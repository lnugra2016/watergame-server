// Genera el "Data (Hex)" para retirar ganancias de la casa desde el Safe.
// Uso:  node gen-housewithdraw.mjs <monto_en_USDC> [direccion_destino]
//   ej: node gen-housewithdraw.mjs 0.50
//   ej: node gen-housewithdraw.mjs 5 0xc7aA03b8C42a876f5c42F37de795E48fE703d6B0
//
// Pegás el hex resultante en el Safe → Transaction Builder → Custom data.
import { encodeFunctionData, parseUnits, isAddress, getAddress } from "viem";

const BANK = "0xa0499cF9864f4375728e1EC24DE159AB9357E05f";
const DEFAULT_TO = "0xc7aA03b8C42a876f5c42F37de795E48fE703d6B0"; // wallet de la casa

const amount = process.argv[2];
const toArg = process.argv[3] || DEFAULT_TO;

if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
  console.error("\n❌ Falta el monto. Uso: node gen-housewithdraw.mjs <monto_USDC> [destino]\n   ej: node gen-housewithdraw.mjs 0.50\n");
  process.exit(1);
}
if (!isAddress(toArg)) {
  console.error("\n❌ Dirección de destino inválida:", toArg, "\n");
  process.exit(1);
}

const to = getAddress(toArg);
const units = parseUnits(amount, 6); // USDC = 6 decimales

const abi = [{
  type: "function", name: "houseWithdraw", stateMutability: "nonpayable",
  inputs: [{ name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [],
}];
const data = encodeFunctionData({ abi, functionName: "houseWithdraw", args: [units, to] });

console.log("\n=== Retiro de ganancias (houseWithdraw) ===");
console.log("Monto   :", amount, "USDC  (" + units.toString() + " unidades)");
console.log("Destino :", to);
console.log("\n--- Para el Safe → Transaction Builder → Custom data ---");
console.log("To Address :", BANK);
console.log("POL value  : 0");
console.log("Data (Hex) :", data);
console.log("");
