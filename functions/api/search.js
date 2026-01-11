// functions/api/search.js
// חיפוש בסיסי בכותרות בלבד באמצעות FTS5 (video_fts)

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// מנקה קלט: משאיר אותיות/מספרים/רווחים בלבד (כולל עברית), כדי למנוע תווים מיוחדים של FTS
function cleanQuery(q) {
  const s = (q || "").trim();
  if (!s) return "";

  // מסיר כל תו שאינו אות/מספר/רווח (Unicode)
  // אם בסביבה שלך אין תמיכה ב-\p{L}, אפשר להחליף לרג'קס פשוט יותר.
  return s
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// בונה MATCH בסיסי: כל מילה עטופה בגרשיים -> AND בין מילים
function toFtsMatch(cleaned) {
  if (!cleaned) return "";
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "";

  // עוטפים כל מילה ב-"..." כדי ש-FTS יחפש אותה כמונח ולא יפרש אופרטורים
  return parts.map(p => `"${p}"`).join(" ");
}

export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  const qRaw = url.searchParams.get("q") || "";
  const cleaned = cleanQuery(qRaw);
  const match = toFtsMatch(cleaned);

  const limit = clamp(parseInt(url.searchParams.get("limit") || "20", 10), 1, 50);

  if (!match) {
    return Response.json(
      { q: qRaw, results: [] },
      { headers: { "cache-control": "public, max-age=30" } }
    );
  }

  // כאן כן מותר להשתמש ב-? כי ב-Workers אנחנו עושים bind.
  const rows = await env.DB.prepare(`
    SELECT video_id, title, published_at
    FROM video_fts
    WHERE video_fts MATCH ?
    LIMIT ?
  `).bind(match, limit).all();

  return Response.json(
    {
      q: qRaw,
      match,
      results: rows.results || []
    },
    {
      headers: {
        // אפשר לשנות. 30 שניות נותן קצת חיסכון למילים חוזרות בלי “להדביק” תוצאות זמן רב.
        "cache-control": "public, max-age=30"
      }
    }
  );
}
