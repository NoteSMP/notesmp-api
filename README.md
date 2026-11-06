# NoteSMP API

Cloudflare Worker API connecting the NoteSMP website, Paper plugin and Discord bot.

- **Worker:** `notesmp-api`
- **Production base URL:** `https://notesmp-api.notesmp-de.workers.dev`
- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1, binding `DB`, database `notesmp-data`
- **Durable Object:** `LIVE_PROFILES` (`LiveProfileChannel`) for live player-profile requests
- **Entry point:** `src/index.js`

## Responsibilities

- Serves public website content, creator data, server status and player profiles.
- Stores player directory records, daily statistics snapshots and earned advancements in D1.
- Registers a player as soon as the Paper plugin reports a join.
- Queues a live profile request for the plugin and returns the response without treating it as a scheduled D1 snapshot.
- Accepts individual advancement unlocks and batch reconciliation from the plugin.
- Provides protected routes for player-data maintenance and Minecraft integration.

## Public endpoints

All paths below are relative to `/v1`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | API and D1 health. |
| GET | `/content/posts` | Published posts; supports category/group/limit filters. |
| GET | `/content/posts/:sixDigitId` | One published post. |
| GET | `/content/hero` | Current homepage hero/event content. |
| GET | `/content/links` | Public website links. |
| GET | `/creators` | Creator list and live metadata. |
| GET | `/server` | Current server status, MOTD, version and online players. |
| GET | `/server/plugin-state` | Plugin/live integration state. |
| GET | `/server/advancement-count` | Available advancement count. |
| GET | `/players` | Public player directory. Supports `limit` (1–100). |
| GET | `/players/:uuid` | Public player profile. |
| GET | `/players/:uuid/statistics` | Stored player statistics. |
| GET | `/players/:uuid/advancements` | Stored earned advancements. |
| GET | `/players/:uuid/live` | Live profile request/status for a player. |

## Protected Minecraft/plugin endpoints

These routes require `Authorization: Bearer <MINECRAFT_API_KEY>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/minecraft/player-join` | Creates or updates the player's public directory record. |
| POST | `/minecraft/status-refresh` | Signals that website server status should be refreshed. |
| GET | `/minecraft/live/poll` | Plugin polls for pending live profile requests. |
| POST | `/minecraft/live/response` | Plugin returns live stats and advancement data for a request. |
| GET | `/minecraft/stats-request` | Polls pending persisted-stat refresh work. |
| POST | `/minecraft/playerstats` | Saves a complete player statistics snapshot. |
| POST | `/minecraft/advancement` | Saves one newly earned advancement. |
| POST | `/minecraft/advancements` | Reconciles a batch of earned advancements. |
| POST | `/minecraft/playerdata/wipe` | Wipes player records, stats, advancements and pending refresh requests only. |

The Worker also retains protected `/minecraft/heartbeat` and `/minecraft/offline` compatibility routes. Current server-status discovery is performed by the API's Minecraft status check; the plugin sends refresh signals rather than publishing periodic status payloads.

## Database and migrations

- Initial schema: `schema.sql`
- Incremental migrations: `migrations/`
- Apply schema/migrations to the intended D1 database before deploying code that depends on them.

Example:

```bash
npx wrangler d1 execute notesmp-data --remote --file=schema.sql
npx wrangler d1 migrations apply notesmp-data --remote
```

Review migration state before applying changes to production. Do not re-run one-off destructive SQL manually without checking its impact.

## Configuration and deployment

The D1 binding and Durable Object binding are declared in `wrangler.jsonc`. Configure `MINECRAFT_API_KEY` as a Cloudflare Worker secret; do not add it to source control.

```bash
npm install
npx wrangler dev
npx wrangler deploy
```

Deploy the Worker named `notesmp-api`. Verify the health endpoint and the production bindings after deployment.

## Security

- Keep `MINECRAFT_API_KEY` private and share it only with trusted server-side integrations.
- Public endpoints must expose only intended public data.
- Protected routes must validate the Bearer key and validate incoming payloads.
- Never put secrets in the website's client-side JavaScript or commit them to Git.
