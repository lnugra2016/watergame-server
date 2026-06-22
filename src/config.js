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
  port: Number(process.env.PORT || 8787),
  decimals: Number(process.env.TOKEN_DECIMALS || 6),
};
