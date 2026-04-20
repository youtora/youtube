function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function xmlResponse(body, maxAge = 900) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

export function buildUrlSet(entries) {
  const items = entries
    .filter((entry) => entry && entry.loc)
    .map((entry) => {
      const parts = [`<loc>${xmlEscape(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${xmlEscape(entry.lastmod)}</lastmod>`);
      return `  <url>${parts.join("")}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

export function buildSitemapIndex(origin) {
  const now = new Date().toISOString();
  const files = [
    "/sitemap-static.xml",
    "/sitemap-videos.xml",
    "/sitemap-channels.xml",
    "/sitemap-playlists.xml",
  ];

  const items = files
    .map((path) => `  <sitemap><loc>${xmlEscape(origin + path)}</loc><lastmod>${xmlEscape(now)}</lastmod></sitemap>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>`;
}

export function toIsoDate(unixSeconds) {
  const n = Number(unixSeconds ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n * 1000).toISOString();
  } catch {
    return "";
  }
}

export async function allRows(DB, sql, params = []) {
  if (!DB) return [];
  try {
    const res = await DB.prepare(sql).bind(...params).all();
    return Array.isArray(res?.results) ? res.results : [];
  } catch {
    return [];
  }
}
