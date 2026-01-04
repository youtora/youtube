function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

async function listTables(db) {
  const r = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();
  return new Set((r.results || []).map((x) => x.name));
}

async function tableColumns(db, table) {
  // table is from our own whitelist selection (not user input)
  const r = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((r.results || []).map((x) => x.name));
}

function pickFirstExisting(set, candidates) {
  for (const c of candidates) if (set.has(c)) return c;
  return null;
}

function toInt(x, def) {
  const n = Number.parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    const playlist_id =
      (url.searchParams.get("playlist_id") || "").trim() ||
      (url.searchParams.get("id") || "").trim();

    if (!playlist_id) {
      return json({ ok: false, error: "missing playlist_id" }, 400);
    }

    const limit = Math.min(toInt(url.searchParams.get("limit"), 30), 60);
    const offset = toInt(url.searchParams.get("offset"), 0);

    const db = env.DB;
    if (!db) return json({ ok: false, error: "DB not bound" }, 500);

    const tables = await listTables(db);

    const T_PLAYLISTS = pickFirstExisting(tables, ["playlists"]);
    const T_VIDEOS = pickFirstExisting(tables, ["videos"]);
    const T_CHANNELS = pickFirstExisting(tables, ["channels"]);

    const T_MAP = pickFirstExisting(tables, [
      "playlist_videos",
      "video_playlists",
      "playlist_items",
    ]);

    if (!T_PLAYLISTS || !T_VIDEOS || !T_CHANNELS || !T_MAP) {
      return json(
        {
          ok: false,
          error: "missing tables",
          have: Array.from(tables.values()).sort(),
          need: { playlists: T_PLAYLISTS, videos: T_VIDEOS, channels: T_CHANNELS, map: T_MAP },
        },
        500
      );
    }

    const colsPlaylists = await tableColumns(db, T_PLAYLISTS);
    const colsVideos = await tableColumns(db, T_VIDEOS);
    const colsChannels = await tableColumns(db, T_CHANNELS);
    const colsMap = await tableColumns(db, T_MAP);

    // channel pk / join logic
    const channelPk = colsChannels.has("id") ? "id" : (colsChannels.has("channel_int") ? "channel_int" : null);

    // video -> channel fk
    const videoChannelFk =
      colsVideos.has("channel_int") ? "channel_int" :
      colsVideos.has("channel_fk") ? "channel_fk" :
      colsVideos.has("channel_id") ? "channel_id" :
      null;

    // playlist -> channel fk
    const playlistChannelFk =
      colsPlaylists.has("channel_int") ? "channel_int" :
      colsPlaylists.has("channel_fk") ? "channel_fk" :
      colsPlaylists.has("channel_id") ? "channel_id" :
      null;

    // thumbs (store only ID, not full URL)
    const playlistThumbCol = pickFirstExisting(colsPlaylists, [
      "thumb_video_id",
      "thumbnail_video_id",
      "thumb",
      "thumbnail_id",
    ]);

    const channelThumbCol = pickFirstExisting(colsChannels, [
      "thumb_video_id",
      "thumbnail_video_id",
      "thumb",
      "thumbnail_id",
    ]);

    const videoPublishedCol = pickFirstExisting(colsVideos, ["published_at", "published", "published_ts"]);
    const videoTitleCol = colsVideos.has("title") ? "title" : null;

    // map columns
    const mapPlaylistCol = pickFirstExisting(colsMap, ["playlist_id", "playlist"]);
    const mapVideoCol = pickFirstExisting(colsMap, ["video_id", "video"]);
    const mapPosCol = pickFirstExisting(colsMap, ["position", "pos", "item_index"]);

    if (!mapPlaylistCol || !mapVideoCol) {
      return json(
        { ok: false, error: "mapping table missing playlist/video columns", table: T_MAP, cols: Array.from(colsMap) },
        500
      );
    }

    // --- fetch playlist row ---
    // build SELECT safely (only known columns)
    const pSelect = [
      `p.playlist_id AS playlist_id`,
      colsPlaylists.has("title") ? `p.title AS title` : `NULL AS title`,
      playlistThumbCol ? `p.${playlistThumbCol} AS thumb_id` : `NULL AS thumb_id`,
    ];

    // join channel
    let pJoin = "";
    let pChanSelect = [
      `NULL AS channel_id`,
      `NULL AS channel_title`,
      `NULL AS channel_thumb_id`,
    ];

    if (playlistChannelFk && videoChannelFk) {
      // If channels have channel_id text, we want it in output
      const chanIdCol = colsChannels.has("channel_id") ? "channel_id" : null;
      const chanTitleCol = colsChannels.has("title") ? "title" : null;

      // Decide join condition:
      // - if playlistChannelFk is int and channels pk is int -> join by pk
      // - if playlistChannelFk is text and channels have channel_id -> join by channel_id
      if (colsPlaylists.has(playlistChannelFk) && colsChannels.has("channel_id") && playlistChannelFk === "channel_id") {
        pJoin = `LEFT JOIN ${T_CHANNELS} c ON c.channel_id = p.channel_id`;
      } else if (channelPk && colsPlaylists.has(playlistChannelFk) && playlistChannelFk !== "channel_id") {
        pJoin = `LEFT JOIN ${T_CHANNELS} c ON c.${channelPk} = p.${playlistChannelFk}`;
      }

      if (pJoin) {
        pChanSelect = [
          chanIdCol ? `c.${chanIdCol} AS channel_id` : `NULL AS channel_id`,
          chanTitleCol ? `c.${chanTitleCol} AS channel_title` : `NULL AS channel_title`,
          channelThumbCol ? `c.${channelThumbCol} AS channel_thumb_id` : `NULL AS channel_thumb_id`,
        ];
      }
    }

    const pSql = `
      SELECT
        ${pSelect.concat(pChanSelect).join(",\n        ")}
      FROM ${T_PLAYLISTS} p
      ${pJoin}
      WHERE p.playlist_id = ?
      LIMIT 1
    `;

    const pRow = await db.prepare(pSql).bind(playlist_id).first();
    if (!pRow) {
      return json({ ok: true, playlist: null, videos: [], limit, offset, has_more: false });
    }

    // --- fetch videos in playlist (with pagination) ---
    // order: by position if exists else by published desc if exists else rowid desc
    let orderBy = "";
    if (mapPosCol) orderBy = `pv.${mapPosCol} ASC`;
    else if (videoPublishedCol) orderBy = `v.${videoPublishedCol} DESC`;
    else orderBy = `v.rowid DESC`;

    // join videos -> channels for display
    let vJoinChannel = "";
    let vChanSelect = [
      `NULL AS channel_id`,
      `NULL AS channel_title`,
      `NULL AS channel_thumb_id`,
    ];

    const chanIdCol = colsChannels.has("channel_id") ? "channel_id" : null;
    const chanTitleCol = colsChannels.has("title") ? "title" : null;

    if (videoChannelFk && colsVideos.has(videoChannelFk)) {
      if (videoChannelFk === "channel_id" && colsChannels.has("channel_id")) {
        vJoinChannel = `LEFT JOIN ${T_CHANNELS} c ON c.channel_id = v.channel_id`;
      } else if (channelPk) {
        vJoinChannel = `LEFT JOIN ${T_CHANNELS} c ON c.${channelPk} = v.${videoChannelFk}`;
      }

      if (vJoinChannel) {
        vChanSelect = [
          chanIdCol ? `c.${chanIdCol} AS channel_id` : `NULL AS channel_id`,
          chanTitleCol ? `c.${chanTitleCol} AS channel_title` : `NULL AS channel_title`,
          channelThumbCol ? `c.${channelThumbCol} AS channel_thumb_id` : `NULL AS channel_thumb_id`,
        ];
      }
    }

    const vSelect = [
      `v.video_id AS video_id`,
      videoTitleCol ? `v.${videoTitleCol} AS title` : `NULL AS title`,
      videoPublishedCol ? `v.${videoPublishedCol} AS published_at` : `NULL AS published_at`,
      mapPosCol ? `pv.${mapPosCol} AS position` : `NULL AS position`,
      ...vChanSelect,
    ];

    // fetch one extra to know has_more
    const vSql = `
      SELECT
        ${vSelect.join(",\n        ")}
      FROM ${T_MAP} pv
      JOIN ${T_VIDEOS} v ON v.video_id = pv.${mapVideoCol}
      ${vJoinChannel}
      WHERE pv.${mapPlaylistCol} = ?
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const rows = await db
      .prepare(vSql)
      .bind(playlist_id, limit + 1, offset)
      .all();

    const all = rows.results || [];
    const has_more = all.length > limit;
    const videos = has_more ? all.slice(0, limit) : all;

    // if playlist thumb missing, try set from first video in playlist (optional helpful for UI)
    let thumb_id = pRow.thumb_id;
    if (!thumb_id && videos.length) thumb_id = videos[0].video_id;

    return json({
      ok: true,
      playlist: {
        playlist_id: pRow.playlist_id,
        title: pRow.title,
        thumb_id,
        channel_id: pRow.channel_id,
        channel_title: pRow.channel_title,
        channel_thumb_id: pRow.channel_thumb_id,
      },
      videos: videos.map((v) => ({
        video_id: v.video_id,
        title: v.title,
        published_at: v.published_at,
        position: v.position,
        channel_id: v.channel_id,
        channel_title: v.channel_title,
        channel_thumb_id: v.channel_thumb_id,
      })),
      limit,
      offset,
      has_more,
    });
  } catch (err) {
    // This makes the UI show a real reason instead of silent fail
    return json(
      {
        ok: false,
        error: "exception",
        message: String(err?.message || err),
      },
      500
    );
  }
}
