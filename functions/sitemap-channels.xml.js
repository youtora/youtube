import { allRows, buildUrlSet, toIsoDate, xmlResponse } from "./_sitemap.js";

export async function onRequest(context) {
  const { env, request } = context;
  const origin = new URL(request.url).origin;
  const rows = await allRows(env.DB, `
    SELECT channel_id, updated_at
    FROM channels
    WHERE channel_id IS NOT NULL AND channel_id != ''
    ORDER BY updated_at DESC, id DESC
    LIMIT 50000
  `);

  const entries = rows.map((row) => ({
    loc: `${origin}/${encodeURIComponent(row.channel_id)}/videos`,
    lastmod: toIsoDate(row.updated_at),
  }));

  return xmlResponse(buildUrlSet(entries));
}
