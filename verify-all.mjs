const t = Date.now();
const out = [];

// 1) Servidor
try {
  const j = await (await fetch("https://watergame-server.onrender.com/?t=" + t)).json();
  out.push("SERVIDOR:");
  out.push("  chainId : " + j.chainId + (j.chainId === 137 ? " ✅" : " ❌"));
  out.push("  operator: " + j.operator + (j.operator?.toLowerCase() === "0x889a881021930bb9ac747e651030366e34a9d552" ? " ✅" : " ❌"));
  out.push("  bank    : " + j.bank);
  out.push("  estado  : " + j.phase + " (round " + j.round + ") ✅ vivo");
} catch (e) {
  out.push("SERVIDOR: ❌ no respondió (" + e.message + ") — puede estar despertando, reintentá");
}

// 2) Frontend: label USDC
try {
  const live = await (await fetch("https://watergamecrashgame.netlify.app/wg-live.jsx?t=" + t)).text();
  const cur = (live.match(/const CURRENCY\s*=\s*"([^"]+)"/) || [])[1];
  out.push("\nFRONTEND label: CURRENCY = " + cur + (cur === "USDC" ? " ✅" : " ❌ (sigue viejo)"));
} catch (e) { out.push("\nFRONTEND label: ❌ " + e.message); }

// 3) Frontend: fix de scroll
try {
  const css = await (await fetch("https://watergamecrashgame.netlify.app/wg-ui.css?t=" + t)).text();
  const main = (css.match(/\.wg-main\s*\{[^}]*\}/) || [])[0] || "";
  const ok = /min-height:\s*0/.test(main);
  out.push("FRONTEND scroll: .wg-main tiene min-height:0 ? " + (ok ? "✅" : "❌ (sigue viejo)"));
} catch (e) { out.push("FRONTEND scroll: ❌ " + e.message); }

console.log("\n" + out.join("\n") + "\n");
