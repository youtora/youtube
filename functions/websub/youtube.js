// functions/websub/youtube.js

function nowSec(){ return Math.floor(Date.now() / 1000); }

function toUnixSeconds(iso){
  const ms = Date.parse(iso || "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function decodeXml(s){
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchText(s, re){
  const m = s.match(re);
  return m ? decodeXml(m[1].trim()) : null;
}

function extractEntries(xml){
  const out = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  let m;
  while((m = entryRe.exec(xml))){
    const e = m[1];
    const videoId = matchText(e, /<yt:videoId>([^<]+)<\/yt:videoId>/);
    if(!videoId) continue;

    const title = matchText(e, /<title>([^<]+)<\/title>/) || "";
    const published = matchText(e, /<published>([^<]+)<\/published>/);

    out.push({
      videoId,
      title,
      published_at: toUnixSeconds(published || null)
    });
  }
  return out;
}

async function hmacSha1Hex(secret, u8){
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, u8);
  const b = new Uint8Array(sig);
  let hex = "";
  for(let i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, "0");
  return hex;
}

function parseChannelIdFromTopic(topicUrl){
  try{
    const u = new URL(topicUrl);
    return (u.searchParams.get("channel_id") || "").trim() || null;
  }catch(_e){
    return null;
  }
}

export async function onRequest({ env, request }){
  const url = new URL(request.url);

  // =========================
  // אימות GET מה-Hub (subscribe/unsubscribe verification)
  // =========================
  if(request.method === "GET"){
    const mode = (url.searchParams.get("hub.mode") || "").trim();
    const topic = (url.searchParams.get("hub.topic") || "").trim();
    const challenge = (url.searchParams.get("hub.challenge") || "").trim();
    const lease = parseInt(url.searchParams.get("hub.lease_seconds") || "0", 10) || 0;

    if(!env.WEBSUB_VERIFY_TOKEN){
      console.log("websub GET missing WEBSUB_VERIFY_TOKEN");
      return new Response("missing WEBSUB_VERIFY_TOKEN", { status: 500 });
    }

    const verifyToken = (url.searchParams.get("hub.verify_token") || "").trim();
    if(verifyToken !== env.WEBSUB_VERIFY_TOKEN){
      console.log("websub GET bad verify_token", { hasTopic: !!topic, mode });
      return new Response("bad verify_token", { status: 403 });
    }

    if(!challenge){
      return new Response("missing hub.challenge", { status: 400 });
    }

    // ✅ אין יותר stale verification. אם הטוקן נכון – מחזירים challenge וזהו.
    // בנוסף: עושים UPSERT לרשומת subscriptions כדי למנוע race (Hub מגיע לפני INSERT).
    const t = nowSec();
    const expires = lease > 0 ? (t + lease) : null;

    let channel_int = null;
    const channel_id = topic ? parseChannelIdFromTopic(topic) : null;

    if(channel_id){
      const r = await env.DB.prepare(`
        SELECT id FROM channels WHERE channel_id=?
      `).bind(channel_id).first();
      channel_int = r?.id ?? null;
    }

    if(topic){
      await env.DB.prepare(`
        INSERT INTO subscriptions(topic_url, channel_int, status, lease_expires_at, last_subscribed_at, last_error)
        VALUES(?, ?, 'active', ?, ?, NULL)
        ON CONFLICT(topic_url) DO UPDATE SET
          channel_int        = COALESCE(excluded.channel_int, subscriptions.channel_int),
          status             = 'active',
          lease_expires_at   = COALESCE(excluded.lease_expires_at, subscriptions.lease_expires_at),
          last_subscribed_at = excluded.last_subscribed_at,
          last_error         = NULL
      `).bind(topic, channel_int, expires, t).run();
    }

    console.log("websub GET verified", {
      mode,
      hasTopic: !!topic,
      lease,
      channel_id: channel_id ? channel_id.slice(0, 8) + "..." : null
    });

    return new Response(challenge, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  // =========================
  // התראות POST מה-Hub (notify)
  // =========================
  if(request.method === "POST"){
    const bodyBuf = await request.arrayBuffer();
    const bodyU8 = new Uint8Array(bodyBuf);

    const topic = (request.headers.get("x-hub-topic") || "").trim();
    const sigRaw = (request.headers.get("x-hub-signature") || "").trim().toLowerCase();

    console.log("websub POST hit", {
      hasTopic: !!topic,
      hasSig: !!sigRaw,
      len: request.headers.get("content-length") || null
    });

    if(!env.WEBSUB_SECRET){
      console.log("websub POST missing WEBSUB_SECRET");
      return new Response("missing WEBSUB_SECRET", { status: 500 });
    }

    const expected = "sha1=" + (await hmacSha1Hex(env.WEBSUB_SECRET, bodyU8));
    if(sigRaw !== expected){
      console.log("websub POST bad signature", {
        sigPrefix: sigRaw ? sigRaw.slice(0, 12) : null,
        expPrefix: expected.slice(0, 12)
      });
      return new Response("bad signature", { status: 403 });
    }

    const xml = new TextDecoder().decode(bodyU8);
    const entries = extractEntries(xml);

    if(!entries.length){
      console.log("websub POST no entries");
      return new Response(null, { status: 204 });
    }

    // 1) קודם לפי topic_url בטבלת subscriptions
    let channel_int = null;
    if(topic){
      const sub = await env.DB.prepare(`
        SELECT channel_int FROM subscriptions WHERE topic_url=?
      `).bind(topic).first();
      channel_int = sub?.channel_int ?? null;
    }

    // 2) fallback: אם לא נמצא, ננסה מתוך topic -> channel_id -> channels.id
    if(!channel_int && topic){
      const channel_id = parseChannelIdFromTopic(topic);
      if(channel_id){
        const r = await env.DB.prepare(`
          SELECT id FROM channels WHERE channel_id=?
        `).bind(channel_id).first();
        channel_int = r?.id ?? null;
      }
    }

    if(!channel_int){
      console.log("websub POST no channel_int (skipping)", { hasTopic: !!topic });
      return new Response(null, { status: 204 });
    }

    const now = nowSec();
    const stmts = entries.map(e => env.DB.prepare(`
      INSERT INTO videos(video_id, channel_int, title, published_at, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        channel_int   = excluded.channel_int,
        title         = excluded.title,
        published_at  = COALESCE(excluded.published_at, videos.published_at),
        updated_at    = excluded.updated_at
      WHERE
        videos.channel_int IS NOT excluded.channel_int
        OR videos.title IS NOT excluded.title
        OR (excluded.published_at IS NOT NULL AND COALESCE(videos.published_at,0) != COALESCE(excluded.published_at,0))
    `).bind(e.videoId, channel_int, e.title, e.published_at ?? null, now));

    if(stmts.length) await env.DB.batch(stmts);

    console.log("websub POST saved", { entries: entries.length, channel_int });

    return new Response(null, { status: 204 });
  }

  return new Response("method not allowed", { status: 405 });
}
