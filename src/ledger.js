// Ledger persistente en Postgres. Lleva el saldo de juego de cada jugador.
// TODAS las operaciones de dinero son ATÓMICAS: dos mensajes concurrentes del mismo
// jugador (doble apuesta, doble cash-out, doble retiro) no pueden duplicar saldo.
//
// Modelo de retiros (coincide con el contrato):
//   withdraw_cumulative[user] = total ACUMULADO que el usuario puede haber retirado.
//   El contrato paga (cumulative - withdrawn_on_chain).
//   Para retirar X: balance -= X ; withdraw_cumulative += X ; se firma el nuevo cumulative.
import { db } from "./db.js";

const lc = (a) => String(a).toLowerCase();
// Redondea a 6 decimales (precisión del token) para no arrastrar ruido de floats.
const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const num = (v) => (v == null ? 0 : Number(v));

export const ledger = {
  async getBalance(addr) {
    const { rows } = await db.query(
      "SELECT balance FROM players WHERE address = $1",
      [lc(addr)]
    );
    return rows.length ? num(rows[0].balance) : 0;
  },

  // Suma saldo (cash-out, acreditar depósito). Crea la fila si no existe. Atómico.
  async credit(addr, amount) {
    const a = r6(amount);
    if (a <= 0) return this.getBalance(addr);
    const { rows } = await db.query(
      `INSERT INTO players (address, balance) VALUES ($1, $2)
       ON CONFLICT (address) DO UPDATE
         SET balance = players.balance + EXCLUDED.balance, updated_at = now()
       RETURNING balance`,
      [lc(addr), a]
    );
    return num(rows[0].balance);
  },

  // Resta saldo (apuesta). Atómico: solo descuenta si HAY saldo suficiente.
  // Devuelve true si descontó, false si saldo insuficiente.
  async debit(addr, amount) {
    const a = r6(amount);
    if (!(a > 0)) return false;
    const { rowCount } = await db.query(
      `UPDATE players SET balance = balance - $2, updated_at = now()
       WHERE address = $1 AND balance >= $2`,
      [lc(addr), a]
    );
    return rowCount === 1;
  },

  // Acredita la parte NUEVA de un depósito on-chain. Atómico con bloqueo de fila
  // para que dos /sync-deposit simultáneos no acrediten dos veces el mismo delta.
  async syncDeposit(addr, onchainDeposited) {
    const a = lc(addr);
    const onchain = r6(onchainDeposited);
    return db.tx(async (client) => {
      // Asegura la fila y la bloquea durante la transacción.
      await client.query(
        `INSERT INTO players (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
        [a]
      );
      const { rows } = await client.query(
        "SELECT credited_deposits FROM players WHERE address = $1 FOR UPDATE",
        [a]
      );
      const already = num(rows[0].credited_deposits);
      if (onchain <= already) return 0;
      const delta = r6(onchain - already);
      await client.query(
        `UPDATE players
           SET balance = balance + $2, credited_deposits = $3, updated_at = now()
         WHERE address = $1`,
        [a, delta, onchain]
      );
      return delta;
    });
  },

  async getCumulative(addr) {
    const { rows } = await db.query(
      "SELECT withdraw_cumulative FROM players WHERE address = $1",
      [lc(addr)]
    );
    return rows.length ? num(rows[0].withdraw_cumulative) : 0;
  },

  // Reserva un retiro de forma ATÓMICA: descuenta saldo, sube el cumulative y el nonce
  // en una sola transacción con bloqueo de fila. Devuelve { cumulative, nonce } o null
  // si el saldo es insuficiente.
  async reserveWithdraw(addr, amount) {
    const a = lc(addr);
    const amt = r6(amount);
    if (!(amt > 0)) return null;
    return db.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT balance, withdraw_cumulative, withdraw_nonce FROM players WHERE address = $1 FOR UPDATE",
        [a]
      );
      if (!rows.length) return null;
      const balance = num(rows[0].balance);
      if (balance < amt) return null;
      const cumulative = r6(num(rows[0].withdraw_cumulative) + amt);
      const nonce = Number(rows[0].withdraw_nonce) + 1;
      await client.query(
        `UPDATE players
           SET balance = balance - $2, withdraw_cumulative = $3, withdraw_nonce = $4, updated_at = now()
         WHERE address = $1`,
        [a, amt, cumulative, nonce]
      );
      return { cumulative, nonce };
    });
  },
};
