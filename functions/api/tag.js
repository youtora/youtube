function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeTagName(value) {
  return String(value || "").trim().replace(/^#+/, "").trim();
}

function normalizeTagType(value) {
  return value === "hashtag" ? "hashtag" : "tag";
}

function buildTagSql(column, hasCursor) {
  return `
    SELECT
      v.id,
      v.video_id,
      v.title,
      v.published_at,
      v.video_kind,
      v.duration_sec,
      v.view_count,
      v.like_count,
      v.comment_count,
      c.channel_id,
      c.title AS channel_title,
      c.thumbnail_url AS channel_thumbnail_url
    FROM video_details AS d
    JOIN videos AS v
      ON v.video_id = d.video_id
    JOIN channels AS c
      ON c.id = v.channel_int
    WHERE EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(d.${column}) THEN d.${column} ELSE '[]' END) AS je
      WHERE LOWER(TRIM(CAST(je.value AS TEXT), '# ')) = LOWER(?)
    )
    ${hasCursor ? "AND v.id < ?" : ""}
    ORDER BY v.id DESC
    LIMIT ?
  `;
}

export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  const value = normalizeTagName(url.searchParams.get("value") || url.searchParams.get("tag") || "");
  const type = normalizeTagType((url.searchParams.get("type") || "tag").trim().toLowerCase());
  const limit = clamp(parseInt(url.searchParams.get("limit") || "50", 10), 1, 100);

  const cursorRaw = (url.searchParams.get("cursor") || "").trim();
  const cursor = cursorRaw ? parseInt(cursorRaw, 10) : null;

  if (!value) {
    return Response.json(
      { results: [], next_cursor: null, value, type },
      { headers: { "cache-control": "public, max-age=30" } }
    );
  }

  const column = type === "hashtag" ? "hashtags_json" : "tags_json";
  const hasCursor = Number.isFinite(cursor) && cursor > 0;
  const sql = buildTagSql(column, hasCursor);

  const res = hasCursor
    ? await env.DB.prepare(sql).bind(value, cursor, limit).all()
    : await env.DB.prepare(sql).bind(value, limit).all();

  const rows = res.results || [];
  const results = rows.map(v => ({
    video_id: v.video_id,
    title: v.title,
    published_at: v.published_at,
    video_kind: v.video_kind || "",
    duration_sec: v.duration_sec ?? null,
    view_count: v.view_count ?? null,
    like_count: v.like_count ?? null,
    comment_count: v.comment_count ?? null,
    channel_id: v.channel_id || null,
    channel_title: v.channel_title || null,
    channel_thumbnail_url: v.channel_thumbnail_url || null,
    cursor: String(v.id)
  }));

  const last = rows[rows.length - 1];
  const next_cursor = last ? String(last.id) : null;

  return Response.json(
    { results, next_cursor, value, type },
    { headers: { "cache-control": "public, max-age=30" } }
  );
}
