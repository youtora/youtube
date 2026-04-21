import { allRows, buildUrlSet, toIsoDate, xmlResponse } from "../_sitemap.js";

export async function onRequest(context) {
  const { env, request } = context;
  const origin = new URL(request.url).origin;
  const rows = await allRows(env.DB, `
    SELECT playlist_id, COALESCE(updated_at, published_at) AS changed_at
    FROM playlists
    WHERE playlist_id IS NOT NULL AND playlist_id != ''
    ORDER BY COALESCE(updated_at, published_at) DESC, id DESC
    LIMIT 50000
  `);

  const entries = rows.map((row) => ({
    loc: `${origin}/${encodeURIComponent(row.playlist_id)}`,
    lastmod: toIsoDate(row.changed_at),
  }));

  return xmlResponse(buildUrlSet(entries));
}
