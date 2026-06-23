// Test del ledger contra Postgres en memoria (pg-mem). Valida la lógica de dinero:
// depósitos, apuestas, saldo insuficiente, retiros atómicos y anti-doble-acreditación.
// Ejecutar: node test/ledger.test.js
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { initDb, db } from "../src/db.js";
import { ledger } from "../src/ledger.js";

const A = "0xAbC0000000000000000000000000000000000001";
let passed = 0;
const ok = (name) => { console.log(`  ✅ ${name}`); passed++; };

async function main() {
  // Postgres en memoria, inyectado al holder db.
  const mem = newDb();
  const pgAdapter = mem.adapters.createPg();
  await initDb(new pgAdapter.Pool());

  // 1) saldo inicial 0
  assert.equal(await ledger.getBalance(A), 0);
  ok("saldo inicial = 0");

  // 2) credit suma y crea fila
  assert.equal(await ledger.credit(A, 100), 100);
  assert.equal(await ledger.getBalance(A), 100);
  ok("credit acredita saldo");

  // 3) debit con saldo suficiente
  assert.equal(await ledger.debit(A, 30), true);
  assert.equal(await ledger.getBalance(A), 70);
  ok("debit descuenta saldo");

  // 4) debit con saldo insuficiente NO descuenta
  assert.equal(await ledger.debit(A, 999), false);
  assert.equal(await ledger.getBalance(A), 70);
  ok("debit rechaza si no alcanza el saldo");

  // 5) syncDeposit acredita solo el delta nuevo, y no duplica
  const d1 = await ledger.syncDeposit(A, 200); // depósito on-chain total = 200
  assert.equal(d1, 200);
  assert.equal(await ledger.getBalance(A), 270); // 70 + 200
  const d2 = await ledger.syncDeposit(A, 200); // mismo total, nada nuevo
  assert.equal(d2, 0);
  assert.equal(await ledger.getBalance(A), 270);
  const d3 = await ledger.syncDeposit(A, 250); // sube a 250, delta = 50
  assert.equal(d3, 50);
  assert.equal(await ledger.getBalance(A), 320);
  ok("syncDeposit acredita solo el delta, sin duplicar");

  // 6) reserveWithdraw: descuenta saldo y sube cumulative + nonce atómicamente
  const r1 = await ledger.reserveWithdraw(A, 100);
  assert.deepEqual(r1, { cumulative: 100, nonce: 1 });
  assert.equal(await ledger.getBalance(A), 220);
  const r2 = await ledger.reserveWithdraw(A, 50);
  assert.deepEqual(r2, { cumulative: 150, nonce: 2 }); // cumulative monótono
  assert.equal(await ledger.getBalance(A), 170);
  ok("reserveWithdraw: cumulative monótono + nonce incremental");

  // 7) reserveWithdraw rechaza si no hay saldo
  const r3 = await ledger.reserveWithdraw(A, 9999);
  assert.equal(r3, null);
  assert.equal(await ledger.getBalance(A), 170);
  ok("reserveWithdraw rechaza si no alcanza el saldo");

  // 8) decimales: el redondeo a 6 decimales no rompe la contabilidad
  await ledger.credit(A, 0.111111);
  assert.equal(await ledger.getBalance(A), 170.111111);
  ok("maneja 6 decimales sin ruido de float");

  // 9) carrera de apuestas concurrentes: dos debit a la vez no sobregiran el saldo
  const B = "0xBbb0000000000000000000000000000000000002";
  await ledger.credit(B, 100);
  const results = await Promise.all([
    ledger.debit(B, 80),
    ledger.debit(B, 80),
  ]);
  const exitos = results.filter(Boolean).length;
  assert.equal(exitos, 1, "solo una de las dos apuestas de 80 debe pasar");
  assert.equal(await ledger.getBalance(B), 20);
  ok("apuestas concurrentes no sobregiran (atomicidad)");

  await db.pool.end?.();
  console.log(`\n  ${passed} pruebas OK ✅\n`);
}

main().catch((e) => { console.error("\n  ❌ FALLO:", e.message, "\n", e); process.exit(1); });
