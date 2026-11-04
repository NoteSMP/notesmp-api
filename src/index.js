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
        await env.DB.prepare("DELETE FROM published_posts WHERE category='news' AND json_extract(event_data_json,'$.type')='maintenance' AND julianday(json_extract(event_data_json,'$.expiryAt')) <= julianday('now')").run();
        const category = url.searchParams.get("category");
        const allowed = ["gallery","events","buildings","places","inprogress","rules","updates","news"];
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50,1),100);
        let result;
        if (category === "events") {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='events' ORDER BY published_at DESC LIMIT ?").bind(limit).all();
        } else if (category === "gallery" && url.searchParams.get("builder")) {
          const builder = url.searchParams.get("builder").trim().slice(0, 16);
          const builderLimit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 1000);
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='gallery' AND lower(COALESCE(linked_minecraft_name,'')) LIKE '%' || lower(?) || '%' ORDER BY published_at DESC LIMIT ?").bind(builder, builderLimit).all();
        } else if (category === "gallery" && url.searchParams.get("group")) {
          // Gallery groups are strictly gallery records. Never mix Discord calendar events
          // into the Gallery tab, even when the selected gallery group is named "Events".
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='gallery' ORDER BY published_at DESC LIMIT ?").bind(limit).all();
        } else if (["buildings","places","inprogress"].includes(category)) {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category='gallery' AND group_name=? ORDER BY published_at DESC LIMIT ?").bind(category,limit).all();
        } else if (category && allowed.includes(category)) {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category=? ORDER BY published_at DESC LIMIT ?").bind(category,limit).all();
        } else {
          result = await env.DB.prepare("SELECT six_digit_id,category,group_name,title,subtitle,body,image_urls_json,event_data_json,linked_minecraft_name,published_at,updated_at FROM published_posts WHERE category IN ('gallery','events','buildings','places','inprogress','rules','updates') ORDER BY published_at DESC LIMIT ?").bind(limit).all();
        }
        const requestedGalleryGroup = category === "gallery" && url.searchParams.get("group")
          ? String(url.searchParams.get("group")).toLowerCase().replace(/[\s_-]+/g, "")
          : "";
        const rows = (result.results || []).filter(row => {
          if (requestedGalleryGroup) {
            const storedGroup = String(row.group_name || "").toLowerCase().replace(/[\s_-]+/g, "");
            return row.category === "gallery" && storedGroup === requestedGalleryGroup;
          }
          if (row.category !== "news") return true;
          try {
            const news = row.event_data_json ? JSON.parse(row.event_data_json) : null;
            const expiry = news?.type === "maintenance" ? Date.parse(news.expiryAt || "") : NaN;
            return !Number.isFinite(expiry) || expiry > Date.now();
          } catch { return true; }
        });
        const posts = rows.map(row => {
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

      if (request.method === "GET" && path === "/v1/content/hero") {
        const rows = await env.DB.prepare("SELECT key,value FROM bot_config WHERE key IN ('info_hero_title','info_hero_subtitle')").all();
        const values = Object.fromEntries((rows.results || []).map(row => [row.key,row.value]));
        return json({ title: values.info_hero_title || "Your world. Your people.", subtitle: values.info_hero_subtitle || "Everything happening on NoteSMP, in one place. Check the server, find your next event, and see what the community is building." });
      }

      if (request.method === "GET" && path === "/v1/content/links") {
        const result = await env.DB.prepare("SELECT link_key,url,updated_at FROM website_links ORDER BY link_key").all();
        return json({links:result.results || []});
      }

      if (request.method === "GET" && path === "/v1/creators") {
        const result = await env.DB.prepare("SELECT c.twitch_login,c.created_at,(SELECT value FROM bot_config WHERE key='twitch_display_name_' || c.twitch_login) AS display_name,(SELECT value FROM bot_config WHERE key='twitch_avatar_' || c.twitch_login) AS avatar_url,c.live_started_at,c.live_title,c.live_url,c.live_thumbnail_url FROM creators c ORDER BY CASE WHEN c.live_title IS NOT NULL AND lower(c.live_title) LIKE '%notesmp%' THEN 0 ELSE 1 END,CASE WHEN c.live_title IS NOT NULL AND lower(c.live_title) LIKE '%notesmp%' THEN c.live_started_at END DESC,c.created_at ASC,c.twitch_login COLLATE NOCASE").all();
        return json({creators:(result.results || []).map(row=>({...row,live:Boolean(row.live_title)}))});
      }

      if (request.method === "GET" && path === "/v1/server") {
        // Public Minecraft status is primary so the website still works without the plugin.
        // The database heartbeat remains a resilient fallback if the public status provider fails.
        try {
          const ping = await fetch("https://api.mcsrvstat.us/2/notesmp.de", { headers: { Accept: "application/json" } });
          if (ping.ok) {
            const status = await ping.json();
            const players = Array.isArray(status.players?.list) ? status.players.list.map(p => typeof p === "string" ? { name: p } : p).slice(0, 200) : [];
            return json({ online: Boolean(status.online), playersOnline: Number(status.players?.online || 0), maxPlayers: Number(status.players?.max || 0), motd: status.motd?.raw || status.motd?.clean || "", version: status.version || null, onlinePlayers: players, updatedAt: new Date().toISOString(), source: "public-ping" });
          }
        } catch {}
        const row = await env.DB.prepare("SELECT online, players_online, max_players, motd, version, online_players_json, updated_at FROM server_state WHERE id = 1").first();
        if (!row) return json({ online: false, playersOnline: 0, maxPlayers: 0, motd: "", version: null, onlinePlayers: [], updatedAt: null });
        let onlinePlayers = [];
        try { onlinePlayers = JSON.parse(row.online_players_json || "[]"); } catch {}
        return json({ online: Boolean(row.online), playersOnline: row.players_online, maxPlayers: row.max_players, motd: row.motd || "", version: row.version, onlinePlayers, updatedAt: row.updated_at, source: "plugin-heartbeat" });
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

      const advancementsMatch = path.match(/^\/v1\/players\/([0-9a-fA-F-]{36})\/advancements$/);
      if (request.method === "GET" && advancementsMatch) {
        const result = await env.DB.prepare("SELECT advancement_id, advancement_title, earned_at FROM player_advancements WHERE minecraft_uuid = ? ORDER BY earned_at DESC, advancement_id").bind(advancementsMatch[1]).all();
        return json({ advancements: result.results || [] });
      }


      if (request.method === "GET" && path === "/v1/minecraft/stats-request") {
        if (!requireServerKey(request, env)) return unauthorized();
        const row = await env.DB.prepare("SELECT uuid, username FROM stats_refresh_queue WHERE status='pending' ORDER BY requested_at LIMIT 1").first();
        if (!row) return json({ request: null });
        await env.DB.prepare("UPDATE stats_refresh_queue SET status='processing', claimed_at=CURRENT_TIMESTAMP WHERE uuid=? AND status='pending'").bind(row.uuid).run();
        return json({ request: row });
      }

      if (request.method === "POST" && path === "/v1/minecraft/playerstats") {
        if (!requireServerKey(request, env)) return unauthorized();
        let payload; try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const uuid = typeof payload.uuid === "string" ? payload.uuid : "";
        const username = typeof payload.username === "string" ? payload.username.slice(0, 16) : "";
        if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !/^[A-Za-z0-9_]{3,16}$/.test(username)) return json({ error: "Invalid player identity" }, 400);
        const base = payload.baseStats || {};
        const number = key => Number.isFinite(Number(base[key])) && Number(base[key]) >= 0 ? Number(base[key]) : 0;
        await env.DB.prepare("INSERT INTO players(uuid,username,first_join,last_seen,playtime_seconds,blocks_broken,blocks_placed,deaths,kills,updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username,last_seen=excluded.last_seen,playtime_seconds=excluded.playtime_seconds,blocks_broken=excluded.blocks_broken,blocks_placed=excluded.blocks_placed,deaths=excluded.deaths,kills=excluded.kills,updated_at=CURRENT_TIMESTAMP")
          .bind(uuid,username,typeof payload.firstJoin==="string"?payload.firstJoin:null,typeof payload.lastSeen==="string"?payload.lastSeen:null,
            number("playtime_seconds"),number("blocks_broken"),number("blocks_placed"),number("deaths"),number("kills")).run();
        const stats = payload.statistics && typeof payload.statistics === "object"
          ? Object.entries(payload.statistics).filter(([statId,value]) => /^[a-z0-9_.:-]{1,100}$/i.test(statId) && Number.isFinite(Number(value)) && Number(value) >= 0)
          : [];
        const statements = stats.map(([statId,value]) => env.DB.prepare("INSERT INTO player_statistics(minecraft_uuid,stat_id,stat_value) VALUES(?,?,?) ON CONFLICT(minecraft_uuid,stat_id) DO UPDATE SET stat_value=excluded.stat_value,updated_at=CURRENT_TIMESTAMP").bind(uuid,statId,Number(value)));
        for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
        await env.DB.prepare("UPDATE stats_refresh_queue SET status='done', claimed_at=NULL WHERE uuid=?").bind(uuid).run();
        return json({ ok: true, statsStored: stats.length });
      }

      const statsMatch = path.match(/^\/v1\/players\/([0-9a-fA-F-]{36})\/statistics$/);
      if (request.method === "GET" && statsMatch) {
        const uuid = statsMatch[1];
        if (url.searchParams.get("refresh") === "1") {
          const player = await env.DB.prepare("SELECT username FROM players WHERE uuid=?").bind(uuid).first();
          if (player?.username) {
            await env.DB.prepare("INSERT INTO stats_refresh_queue(uuid,username,status,requested_at) VALUES(?,?,'pending',CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username,status='pending',requested_at=CURRENT_TIMESTAMP WHERE stats_refresh_queue.requested_at < datetime('now','-60 seconds') OR stats_refresh_queue.status='done'").bind(uuid,player.username).run();
          }
        }
        const result = await env.DB.prepare("SELECT stat_id, stat_value, updated_at FROM player_statistics WHERE minecraft_uuid = ? ORDER BY stat_id").bind(uuid).all();
        return json({ statistics: result.results || [] });
      }

      if (request.method === "POST" && path === "/v1/minecraft/advancements") {
        if (!requireServerKey(request, env)) return unauthorized();
        const body = await request.json();
        const uuid = typeof body.uuid === "string" ? body.uuid : "";
        const username = typeof body.username === "string" ? body.username.slice(0, 16) : "";
        const advancements = Array.isArray(body.advancements) ? body.advancements.slice(0, 5000) : [];
        if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !username) return json({ error: "Invalid advancement payload" }, 400);
        await env.DB.prepare("INSERT INTO players (uuid, username, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username, updated_at=CURRENT_TIMESTAMP").bind(uuid, username).run();
        const statements = advancements.filter(item => item && typeof item.advancementId === "string" && item.advancementId.length <= 180)
          .map(item => env.DB.prepare("INSERT INTO player_advancements (minecraft_uuid, advancement_id, advancement_title, earned_at) VALUES (?, ?, ?, ?) ON CONFLICT(minecraft_uuid, advancement_id) DO UPDATE SET advancement_title=excluded.advancement_title, earned_at=excluded.earned_at")
            .bind(uuid, item.advancementId, typeof item.title === "string" ? item.title.slice(0, 180) : item.advancementId, typeof item.earnedAt === "string" ? item.earnedAt : new Date().toISOString()));
        for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
        return json({ ok: true, advancementsStored: statements.length });
      }

      if (request.method === "POST" && path === "/v1/minecraft/advancement") {
        if (!requireServerKey(request, env)) return unauthorized();
        const body = await request.json();
        const uuid = typeof body.uuid === "string" ? body.uuid : "";
        const username = typeof body.username === "string" ? body.username.slice(0, 16) : "";
        const advancementId = typeof body.advancementId === "string" ? body.advancementId.slice(0, 180) : "";
        const title = typeof body.title === "string" ? body.title.slice(0, 180) : advancementId;
        const earnedAt = typeof body.earnedAt === "string" ? body.earnedAt : new Date().toISOString();
        if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !username || !advancementId) return json({ error: "Invalid advancement payload" }, 400);
        await env.DB.prepare("INSERT INTO players (uuid, username, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username, updated_at=CURRENT_TIMESTAMP").bind(uuid, username).run();
        await env.DB.prepare("INSERT INTO player_advancements (minecraft_uuid, advancement_id, advancement_title, earned_at) VALUES (?, ?, ?, ?) ON CONFLICT(minecraft_uuid, advancement_id) DO UPDATE SET advancement_title=excluded.advancement_title, earned_at=excluded.earned_at").bind(uuid, advancementId, title, earnedAt).run();
        return json({ ok: true });
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
