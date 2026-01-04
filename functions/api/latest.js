export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "24", 10), 1), 60);

  // cursor format: "<published_or_0>:<row_id>"
  const cursorRaw = (url.searchParams.get("cursor") || "").trim();
  let cursorP = null;
  let cursorId = 0;

  if (cursorRaw) {
    const [pStr, idStr] = cursorRaw.split(":");
    const p = parseInt(pStr || "0", 10);
    const id = parseInt(idStr || "0", 10);
    if (!Number.isNaN(p) && !Number.isNaN(id)) {
      cursorP = p;
      cursorId = id;
    }
  }

  const rows = await env.DB.prepare(`
    SELECT
      v.id,
      v.video_id,
      v.title,
      v.published_at,
      c.channel_id,
      c.title AS channel_title
    FROM videos v
    JOIN channels c ON c.id = v.channel_int
    WHERE (
      ? IS NULL
      OR COALESCE(v.published_at, 0) < ?
      OR (COALESCE(v.published_at, 0) = ? AND v.id < ?)
    )
    ORDER BY COALESCE(v.published_at, 0) DESC, v.id DESC
    LIMIT ?
  `).bind(cursorP, cursorP, cursorP, cursorId, limit).all();

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
