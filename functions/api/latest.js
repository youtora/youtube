export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  // ניסוי: נשאיר 200 כדי לצמצם מספר שאילתות
  const limit = 200;

  // cursor format: "<published_at>:<id>"
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
    }
  }

  const rows =
    (cursorP !== null && cursorId !== null)
      ? await env.DB.prepare(`
          SELECT id, video_id, title, published_at
          FROM videos INDEXED BY idx_videos_latest_cover
          WHERE (published_at, id) < (?, ?)
          ORDER BY published_at DESC, id DESC
          LIMIT ?
        `).bind(cursorP, cursorId, limit).all()
      : await env.DB.prepare(`
          SELECT id, video_id, title, published_at
          FROM videos INDEXED BY idx_videos_latest_cover
          ORDER BY published_at DESC, id DESC
          LIMIT ?
        `).bind(limit).all();

  const vrows = rows.results || [];

  const videos = vrows.map(r => ({
    video_id: r.video_id,
    title: r.title,
    published_at: r.published_at,
    channel_id: null,
    channel_title: null,
  }));

  let next_cursor = null;
  const last = vrows[vrows.length - 1];
  if (last) {
    const p = (last.published_at ?? 0);
    next_cursor = `${p}:${last.id}`;
  }

  return Response.json(
    { videos, next_cursor },
    { headers: { "cache-control": "public, max-age=60" } }
  );
}
