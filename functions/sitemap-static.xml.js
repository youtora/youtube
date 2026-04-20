import { buildUrlSet, xmlResponse } from "./_sitemap.js";

export async function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  const entries = [
    { loc: `${origin}/` },
    { loc: `${origin}/shorts` },
    { loc: `${origin}/live` },
    { loc: `${origin}/channels` },
    { loc: `${origin}/playlists` },
  ];
  return xmlResponse(buildUrlSet(entries));
}
