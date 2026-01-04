function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export async function onRequest({ env }) {
  const thumb = await hasColumn(env, "channels", "thumbnail_url");
  const sql = `
    SELECT channel_id, title ${thumb ? ", thumbnail_url" : ""}
    FROM channels
    WHERE is_active=1
    ORDER BY COALESCE(title, channel_id) COLLATE NOCASE ASC
  `;
  const rows = await env.DB.prepare(sql).all();
  return json({ channels: rows.results || [] }, 200, { "cache-control": "public, max-age=300" });
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
