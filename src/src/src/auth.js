// Autenticación SIWE (Sign-In With Ethereum, EIP-4361).
// El jugador prueba que controla su wallet FIRMANDO un mensaje. Sin esto, cualquiera
// podía hacerse pasar por otra dirección y mover su saldo/retiros.
//
// Flujo:
//   1) GET  /siwe/nonce          -> nonce de un solo uso
//   2) el cliente firma un mensaje SIWE con ese nonce
//   3) POST /siwe/verify         -> verifica la firma y entrega un token de sesión
//   4) el token autoriza el WebSocket y los endpoints sensibles
//
// Nonces y sesiones viven en memoria: perderlos solo obliga a re-loguear (no es dinero).
// Para varias instancias detrás de un balanceador, mover esto a Redis/Postgres.
import crypto from "node:crypto";
import { parseSiweMessage, verifySiweMessage, generateSiweNonce } from "viem/siwe";
import { publicClient } from "./signer.js";
import { config } from "./config.js";

const NONCE_TTL_MS = 10 * 60 * 1000;        // 10 min para firmar
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h de sesión

const nonces = new Map();   // nonce -> expiresAt
const sessions = new Map(); // token -> { address, expiresAt }

export function issueNonce() {
  const nonce = generateSiweNonce();
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return nonce;
}

function consumeNonce(nonce) {
  const exp = nonces.get(nonce);
  nonces.delete(nonce); // un solo uso, pase lo que pase
  return !!exp && exp >= Date.now();
}

// Verifica el mensaje SIWE firmado y, si es válido, crea una sesión. Devuelve { token, address }.
export async function verifyLogin({ message, signature }) {
  if (!message || !signature) throw new Error("Falta message o signature");

  const parsed = parseSiweMessage(message);
  if (!parsed?.address || !parsed?.nonce) throw new Error("Mensaje SIWE inválido");

  // El nonce debe ser uno que NOSOTROS emitimos y no haber expirado/usado.
  if (!consumeNonce(parsed.nonce)) throw new Error("Nonce inválido o expirado");

  // La red del mensaje debe coincidir con la del juego.
  if (parsed.chainId != null && Number(parsed.chainId) !== config.chainId) {
    throw new Error("chainId incorrecto");
  }

  // Verifica la firma (EOA o wallet de contrato vía EIP-1271). Si SIWE_DOMAIN está
  // configurado, exige que el dominio del mensaje coincida (anti-phishing).
  const params = { message, signature, nonce: parsed.nonce };
  if (config.siweDomain) params.domain = config.siweDomain;
  const valid = await verifySiweMessage(publicClient, params);
  if (!valid) throw new Error("Firma inválida");

  const address = parsed.address.toLowerCase();
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { address, expiresAt: Date.now() + SESSION_TTL_MS });
  return { token, address };
}

// Devuelve la dirección de la sesión, o null si el token no vale / expiró.
export function resolveSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return s.address;
}

// Middleware Express: exige "Authorization: Bearer <token>" y deja req.address.
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const address = resolveSession(token);
  if (!address) return res.status(401).json({ error: "No autenticado (inicia sesión con tu wallet)" });
  req.address = address;
  next();
}

// Limpieza periódica de nonces/sesiones vencidos.
export function startAuthGc() {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of nonces) if (exp < now) nonces.delete(k);
    for (const [k, s] of sessions) if (s.expiresAt < now) sessions.delete(k);
  }, 60_000);
  t.unref?.();
}
