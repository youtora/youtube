function unauthorized() { return new Response("unauthorized", { status: 401 }); }
function nowSec() { return Math.floor(Date.now()/1000); }

async function ytJson(url) {
  const r = await fetch(url);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`YT ${r.status}: ${t.slice(0,200)}`);
  return j;
}

export async function onRequest({ env, request }) {
  if (request.method !== "POST") return new Response("use POST", { status: 200 });

  const token = request.headers.get("x-admin-token") || "";
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return unauthorized();

  const body = await request.json().catch(()=>({}));
  const channel_id = (body.channel_id || "").trim();
  if (!channel_id) return new Response("missing channel_id", { status: 400 });

  const t = nowSec();

  // 1) ערוץ + uploads_playlist_id
  let title = null, thumb = null, uploads = null;

  if (!env.YT_API_KEY) {
    // בלי מפתח: אפשר עדיין להירשם לפושים, אבל אין backfill היסטוריה
  } else {
    const data = await ytJson(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${encodeURIComponent(channel_id)}&key=${encodeURIComponent(env.YT_API_KEY)}`
    );
    const item = data?.items?.[0];
    title = item?.snippet?.title || null;
    thumb = item?.snippet?.thumbnails?.default?.url
         || item?.snippet?.thumbnails?.medium?.url
         || item?.snippet?.thumbnails?.high?.url
         || null;
    uploads = item?.contentDetails?.relatedPlaylists?.uploads || null;
  }

  await env.DB.prepare(`
    INSERT INTO channels(channel_id, title, thumbnail_url, is_active, created_at, updated_at)
    VALUES(?, ?, ?, 1, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = COALESCE(excluded.title, channels.title),
      thumbnail_url = COALESCE(excluded.thumbnail_url, channels.thumbnail_url),
      is_active = 1,
      updated_at = excluded.updated_at
  `).bind(channel_id, title, thumb, t, t).run();

  const ch = await env.DB.prepare(`SELECT id FROM channels WHERE channel_id = ?`).bind(channel_id).first();
  const channel_int = ch.id;

  // backfill state
  await env.DB.prepare(`
    INSERT INTO channel_backfill(channel_int, uploads_playlist_id, next_page_token, done, imported_count, updated_at)
    VALUES(?, ?, NULL, 0, 0, ?)
    ON CONFLICT(channel_int) DO UPDATE SET
      uploads_playlist_id = COALESCE(excluded.uploads_playlist_id, channel_backfill.uploads_playlist_id),
      updated_at = excluded.updated_at
  `).bind(channel_int, uploads, t).run();

  // 2) subscribe WebSub
  const origin = new URL(request.url).origin;
  const callback = `${origin}/websub/youtube`;
  const topic = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel_id)}`;
  const hub = "https://pubsubhubbub.appspot.com/subscribe";

  const params = new URLSearchParams();
  params.set("hub.mode", "subscribe");
  params.set("hub.callback", callback);
  params.set("hub.topic", topic);
  params.set("hub.verify", "async");
  if (env.WEBSUB_SECRET) params.set("hub.secret", env.WEBSUB_SECRET);

  const res = await fetch(hub, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  await env.DB.prepare(`
    INSERT INTO subscriptions(topic_url, channel_int, status, last_subscribed_at, last_error)
    VALUES(?, ?, 'pending', ?, NULL)
    ON CONFLICT(topic_url) DO UPDATE SET
      channel_int = excluded.channel_int,
      status='pending',
      last_subscribed_at=excluded.last_subscribed_at,
      last_error=NULL
  `).bind(topic, channel_int, t).run();

  return Response.json({
    ok: true,
    channel_id,
    channel_int,
    title,
    uploads_playlist_id: uploads,
    subscribed_sent: res.status
  });
}
