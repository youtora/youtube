export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "24", 10), 1), 60);

  // cursor format: "<published_at>:<id>"
  // (נשאר אותו פורמט כדי שהלקוח לא יסתבך)
  const cursorRaw = (url.searchParams.get("cursor") || "").trim();
  let cursorP = null;
  let cursorId = null;

  if (cursorRaw) {
    const parts = cursorRaw.split(":");
    if (parts.length === 2) {
      const p = parseInt(parts[0] || "0", 10);
      const id = parseInt(parts[1] || "0", 10);
      if (Number.isFinite(p) && Number.isFinite(id) && id > 0) {
        cursorP = p;
        cursorId = id;
      }
    } else {
      // תאימות אם נשאר לך cursor ישן שהוא רק id
      const id = parseInt(parts[0] || "0", 10);
      if (Number.isFinite(id) && id > 0) cursorId = id;
    }
  }

  // אם הגיע cursor שהוא רק id (מתקופה קודמת), נשלים published_at פעם אחת
  if (cursorP === null && cursorId !== null) {
    const row = await env.DB.prepare(`SELECT published_at FROM videos WHERE id=?`).bind(cursorId).first();
    cursorP = row?.published_at ?? 0;
  }

  const baseSql = `
    SELECT
      v.id,
      v.video_id,
      v.title,
      v.published_at,
      c.channel_id,
      c.title AS channel_title
    FROM videos v
    LEFT JOIN channels c ON c.id = v.channel_int
  `;

  const rows = (cursorP !== null && cursorId !== null)
    ? await env.DB.prepare(`
        ${baseSql}
        WHERE (v.published_at < ? OR (v.published_at = ? AND v.id < ?))
        ORDER BY v.published_at DESC, v.id DESC
        LIMIT ?
      `).bind(cursorP, cursorP, cursorId, limit).all()
    : await env.DB.prepare(`
        ${baseSql}
        ORDER BY v.published_at DESC, v.id DESC
        LIMIT ?
      `).bind(limit).all();

  const videos = (rows.results || []).map(r => ({
    video_id: r.video_id,
    title: r.title,
    published_at: r.published_at,
    channel_id: r.channel_id,
    channel_title: r.channel_title,
  }));

  let next_cursor = null;
  const last = (rows.results || [])[rows.results.length - 1];
  if (last) {
    const p = (last.published_at ?? 0);
    next_cursor = `${p}:${last.id}`;
  }

  return Response.json(
    { videos, next_cursor },
    { headers: { "cache-control": "public, max-age=60" } }
  );
}
