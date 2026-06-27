// Configuración leída del entorno (.env)
import dotenv from "dotenv";
dotenv.config();

function req(name) {
  const v = process.env[name];
  if (!v || v.includes("TU_CLAVE")) {
    console.error(`\n❌ Falta configurar ${name} en el archivo .env\n`);
    process.exit(1);
  }
  return v;
}

export const config = {
  rpcUrl: process.env.RPC_URL || "https://rpc-amoy.polygon.technology",
  chainId: Number(process.env.CHAIN_ID || 80002),
  bankAddress: req("BANK_ADDRESS"),
  tokenAddress: req("TOKEN_ADDRESS"),
  operatorKey: req("OPERATOR_PRIVATE_KEY"),
  databaseUrl: req("DATABASE_URL"),
  // SSL para Postgres gestionado (Railway/Render/Neon/Supabase). Local: déjalo en false.
  dbSsl: String(process.env.DB_SSL || "false").toLowerCase() === "true",
  // Dominio esperado en el login SIWE (anti-phishing). Ej: "watergame.netlify.app".
  // Si se deja vacío no se valida el dominio (recomendado configurarlo en producción).
  siweDomain: process.env.SIWE_DOMAIN || "",
  // Clave para la página de admin (/admin/liabilities). Si está vacía, la página se desactiva.
  adminSecret: process.env.ADMIN_SECRET || "",
  port: Number(process.env.PORT || 8787),
  decimals: Number(process.env.TOKEN_DECIMALS || 6),
};
