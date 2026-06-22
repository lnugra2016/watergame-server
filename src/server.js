// Servidor WaterGame: HTTP (REST) + WebSocket (rondas en vivo).
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { ledger } from "./ledger.js";
import { GameEngine } from "./gameEngine.js";
import { readDeposited, signWithdraw, checkOperator, operator } from "./signer.js";

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

// ---- WebSocket: cada cliente se autentica con su address y juega ----
wss.on("connection", (ws) => {
  ws.address = null;
  ws.send(JSON.stringify(game.state()));

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.type === "auth" && m.address) {
      ws.address = String(m.address).toLowerCase();
      ws.send(JSON.stringify({ type: "balance", balance: ledger.getBalance(ws.address) }));
      return;
    }
    if (!ws.address) {
      ws.send(JSON.stringify({ type: "error", error: "No autenticado" }));
      return;
    }
    if (m.type === "bet") {
      const r = game.placeBet(ws.address, Number(m.amount));
      ws.send(JSON.stringify({ type: "betAck", ...r }));
    }
    if (m.type === "cashout") {
      const r = game.cashout(ws.address);
      ws.send(JSON.stringify({ type: "cashoutAck", ...r }));
    }
  });
});

// envía saldo actualizado tras cada crash (por si cambió)
const origBroadcast = broadcast;

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

// Sincroniza un depósito on-chain → acredita saldo de juego
// El frontend llama esto después de que el usuario hace deposit() en el contrato.
app.post("/sync-deposit", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: "address requerida" });
    const onchain = await readDeposited(address);
    const credited = ledger.syncDeposit(address, onchain);
    res.json({ ok: true, credited, balance: ledger.getBalance(address) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Consulta de saldo de juego
app.get("/balance/:address", (req, res) => {
  res.json({ balance: ledger.getBalance(req.params.address) });
});

// Pide autorización de retiro: el servidor firma EIP-712 el saldo retirable.
// Body: { address, amount }  -> retira `amount` del saldo de juego.
app.post("/withdraw-auth", async (req, res) => {
  try {
    const { address, amount } = req.body;
    const amt = Number(amount);
    if (!address || !(amt > 0)) return res.status(400).json({ error: "address y amount requeridos" });
    if (ledger.getBalance(address) < amt) return res.status(400).json({ error: "Saldo insuficiente" });

    const cumulative = ledger.reserveWithdraw(address, amt);
    if (cumulative == null) return res.status(400).json({ error: "No se pudo reservar" });

    const nonce = ledger.nextNonce(address);
    const sig = await signWithdraw(address, cumulative, nonce);
    res.json({
      ok: true,
      // el frontend llama contract.withdraw(cumulative, nonce, expiry, signature)
      cumulative: sig.cumulative,
      nonce: sig.nonce,
      expiry: sig.expiry,
      signature: sig.signature,
      newBalance: ledger.getBalance(address),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- arranque ----
server.listen(config.port, async () => {
  console.log(`\n💧 WaterGame server en http://localhost:${config.port}`);
  console.log(`   Operator: ${operator.address}`);
  console.log(`   Bank:     ${config.bankAddress}`);
  try {
    const ok = await checkOperator();
    if (ok) console.log("   ✅ El operator del contrato coincide con esta clave.\n");
    else console.log("   ⚠ OJO: el operator del contrato NO coincide con esta clave. Las firmas serán rechazadas.\n");
  } catch (e) {
    console.log("   ⚠ No se pudo verificar el operator on-chain:", e.message, "\n");
  }
});
