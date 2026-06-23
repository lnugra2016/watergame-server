import { createPublicClient, http, formatUnits, formatEther } from "viem";

const WALLET = "0xc7aA03b8C42a876f5c42F37de795E48fE703d6B0";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const client = createPublicClient({
  chain: { id: 137, name: "polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: ["https://polygon-bor-rpc.publicnode.com"] } } },
  transport: http("https://polygon-bor-rpc.publicnode.com"),
});

const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const usdc = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [WALLET] });
const pol = await client.getBalance({ address: WALLET });

console.log("Wallet:", WALLET);
console.log("USDC:", formatUnits(usdc, 6), usdc > 0n ? "✅" : "❌ (no hay USDC para depositar)");
console.log("POL :", formatEther(pol), pol > 0n ? "✅ (para gas)" : "❌ (sin gas)");
