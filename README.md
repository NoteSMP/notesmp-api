# NoteSMP API

This is a separate Cloudflare Worker API. It does not replace the existing website Worker.

## Planned deployment

- Worker name: `notesmp-api`
- Database: Cloudflare D1 named `notesmp-data`
- D1 binding: `DB`
- Public API hostname: `api.notesmp.de` (connect only after deployment)
- Website origin: `https://www.notesmp.de`

## Endpoints

- `GET /v1/health` — checks API and D1 connectivity.
- `GET /v1/server` — latest server heartbeat.
- `GET /v1/players` — public player leaderboard (up to 100).
- `GET /v1/players/:uuid` — public player profile.
- `POST /v1/minecraft/heartbeat` — protected Minecraft server heartbeat.
- `POST /v1/minecraft/offline` — protected server shutdown notification.

## Secrets

Set `MINECRAFT_API_KEY` as a Worker secret. Never put it in the website, GitHub, or a public config file. The Paper plugin will use it in an Authorization Bearer header.

## Database

Create the D1 database, then run `api/schema.sql` against the remote database. The Worker must have a D1 binding named `DB`.

Do not deploy until a real database ID has been added to the Wrangler configuration. Never commit API keys or other secrets.
