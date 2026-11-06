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
        // Never use a stored heartbeat as proof that the server is online.
        // A failed or timed-out live ping must fail closed, otherwise stale ONLINE
        // state can survive a server shutdown indefinitely.
        try {
          const ping = await fetch("https://api.mcsrvstat.us/3/notesmp.de", {
            headers: { Accept: "application/json", "User-Agent": "NoteSMP-Website/1.0 (https://www.notesmp.de)" },
            signal: AbortSignal.timeout(10000),
            cf: { cacheTtl: 0, cacheEverything: false }
          });
          if (!ping.ok) throw new Error("Status provider returned HTTP " + ping.status);
          const status = await ping.json();
          if (typeof status.online !== "boolean") throw new Error("Status provider returned an invalid response");
          if (status.online && !status.motd?.raw && !status.motd?.clean) {
            try {
              const motdResponse = await fetch("https://api.mcstatus.io/v2/status/java/notesmp.de?query=false&timeout=6", {
                headers: { Accept: "application/json", "User-Agent": "NoteSMP-Website/1.0 (https://www.notesmp.de)" },
                signal: AbortSignal.timeout(8000)
              });
              if (motdResponse.ok) {
                const alternate = await motdResponse.json();
                if (alternate.online && alternate.motd) status.motd = alternate.motd;
              }
            } catch (error) {
              console.warn("Secondary Minecraft MOTD lookup failed:", error);
            }
          }
          const players = Array.isArray(status.players?.list)
            ? status.players.list.map(p => typeof p === "string" ? { name: p } : p).slice(0, 200)
            : [];
          return json({
            online: status.online,
            playersOnline: status.online ? Number(status.players?.online || 0) : 0,
            maxPlayers: Number(status.players?.max || 0),
            motd: Array.isArray(status.motd?.raw) ? status.motd.raw.join("\n") : Array.isArray(status.motd?.clean) ? status.motd.clean.join("\n") : status.motd?.raw || status.motd?.clean || "",
            version: status.version || null,
            onlinePlayers: status.online ? players : [],
            updatedAt: new Date().toISOString(),
            source: "live-ping"
          });
        } catch (error) {
          console.warn("Primary Minecraft status lookup failed; trying mcstatus.io:", error);
          try {
            const fallback = await fetch("https://api.mcstatus.io/v2/status/java/notesmp.de?query=false&timeout=6", {
              headers: { Accept: "application/json", "User-Agent": "NoteSMP-Website/1.0 (https://www.notesmp.de)" },
              signal: AbortSignal.timeout(8000)
            });
            if (!fallback.ok) throw new Error("mcstatus.io returned HTTP " + fallback.status);
            const status = await fallback.json();
            if (typeof status.online !== "boolean") throw new Error("mcstatus.io returned an invalid response");
            const rawMotd = status.motd?.raw || status.motd?.clean || "";
            const motd = Array.isArray(rawMotd) ? rawMotd.join("\n") : rawMotd;
            const players = Array.isArray(status.players?.sample)
              ? status.players.sample.map(p => ({ name: p.name_clean || p.name_raw || p.name, uuid: p.uuid })).filter(p => p.name).slice(0, 200)
              : [];
            return json({
              online: status.online,
              playersOnline: status.online ? Number(status.players?.online || 0) : 0,
              maxPlayers: Number(status.players?.max || 0),
              motd,
              version: status.version?.name_clean || status.version?.name_raw || null,
              onlinePlayers: status.online ? players : [],
              updatedAt: new Date().toISOString(),
              source: "mcstatus.io"
            });
          } catch (fallbackError) {
            console.warn("Both Minecraft status providers failed:", fallbackError);
            return json({
              online: false,
              playersOnline: 0,
              maxPlayers: 0,
              motd: "",
              version: null,
              onlinePlayers: [],
              updatedAt: new Date().toISOString(),
              source: "ping-failed",
              unavailable: true
            });
          }
        }
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

      const liveProfileMatch = path.match(/^\/v1\/players\/([0-9a-fA-F-]{36})\/live$/);
      if (request.method === "GET" && liveProfileMatch) {
        const uuid = liveProfileMatch[1].toLowerCase();
        const player = await env.DB.prepare("SELECT username FROM players WHERE uuid=?").bind(uuid).first();
        if (!player?.username) return json({ error: "Player not found" }, 404);
        if (!env.LIVE_PROFILES) return json({ error: "Live profile channel is not configured" }, 503);
        const id = env.LIVE_PROFILES.idFromName("notesmp-live-profiles");
        const channel = env.LIVE_PROFILES.get(id);
        const response = await channel.fetch("https://live-profile/request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuid, username: player.username })
        });
        return new Response(response.body, { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }

      if (request.method === "GET" && path === "/v1/minecraft/live/poll") {
        if (!requireServerKey(request, env)) return unauthorized();
        if (!env.LIVE_PROFILES) return json({ request: null });
        const channel = env.LIVE_PROFILES.get(env.LIVE_PROFILES.idFromName("notesmp-live-profiles"));
        const response = await channel.fetch("https://live-profile/poll");
        return new Response(response.body, { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }

      if (request.method === "GET" && path === "/v1/server/plugin-state") {
        if (!env.LIVE_PROFILES) return json({ pluginAvailable: false, refreshAt: 0 });
        const channel = env.LIVE_PROFILES.get(env.LIVE_PROFILES.idFromName("notesmp-live-profiles"));
        const response = await channel.fetch("https://live-profile/status");
        return new Response(response.body, { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }

      if (request.method === "POST" && path === "/v1/minecraft/status-refresh") {
        if (!requireServerKey(request, env)) return unauthorized();
        if (env.LIVE_PROFILES) {
          const channel = env.LIVE_PROFILES.get(env.LIVE_PROFILES.idFromName("notesmp-live-profiles"));
          await channel.fetch("https://live-profile/status-refresh", { method: "POST" });
        }
        return json({ ok: true, signal: "status-refresh" });
      }

      if (request.method === "GET" && path === "/v1/server/advancement-count") {
        const row = await env.DB.prepare("SELECT meta_value, updated_at FROM server_metadata WHERE meta_key='total_advancements'").first();
        return json({ totalAdvancements: row ? Number(row.meta_value) || 0 : null, updatedAt: row?.updated_at || null });
      }

      if (request.method === "POST" && path === "/v1/minecraft/live/response") {
        if (!requireServerKey(request, env)) return unauthorized();
        if (!env.LIVE_PROFILES) return json({ error: "Live profile channel is not configured" }, 503);
        const channel = env.LIVE_PROFILES.get(env.LIVE_PROFILES.idFromName("notesmp-live-profiles"));
        const responseBody = await request.text();
        try {
          const livePayload = JSON.parse(responseBody);
          const totalAdvancements = Number(livePayload.totalAdvancements);
          if (Number.isInteger(totalAdvancements) && totalAdvancements >= 0) {
            await env.DB.prepare("INSERT INTO server_metadata(meta_key,meta_value,updated_at) VALUES('total_advancements',?,CURRENT_TIMESTAMP) ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value,updated_at=CURRENT_TIMESTAMP")
              .bind(String(totalAdvancements)).run();
          }
        } catch (error) {
          // Keep the live channel resilient; malformed optional metadata must not block profile delivery.
        }
        const response = await channel.fetch("https://live-profile/respond", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: responseBody
        });
        return new Response(response.body, { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }

      const advancementsMatch = path.match(/^\/v1\/players\/([0-9a-fA-F-]{36})\/advancements$/);
      if (request.method === "GET" && advancementsMatch) {
        const result = await env.DB.prepare("SELECT advancement_id, earned_at FROM player_advancements WHERE minecraft_uuid = ? AND advancement_id NOT LIKE 'minecraft:recipes/%' AND advancement_id NOT LIKE '%/root' ORDER BY earned_at DESC, advancement_id").bind(advancementsMatch[1].toLowerCase()).all();
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
        await env.DB.prepare("INSERT INTO players(uuid,username,first_join,last_seen,playtime_seconds,blocks_broken,blocks_placed,deaths,kills,updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username,first_join=COALESCE(players.first_join,excluded.first_join),last_seen=excluded.last_seen,playtime_seconds=excluded.playtime_seconds,blocks_broken=excluded.blocks_broken,blocks_placed=excluded.blocks_placed,deaths=excluded.deaths,kills=excluded.kills,updated_at=CURRENT_TIMESTAMP WHERE players.username IS NOT excluded.username OR players.first_join IS NOT COALESCE(players.first_join,excluded.first_join) OR players.last_seen IS NOT excluded.last_seen OR players.playtime_seconds IS NOT excluded.playtime_seconds OR players.blocks_broken IS NOT excluded.blocks_broken OR players.blocks_placed IS NOT excluded.blocks_placed OR players.deaths IS NOT excluded.deaths OR players.kills IS NOT excluded.kills")
          .bind(uuid,username,typeof payload.firstJoin==="string"?payload.firstJoin:null,typeof payload.lastSeen==="string"?payload.lastSeen:null,
            number("playtime_seconds"),number("blocks_broken"),number("blocks_placed"),number("deaths"),number("kills")).run();
        const allowedStats = new Set(["mob_kills","player_kills","deaths","time_since_last_death","damage_absorbed","damage_dealt","damage_resisted","damage_taken","jumps","sneak_time","distance_climbed","distance_crouched","distance_fallen","distance_flown","distance_sprinted","distance_swum","distance_walked","distance_walked_under_water","distance_by_boat","distance_by_elytra","distance_by_happy_ghast","distance_by_horse","distance_by_minecart","blocks_placed","blocks_broken","fish_caught","animals_bred","chests_opened","barrels_opened","shulker_boxes_opened","items_dropped","items_enchanted","talked_to_villagers","traded_with_villagers","time_since_last_rest","times_slept_in_a_bed"]);
        const stats = payload.statistics && typeof payload.statistics === "object"
          ? Object.entries(payload.statistics).filter(([statId,value]) => (allowedStats.has(statId) || /^minecraft:kill_entity:minecraft:[a-z0-9_.-]+$/i.test(statId)) && Number.isFinite(Number(value)) && Number(value) >= 0)
          : [];
        // Compare the incoming complete snapshot with D1 and write only actual differences.
        const existingResult = await env.DB.prepare("SELECT stat_id, stat_value FROM player_statistics WHERE minecraft_uuid=?").bind(uuid).all();
        const existing = new Map((existingResult.results || []).map(row => [row.stat_id, Number(row.stat_value)]));
        const incoming = new Map(stats.map(([statId, value]) => [statId, Number(value)]));
        const changed = stats.filter(([statId, value]) => !existing.has(statId) || existing.get(statId) !== Number(value));
        const removed = [...existing.keys()].filter(statId => !incoming.has(statId));
        const statements = changed.map(([statId,value]) =>
          env.DB.prepare("INSERT INTO player_statistics(minecraft_uuid,stat_id,stat_value) VALUES(?,?,?) ON CONFLICT(minecraft_uuid,stat_id) DO UPDATE SET stat_value=excluded.stat_value,updated_at=CURRENT_TIMESTAMP")
            .bind(uuid,statId,Number(value)));
        if (removed.length) {
          const placeholders = removed.map(() => "?").join(",");
          statements.push(env.DB.prepare("DELETE FROM player_statistics WHERE minecraft_uuid=? AND stat_id IN (" + placeholders + ")").bind(uuid, ...removed));
        }
        for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
        return json({ ok: true, statsReceived: stats.length, statsChanged: changed.length, statsRemoved: removed.length });
      }

      const statsMatch = path.match(/^\/v1\/players\/([0-9a-fA-F-]{36})\/statistics$/);
      if (request.method === "GET" && statsMatch) {
        const uuid = statsMatch[1];
        if (url.searchParams.get("refresh") === "1") {
          const player = await env.DB.prepare("SELECT username FROM players WHERE uuid=?").bind(uuid).first();
          if (player?.username) {
            await env.DB.prepare("INSERT INTO stats_refresh_queue(uuid,username,status,requested_at) VALUES(?,?,'pending',CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username,status='pending',requested_at=CURRENT_TIMESTAMP,claimed_at=NULL").bind(uuid,player.username).run();
            // Keep this profile request open briefly for the plugin's next poll and fresh snapshot.
            for (let attempt = 0; attempt < 40; attempt++) {
              const queue = await env.DB.prepare("SELECT status FROM stats_refresh_queue WHERE uuid=?").bind(uuid).first();
              if (queue?.status === "done") break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
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
        // Treat the payload as a complete snapshot, but only mutate D1 rows that differ.
        const normalized = advancements.filter(item => item && typeof item.advancementId === "string" && item.advancementId.length <= 180)
          .map(item => ({
            id: item.advancementId,
            title: typeof item.title === "string" ? item.title.slice(0, 180) : item.advancementId,
            icon: typeof item.icon === "string" ? item.icon.slice(0, 120) : null,
            earnedAt: typeof item.earnedAt === "string" ? item.earnedAt : new Date().toISOString()
          }));
        // An empty plugin snapshot can mean the advancement file was unavailable or
        // unreadable. Never erase a player's previously recorded unlocks on an empty response.
        if (normalized.length === 0) {
          return json({ ok: true, advancementsReceived: 0, advancementsChanged: 0, advancementsRemoved: 0, preservedExisting: true });
        }
        const existingResult = await env.DB.prepare("SELECT advancement_id, advancement_title, icon_name, earned_at FROM player_advancements WHERE minecraft_uuid=?").bind(uuid).all();
        const existing = new Map((existingResult.results || []).map(row => [row.advancement_id, row]));
        const incoming = new Map(normalized.map(item => [item.id, item]));
        const changed = normalized.filter(item => {
          const old = existing.get(item.id);
          return !old || old.advancement_title !== item.title || old.icon_name !== item.icon || old.earned_at !== item.earnedAt;
        });
        const removed = [...existing.keys()].filter(id => !incoming.has(id));
        const statements = changed.map(item =>
          env.DB.prepare("INSERT INTO player_advancements (minecraft_uuid, advancement_id, advancement_title, icon_name, earned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(minecraft_uuid, advancement_id) DO UPDATE SET advancement_title=excluded.advancement_title, icon_name=excluded.icon_name, earned_at=excluded.earned_at")
            .bind(uuid, item.id, item.title, item.icon, item.earnedAt));
        if (removed.length) {
          const placeholders = removed.map(() => "?").join(",");
          statements.push(env.DB.prepare("DELETE FROM player_advancements WHERE minecraft_uuid=? AND advancement_id IN (" + placeholders + ")").bind(uuid, ...removed));
        }
        for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
        return json({ ok: true, advancementsReceived: normalized.length, advancementsChanged: changed.length, advancementsRemoved: removed.length });
      }

      if (request.method === "POST" && path === "/v1/minecraft/advancement") {
        if (!requireServerKey(request, env)) return unauthorized();
        const body = await request.json();
        const uuid = typeof body.uuid === "string" ? body.uuid : "";
        const username = typeof body.username === "string" ? body.username.slice(0, 16) : "";
        const advancementId = typeof body.advancementId === "string" ? body.advancementId.slice(0, 180) : "";
        const title = typeof body.title === "string" ? body.title.slice(0, 180) : advancementId;
        const icon = typeof body.icon === "string" ? body.icon.slice(0, 120) : null;
        const earnedAt = typeof body.earnedAt === "string" ? body.earnedAt : new Date().toISOString();
        if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !username || !advancementId) return json({ error: "Invalid advancement payload" }, 400);
        await env.DB.prepare("INSERT INTO players (uuid, username, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(uuid) DO UPDATE SET username=excluded.username, updated_at=CURRENT_TIMESTAMP").bind(uuid, username).run();
        await env.DB.prepare("INSERT INTO player_advancements (minecraft_uuid, advancement_id, advancement_title, icon_name, earned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(minecraft_uuid, advancement_id) DO UPDATE SET advancement_title=excluded.advancement_title, icon_name=excluded.icon_name, earned_at=excluded.earned_at").bind(uuid, advancementId, title, icon, earnedAt).run();
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


export class LiveProfileChannel {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/request") {
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body.uuid || "") || typeof body.username !== "string") return json({ error: "Invalid player" }, 400);
      const requestId = crypto.randomUUID();
      const item = { requestId, uuid: body.uuid.toLowerCase(), username: body.username, createdAt: Date.now() };
      await this.state.storage.put("pending:" + requestId, item);
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        const result = await this.state.storage.get("response:" + requestId);
        if (result) {
          await this.state.storage.delete("response:" + requestId);
          await this.state.storage.delete("pending:" + requestId);
          return json({ ok: true, source: "plugin-live", ...result });
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      await this.state.storage.delete("pending:" + requestId);
      return json({ error: "Plugin did not respond in time", unavailable: true }, 504);
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const lastPoll = Number(await this.state.storage.get("last-plugin-poll") || 0);
      const refreshAt = Number(await this.state.storage.get("last-status-refresh") || 0);
      return json({ pluginAvailable: Date.now() - lastPoll < 15000, refreshAt });
    }
    if (request.method === "POST" && url.pathname === "/status-refresh") {
      await this.state.storage.put("last-status-refresh", Date.now());
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/poll") {
      await this.state.storage.put("last-plugin-poll", Date.now());
      const listed = await this.state.storage.list({ prefix: "pending:", limit: 50 });
      const requests = [...listed.values()].sort((a, b) => a.createdAt - b.createdAt);
      const next = requests.find(item => Date.now() - item.createdAt < 20000 && (!item.claimedAt || Date.now() - item.claimedAt > 8000));
      if (next) {
        next.claimedAt = Date.now();
        await this.state.storage.put("pending:" + next.requestId, next);
      }
      return json({ request: next || null });
    }
    if (request.method === "POST" && url.pathname === "/respond") {
      const body = await request.json();
      if (typeof body.requestId !== "string") return json({ error: "Missing requestId" }, 400);
      const pending = await this.state.storage.get("pending:" + body.requestId);
      if (!pending || Date.now() - pending.createdAt > 20000) return json({ error: "Request expired" }, 404);
      const result = {
        uuid: pending.uuid, username: pending.username,
        statistics: Array.isArray(body.statistics) ? body.statistics : [],
        advancements: Array.isArray(body.advancements) ? body.advancements.map(item => ({
          advancement_id: item.advancement_id || item.advancementId,
          earned_at: item.earned_at || item.earnedAt || null
        })) : [],
        baseStats: body.baseStats && typeof body.baseStats === "object" ? body.baseStats : {},
        firstJoin: typeof body.firstJoin === "string" ? body.firstJoin : null,
        lastSeen: typeof body.lastSeen === "string" ? body.lastSeen : null,
        totalAdvancements: Number.isInteger(Number(body.totalAdvancements)) && Number(body.totalAdvancements) >= 0 ? Number(body.totalAdvancements) : null,
        receivedAt: new Date().toISOString()
      };
      await this.state.storage.put("response:" + body.requestId, result, { expirationTtl: 25 });
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }
}
