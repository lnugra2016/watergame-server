import { isAddress, getAddress } from "viem";

const EXISTING = "0xc7aA03b8C42a876f5c42F37de795E48fE703d6B0"; // firmante actual
const cands = [
  { label: "Ledger (firmante 3)", raw: "0x3Ac68EFcED0812c68d59F33874C2738A790a8E07" },
  { label: "Trust Wallet (firmante 2)", raw: "0xcfac1defb328ae1449a7ed1d276034201034e7b6" },
];

for (const c of cands) {
  console.log("\n" + c.label + ":");
  console.log("  pegado :", c.raw);
  console.log("  largo  :", c.raw.length, c.raw.length === 42 ? "✅" : "❌ (esperado 42)");
  if (!isAddress(c.raw)) { console.log("  ❌ NO es una dirección válida"); continue; }
  const cs = getAddress(c.raw);
  console.log("  checksum:", cs);
  const wasChecksummed = /[A-F]/.test(c.raw.slice(2)) && /[a-f]/.test(c.raw.slice(2));
  console.log("  formato :", wasChecksummed ? "✅ venía con checksum y es válido (sin typo)" : "⚠️ venía en minúsculas (válida, pero el checksum no se puede verificar — confirmá que coincide con tu wallet)");
  if (cs.toLowerCase() === EXISTING.toLowerCase()) console.log("  ❌ ES el firmante que ya está — no la agregues");
}

// duplicados entre sí
if (cands[0].raw.toLowerCase() === cands[1].raw.toLowerCase()) console.log("\n❌ Las dos direcciones son iguales");
else console.log("\n✅ Son dos direcciones distintas entre sí y distintas del firmante actual");
