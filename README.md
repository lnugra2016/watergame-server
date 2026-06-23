# WaterGame — Servidor de Juego (Pieza 2)

Servidor Node.js que corre las rondas en vivo, lleva el saldo de cada jugador y **firma automáticamente los retiros** (lo que antes hacías a mano con `cast`).

## Qué hace
- **WebSocket** (`ws://localhost:8787`): emite el estado de la ronda en vivo (countdown, multiplicador subiendo, crash) y recibe apuestas/cash-outs. El cliente se autentica con `{type:"auth", token}` (token de sesión SIWE).
- **REST**:
  - `GET /` — estado del servidor (verifica que vive y que el operator coincide).
  - `GET /siwe/nonce` — nonce de un solo uso para el login.
  - `POST /siwe/verify` `{message, signature}` — verifica la firma SIWE y devuelve `{token, address}`.
  - `POST /sync-deposit` *(auth)* — lee el depósito on-chain del jugador autenticado y acredita su saldo.
  - `GET /balance` *(auth)* — saldo de juego del jugador autenticado.
  - `POST /withdraw-auth` `{amount}` *(auth)* — **firma EIP-712** el retiro y devuelve `{cumulative, nonce, expiry, signature}` para llamar a `withdraw()` del contrato. La dirección sale de la sesión, nunca del body.
- **Auth SIWE**: el jugador firma un mensaje (EIP-4361) para probar que controla la wallet; recibe un token de sesión. Los endpoints marcados *(auth)* exigen `Authorization: Bearer <token>`.
- **Ledger en Postgres**: todas las operaciones de dinero son atómicas (no hay doble apuesta/cash-out/retiro por carrera) y persisten reinicios.
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
Pon tus datos reales del despliegue:
```
BANK_ADDRESS=0x7f27D5401E85B918Cc079DFa48862157Fa9E9bbf
TOKEN_ADDRESS=0x4C83276A8f11492a8A22Bcae8Cb21e593f6E7C7a
OPERATOR_PRIVATE_KEY=0xTU_CLAVE   # la MISMA cuenta que pusiste como operator

# Base de datos (el saldo es DINERO: se persiste aquí, no en memoria)
DATABASE_URL=postgres://usuario:clave@localhost:5432/watergame
DB_SSL=false                      # true en Postgres gestionado (Railway/Render/Neon/Supabase)

# Login con wallet (SIWE). En producción = host del frontend.
SIWE_DOMAIN=                      # ej. watergame.netlify.app (vacío solo en local)
```
⚠️ El `OPERATOR_PRIVATE_KEY` debe ser la cuenta que está como `operator` en el contrato (la que pusiste con `setOperator`). Si no coincide, el contrato rechaza las firmas.

### Base de datos
El ledger vive en **Postgres** (tabla `players`, se crea sola al arrancar). Necesitas una
instancia corriendo y `DATABASE_URL` apuntando a ella. Local con Docker:
```bash
docker run -d --name wg-pg -e POSTGRES_USER=watergame -e POSTGRES_PASSWORD=watergame \
  -e POSTGRES_DB=watergame -p 5432:5432 postgres:16
```
En producción usa un Postgres gestionado y pon `DB_SSL=true`.

## Pruebas
```bash
npm test   # ledger atómico (pg-mem) + login SIWE
```

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
Los endpoints de dinero exigen un token de sesión SIWE (`Authorization: Bearer`).
Obtenerlo a mano requiere firmar el mensaje SIWE con la wallet; lo normal es probarlo
desde el frontend. Sin token solo puedes ver el estado:
```bash
# estado del servidor
curl http://localhost:8787/

# nonce para iniciar login (luego el frontend firma y llama a /siwe/verify)
curl http://localhost:8787/siwe/nonce

# con un token ya obtenido (TOKEN):
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/balance
curl -X POST http://localhost:8787/withdraw-auth \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":10}'
# devuelve {cumulative, nonce, expiry, signature} -> con eso llamas withdraw() del contrato
```

## Protocolo WebSocket (para el frontend)
Cliente → servidor:
```json
{ "type": "auth", "token": "<token de /siwe/verify>" }
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

## ⚠ Notas de producción
- ✅ El ledger ya vive en **Postgres** con operaciones atómicas (persiste reinicios).
- ✅ El jugador se autentica con **SIWE** (firma de wallet) antes de jugar/depositar/retirar.
- Configura `SIWE_DOMAIN` = al host real del frontend (anti-phishing).
- Sesiones/nonces SIWE viven en memoria: con **varias instancias** detrás de un balanceador, muévelos a Redis. Con una sola instancia, basta.
- La `operator key` aquí es una hot key simple. En producción: límites, rotación, y custodia del owner con multisig/MPC.
- El contrato debe estar **fondeado** para pagar (usa `fund()` o transfiere token al contrato) — si no, los `withdraw` revierten por falta de balance.

## Siguiente paso (Pieza 3)
Conectar el frontend del juego a este servidor: WebSocket para jugar, y los botones de depósito/retiro llamando al contrato con viem + este servidor para la firma.
