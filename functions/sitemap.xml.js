import { buildSitemapIndex, xmlResponse } from "./_sitemap.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  return xmlResponse(buildSitemapIndex(url.origin));
}
