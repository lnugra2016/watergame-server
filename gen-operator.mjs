// Genera una clave de operator NUEVA para mainnet y escribe un .env.mainnet listo.
// La clave privada SOLO se escribe a disco (.env.mainnet, gitignored). En consola se
// imprime únicamente la dirección pública (eso es lo que va como OPERATOR_ADDR al desplegar).
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync } from "node:fs";

const OUT = ".env.mainnet";
if (existsSync(OUT)) {
  console.error(`\n❌ ${OUT} ya existe. Borralo a mano si querés regenerar (NO sobrescribo claves).\n`);
  process.exit(1);
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

const env = `# ===== WaterGame server — PRODUCCIÓN (Polygon mainnet) =====
# ⚠ Este archivo contiene la CLAVE del operator. NUNCA lo subas a internet.

# ---- Red / contrato ----
RPC_URL=https://polygon-bor-rpc.publicnode.com
CHAIN_ID=137
BANK_ADDRESS=RELLENAR_DESPUES_DEL_DEPLOY
TOKEN_ADDRESS=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359

# ---- Clave del OPERATOR (firmante de retiros) — NUEVA para mainnet ----
OPERATOR_PRIVATE_KEY=${pk}

# ---- Base de datos (Postgres gestionado) ----
DATABASE_URL=RELLENAR_URL_DE_POSTGRES
DB_SSL=true

# ---- SIWE ----
SIWE_DOMAIN=RELLENAR_HOST_DEL_FRONTEND

# ---- Servidor / juego ----
PORT=8787
TOKEN_DECIMALS=6
`;

writeFileSync(OUT, env, { mode: 0o600 });
console.log("\n✅ Clave de operator nueva generada.");
console.log("   Escrita en:", OUT, "(la clave NO se muestra aquí)");
console.log("\n>> OPERATOR_ADDR (dirección pública, usar al desplegar):");
console.log("   " + account.address + "\n");
