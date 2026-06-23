import { createPublicClient, http, formatUnits } from "viem";

const BANK = "0xa0499cF9864f4375728e1EC24DE159AB9357E05f";
const SAFE = "0x5E56F9685826fC72b08011DCfEC20A319bb23a39";
const OPERATOR = "0x889a881021930bB9aC747e651030366E34a9d552";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const client = createPublicClient({
  chain: { id: 137, name: "polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: ["https://polygon-bor-rpc.publicnode.com"] } } },
  transport: http("https://polygon-bor-rpc.publicnode.com"),
});

const abi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "maxBet", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dailyWithdrawCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];

const read = (name) => client.readContract({ address: BANK, abi, functionName: name });
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
const mark = (ok) => (ok ? "✅" : "❌");

const owner = await read("owner");
const pending = await read("pendingOwner");
const operator = await read("operator");
const maxBet = await read("maxBet");
const cap = await read("dailyWithdrawCap");
const token = await read("token");
const bal = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [BANK] });

console.log("\n=== WaterGameBank en Polygon mainnet ===");
console.log(`${mark(eq(owner, SAFE))} owner            = ${owner}  (Safe esperado)`);
console.log(`${mark(pending === "0x0000000000000000000000000000000000000000")} pendingOwner     = ${pending}  (debe ser 0x0)`);
console.log(`${mark(eq(operator, OPERATOR))} operator         = ${operator}`);
console.log(`${mark(maxBet === 100000n)} maxBet           = ${maxBet}  (${formatUnits(maxBet, 6)} USDC)`);
console.log(`${mark(cap === 1000000n)} dailyWithdrawCap = ${cap}  (${formatUnits(cap, 6)} USDC)`);
console.log(`${mark(eq(token, USDC))} token            = ${token}  (USDC real)`);
console.log(`   fondo del contrato = ${formatUnits(bal, 6)} USDC`);
console.log("");
