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

  // Reconcilia el saldo contra los retiros YA EJECUTADOS on-chain. Si el contrato
  // registra más retirado de lo que ya descontamos, descuenta esa diferencia ahora.
  // Así el saldo baja SOLO cuando el retiro realmente ocurrió en la blockchain.
  // Devuelve el saldo actualizado.
  async reconcile(addr, onchainWithdrawn) {
    const a = lc(addr);
    const onchain = r6(onchainWithdrawn);
    return db.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT balance, reflected_withdrawn FROM players WHERE address = $1 FOR UPDATE",
        [a]
      );
      if (!rows.length) return 0;
      const balance = num(rows[0].balance);
      const reflected = num(rows[0].reflected_withdrawn);
      if (onchain <= reflected) return balance;
      const delta = r6(onchain - reflected);
      const newBalance = Math.max(0, r6(balance - delta));
      await client.query(
        `UPDATE players SET balance = $2, reflected_withdrawn = $3, updated_at = now() WHERE address = $1`,
        [a, newBalance, onchain]
      );
      return newBalance;
    });
  },

  // Autoriza un retiro: NO descuenta el saldo (eso pasa cuando se confirma on-chain vía
  // reconcile). Primero reconcilia contra el retirado on-chain, valida saldo suficiente,
  // y firma un cumulative = retirado_on_chain + monto. Anti-replay: el contrato solo paga
  // (cumulative - retirado_on_chain), y el cumulative nunca supera retirado + saldo.
  // Devuelve { cumulative, nonce } o null si el saldo no alcanza.
  async authorizeWithdraw(addr, amount, onchainWithdrawn) {
    const a = lc(addr);
    const amt = r6(amount);
    const onchain = r6(onchainWithdrawn);
    if (!(amt > 0)) return null;
    return db.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT balance, reflected_withdrawn, withdraw_nonce FROM players WHERE address = $1 FOR UPDATE",
        [a]
      );
      if (!rows.length) return null;
      let balance = num(rows[0].balance);
      const reflected = num(rows[0].reflected_withdrawn);
      // Reconciliar primero: si on-chain ya retiró más de lo reflejado, descontar.
      if (onchain > reflected) {
        const delta = r6(onchain - reflected);
        balance = Math.max(0, r6(balance - delta));
      }
      if (balance < amt) {
        // Persistir la reconciliación aunque no alcance, para no repetir el descuento.
        if (onchain > reflected) {
          await client.query(
            `UPDATE players SET balance = $2, reflected_withdrawn = $3, updated_at = now() WHERE address = $1`,
            [a, balance, onchain]
          );
        }
        return null;
      }
      const cumulative = r6(onchain + amt);
      const nonce = Number(rows[0].withdraw_nonce) + 1;
      // Guardamos la reconciliación y el nonce; el saldo NO se descuenta todavía.
      await client.query(
        `UPDATE players SET balance = $2, reflected_withdrawn = $3, withdraw_nonce = $4, updated_at = now() WHERE address = $1`,
        [a, balance, onchain, nonce]
      );
      return { cumulative, nonce };
    });
  },
};
