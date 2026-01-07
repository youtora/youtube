// functions/admin/add-channel.js

function unauthorized() { return new Response("unauthorized", { status: 401 }); }
function nowSec() { return Math.floor(Date.now() / 1000); }
function toUnixSeconds(iso) {
  const ms = Date.parse(iso || "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

async function ytJson(url) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`YT ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

async function ensureChannel({ env, channel_id }) {
  const apiKey = env.YT_API_KEY || "";
  if (!apiKey) throw new Error("missing YT_API_KEY");

  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "snippet,contentDetails");
  u.searchParams.set("id", channel_id);
  u.searchParams.set("key", apiKey);

  const j = await ytJson(u.toString());
  const item = (j.items || [])[0];
  if (!item) throw new Error("channel not found");

  const title = item.snippet?.title || "";
  const uploads = item.contentDetails?.relatedPlaylists?.uploads || "";

  const res = await env.DB.prepare(`
    INSERT INTO channels(channel_id, title, uploads_playlist_id, created_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = excluded.title,
      uploads_playlist_id = excluded.uploads_playlist_id
  `).bind(channel_id, title, uploads, nowSec()).run();

  const channel_int = res.meta?.last_row_id;

  const row = await env.DB.prepare(`
    SELECT channel_int
    FROM channels
    WHERE channel_id=?
  `).bind(channel_id).first();

  return {
    channel_int: row?.channel_int ?? channel_int ?? null,
    title,
    uploads_playlist_id: uploads
  };
}

/** הרשמה ל-WebSub אימות אסינכרוני */
async function subscribeWebSub({ env, request, channel_id, channel_int }) {
  const t = nowSec();
  const origin = (env.PUBLIC_ORIGIN || new URL(request.url).origin).replace(/\/$/, "");
  const callback = `${origin}/websub/youtube`;
  const topic = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel_id)}`;
  const hub = "https://pubsubhubbub.appspot.com/subscribe";

  const existing = await env.DB.prepare(`
    SELECT status, lease_expires_at
    FROM subscriptions
    WHERE topic_url=?
  `).bind(topic).first();

  const MIN_REMAINING = 2 * 24 * 3600; // 2 ימים
  if (existing?.status === "active" && Number.isFinite(existing?.lease_expires_at) && existing.lease_expires_at > t + MIN_REMAINING) {
    return { ok: true, skipped: true, reason: "already active", topic, hub_status: null };
  }

  const params = new URLSearchParams();
  params.set("hub.mode", "subscribe");
  params.set("hub.callback", callback);
  params.set("hub.topic", topic);
  params.set("hub.verify", "async");

  // חשוב: מגן מזיוף של בקשות אימות GET
  if (!env.WEBSUB_VERIFY_TOKEN) {
    const last_error = "missing WEBSUB_VERIFY_TOKEN";

    await env.DB.prepare(`
      INSERT INTO subscriptions(topic_url, channel_int, status, last_subscribed_at, last_error)
      VALUES(?, ?, 'pending', ?, ?)
      ON CONFLICT(topic_url) DO UPDATE SET
        channel_int = excluded.channel_int,
        status = CASE
          WHEN subscriptions.status='active' THEN 'active'
          ELSE 'pending'
        END,
        last_subscribed_at = excluded.last_subscribed_at,
        last_error = excluded.last_error
    `).bind(topic, channel_int, t, last_error).run();

    return { ok: false, skipped: false, reason: last_error, topic, hub_status: null, last_error };
  }
  params.set("hub.verify_token", env.WEBSUB_VERIFY_TOKEN);

  if (env.WEBSUB_SECRET) params.set("hub.secret", env.WEBSUB_SECRET);

  const res = await fetch(hub, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const last_error = res.ok ? null : `hub subscribe failed: ${res.status}`;

  await env.DB.prepare(`
    INSERT INTO subscriptions(topic_url, channel_int, status, last_subscribed_at, last_error)
    VALUES(?, ?, 'pending', ?, ?)
    ON CONFLICT(topic_url) DO UPDATE SET
      channel_int = excluded.channel_int,
      status = CASE
        WHEN subscriptions.status='active' THEN 'active'
        ELSE 'pending'
      END,
      last_subscribed_at = excluded.last_subscribed_at,
      last_error = excluded.last_error
  `).bind(topic, channel_int, t, last_error).run();

  return { ok: res.ok, skipped: false, topic, hub_status: res.status, last_error };
}

async function fetchPlaylists({ env, channel_id, max_pages }) {
  const apiKey = env.YT_API_KEY || "";
  if (!apiKey) throw new Error("missing YT_API_KEY");

  const out = [];
  let pageToken = "";

  for (let p = 0; p < max_pages; p++) {
    const u = new URL("https://www.googleapis.com/youtube/v3/playlists");
    u.searchParams.set("part", "snippet,contentDetails");
    u.searchParams.set("channelId", channel_id);
    u.searchParams.set("maxResults", "50");
    u.searchParams.set("key", apiKey);
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const j = await ytJson(u.toString());
    const items = j.items || [];

    for (const it of items) {
      const playlist_id = it.id || "";
      const title = it.snippet?.title || "";
      const published_at = toUnixSeconds(it.snippet?.publishedAt || "");
      const item_count = it.contentDetails?.itemCount ?? null;

      if (!playlist_id) continue;

      out.push({ playlist_id, title, published_at, item_count });
    }

    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
  }

  return out;
}

export async function onRequest({ env, request }) {
  if (request.method !== "POST") return new Response("use POST", { status: 200 });

  const token = request.headers.get("x-admin-token") || "";
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const channel_id = (body.channel_id || "").trim();
  const playlists_pages = Math.min(Math.max(parseInt(body.playlists_pages || "10", 10), 1), 30);

  if (!channel_id) return new Response("missing channel_id", { status: 400 });

  const { channel_int, title, uploads_playlist_id: uploads } = await ensureChannel({ env, channel_id });

  const websub = await subscribeWebSub({ env, request, channel_id, channel_int });

  const playlists = await fetchPlaylists({ env, channel_id, max_pages: playlists_pages });

  if (playlists.length) {
    const now = nowSec();
    const stmts = [];
    for (const pl of playlists) {
      stmts.push(env.DB.prepare(`
        INSERT INTO playlists(playlist_id, channel_int, title, published_at, item_count, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(playlist_id) DO UPDATE SET
          channel_int = excluded.channel_int,
          title = excluded.title,
          published_at = excluded.published_at,
          item_count = excluded.item_count
      `).bind(pl.playlist_id, channel_int, pl.title, pl.published_at ?? null, pl.item_count ?? null, now));
    }
    await env.DB.batch(stmts);
  }

  return Response.json({
    ok: true,
    channel_id,
    channel_int,
    title,
    uploads_playlist_id: uploads,
    websub,
    playlists
  });
}
