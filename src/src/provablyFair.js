// Provably fair: misma fórmula que el contrato/frontend.
import { createHash } from "node:crypto";

export function sha256hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

// genera semilla aleatoria de 64 hex
export function randomSeed() {
  const b = createHash("sha256").update(String(Math.random()) + Date.now()).digest("hex");
  return b;
}

// crash multiplier determinista a partir de las semillas + nonce
export function crashPoint(serverSeed, clientSeed, nonce) {
  const hex = sha256hex(`${serverSeed}:${clientSeed}:${nonce}`).slice(0, 13);
  const h = parseInt(hex, 16);
  const e = Math.pow(2, 52);
  if (h % 33 === 0) return 1.0; // ventaja de la casa
  const c = Math.floor((100 * e - h) / (e - h)) / 100;
  return Math.max(1.0, c);
}
