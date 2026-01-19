export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const assetUrl = new URL("/k9p1.html", url);
  return env.ASSETS.fetch(new Request(assetUrl, request));
}
