# WaterGame — Servidor de Juego (Pieza 2)

Servidor Node.js que corre las rondas en vivo, lleva el saldo de cada jugador y **firma automáticamente los retiros** (lo que antes hacías a mano con `cast`).

## Qué hace
- **WebSocket** (`ws://localhost:8787`): emite el estado de la ronda en vivo (countdown, multiplicador subiendo, crash) y recibe apuestas/cash-outs.
- **REST**:
  - `GET /` — estado del servidor (verifica que vive y que el operator coincide).
  - `POST /sync-deposit` `{address}` — lee el depósito on-chain y acredita saldo de juego.
  - `GET /balance/:address` — saldo de juego.
  - `POST /withdraw-auth` `{address, amount}` — **firma EIP-712** el retiro y devuelve `{cumulative, nonce, expiry, signature}` para llamar a `withdraw()` del contrato.
- **Provably fair**: genera semilla, publica el hash y la revela al hacer crash. Misma fórmula que el contrato.

## Requisitos
- Node.js 20+ (en WSL: `sudo apt install nodejs npm` o usa nvm).

## Instalar
```bash
cd watergame-server
npm install
cp .env.example .env
```

## Configurar `.env`
Pon tus datos reales del despliegue en Amoy:
```
BANK_ADDRESS=0x7f27D5401E85B918Cc079DFa48862157Fa9E9bbf
TOKEN_ADDRESS=0x4C83276A8f11492a8A22Bcae8Cb21e593f6E7C7a
OPERATOR_PRIVATE_KEY=0xTU_CLAVE_DE_TESTNET   # la MISMA cuenta que pusiste como operator
```
⚠️ El `OPERATOR_PRIVATE_KEY` debe ser la cuenta que está como `operator` en el contrato (la que pusiste con `setOperator`). Si no coincide, el contrato rechaza las firmas.

## Arrancar
```bash
npm start
```
Verás:
```
💧 WaterGame server en http://localhost:8787
   Operator: 0x....
   ✅ El operator del contrato coincide con esta clave.
```
Si dice ✅, el servidor puede firmar retiros válidos.

## Probar sin frontend (con curl)
```bash
# 1) estado
curl http://localhost:8787/

# 2) acreditar un depósito on-chain (primero deposita con cast/contrato)
curl -X POST http://localhost:8787/sync-deposit \
  -H "Content-Type: application/json" \
  -d '{"address":"0xTU_DIRECCION"}'

# 3) ver saldo de juego
curl http://localhost:8787/balance/0xTU_DIRECCION

# 4) pedir firma de retiro de 10 USDT
curl -X POST http://localhost:8787/withdraw-auth \
  -H "Content-Type: application/json" \
  -d '{"address":"0xTU_DIRECCION","amount":10}'
# devuelve {cumulative, nonce, expiry, signature} -> con eso llamas withdraw() del contrato
```

## Protocolo WebSocket (para el frontend)
Cliente → servidor:
```json
{ "type": "auth", "address": "0x..." }
{ "type": "bet", "amount": 10 }
{ "type": "cashout" }
```
Servidor → cliente:
```json
{ "type": "state", "phase": "waiting", "roundId": 5, "history": [...], "seedHash": "..." }
{ "type": "countdown", "pct": 60 }
{ "type": "phase", "phase": "flying" }
{ "type": "tick", "multiplier": 2.31 }
{ "type": "crash", "crash": 3.07, "serverSeed": "...", "clientSeed": "..." }
{ "type": "betAck", "ok": true, "balance": 90 }
{ "type": "cashoutAck", "ok": true, "multiplier": 2.10, "payout": 21, "balance": 111 }
{ "type": "balance", "balance": 100 }
```

## ⚠ Notas de producción (esto es para testnet/demo)
- El ledger está **en memoria**: si reinicias el servidor, se pierde. En producción usa Postgres.
- La `operator key` aquí es una hot key simple. En producción: límites, rotación, y custodia del owner con multisig/MPC.
- Falta autenticación real del jugador (firmar un mensaje SIWE al hacer `auth`). Añádelo antes de mainnet.
- El contrato debe estar **fondeado** para pagar (usa `fund()` o transfiere token al contrato) — si no, los `withdraw` revierten por falta de balance.

## Siguiente paso (Pieza 3)
Conectar el frontend del juego a este servidor: WebSocket para jugar, y los botones de depósito/retiro llamando al contrato con viem + este servidor para la firma.
