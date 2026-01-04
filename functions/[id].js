export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = context.params.id;

  // רק HTML
  if (request.method !== "GET") return env.ASSETS.fetch(request);
  const accept = request.headers.get("Accept") || "";
  if (!accept.includes("text/html")) return env.ASSETS.fetch(request);

  // לא לגעת בקבצים סטטיים
  if (id.includes(".")) return env.ASSETS.fetch(request);

  // רק Video ID (11 תווים)
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    // זה לא וידאו — תחזיר את ה-SPA הרגיל
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  }

  // מביאים כותרת+תמונה דרך oEmbed (בלי API key)
  const oembed =
    "https://www.youtube.com/oembed?format=json&url=" +
    encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);

  let title = "צפייה בסרטון";
  let image = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  let description = "צפה בסרטון";

  try {
    const r = await fetch(oembed, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      title = j.title || title;
      image = j.thumbnail_url || image;
      description = j.author_name ? `ערוץ: ${j.author_name}` : description;
    }
  } catch {}

  // ⚠️ פה התיקון הגדול:
  // במקום next() (שמחזיר 404), מביאים במפורש את index.html מהסטטיים
  const indexRes = await env.ASSETS.fetch(new Request(new URL("/", url), request));

  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(
          `
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="YouTube">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url.toString())}">
<meta name="twitter:card" content="summary_large_image">
          `.trim(),
          { html: true }
        );
      },
    })
    .transform(indexRes);
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
