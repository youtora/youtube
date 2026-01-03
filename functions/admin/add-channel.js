// functions/admin/subscribe-channel.js

function unauthorized() { return new Response("unauthorized", { status: 401 }); }
function nowSec() { return Math.floor(Date.now() / 1000); }

async function subscribeWebSub({ env, request, channel_id, channel_int }) {
  const t = nowSec();
  const origin = new URL(request.url).origin;
  const callback = `${origin}/websub/youtube`;
  const topic = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel_id)}`;
  const hub = "https://pubsubhubbub.appspot.com/subscribe";

  const existing = await env.DB.prepare(`
    SELECT status, lease_expires_at
    FROM subscriptions
    WHERE topic_url=?
  `).bind(topic).first();

  const MIN_REMAINING = 2 * 24 * 3600; // 2 ימים
  if (existing?.status === "active" && Number.isFinite(existing?.lease_expires_at) && existing.lease_expires_at > t + MIN_REMAINING) {
    return { ok: true, skipped: true, reason: "already active", topic, hub_status: null };
  }

  const params = new URLSearchParams();
  params.set("hub.mode", "subscribe");
  params.set("hub.callback", callback);
  params.set("hub.topic", topic);
  params.set("hub.verify", "async");
  if (env.WEBSUB_SECRET) params.set("hub.secret", env.WEBSUB_SECRET);

  const res = await fetch(hub, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const last_error = res.ok ? null : `hub subscribe failed: ${res.status}`;

  await env.DB.prepare(`
    INSERT INTO subscriptions(topic_url, channel_int, status, last_subscribed_at, last_error)
    VALUES(?, ?, 'pending', ?, ?)
    ON CONFLICT(topic_url) DO UPDATE SET
      channel_int = excluded.channel_int,
      status = CASE
        WHEN subscriptions.status='active' THEN 'active'
        ELSE 'pending'
      END,
      last_subscribed_at = excluded.last_subscribed_at,
      last_error = excluded.last_error
  `).bind(topic, channel_int, t, last_error).run();

  return { ok: res.ok, skipped: false, topic, hub_status: res.status, last_error };
}

export async function onRequest({ env, request }) {
  if (request.method !== "POST") return new Response("use POST", { status: 200 });

  const token = request.headers.get("x-admin-token") || "";
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const channel_id = (body.channel_id || "").trim();
  if (!channel_id) return new Response("missing channel_id", { status: 400 });

  const ch = await env.DB.prepare(`SELECT id FROM channels WHERE channel_id=? AND is_active=1`)
    .bind(channel_id).first();
  if (!ch) return new Response("channel not found (add it first)", { status: 404 });

  const sub = await subscribeWebSub({ env, request, channel_id, channel_int: ch.id });
  return Response.json({ ok: true, channel_id, channel_int: ch.id, websub: sub });
}
