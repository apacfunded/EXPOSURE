# Exposure — going live

The site (`public/`) and the backend (`api/`) deploy together on Vercel from this repo. The site calls `/api` on its own domain.

## What runs where
| Piece | Where | Notes |
|---|---|---|
| Website | Vercel (`public/`) | Security headers in `vercel.json` |
| API | Vercel functions (`api/`) | state, wallet, rate, launch, X linking |
| Jobs | GitHub Actions → `/api/cron/*` | tick every 5 min, claim every 30 min, payout every 15 min |
| Database | Supabase | `supabase/schema.sql`, locked so only the server can read or write |
| Chain reads | Helius (or any Solana RPC) | |
| Coin images + metadata | Pinata (IPFS) | pump.fun no longer accepts direct uploads |

## How the money moves
- Every coin launched on Exposure gets its **own pool wallet**, derived from one master secret (`POOL_MASTER_SEED`). That wallet is set as the coin's pump.fun creator, so its creator fees land there and nowhere else.
- The claim job sweeps pump.fun's creator vault into the pool wallet (bonding curve and PumpSwap).
- When a pool reaches 1 SOL, the payout job sends 70% to callers (max 0.5 SOL each), 10% to `TOP20_WALLET`, 20% to `RESERVE_WALLET`. Anything capped or too small stays in the pool for next time.
- A round can't be paid twice (database lock per coin + round). If any send fails, that coin stops and waits for you.
- `PAUSED=1` stops every write and payout immediately. `PAYOUTS_ENABLED` must be `1` for real payouts; otherwise the job only reports what it would send. `MAX_PAYOUT_SOL_PER_RUN` caps each run.

## Vercel environment variables (Project → Settings → Environment Variables, Production)
| Name | What |
|---|---|
| `SITE_URL` | `https://yourdomain.com` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role** key (never put this anywhere else) |
| `SOLANA_RPC_URL` | Helius mainnet RPC URL with your key |
| `POOL_MASTER_SEED` | 64 hex characters. Generate once, back it up offline. Whoever has it controls every pool. |
| `CRON_SECRET` | 40+ random characters (also add as a GitHub Actions secret) |
| `PINATA_JWT` | Pinata API JWT (uploads only) |
| `PINATA_GATEWAY` | optional, your Pinata gateway domain |
| `TOP20_WALLET` | public address |
| `RESERVE_WALLET` | public address |
| `EXPO_MINT` | $EXPO mint (ratings need it; leave unset until $EXPO exists) |
| `RATE_MIN_EXPO` | optional, minimum $EXPO to rate (default 1) |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Later (X linking is off for now). X developer app (OAuth 2.0, callback `https://yourdomain.com/api/x/callback`) |
| `LAUNCHES_ENABLED` | `1` to open launches |
| `PAYOUTS_ENABLED` | `1` to send real payouts |
| `MAX_PAYOUT_SOL_PER_RUN` | default 5 |
| `PAUSED` | `1` = kill switch |

Generate secrets on your own computer: `openssl rand -hex 32` (POOL_MASTER_SEED) and `openssl rand -hex 24` (CRON_SECRET).

## GitHub Actions secrets
`SITE_URL` and `CRON_SECRET` (same value as Vercel).

## Order to switch things on
1. Run `supabase/schema.sql` in Supabase.
2. Add the Vercel env vars (leave `LAUNCHES_ENABLED`, `PAYOUTS_ENABLED` unset). Redeploy.
3. Check `https://yourdomain.com/api/state` returns JSON.
4. `LAUNCHES_ENABLED=1`, launch one test coin from your own wallet, trade a little, run the claim job by hand (Actions → jobs → Run workflow → `claim`) and confirm fees reach the coin's pool wallet.
5. Watch payout dry runs. Only then `PAYOUTS_ENABLED=1`.

## Not finished (needs a decision)
- **Callout data with likes.** No platform publishes who liked a callout. See `lib/sources.js`. Until a source exists, no payouts happen and fees safely build up in each pool.
- **Dev buy and stock pairs** at launch are switched off server-side until tested on mainnet.
- After the first successful Vercel build, pin `@pump-fun/pump-sdk` to the exact version installed.
