// functions/api/search.js
// FTS5 search (titles only) + cursor pagination by rowid
// Optimized: fetch only rowids from FTS, then fetch video fields from videos by PK

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function cleanQuery(q) {
  const s = (q || "").trim();
  if (!s) return "";
  return s
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toFtsMatch(cleaned) {
  if (!cleaned) return "";
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "";
  return parts.map(p => `"${p}"`).join(" ");
}

export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  const qRaw = url.searchParams.get("q") || "";
  const cleaned = cleanQuery(qRaw);
  const match = toFtsMatch(cleaned);

  // תן ל-UI לבקש 100/200 בלי להיחנק
  const limit = clamp(parseInt(url.searchParams.get("limit") || "100", 10), 1, 200);

  const cursorRaw = (url.searchParams.get("cursor") || "").trim();
  const cursor = cursorRaw ? parseInt(cursorRaw, 10) : null;

  if (!match) {
    return Response.json(
      { results: [], next_cursor: null },
      { headers: { "cache-control": "no-store" } }
    );
  }

  // 1) FTS: רק rowid (זול יותר)
  const fts = (Number.isFinite(cursor) && cursor > 0)
    ? await env.DB.prepare(`
        SELECT rowid
        FROM video_fts
        WHERE video_fts MATCH ?
          AND rowid < ?
        ORDER BY rowid DESC
        LIMIT ?
      `).bind(match, cursor, limit).all()
    : await env.DB.prepare(`
        SELECT rowid
        FROM video_fts
        WHERE video_fts MATCH ?
        ORDER BY rowid DESC
        LIMIT ?
      `).bind(match, limit).all();

  const ids = (fts.results || []).map(r => r.rowid);
  if (!ids.length) {
    return Response.json(
      { results: [], next_cursor: null },
      { headers: { "cache-control": "no-store" } }
    );
  }

  // 2) videos: שליפה זולה לפי PK (id)
  const placeholders = ids.map(() => "?").join(",");
  const vids = await env.DB.prepare(`
    SELECT id, video_id, title, published_at
    FROM videos
    WHERE id IN (${placeholders})
    ORDER BY id DESC
  `).bind(...ids).all();

  const results = (vids.results || []).map(v => ({
    video_id: v.video_id,
    title: v.title,
    published_at: v.published_at,
    // אופציונלי (עוזר ללקוח fallback, לא עולה Reads)
    cursor: String(v.id)
  }));

  const next_cursor = String(ids[ids.length - 1]);

  return Response.json(
    { results, next_cursor },
    { headers: { "cache-control": "no-store" } }
  );
}
