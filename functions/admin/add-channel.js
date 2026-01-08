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

/** מוציא VIDEO_ID מתוך URL של ytimg, כדי לשמור רק מזהה */
function extractVideoIdFromThumbUrl(url) {
  if (!url) return null;
  // https://i.ytimg.com/vi/VIDEO_ID/mqdefault.jpg
  // https://i.ytimg.com/vi_webp/VIDEO_ID/...
  const m = url.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]{11})\//);
  return m ? m[1] : null;
}

/** שומר אירוע "צ'אנל נוסף" */
async function logAddChannel({ env, channel_int, channel_id }) {
  const t = nowSec();
  await env.DB.prepare(`
    INSERT INTO logs (ts, kind, channel_int, channel_id, data)
    VALUES (?, 'add-channel', ?, ?, NULL)
  `).bind(t, channel_int, channel_id).run();
}

async function upsertChannel({ env, channel_id, title, uploads_playlist_id }) {
  const t = nowSec();
  const out = await env.DB.prepare(`
    INSERT INTO channels (channel_id, title, uploads_playlist_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = excluded.title,
      uploads_playlist_id = excluded.uploads_playlist_id
    RETURNING channel_int
  `).bind(channel_id, title || null, uploads_playlist_id || null, t).first();

  return out?.channel_int;
}

async function importUploadsPlaylist({ env, channel_int, playlist_id }) {
  if (!playlist_id) return { ok: false, imported: 0 };

  let imported = 0;
  let pageToken = null;
  const API_KEY = env.YT_API_KEY;

  if (!API_KEY) return { ok: false, imported: 0, error: "missing YT_API_KEY" };

  for (let i = 0; i < 50; i++) { // בטיחות
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", playlist_id);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await ytJson(url.toString());
    const items = data.items || [];

    for (const it of items) {
      const sn = it.snippet || {};
      const cd = it.contentDetails || {};

      const video_id = cd.videoId || sn?.resourceId?.videoId || null;
      if (!video_id) continue;

      const published_at = toUnixSeconds(cd.videoPublishedAt || sn.publishedAt) || null;
      const title = sn.title || null;
      const channel_title = sn.channelTitle || null;
      const description = sn.description || null;

      const thumb = sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || null;
      const thumb_video_id = extractVideoIdFromThumbUrl(thumb);

      await env.DB.prepare(`
        INSERT INTO videos (channel_int, video_id, published_at, title, channel_title, description, thumb_video_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_int, video_id) DO UPDATE SET
          published_at = COALESCE(excluded.published_at, videos.published_at),
          title = COALESCE(excluded.title, videos.title),
          channel_title = COALESCE(excluded.channel_title, videos.channel_title),
          description = COALESCE(excluded.description, videos.description),
          thumb_video_id = COALESCE(excluded.thumb_video_id, videos.thumb_video_id)
      `).bind(channel_int, video_id, published_at, title, channel_title, description, thumb_video_id).run();

      imported++;
    }

    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }

  return { ok: true, imported };
}

async function subscribeWebSub({ env, request, channel_id, channel_int }) {
  const t = nowSec();
  const origin = new URL(request.url).origin;
  const callback = `${origin}/websub/youtube`;

  // חשוב: ביוטיוב ה-topic ה"קנוני" הוא מה שמופיע ב-<link rel="self"> בפיד
  // ולכן משתמשים ב- /xml/feeds ולא ב- /feeds
  const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channel_id)}`;

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
  params.set("hub.topic", topic);
  params.set("hub.callback", callback);
  params.set("hub.verify", "async");
  params.set("hub.verify_token", env.WEBSUB_VERIFY_TOKEN || "");
  params.set("hub.lease_seconds", String(env.WEBSUB_LEASE_SECONDS || 432000));

  const r = await fetch(hub, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const last_error = r.ok ? null : `hub ${r.status}: ${(await r.text()).slice(0, 200)}`;

  // נשמור/נעדכן סטטוס "pending" מיד עם הבקשה
  await env.DB.prepare(`
    INSERT INTO subscriptions (topic_url, channel_int, status, last_subscribed_at, last_error)
    VALUES (?, ?, 'pending', ?, ?)
    ON CONFLICT(topic_url) DO UPDATE SET
      channel_int = excluded.channel_int,
      status = excluded.status,
      last_subscribed_at = excluded.last_subscribed_at,
      last_error = excluded.last_error
  `).bind(topic, channel_int, t, last_error).run();

  return { ok: r.ok, skipped: false, topic, hub_status: r.status, last_error };
}

export async function onRequest({ env, request }) {
  if (request.method !== "POST") return new Response("use POST", { status: 200 });

  const token = request.headers.get("x-admin-token") || "";
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const channel_id = (body.channel_id || "").trim();

  if (!channel_id) return Response.json({ ok: false, error: "missing channel_id" }, { status: 400 });

  const apiKey = env.YT_API_KEY;
  if (!apiKey) return Response.json({ ok: false, error: "missing YT_API_KEY" }, { status: 500 });

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("id", channel_id);
  url.searchParams.set("key", apiKey);

  const data = await ytJson(url.toString());
  const ch = (data.items || [])[0];
  if (!ch) return Response.json({ ok: false, error: "channel not found" }, { status: 404 });

  const title = ch.snippet?.title || null;
  const uploads_playlist_id = ch.contentDetails?.relatedPlaylists?.uploads || null;

  const channel_int = await upsertChannel({ env, channel_id, title, uploads_playlist_id });
  if (!channel_int) return Response.json({ ok: false, error: "failed to upsert channel" }, { status: 500 });

  await logAddChannel({ env, channel_int, channel_id });

  const websub = await subscribeWebSub({ env, request, channel_id, channel_int });
  const playlists = await importUploadsPlaylist({ env, channel_int, playlist_id: uploads_playlist_id });

  return Response.json({
    ok: true,
    channel_id,
    channel_int,
    title,
    uploads_playlist_id,
    websub: {
      ok: !!websub.ok,
      skipped: !!websub.skipped,
      reason: websub.reason || null,
      topic: websub.topic,
      hub_status: websub.hub_status,
      last_error: websub.last_error || null
    },
    playlists
  });
}
