const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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


      if (request.method === "GET" && path === "/v1/content/posts") {
        const category = url.searchParams.get("category");
        const allowed = ["gallery","events","buildings","places","inprogress","rules","updates","news"];
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50,1),100);
        let result;
        if (category === "events") {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='events' ORDER BY published_at DESC LIMIT ?").bind(limit).all();
        } else if (category === "gallery" && url.searchParams.get("group")) {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='gallery' AND lower(group_name)=lower(?) ORDER BY published_at DESC LIMIT ?").bind(url.searchParams.get("group"),limit).all();
        } else if (["buildings","places","inprogress"].includes(category)) {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='gallery' AND group_name=? ORDER BY published_at DESC LIMIT ?").bind(category,limit).all();
        } else if (category && allowed.includes(category)) {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category=? ORDER BY published_at DESC LIMIT ?").bind(category,limit).all();
        } else {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category IN ('gallery','events','buildings','places','inprogress','rules','updates') ORDER BY published_at DESC LIMIT ?").bind(limit).all();
        }
        const posts = (result.results || []).map(row => {
          let images=[]; let event=null;
          try { images=JSON.parse(row.image_urls_json || "[]"); } catch {}
          try { event=row.event_data_json ? JSON.parse(row.event_data_json) : null; } catch {}
          return { id:row.six_digit_id,category:row.category === "gallery" ? row.group_name : row.category,group:row.group_name,title:row.title,subtitle:row.subtitle,body:row.body,images,event,dimension:event?.dimension || null,coordinates:event?.coordinates || null,authorMinecraftName:row.linked_minecraft_name,publishedAt:row.published_at,updatedAt:row.updated_at };
        });
        return json({posts});
      }

      const postMatch = path.match(/^\/v1\/content\/posts\/(\d{6})$/);
      if (request.method === "GET" && postMatch) {
        const row = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE six_digit_id=?").bind(postMatch[1]).first();
        if (!row) return json({error:"Post not found"},404);
        let images=[]; let event=null;
        try { images=JSON.parse(row.image_urls_json || "[]"); } catch {}
        try { event=row.event_data_json ? JSON.parse(row.event_data_json) : null; } catch {}
        return json({post:{id:row.six_digit_id,category:row.category === "gallery" ? row.group_name : row.category,group:row.group_name,title:row.title,subtitle:row.subtitle,body:row.body,images,event,dimension:event?.dimension || null,coordinates:event?.coordinates || null,authorMinecraftName:row.linked_minecraft_name,publishedAt:row.published_at,updatedAt:row.updated_at}});
      }

      if (request.method === "GET" && path === "/v1/content/links") {
        const result = await env.DB.prepare("SELECT link_key,url,updated_at FROM website_links ORDER BY link_key").all();
        return json({links:result.results || []});
      }

      if (request.method === "GET" && path === "/v1/creators") {
        const result = await env.DB.prepare("SELECT c.twitch_login,(SELECT value FROM bot_config WHERE key='twitch_avatar_' || c.twitch_login) AS avatar_url,c.live_started_at,c.live_title,c.live_url,c.live_thumbnail_url FROM creators c ORDER BY CASE WHEN c.live_title IS NULL THEN 1 ELSE 0 END,c.live_started_at DESC,c.twitch_login COLLATE NOCASE").all();
        return json({creators:(result.results || []).map(row=>({...row,live:Boolean(row.live_title)}))});
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
