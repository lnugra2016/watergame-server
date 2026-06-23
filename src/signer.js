// Cliente blockchain: lee depósitos on-chain y firma retiros (EIP-712).
import { createPublicClient, http, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

const chain = {
  id: config.chainId,
  name: "amoy",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
};

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
export const operator = privateKeyToAccount(config.operatorKey);

const BANK_ABI = [
  { type: "function", name: "deposited", stateMutability: "view", inputs: [{ name: "u", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawn", stateMutability: "view", inputs: [{ name: "u", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const bank = getContract({ address: config.bankAddress, abi: BANK_ABI, client: publicClient });

const SCALE = 10 ** config.decimals;

// Lee cuánto ha depositado un usuario en el contrato (en unidades del token)
export async function readDeposited(address) {
  const raw = await bank.read.deposited([address]);
  return Number(raw) / SCALE;
}

// Verifica que el operator del contrato coincide con nuestra clave
export async function checkOperator() {
  const onchain = await bank.read.operator();
  return onchain.toLowerCase() === operator.address.toLowerCase();
}

// Firma EIP-712 un retiro. cumulative en unidades del token (se convierte a enteros del token).
export async function signWithdraw(user, cumulativeUnits, nonce) {
  const cumulative = BigInt(Math.round(cumulativeUnits * SCALE));
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hora

  const domain = {
    name: "WaterGameBank",
    version: "1",
    chainId: config.chainId,
    verifyingContract: config.bankAddress,
  };
  const types = {
    Withdraw: [
      { name: "user", type: "address" },
      { name: "cumulative", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const message = { user, cumulative, nonce: BigInt(nonce), expiry };

  const signature = await operator.signTypedData({ domain, types, primaryType: "Withdraw", message });
  return { cumulative: cumulative.toString(), nonce, expiry: expiry.toString(), signature };
}
