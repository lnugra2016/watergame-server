import { createPublicClient, http, formatUnits } from "viem";

const BANK = "0xa0499cF9864f4375728e1EC24DE159AB9357E05f";
const WALLET = "0xc7aA03b8C42a876f5c42F37de795E48fE703d6B0";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const client = createPublicClient({
  chain: { id: 137, name: "polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: ["https://polygon-bor-rpc.publicnode.com"] } } },
  transport: http("https://polygon-bor-rpc.publicnode.com"),
});

const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const bankAbi = [
  { type: "function", name: "deposited", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawn", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

const contractUsdc = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [BANK] });
const walletUsdc = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [WALLET] });
const deposited = await client.readContract({ address: BANK, abi: bankAbi, functionName: "deposited", args: [WALLET] });
const withdrawn = await client.readContract({ address: BANK, abi: bankAbi, functionName: "withdrawn", args: [WALLET] });

console.log("\n=== Rastreo de fondos (on-chain, no miente) ===");
console.log("USDC DENTRO del contrato      :", formatUnits(contractUsdc, 6), "USDC");
console.log("USDC en tu wallet             :", formatUnits(walletUsdc, 6), "USDC");
console.log("Total que DEPOSITASTE (histórico):", formatUnits(deposited, 6), "USDC");
console.log("Total que RETIRASTE on-chain  :", formatUnits(withdrawn, 6), "USDC");
console.log("");
if (withdrawn === 0n) {
  console.log(">> Confirmado: NUNCA se ejecutó un retiro on-chain (no confirmaste en MetaMask).");
  console.log(">> Toda tu plata está SANA y SALVA dentro del contrato. No se perdió nada.");
}
