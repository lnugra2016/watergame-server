// Test del login SIWE (auth.js). Valida: firma válida -> sesión; nonce de un solo uso;
// nonce inventado rechazado; firma de otra wallet rechazada; token inválido -> null.
// Ejecutar: node test/auth.test.js
import assert from "node:assert/strict";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { issueNonce, verifyLogin, resolveSession } from "../src/auth.js";
import { config } from "../src/config.js";

let passed = 0;
const ok = (name) => { console.log(`  ✅ ${name}`); passed++; };

async function signLogin(account, nonce) {
  const message = createSiweMessage({
    domain: "watergame.netlify.app",
    address: account.address,
    statement: "Inicia sesión en WaterGame.",
    uri: "https://watergame.netlify.app",
    version: "1",
    chainId: config.chainId,
    nonce,
  });
  const signature = await account.signMessage({ message });
  return { message, signature };
}

async function expectReject(promise, label) {
  try { await promise; assert.fail(`debía rechazar: ${label}`); }
  catch (e) { if (e.code === "ERR_ASSERTION") throw e; }
}

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());

  // 1) login válido -> token + address, y la sesión resuelve a esa address
  const nonce = issueNonce();
  const { message, signature } = await signLogin(account, nonce);
  const session = await verifyLogin({ message, signature });
  assert.equal(session.address, account.address.toLowerCase());
  assert.ok(session.token && session.token.length >= 32);
  assert.equal(resolveSession(session.token), account.address.toLowerCase());
  ok("login SIWE válido crea sesión y token resuelve a la address");

  // 2) el nonce es de un solo uso: reusar el mismo mensaje/firma debe fallar
  await expectReject(verifyLogin({ message, signature }), "nonce reusado");
  ok("nonce de un solo uso (anti-replay)");

  // 3) nonce nunca emitido -> rechazado
  const fake = await signLogin(account, "0123456789abcdef0123456789abcdef");
  await expectReject(verifyLogin(fake), "nonce no emitido");
  ok("nonce no emitido rechazado");

  // 4) firma de OTRA wallet sobre el mensaje -> rechazada
  const n2 = issueNonce();
  const victim = privateKeyToAccount(generatePrivateKey());
  const attacker = privateKeyToAccount(generatePrivateKey());
  const msgVictim = (await signLogin(victim, n2)).message;
  const sigAttacker = await attacker.signMessage({ message: msgVictim });
  await expectReject(verifyLogin({ message: msgVictim, signature: sigAttacker }), "firma de otra wallet");
  ok("firma que no corresponde a la address es rechazada");

  // 5) token inválido / inexistente -> null
  assert.equal(resolveSession("token-que-no-existe"), null);
  assert.equal(resolveSession(undefined), null);
  ok("token inválido resuelve a null");

  console.log(`\n  ${passed} pruebas OK ✅\n`);
}

main().catch((e) => { console.error("\n  ❌ FALLO:", e.message, "\n", e); process.exit(1); });
