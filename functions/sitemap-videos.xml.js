import { allRows, buildUrlSet, toIsoDate, xmlResponse } from "./_sitemap.js";

export async function onRequest(context) {
  const { env, request } = context;
  const origin = new URL(request.url).origin;
  const rows = await allRows(env.DB, `
    SELECT video_id, COALESCE(updated_at, published_at) AS changed_at
    FROM videos
    WHERE video_id IS NOT NULL AND video_id != ''
    ORDER BY COALESCE(updated_at, published_at) DESC, id DESC
    LIMIT 50000
  `);

  const entries = rows.map((row) => ({
    loc: `${origin}/${encodeURIComponent(row.video_id)}`,
    lastmod: toIsoDate(row.changed_at),
  }));

  return xmlResponse(buildUrlSet(entries));
}
