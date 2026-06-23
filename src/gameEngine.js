// Motor de rondas en vivo (crash game). Coordina el tiempo real para todos los clientes.
import { randomSeed, sha256hex, crashPoint } from "./provablyFair.js";
import { ledger } from "./ledger.js";

const WAIT_MS = 6000;     // tiempo de apuestas entre rondas
const TICK_MS = 100;      // refresco del multiplicador
const CRASH_HOLD_MS = 3000;
const GROWTH = 0.16;      // velocidad de subida (e^(GROWTH*t))

export class GameEngine {
  constructor(broadcast) {
    this.broadcast = broadcast;        // fn para enviar estado a todos
    this.roundId = 0;
    this.phase = "waiting";
    this.multiplier = 1.0;
    this.history = [];
    this.bets = new Map();             // address -> { amount, cashedAt|null }
    this.clientSeed = "watergame";     // en prod: por jugador
    this._startWaiting();
  }

  state() {
    return {
      type: "state",
      roundId: this.roundId,
      phase: this.phase,
      multiplier: Number(this.multiplier.toFixed(2)),
      history: this.history.slice(0, 14),
      seedHash: this.seedHash || null,
    };
  }

  // ---- fase de espera (apuestas abiertas) ----
  _startWaiting() {
    this.phase = "waiting";
    this.multiplier = 1.0;
    this.bets = new Map();
    this.roundId += 1;

    // provably fair: nueva semilla + commit
    this.serverSeed = randomSeed();
    this.seedHash = sha256hex(this.serverSeed);
    this.crashAt = crashPoint(this.serverSeed, this.clientSeed, this.roundId);

    this.broadcast(this.state());
    this.t0 = Date.now();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._startFlying(), WAIT_MS);
    this._emitCountdown();
  }

  _emitCountdown() {
    if (this.phase !== "waiting") return;
    const elapsed = Date.now() - this.t0;
    const pct = Math.max(0, 1 - elapsed / WAIT_MS) * 100;
    this.broadcast({ type: "countdown", pct: Math.round(pct) });
    if (elapsed < WAIT_MS) setTimeout(() => this._emitCountdown(), 150);
  }

  // ---- fase de vuelo (multiplicador sube) ----
  _startFlying() {
    this.phase = "flying";
    this.t0 = Date.now();
    this.broadcast({ type: "phase", phase: "flying", roundId: this.roundId });
    this._tick();
  }

  _tick() {
    if (this.phase !== "flying") return;
    const t = (Date.now() - this.t0) / 1000;
    let m = Math.exp(GROWTH * t);
    if (m >= this.crashAt) {
      this.multiplier = this.crashAt;
      return this._crash();
    }
    this.multiplier = m;
    this.broadcast({ type: "tick", multiplier: Number(m.toFixed(2)) });
    setTimeout(() => this._tick(), TICK_MS);
  }

  // ---- crash: liquida apuestas no cobradas, revela semilla ----
  _crash() {
    this.phase = "crashed";
    const crashM = Number(this.crashAt.toFixed(2));
    this.history.unshift(crashM);
    this.history = this.history.slice(0, 14);

    // las apuestas no cobradas ya tienen el saldo descontado (se pierden)
    this.broadcast({
      type: "crash",
      roundId: this.roundId,
      crash: crashM,
      serverSeed: this.serverSeed,   // reveal
      clientSeed: this.clientSeed,
    });

    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._startWaiting(), CRASH_HOLD_MS);
  }

  // ---- acciones del jugador ----
  async placeBet(address, amount) {
    const a = address.toLowerCase();
    if (this.phase !== "waiting") return { ok: false, error: "Apuestas cerradas" };
    if (this.bets.has(a)) return { ok: false, error: "Ya apostaste" };
    if (!(amount > 0)) return { ok: false, error: "Monto inválido" };

    // Reserva el slot ANTES del await: bloquea una segunda apuesta concurrente del
    // mismo jugador mientras esperamos a la base de datos.
    this.bets.set(a, { amount, cashedAt: null, pending: true });
    const ok = await ledger.debit(a, amount);
    if (!ok) {
      this.bets.delete(a);
      return { ok: false, error: "Saldo insuficiente" };
    }
    // Si la ronda terminó durante el await (el mapa se reinició), devolvemos el dinero.
    const bet = this.bets.get(a);
    if (!bet) {
      await ledger.credit(a, amount);
      return { ok: false, error: "La ronda terminó, apuesta no registrada" };
    }
    bet.pending = false;
    return { ok: true, balance: await ledger.getBalance(a) };
  }

  async cashout(address) {
    const a = address.toLowerCase();
    if (this.phase !== "flying") return { ok: false, error: "No hay ronda activa" };
    const bet = this.bets.get(a);
    if (!bet || bet.cashedAt || bet.pending) return { ok: false, error: "Sin apuesta activa" };
    const m = this.multiplier;
    if (m >= this.crashAt) return { ok: false, error: "Demasiado tarde" };
    // Marca cobrado ANTES del await: evita doble cash-out por mensajes concurrentes.
    bet.cashedAt = m;
    const payout = bet.amount * m;
    const balance = await ledger.credit(a, payout);
    return { ok: true, multiplier: Number(m.toFixed(2)), payout, balance };
  }
}
