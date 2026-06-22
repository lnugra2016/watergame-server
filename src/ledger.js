// Ledger en memoria. Lleva el saldo de juego de cada jugador.
// ⚠ En producción esto va en una base de datos (Postgres) con respaldo.
//
// Modelo de retiros (coincide con el contrato):
//   withdrawableCumulative[user] = total ACUMULADO que el usuario puede haber retirado.
//   El contrato paga (cumulative - withdrawn_on_chain).
//   Para retirar X: balance -= X ; withdrawableCumulative += X ; se firma el nuevo cumulative.

const balances = new Map();              // address -> saldo de juego (number, en unidades del token)
const creditedDeposits = new Map();      // address -> cuánto del depósito on-chain ya se acreditó
const withdrawCumulative = new Map();    // address -> cumulative firmado
const withdrawNonce = new Map();         // address -> último nonce usado

const lc = (a) => String(a).toLowerCase();

export const ledger = {
  getBalance(addr) {
    return balances.get(lc(addr)) || 0;
  },
  setBalance(addr, v) {
    balances.set(lc(addr), Math.max(0, v));
  },
  credit(addr, amount) {
    balances.set(lc(addr), this.getBalance(addr) + amount);
  },
  debit(addr, amount) {
    const b = this.getBalance(addr);
    if (amount > b + 1e-9) return false;
    balances.set(lc(addr), b - amount);
    return true;
  },

  // Acredita la parte NUEVA de un depósito on-chain
  syncDeposit(addr, onchainDeposited) {
    const already = creditedDeposits.get(lc(addr)) || 0;
    if (onchainDeposited > already) {
      const delta = onchainDeposited - already;
      creditedDeposits.set(lc(addr), onchainDeposited);
      this.credit(addr, delta);
      return delta;
    }
    return 0;
  },

  getCumulative(addr) {
    return withdrawCumulative.get(lc(addr)) || 0;
  },
  nextNonce(addr) {
    const n = (withdrawNonce.get(lc(addr)) || 0) + 1;
    withdrawNonce.set(lc(addr), n);
    return n;
  },
  // Mueve `amount` del saldo de juego al acumulado retirable y devuelve el nuevo cumulative
  reserveWithdraw(addr, amount) {
    if (!this.debit(addr, amount)) return null;
    const cum = this.getCumulative(addr) + amount;
    withdrawCumulative.set(lc(addr), cum);
    return cum;
  },
};
