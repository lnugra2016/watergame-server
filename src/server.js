// Servidor WaterGame: HTTP (REST) + WebSocket (rondas en vivo).
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { ledger } from "./ledger.js";
import { initDb } from "./db.js";
import { GameEngine } from "./gameEngine.js";
import { readDeposited, readWithdrawn, signWithdraw, checkOperator, operator } from "./signer.js";
import { issueNonce, verifyLogin, resolveSession, requireAuth, startAuthGc } from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// ---- broadcast a todos los clientes ----
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(data); });
}

const game = new GameEngine(broadcast);

// ---- WebSocket: cada cliente se autentica con su token de sesión SIWE y juega ----
wss.on("connection", (ws) => {
  ws.address = null;
  ws.send(JSON.stringify(game.state()));

  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.type === "auth") {
      // Solo se acepta un token de sesión obtenido vía /siwe/verify. Nada de address suelta.
      const address = resolveSession(m.token);
      if (!address) {
        ws.send(JSON.stringify({ type: "error", error: "Sesión inválida, inicia sesión con tu wallet" }));
        return;
      }
      ws.address = address;
      ws.send(JSON.stringify({ type: "balance", balance: await freshBalance(ws.address) }));
      return;
    }
    if (!ws.address) {
      ws.send(JSON.stringify({ type: "error", error: "No autenticado" }));
      return;
    }
    if (m.type === "bet") {
      const r = await game.placeBet(ws.address, Number(m.amount));
      ws.send(JSON.stringify({ type: "betAck", ...r }));
    }
    if (m.type === "cashout") {
      const r = await game.cashout(ws.address);
      ws.send(JSON.stringify({ type: "cashoutAck", ...r }));
    }
  });
});

// ---- REST ----

// estado simple para verificar que vive
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "watergame-server",
    operator: operator.address,
    bank: config.bankAddress,
    token: config.tokenAddress,
    chainId: config.chainId,
    round: game.roundId,
    phase: game.phase,
  });
});

// ---- SIWE (login con wallet) ----

// 1) El cliente pide un nonce de un solo uso.
app.get("/siwe/nonce", (_req, res) => {
  res.json({ nonce: issueNonce() });
});

// 2) El cliente firma el mensaje SIWE y lo manda; devolvemos un token de sesión.
app.post("/siwe/verify", async (req, res) => {
  try {
    const { message, signature } = req.body;
    const session = await verifyLogin({ message, signature });
    res.json({ ok: true, ...session });
  } catch (e) {
    res.status(401).json({ ok: false, error: String(e.message || e) });
  }
});

// Sincroniza un depósito on-chain → acredita saldo de juego del jugador AUTENTICADO.
app.post("/sync-deposit", requireAuth, async (req, res) => {
  try {
    const onchain = await readDeposited(req.address);
    const credited = await ledger.syncDeposit(req.address, onchain);
    res.json({ ok: true, credited, balance: await ledger.getBalance(req.address) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Saldo de juego reconciliado contra los retiros ya confirmados on-chain.
// Si la lectura on-chain falla, cae al saldo guardado (no rompe la UI).
async function freshBalance(address) {
  try {
    const onchainWithdrawn = await readWithdrawn(address);
    return await ledger.reconcile(address, onchainWithdrawn);
  } catch {
    return ledger.getBalance(address);
  }
}

// Consulta de saldo de juego (solo el propio, autenticado).
app.get("/balance", requireAuth, async (req, res) => {
  try {
    res.json({ balance: await freshBalance(req.address) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Pide autorización de retiro: el servidor firma EIP-712 el saldo retirable.
// La dirección sale de la sesión SIWE, NUNCA del body (si no, se podría drenar a otros).
// Body: { amount }
app.post("/withdraw-auth", requireAuth, async (req, res) => {
  try {
    const amt = Number(req.body?.amount);
    if (!(amt > 0)) return res.status(400).json({ error: "amount requerido" });

    // Firma el retiro SIN descontar el saldo (se descuenta al confirmarse on-chain).
    // cumulative = retirado_on_chain + monto; el contrato paga la diferencia.
    const onchainWithdrawn = await readWithdrawn(req.address);
    const reservation = await ledger.authorizeWithdraw(req.address, amt, onchainWithdrawn);
    if (!reservation) return res.status(400).json({ error: "Saldo insuficiente" });

    const sig = await signWithdraw(req.address, reservation.cumulative, reservation.nonce);
    res.json({
      ok: true,
      // el frontend llama contract.withdraw(cumulative, nonce, expiry, signature)
      cumulative: sig.cumulative,
      nonce: sig.nonce,
      expiry: sig.expiry,
      signature: sig.signature,
      newBalance: await ledger.getBalance(req.address),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- arranque ----
async function start() {
  try {
    await initDb();
    console.log("   🗄  Base de datos lista (Postgres).");
  } catch (e) {
    console.error("\n❌ No se pudo conectar a Postgres. Revisa DATABASE_URL.\n", e.message, "\n");
    process.exit(1);
  }
  startAuthGc();
  server.listen(config.port, onListening);
}

async function onListening() {
  console.log(`\n💧 WaterGame server en http://localhost:${config.port}`);
  console.log(`   Operator: ${operator.address}`);
  console.log(`   Bank:     ${config.bankAddress}`);
  console.log(`   SIWE:     login con wallet ${config.siweDomain ? `(dominio: ${config.siweDomain})` : "(⚠ SIWE_DOMAIN sin configurar)"}`);
  try {
    const ok = await checkOperator();
    if (ok) console.log("   ✅ El operator del contrato coincide con esta clave.\n");
    else console.log("   ⚠ OJO: el operator del contrato NO coincide con esta clave. Las firmas serán rechazadas.\n");
  } catch (e) {
    console.log("   ⚠ No se pudo verificar el operator on-chain:", e.message, "\n");
  }
}

start();
