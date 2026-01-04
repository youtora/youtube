export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // רק GET של HTML (כדי לא להפריע ל-API/assets)
  if (request.method !== "GET") return next();
  const accept = request.headers.get("Accept") || "";
  if (!accept.includes("text/html")) return next();

  const path = url.pathname.replace(/^\/+/, ""); // בלי "/"
  if (!path) return next();

  // אל תיגע בנתיבים של API/קבצים סטטיים
  if (path.startsWith("api/")) return next();
  if (path.includes(".")) return next(); // למשל /assets/app.js, /favicon.ico וכו'

  // אצלך וידאו הוא נתיב של סגמנט אחד: /<videoId>
  // YouTube Video ID הוא בד"כ 11 תווים: A-Z a-z 0-9 _ -
  const isVideoId = /^[A-Za-z0-9_-]{11}$/.test(path);
  if (!isVideoId) return next();

  const videoId = path;

  // בלי API Key: מביאים title+thumbnail דרך oEmbed של YouTube
  // (עובד מצוין לפריוויו)
  const oembedUrl =
    `https://www.youtube.com/oembed?format=json&url=` +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);

  let title = "צפייה בסרטון";
  let image = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let description = "צפה בסרטון";
  let author = "";

  try {
    const r = await fetch(oembedUrl, { headers: { "Accept": "application/json" } });
    if (r.ok) {
      const j = await r.json();
      title = j.title || title;
      author = j.author_name || "";
      image = j.thumbnail_url || image;
      description = author ? `ערוץ: ${author}` : description;
    }
  } catch (_) {
    // לא מפילים את העמוד אם oEmbed נכשל
  }

  const pageUrl = url.toString();

  // טען את ה-index.html הרגיל (ה-SPA)
  const response = await next();

  // הזרקת OG לתוך <head>
  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(
          `
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="YouTube (clone)">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
          `.trim(),
          { html: true }
        );
      },
    })
    .transform(response);
}

// מינימום escape כדי לא לשבור HTML אם יש מרכאות וכו'
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
