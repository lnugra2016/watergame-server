import { createPublicClient, http } from "viem";
const SAFE = "0x5E56F9685826fC72b08011DCfEC20A319bb23a39";
const client = createPublicClient({
  chain: { id: 137, name: "polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: ["https://polygon-bor-rpc.publicnode.com"] } } },
  transport: http("https://polygon-bor-rpc.publicnode.com"),
});
const abi = [
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
try {
  const owners = await client.readContract({ address: SAFE, abi, functionName: "getOwners" });
  const th = await client.readContract({ address: SAFE, abi, functionName: "getThreshold" });
  console.log("\nSafe:", SAFE);
  console.log("Firmantes actuales (" + owners.length + "):");
  owners.forEach((o, i) => console.log("  " + (i + 1) + ") " + o));
  console.log("Umbral (firmas requeridas):", th.toString());
  console.log("\n=> Estado: " + th + "-de-" + owners.length);
} catch (e) {
  console.log("No se pudo leer (¿Safe no desplegado aún?):", e.shortMessage || e.message);
}
