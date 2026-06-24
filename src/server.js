// Servidor WaterGame: HTTP (REST) + WebSocket (rondas en vivo).
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { ledger } from "./ledger.js";
import { initDb } from "./db.js";
import { GameEngine } from "./gameEngine.js";
import { readDeposited, readWithdrawn, readContractBalance, signWithdraw, checkOperator, operator } from "./signer.js";
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

// ---- Admin: reporte de caja (cuánto es ganancia vs. cuánto se les debe a los jugadores) ----
// Protegido con ADMIN_SECRET. Abrir en el navegador:
//   https://watergame-server.onrender.com/admin/liabilities?key=TU_ADMIN_SECRET
const f2 = (n) => Number(n).toFixed(2);
function liabilitiesPage(d) {
  const warn = d.undercollateralized
    ? `<div class="card bad"><b>⚠ ALERTA:</b> el contrato tiene MENOS USDC ($${f2(d.contractBalance)}) que lo que se les debe a los jugadores ($${f2(d.totalOwed)}). NO retires nada y revisá esto.</div>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>WaterGame — Caja</title><style>
body{font-family:system-ui,sans-serif;background:#0f1720;color:#e8f0f5;margin:0;padding:24px;}
.wrap{max-width:520px;margin:0 auto;}
h1{font-size:20px;margin:0 0 4px;} .sub{color:#8aa;font-size:13px;margin-bottom:20px;}
.card{background:#16212c;border:1px solid #243441;border-radius:14px;padding:16px 18px;margin-bottom:12px;}
.row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;}
.row .lbl{color:#9bb;} .row .val{font-weight:700;font-size:18px;}
.big{font-size:26px;} .aqua{color:#5ed9d0;} .green{color:#5fd38a;} .muted{color:#8aa;font-size:12px;}
.bad{border-color:#a33;background:#2a1717;color:#f3b0b0;}
.hi{background:#13261f;border-color:#1f5a40;}
code{background:#0b1117;padding:2px 6px;border-radius:6px;}
</style></head><body><div class="wrap">
<h1>💧 WaterGame — Estado de la caja</h1>
<div class="sub">Jugadores con saldo: ${d.players} · actualizado al abrir</div>
${warn}
<div class="card">
  <div class="row"><span class="lbl">USDC en el contrato (la caja)</span><span class="val">$${f2(d.contractBalance)}</span></div>
  <div class="row"><span class="lbl">Le debés a los jugadores</span><span class="val">$${f2(d.totalOwed)}</span></div>
  <div class="row"><span class="lbl">Excedente (ganancia bruta)</span><span class="val aqua">$${f2(d.surplus)}</span></div>
</div>
<div class="card hi">
  <div class="row"><span class="lbl">Colchón recomendado (reserva)</span><span class="val">$${f2(d.recommendedBuffer)}</span></div>
  <div class="row"><span class="lbl">✅ Podés retirar con tranquilidad</span><span class="val big green">$${f2(d.safeToWithdraw)}</span></div>
  <div class="muted" style="margin-top:8px">Dejamos un colchón del ${Math.round(d.bufferPct*100)}% del excedente por si un jugador gana fuerte. La caja siempre tiene que poder pagarle a todos.</div>
</div>
<div class="card">
  <div class="muted">Para retirar esos <b>$${f2(d.safeToWithdraw)}</b>:<br/>
  1) En tu PC: <code>node gen-housewithdraw.mjs ${f2(d.safeToWithdraw)}</code><br/>
  2) Pegá el Data hex en el Safe (2-de-3) → Transaction Builder → Custom data → firmá con 2 llaves → ejecutá.</div>
</div>
</div></body></html>`;
}

app.get("/admin/liabilities", async (req, res) => {
  if (!config.adminSecret) return res.status(503).send("Falta configurar ADMIN_SECRET en el servidor.");
  const hdr = req.headers.authorization || "";
  const key = req.query.key || (hdr.startsWith("Bearer ") ? hdr.slice(7) : null);
  if (key !== config.adminSecret) return res.status(401).send("No autorizado. Agregá ?key=TU_ADMIN_SECRET a la URL.");
  try {
    const { totalOwed, players } = await ledger.totals();
    const contractBalance = await readContractBalance();
    const surplus = Math.max(0, contractBalance - totalOwed);
    const bufferPct = Number(process.env.HOUSE_BUFFER_PCT || 0.25);
    const recommendedBuffer = surplus * bufferPct;
    const safeToWithdraw = Math.max(0, surplus - recommendedBuffer);
    const undercollateralized = contractBalance < totalOwed - 1e-9;
    const data = { contractBalance, totalOwed, players, surplus, recommendedBuffer, safeToWithdraw, bufferPct, undercollateralized };
    if (req.query.format === "json") return res.json(data);
    res.send(liabilitiesPage(data));
  } catch (e) {
    res.status(500).send("Error: " + String(e.message || e));
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
