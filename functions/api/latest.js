function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
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
  const limit = clamp(parseInt(url.searchParams.get("limit") || "24", 10), 1, 60);
  const cur = decodeCursor(url.searchParams.get("cursor"));

  const where = cur
    ? `WHERE (COALESCE(v.published_at,0) < ? OR (COALESCE(v.published_at,0) = ? AND v.video_id < ?))`
    : ``;

  const binds = cur ? [cur.ts, cur.ts, cur.id, limit] : [limit];

  const sql = `
    SELECT
      v.video_id,
      v.title,
      v.published_at,
      c.channel_id,
      c.title AS channel_title,
      ${await hasColumn(env, "channels", "thumbnail_url") ? "c.thumbnail_url AS channel_thumbnail_url" : "NULL AS channel_thumbnail_url"}
    FROM videos v
    JOIN channels c ON c.id = v.channel_int
    ${where}
    ORDER BY COALESCE(v.published_at,0) DESC, v.video_id DESC
    LIMIT ?
  `;

  const rows = await env.DB.prepare(sql).bind(...binds).all();
  const videos = rows.results || [];

  let next_cursor = null;
  if (videos.length === limit) {
    const last = videos[videos.length - 1];
    next_cursor = encodeCursor(last.published_at || 0, last.video_id);
  }

  return json(
    { videos, next_cursor },
    200,
    { "cache-control": "public, max-age=30" }
  );
}

/* column detector (safe if schema changes) */
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
