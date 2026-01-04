function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function clamp(n, a, b) {
  n = Number.isFinite(n) ? n : a;
  return Math.max(a, Math.min(b, n));
}

function decodeCursor(cur) {
  if (!cur) return null;
  const s = String(cur);
  const i = s.indexOf(":");
  if (i === -1) return null;
  const ts = parseInt(s.slice(0, i), 10);
  const id = s.slice(i + 1);
  if (!Number.isFinite(ts) || !id) return null;
  return { ts, id };
}
function encodeCursor(ts, id) {
  return `${ts || 0}:${id}`;
}

export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const channel_id = (url.searchParams.get("channel_id") || "").trim();
  if (!channel_id) return json({ error: "missing channel_id" }, 400);

  const include_videos = (url.searchParams.get("include_videos") || "0") === "1";
  const include_playlists = (url.searchParams.get("include_playlists") || "0") === "1";

  const videos_limit = clamp(parseInt(url.searchParams.get("videos_limit") || "24", 10), 1, 60);
  const playlists_limit = clamp(parseInt(url.searchParams.get("playlists_limit") || "24", 10), 1, 60);

  const videos_cursor = decodeCursor(url.searchParams.get("videos_cursor"));
  const playlists_cursor = decodeCursor(url.searchParams.get("playlists_cursor"));

  const chThumb = await hasColumn(env, "channels", "thumbnail_url");

  const ch = await env.DB.prepare(`
    SELECT id, channel_id, title ${chThumb ? ", thumbnail_url" : ""}
    FROM channels
    WHERE channel_id=? AND is_active=1
    LIMIT 1
  `).bind(channel_id).first();

  if (!ch) return json({ channel: null }, 404);

  const out = { channel: ch };

  if (include_videos) {
    const where = videos_cursor
      ? `AND (COALESCE(v.published_at,0) < ? OR (COALESCE(v.published_at,0) = ? AND v.video_id < ?))`
      : ``;
    const binds = videos_cursor
      ? [ch.id, videos_cursor.ts, videos_cursor.ts, videos_cursor.id, videos_limit]
      : [ch.id, videos_limit];

    const rows = await env.DB.prepare(`
      SELECT
        v.video_id, v.title, v.published_at,
        c.channel_id, c.title AS channel_title,
        ${chThumb ? "c.thumbnail_url AS channel_thumbnail_url" : "NULL AS channel_thumbnail_url"}
      FROM videos v
      JOIN channels c ON c.id = v.channel_int
      WHERE v.channel_int=?
      ${where}
      ORDER BY COALESCE(v.published_at,0) DESC, v.video_id DESC
      LIMIT ?
    `).bind(...binds).all();

    const videos = rows.results || [];
    out.videos = videos;

    out.videos_next_cursor = (videos.length === videos_limit)
      ? encodeCursor(videos[videos.length - 1].published_at || 0, videos[videos.length - 1].video_id)
      : null;
  }

  if (include_playlists) {
    const hasThumbId = await hasColumn(env, "playlists", "thumb_video_id")
      || await hasColumn(env, "playlists", "thumbnail_video_id");

    const thumbExpr = hasThumbId
      ? (await hasColumn(env, "playlists", "thumb_video_id")
          ? "p.thumb_video_id AS thumb_video_id"
          : "p.thumbnail_video_id AS thumb_video_id")
      : `(SELECT pv.video_id FROM playlist_videos pv WHERE pv.playlist_id=p.playlist_id LIMIT 1) AS thumb_video_id`;

    const where = playlists_cursor
      ? `AND (COALESCE(p.published_at,0) < ? OR (COALESCE(p.published_at,0) = ? AND p.playlist_id < ?))`
      : ``;

    const binds = playlists_cursor
      ? [ch.id, playlists_cursor.ts, playlists_cursor.ts, playlists_cursor.id, playlists_limit]
      : [ch.id, playlists_limit];

    const rows = await env.DB.prepare(`
      SELECT
        p.playlist_id, p.title, p.published_at, p.item_count,
        c.channel_id, c.title AS channel_title,
        ${chThumb ? "c.thumbnail_url AS channel_thumbnail_url" : "NULL AS channel_thumbnail_url"},
        ${thumbExpr}
      FROM playlists p
      JOIN channels c ON c.id = p.channel_int
      WHERE p.channel_int=?
      ${where}
      ORDER BY COALESCE(p.published_at,0) DESC, p.playlist_id DESC
      LIMIT ?
    `).bind(...binds).all();

    const playlists = rows.results || [];
    out.playlists = playlists;

    out.playlists_next_cursor = (playlists.length === playlists_limit)
      ? encodeCursor(playlists[playlists.length - 1].published_at || 0, playlists[playlists.length - 1].playlist_id)
      : null;
  }

  return json(out, 200, { "cache-control": "public, max-age=60" });
}

const _colsCache = new Map();
async function hasColumn(env, table, col) {
  const key = `${table}`;
  let set = _colsCache.get(key);
  if (!set) {
    const r = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    set = new Set((r.results || []).map(x => x.name));
    _colsCache.set(key, set);
  }
  return set.has(col);
}
