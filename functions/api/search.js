// functions/api/search.js
// FTS5 search on titles only (video_fts) + cursor pagination by rowid
// Always returns 50 results per request (no max limit param).

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

  // תמיד 50
  const limit = 50;

  // cursor: rowid (מספר)
  const cursorRaw = (url.searchParams.get("cursor") || "").trim();
  const cursor = cursorRaw ? parseInt(cursorRaw, 10) : null;

  if (!match) {
    return Response.json(
      { results: [], next_cursor: null },
      { headers: { "cache-control": "public, max-age=30" } }
    );
  }

  // 1) מה-FTS מביאים רק rowid (חסכוני)
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
      { headers: { "cache-control": "public, max-age=30" } }
    );
  }

  // 2) מביאים פרטי וידאו לפי PK (id) — זול
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
    cursor: String(v.id) // fallback ללקוח (לא חובה, אבל עוזר)
  }));

  // cursor הבא = ה-rowid האחרון שחזר מה-FTS
  const next_cursor = String(ids[ids.length - 1]);

  return Response.json(
    { results, next_cursor },
    { headers: { "cache-control": "public, max-age=30" } }
  );
}
