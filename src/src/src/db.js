// Capa de base de datos (Postgres). Pool de conexiones + esquema + helper de transacciones.
// El saldo de cada jugador es DINERO: se persiste aquí, no en memoria. Si el server se
// reinicia, el estado sobrevive.
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// Holder del pool. En producción lo crea initDb(); en los tests se le inyecta un
// pool de pg-mem. El resto del código usa db.query() / db.tx() sin saber cuál es.
export const db = {
  pool: null,
  query: (...args) => db.pool.query(...args),

  // Ejecuta `fn(client)` dentro de una transacción: COMMIT si todo va bien,
  // ROLLBACK ante cualquier error. Siempre devuelve la conexión al pool.
  async tx(fn) {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* noop */ }
      throw e;
    } finally {
      client.release();
    }
  },
};

function makePool() {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    // SSL para Postgres gestionado (Railway/Render/Neon/Supabase). Local: sin SSL.
    ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  pool.on("error", (err) => {
    console.error("⚠ Error inesperado en el pool de Postgres:", err.message);
  });
  return pool;
}

// Inicializa la conexión y crea las tablas si no existen.
// `poolOverride` solo lo usan los tests (pg-mem); en producción se llama sin argumentos.
// NUMERIC(38,6) = misma precisión que el token (6 decimales), sin errores de floats.
export async function initDb(poolOverride) {
  db.pool = poolOverride || makePool();
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      address             TEXT PRIMARY KEY,
      balance             NUMERIC(38,6) NOT NULL DEFAULT 0,
      credited_deposits   NUMERIC(38,6) NOT NULL DEFAULT 0,
      withdraw_cumulative NUMERIC(38,6) NOT NULL DEFAULT 0,
      withdraw_nonce      BIGINT        NOT NULL DEFAULT 0,
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
      CONSTRAINT balance_non_negative CHECK (balance >= 0)
    );
  `);
  // Migración: columna que registra cuánto retiro on-chain ya descontamos del saldo.
  // Permite descontar el saldo SOLO cuando el retiro se confirmó en la blockchain.
  await db.pool.query(
    `ALTER TABLE players ADD COLUMN IF NOT EXISTS reflected_withdrawn NUMERIC(38,6) NOT NULL DEFAULT 0;`
  );

  // Reset opcional del ledger (para empezar limpio). Poné WIPE_LEDGER=true UNA vez,
  // redeployá, y después volvé a ponerlo en false.
  // ⚠ NO borramos las filas. Si las borráramos (TRUNCATE), el próximo /sync-deposit
  //   RE-ACREDITARÍA todos los depósitos históricos on-chain —deposited() es acumulativo
  //   y nunca baja— e inflaría el saldo (exactamente el bug que tuvimos en la migración).
  //   En vez de eso ponemos los saldos en 0 PERO conservamos credited_deposits y
  //   reflected_withdrawn (las marcas contra la blockchain): así los depósitos viejos
  //   quedan marcados como YA acreditados y solo se acredita lo NUEVO. Reset seguro.
  if (String(process.env.WIPE_LEDGER || "").toLowerCase() === "true") {
    await db.pool.query(
      "UPDATE players SET balance = 0, withdraw_nonce = 0, updated_at = now();"
    );
    console.log("⚠ WIPE_LEDGER=true → saldos en 0 (marcas on-chain conservadas, sin re-acreditar). Poné WIPE_LEDGER=false.");
  }
  return db.pool;
}
