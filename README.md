# NoteSMP API

Cloudflare Worker API used by the NoteSMP website, Discord bot, and Minecraft server integration.

## Components

- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1, binding `DB`, database `notesmp-data`
- **Source:** `src/index.js`
- **Schema:** `schema.sql`

## Configure and deploy

1. Confirm the D1 database binding in `wrangler.jsonc` points to the intended database.
2. Apply `schema.sql` to the D1 database.
3. For incremental database changes, apply the matching SQL migration to the same D1 database (advancements: `npx wrangler d1 execute notesmp-data --remote --file=migrations/0002_player_advancements.sql`).
4. Configure the Worker secret `MINECRAFT_API_KEY`. The Paper plugin and protected integration calls must send it as a Bearer token.
5. Deploy with Wrangler or the configured Cloudflare deployment pipeline.

```bash
npm install --save-dev wrangler
npx wrangler login
npx wrangler dev
npx wrangler deploy
```

Do not expose `MINECRAFT_API_KEY` in the website, public source, client-side JavaScript, or commit history.

## Public endpoints

Base URL: the deployed API Worker URL (for example, the configured `NOTESMP_API_URL`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | Checks API/D1 connectivity. |
| GET | `/v1/content/posts` | Lists published content. Optional query parameters: `category`, `group` (for gallery group), and `limit` (1–100). |
| GET | `/v1/content/posts/:sixDigitId` | Fetches one published post by its six-digit ID. |
| GET | `/v1/content/links` | Returns website links. |
| GET | `/v1/creators` | Returns creators and their current Twitch live metadata. |
| GET | `/v1/server` | Returns the latest server online state, player counts, MOTD, version, online player list, and update time. |
| GET | `/v1/players` | Lists public player records. Optional `limit` (1–100). |
| GET | `/v1/players/:uuid` | Fetches a public player profile by UUID. |
| GET | `/v1/players/:uuid/statistics` | Returns the player's recorded statistics. |
| GET | `/v1/players/:uuid/advancements` | Returns the player's earned advancement history. |
| GET | `/v1/content/posts?category=gallery&builder=:name` | Lists gallery posts attributed to a builder name. |

## Protected Minecraft endpoints

These endpoints require `Authorization: Bearer <MINECRAFT_API_KEY>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/minecraft/heartbeat` | Stores server online status, counts, MOTD, version, and online player names. |
| POST | `/v1/minecraft/offline` | Marks the server offline and clears the current online-player list. |

Heartbeat JSON should include `playersOnline` and `maxPlayers` as valid integer counts. Optional fields include `motd`, `version`, and `onlinePlayers`.

Example:

```bash
curl -X POST "$NOTESMP_API_URL/v1/minecraft/heartbeat" \
  -H "Authorization: Bearer $MINECRAFT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"playersOnline":1,"maxPlayers":20,"motd":"NoteSMP","version":"Java","onlinePlayers":["ExamplePlayer"]}'
```

## Minecraft data ingestion

The API also contains protected plugin-facing routes for account verification and player-stat ingestion:

- `POST /minecraft/verify` — consumes a pending verification code and links the Discord account to the Minecraft UUID/name.
- `POST /minecraft/playerstats` — upserts the player's base stats and statistic key/value data.
- `POST /v1/minecraft/advancement` — records one newly earned Minecraft advancement.
- `POST /v1/minecraft/advancements` — upserts a batch of earned advancements to backfill a player's history.

Both require the same Bearer API key. See the route handlers in `src/index.js` for exact payload validation.

## CORS and errors

The API responds to preflight `OPTIONS` requests and allows cross-origin browser requests. JSON errors include an `error` field; common statuses include 400 (invalid input), 401 (missing/invalid API key), 404 (unknown resource/route), and 500 (unexpected server error).
