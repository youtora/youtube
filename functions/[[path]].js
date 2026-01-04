export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // רק HTML (לא לגעת ב-assets / api)
  if (request.method !== "GET") return env.ASSETS.fetch(request);
  const accept = request.headers.get("Accept") || "";
  if (!accept.includes("text/html")) return env.ASSETS.fetch(request);

  const path = url.pathname;

  // לא לגעת ב-API ובקבצים סטטיים
  if (path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (path.includes(".")) return env.ASSETS.fetch(request);

  // תמיד נחזיר את ה-SPA (index) כדי שרענון לא ייפול ל-404
  const indexRes = await env.ASSETS.fetch(new Request(new URL("/", url), request)); // :contentReference[oaicite:1]{index=1}

  // בונים OG לפי סוג הדף (וידאו/פלייליסט/ערוץ)
  const meta = await buildOgMeta({ url, env });

  // אם לא זיהינו - תחזיר את ה-SPA רגיל בלי OG דינמי
  if (!meta) return indexRes;

  const rewritten = new HTMLRewriter() // :contentReference[oaicite:2]{index=2}
    .on("head", {
      element(el) {
        el.append(
          `
<meta property="og:type" content="${esc(meta.type)}">
<meta property="og:site_name" content="YouTube">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image" content="${esc(meta.image)}">
<meta property="og:url" content="${esc(meta.url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(meta.image)}">
          `.trim(),
          { html: true }
        );
      },
    })
    .transform(indexRes);

  // אופציונלי: פריוויו מהיר לבוטים (לא חובה)
  const out = new Response(rewritten.body, rewritten);
  out.headers.set("Cache-Control", "public, max-age=300");
  return out;
}

async function buildOgMeta({ url, env }) {
  const p = url.pathname;

  // 1) וידאו אצלך: /<11chars>
  const mVideo = p.match(/^\/([A-Za-z0-9_-]{11})$/);
  if (mVideo) {
    const id = mVideo[1];

    // אם יש לך טבלת videos – אפשר לשדרג פה, אבל נשאיר עובד גם בלי:
    return {
      type: "video.other",
      url: url.toString(),
      title: "צפייה בסרטון",
      description: "צפה בסרטון",
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }

  // 2) פלייליסט אצלך: /PL....
  const mPl = p.match(/^\/(PL[A-Za-z0-9_-]+)$/);
  if (mPl) {
    const playlistId = mPl[1];

    // שליפה מ-D1 לפי מה שהראית בצילום: playlists(playlist_id, title, thumb_video_id)
    const row = await firstRow(env.DB, `
      SELECT title, thumb_video_id
      FROM playlists
      WHERE playlist_id = ?
      LIMIT 1
    `, [playlistId]);

    if (!row) {
      // fallback מינימלי אם לא נמצא
      return {
        type: "website",
        url: url.toString(),
        title: "פלייליסט",
        description: "צפה בפלייליסט",
        image: `${url.origin}/default-og.jpg`,
      };
    }

    const title = row.title || "פלייליסט";
    const thumbVideoId = row.thumb_video_id || "";
    const image = thumbVideoId
      ? `https://i.ytimg.com/vi/${thumbVideoId}/hqdefault.jpg`
      : `${url.origin}/default-og.jpg`;

    return {
      type: "website",
      url: url.toString(),
      title,
      description: "צפה בפלייליסט",
      image,
    };
  }

  // 3) ערוץ אצלך: /UC.../<tab>
  const mCh = p.match(/^\/(UC[A-Za-z0-9_-]{10,})(?:\/([^/]+))?$/);
  if (mCh) {
    const channelId = mCh[1];

    // שליפה מ-D1 לפי מה שהראית: channels(channel_id, title, thumbnail_url)
    const row = await firstRow(env.DB, `
      SELECT title, thumbnail_url
      FROM channels
      WHERE channel_id = ?
      LIMIT 1
    `, [channelId]);

    if (!row) {
      return {
        type: "website",
        url: url.toString(),
        title: "ערוץ",
        description: "צפה בערוץ",
        image: `${url.origin}/default-og.jpg`,
      };
    }

    return {
      type: "website",
      url: url.toString(),
      title: row.title || "ערוץ",
      description: "צפה בערוץ",
      image: row.thumbnail_url || `${url.origin}/default-og.jpg`,
    };
  }

  return null;
}

async function firstRow(DB, sql, params) {
  if (!DB) return null; // אם binding שונה אצלך – תעדכן את השם (בד"כ DB)
  const res = await DB.prepare(sql).bind(...params).all();
  return res?.results?.[0] || null;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
