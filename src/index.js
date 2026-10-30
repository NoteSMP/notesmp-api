const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.notesmp.de",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

function requireServerKey(request, env) {
  const header = request.headers.get("Authorization") || "";
  return Boolean(env.MINECRAFT_API_KEY) && header === `Bearer ${env.MINECRAFT_API_KEY}`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    try {
      if (request.method === "GET" && path === "/v1/health") {
        await env.DB.prepare("SELECT 1").first();
        return json({ ok: true, service: "notesmp-api", database: "connected" });
      }

      if (request.method === "GET" && path === "/v1/server") {
        const row = await env.DB.prepare(
          "SELECT online, players_online, max_players, motd, version, online_players_json, updated_at FROM server_state WHERE id = 1"
        ).first();
        if (!row) return json({ online: false, playersOnline: 0, maxPlayers: 0, motd: "", version: null, onlinePlayers: [], updatedAt: null });
        let onlinePlayers = [];
        try { onlinePlayers = JSON.parse(row.online_players_json || "[]"); } catch {}
        return json({
          online: Boolean(row.online),
          playersOnline: row.players_online,
          maxPlayers: row.max_players,
          motd: row.motd || "",
          version: row.version,
          onlinePlayers,
          updatedAt: row.updated_at
        });
      }

      if (request.method === "GET" && path === "/v1/players") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
        const result = await env.DB.prepare(
          "SELECT uuid, username, first_join, last_seen, playtime_seconds, blocks_broken, blocks_placed, deaths, kills, updated_at FROM players ORDER BY playtime_seconds DESC LIMIT ?"
        ).bind(limit).all();
        return json({ players: result.results || [] });
      }

      const playerMatch = path.match(/^\/v1\/players\/([0-9a-fA-F-]{36})$/);
      if (request.method === "GET" && playerMatch) {
        const player = await env.DB.prepare(
          "SELECT uuid, username, first_join, last_seen, playtime_seconds, blocks_broken, blocks_placed, deaths, kills, updated_at FROM players WHERE uuid = ?"
        ).bind(playerMatch[1]).first();
        return player ? json({ player }) : json({ error: "Player not found" }, 404);
      }

      if (request.method === "POST" && path === "/v1/minecraft/heartbeat") {
        if (!requireServerKey(request, env)) return unauthorized();
        const body = await request.json();
        const playersOnline = Number(body.playersOnline);
        const maxPlayers = Number(body.maxPlayers);
        if (!Number.isInteger(playersOnline) || playersOnline < 0 || !Number.isInteger(maxPlayers) || maxPlayers < 1 || playersOnline > maxPlayers) {
          return json({ error: "Invalid player counts" }, 400);
        }
        const onlinePlayers = Array.isArray(body.onlinePlayers) ? body.onlinePlayers.slice(0, 200) : [];
        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO server_state (id, online, players_online, max_players, motd, version, online_players_json, updated_at)
          VALUES (1, 1, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET online=1, players_online=excluded.players_online,
            max_players=excluded.max_players, motd=excluded.motd, version=excluded.version,
            online_players_json=excluded.online_players_json, updated_at=excluded.updated_at
        `).bind(
          playersOnline, maxPlayers,
          typeof body.motd === "string" ? body.motd.slice(0, 1000) : "",
          typeof body.version === "string" ? body.version.slice(0, 40) : null,
          JSON.stringify(onlinePlayers), now
        ).run();
        return json({ ok: true, updatedAt: now });
      }

      if (request.method === "POST" && path === "/v1/minecraft/offline") {
        if (!requireServerKey(request, env)) return unauthorized();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "UPDATE server_state SET online=0, players_online=0, online_players_json='[]', updated_at=? WHERE id=1"
        ).bind(now).run();
        return json({ ok: true, updatedAt: now });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("NoteSMP API error", error);
      return json({ error: "Internal server error" }, 500);
    }
  }
};
