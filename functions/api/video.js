function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const video_id = (url.searchParams.get("video_id") || "").trim();
  if (!video_id) return new Response("missing video_id", { status: 400 });

  const recLimit = clamp(parseInt(url.searchParams.get("recommended_limit") || "20", 10), 1, 60);

  // 1) מביאים את הסרטון פעם אחת (כולל channel_int)
  const vrow = await env.DB.prepare(`
    SELECT id, video_id, title, published_at, channel_int
    FROM videos
    WHERE video_id = ?
    LIMIT 1
  `).bind(video_id).first();

  if (!vrow) return new Response("not found", { status: 404 });

  // 2) מביאים פרטי ערוץ פעם אחת (שורה אחת)
  const crow = await env.DB.prepare(`
    SELECT channel_id, title AS channel_title, thumbnail_url
    FROM channels
    WHERE id = ?
    LIMIT 1
  `).bind(vrow.channel_int).first();

  const video = {
    video_id: vrow.video_id,
    title: vrow.title,
    published_at: vrow.published_at,
    channel_id: crow?.channel_id || null,
    channel_title: crow?.channel_title || null,
    thumbnail_url: crow?.thumbnail_url || null,
  };

  // 3) “מוצעים” מאותו ערוץ — דפדוף על האינדקס של הערוץ (בלי subquery, בלי NULL-order)
  const rec = await env.DB.prepare(`
    SELECT video_id, title, published_at
    FROM videos INDEXED BY idx_videos_channel_cover
    WHERE channel_int = ?
      AND video_id <> ?
    ORDER BY published_at DESC, id DESC
    LIMIT ?
  `).bind(vrow.channel_int, video_id, recLimit).all();

  return Response.json(
    {
      video,
      recommended: rec.results || []
    },
    {
      headers: {
        "cache-control": "public, max-age=300"
      }
    }
  );
}
