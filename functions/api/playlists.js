export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "60", 10), 1), 200);

  const rows = await env.DB.prepare(`
    SELECT p.playlist_id, p.title, p.thumb_video_id, p.published_at, p.item_count,
           c.channel_id, c.title AS channel_title
    FROM playlists p
    JOIN channels c ON c.id = p.channel_int
    ORDER BY p.id DESC
    LIMIT ?
  `).bind(limit).all();

  return Response.json({ playlists: rows.results });
}
