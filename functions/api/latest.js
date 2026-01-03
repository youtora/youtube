export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "40", 10), 1), 100);

  const rows = await env.DB.prepare(`
    SELECT v.video_id, v.title, v.published_at,
           c.channel_id, c.title AS channel_title
    FROM videos v
    JOIN channels c ON c.id = v.channel_int
    ORDER BY (v.published_at IS NULL), v.published_at DESC, v.id DESC
    LIMIT ?
  `).bind(limit).all();

  return Response.json({ videos: rows.results });
}
