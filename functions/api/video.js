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

export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const video_id = (url.searchParams.get("video_id") || "").trim();
  if (!video_id) return json({ error: "missing video_id" }, 400);

  const suggested_limit = clamp(parseInt(url.searchParams.get("suggested_limit") || "18", 10), 1, 60);
  const suggested_cursor = decodeCursor(url.searchParams.get("suggested_cursor"));

  const chThumb = await hasColumn(env, "channels", "thumbnail_url");

  const v = await env.DB.prepare(`
    SELECT
      v.video_id, v.title, v.published_at,
      c.channel_id, c.title AS channel_title,
      ${chThumb ? "c.thumbnail_url AS channel_thumbnail_url" : "NULL AS channel_thumbnail_url"},
      v.channel_int
    FROM videos v
    JOIN channels c ON c.id = v.channel_int
    WHERE v.video_id=?
    LIMIT 1
  `).bind(video_id).first();

  if (!v) return json({ video: null }, 404);

  // suggested: latest from same channel (excluding current)
  const whereCur = suggested_cursor
    ? `AND (COALESCE(v2.published_at,0) < ? OR (COALESCE(v2.published_at,0) = ? AND v2.video_id < ?))`
    : ``;

  const binds = suggested_cursor
    ? [v.channel_int, video_id, suggested_cursor.ts, suggested_cursor.ts, suggested_cursor.id, suggested_limit]
    : [v.channel_int, video_id, suggested_limit];

  const rows = await env.DB.prepare(`
    SELECT
      v2.video_id, v2.title, v2.published_at,
      c.channel_id, c.title AS channel_title,
      ${chThumb ? "c.thumbnail_url AS channel_thumbnail_url" : "NULL AS channel_thumbnail_url"}
    FROM videos v2
    JOIN channels c ON c.id = v2.channel_int
    WHERE v2.channel_int=? AND v2.video_id <> ?
    ${whereCur}
    ORDER BY COALESCE(v2.published_at,0) DESC, v2.video_id DESC
    LIMIT ?
  `).bind(...binds).all();

  const suggested = rows.results || [];
  const suggested_next_cursor = (suggested.length === suggested_limit)
    ? encodeCursor(suggested[suggested.length - 1].published_at || 0, suggested[suggested.length - 1].video_id)
    : null;

  // drop channel_int from client payload
  const { channel_int, ...videoPublic } = v;

  return json(
    { video: videoPublic, suggested, suggested_next_cursor },
    200,
    { "cache-control": "public, max-age=60" }
  );
}
