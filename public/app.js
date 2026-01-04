const app = document.getElementById("app");
const qInput = document.getElementById("q");
const searchForm = document.getElementById("searchForm");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function isChannelId(x){ return /^UC[\w-]{10,}$/.test(x); }
function isPlaylistId(x){ return /^PL[\w-]{8,}$/.test(x); }
// רוב מזהי וידאו הם 11 תווים, אבל לא ננעל על זה חזק
function looksLikeVideoId(x){ return /^[\w-]{8,}$/.test(x) && !isChannelId(x) && !isPlaylistId(x); }

function videoThumb(id){ return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; }

// אצלך לפעמים שמור thumbnail_id, לפעמים thumbnail_url (ישנים) — נתמודד עם שניהם
function channelAvatar(ch){
  if (ch?.thumbnail_id) return `https://yt3.ggpht.com/${ch.thumbnail_id}=s176-c-k-c0x00ffffff-no-rj`;
  if (ch?.thumbnail_url) return ch.thumbnail_url;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#222"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#bbb" font-family="Arial" font-size="18">UC</text></svg>`)}`;
}

function playlistThumb(p){
  if (p?.thumbnail_id) return `https://i.ytimg.com/vi/${p.thumbnail_id}/mqdefault.jpg`; // אם שמרת "videoId" כתמונה
  if (p?.thumbnail_url) return p.thumbnail_url;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#222"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#bbb" font-family="Arial" font-size="18">Playlist</text></svg>`)}`;
}

function fmtDate(v){
  if (!v) return "";
  // number = seconds/ms
  if (typeof v === "number"){
    const ms = v > 2_000_000_000_000 ? v : (v > 2_000_000_000 ? v*1000 : v);
    const d = new Date(ms);
    if (!isNaN(d)) return d.toLocaleDateString("he-IL");
  }
  // string
  const d = new Date(v);
  if (!isNaN(d)) return d.toLocaleDateString("he-IL");
  return String(v);
}

async function jget(url){
  const r = await fetch(url);
  const t = await r.text();
  let data;
  try { data = JSON.parse(t); } catch { data = t; }
  if (!r.ok) throw new Error((data && data.error) ? data.error : `HTTP ${r.status}`);
  return data;
}

function navTo(path){
  history.pushState({}, "", path);
  route();
}

document.addEventListener("click", (e)=>{
  const a = e.target.closest("a[data-link]");
  if (!a) return;
  e.preventDefault();
  navTo(a.getAttribute("href"));
});

window.addEventListener("popstate", route);

searchForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  const q = qInput.value.trim();
  navTo(`/search?q=${encodeURIComponent(q)}`);
});

function setTitle(t){ document.title = t ? `${t} • YouTube Catalog` : "YouTube Catalog"; }

function skelList(n=6){
  const items = Array.from({length:n}).map(()=>`
    <div class="item">
      <div class="item__media">
        <div class="thumb skel"></div>
      </div>
      <div class="item__body">
        <div class="skel" style="height:16px; width:80%; margin-bottom:10px;"></div>
        <div class="skel" style="height:12px; width:55%;"></div>
      </div>
    </div>
  `).join("");
  return `<div class="stack">${items}</div>`;
}

function renderError(msg){
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">שגיאה</div>
      <div class="muted">${esc(msg)}</div>
    </div>
  `;
}

function renderNotFound(){
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">לא נמצא</div>
      <div class="muted">העמוד שביקשת לא קיים.</div>
    </div>
  `;
}

async function pageHome(){
  setTitle("בית");
  app.innerHTML = `
    <div class="stack">
      <div class="card" style="padding:16px">
        <div class="h1">סרטונים אחרונים</div>
        <div class="muted">פיד אחרון מה־DB (מהיר, בלי להכביד).</div>
      </div>
      <div class="card" style="padding:16px">
        ${skelList(8)}
      </div>
    </div>
  `;

  // אם יש לך endpoint כזה – מעולה. אם לא, ניפול ל־search ריק/לא קיים.
  let data = null;
  try {
    data = await jget(`/api/latest?limit=60`);
  } catch {
    // fallback: אם אין latest – נציג הסבר קצר במקום “לשבור” את האתר
    app.innerHTML = `
      <div class="card" style="padding:16px">
        <div class="h1">עמוד בית</div>
        <div class="muted">
          כדי להציג “אחרונים”, צריך endpoint קטן: <b>/api/latest</b> שמחזיר 60 סרטונים אחרונים מה־DB.
          <br/>ברגע שתוסיף אותו – העמוד הזה יתמלא אוטומטית.
        </div>
      </div>
    `;
    return;
  }

  const videos = data?.videos ?? data ?? [];
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">סרטונים אחרונים</div>
      <div class="grid">
        ${videos.map(v => `
          <a class="card" data-link href="/${esc(v.video_id)}" style="padding:12px; display:block">
            <div class="thumb">
              <img loading="lazy" src="${videoThumb(esc(v.video_id))}" alt="">
            </div>
            <div style="padding-top:10px">
              <div class="item__title">${esc(v.title)}</div>
              <div class="item__meta">
                <span>${esc(v.channel_title ?? "")}</span>
                <span>${fmtDate(v.published_at)}</span>
              </div>
            </div>
          </a>
        `).join("")}
      </div>
    </div>
  `;
}

async function pageChannels(){
  setTitle("ערוצים");
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">ערוצים</div>
      <div class="muted">רשימת כל הערוצים בקטלוג.</div>
      <div class="hr"></div>
      ${skelList(6)}
    </div>
  `;
  const data = await jget("/api/channels");
  const channels = data?.channels ?? data ?? [];
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">ערוצים</div>
      <div class="stack">
        ${channels.map(ch => `
          <a class="item" data-link href="/${esc(ch.channel_id)}">
            <div class="avatar">
              <img loading="lazy" src="${channelAvatar(ch)}" alt="">
            </div>
            <div class="item__body">
              <div class="item__title">${esc(ch.title ?? "(ללא כותרת)")}</div>
              <div class="item__meta"><span>${esc(ch.channel_id)}</span></div>
            </div>
          </a>
        `).join("")}
      </div>
    </div>
  `;
}

async function pagePlaylists(){
  setTitle("פלייליסטים");
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">פלייליסטים</div>
      <div class="muted">רשימת כל הפלייליסטים בקטלוג.</div>
      <div class="hr"></div>
      ${skelList(6)}
    </div>
  `;

  // אם יש לך endpoint כזה – מצוין.
  let data = null;
  try {
    data = await jget("/api/playlists");
  } catch {
    app.innerHTML = `
      <div class="card" style="padding:16px">
        <div class="h1">פלייליסטים</div>
        <div class="muted">
          כדי להציג רשימת פלייליסטים, צריך endpoint: <b>/api/playlists</b>.
          <br/>אם כבר יש לך אותו – תבדוק שהוא מחזיר JSON עם playlists.
        </div>
      </div>
    `;
    return;
  }

  const playlists = data?.playlists ?? data ?? [];
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">פלייליסטים</div>
      <div class="grid">
        ${playlists.map(p => `
          <a class="card" data-link href="/${esc(p.playlist_id)}" style="padding:12px; display:block">
            <div class="thumb">
              <img loading="lazy" src="${playlistThumb(p)}" alt="">
            </div>
            <div style="padding-top:10px">
              <div class="item__title">${esc(p.title ?? "(ללא כותרת)")}</div>
              <div class="item__meta">
                <span>${esc(p.channel_title ?? "")}</span>
              </div>
            </div>
          </a>
        `).join("")}
      </div>
    </div>
  `;
}

async function pageSearch(params){
  const q = (params.get("q") ?? "").trim();
  setTitle(q ? `חיפוש: ${q}` : "חיפוש");
  qInput.value = q;

  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">תוצאות חיפוש</div>
      <div class="muted">${q ? `עבור: “${esc(q)}”` : "הקלד מילים לחיפוש."}</div>
      <div class="hr"></div>
      ${q ? skelList(8) : ""}
    </div>
  `;

  if (!q) return;

  const data = await jget(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
  const videos = data?.videos ?? data?.results ?? data ?? [];

  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">תוצאות חיפוש</div>
      <div class="muted">נמצאו ${videos.length} תוצאות</div>
      <div class="hr"></div>
      <div class="stack">
        ${videos.map(v => `
          <a class="item" data-link href="/${esc(v.video_id)}">
            <div class="item__media">
              <div class="thumb">
                <img loading="lazy" src="${videoThumb(esc(v.video_id))}" alt="">
              </div>
            </div>
            <div class="item__body">
              <div class="item__title">${esc(v.title)}</div>
              <div class="item__meta">
                <span>${esc(v.channel_title ?? "")}</span>
                <span>${fmtDate(v.published_at)}</span>
              </div>
            </div>
          </a>
        `).join("")}
      </div>
    </div>
  `;
}

async function pageChannel(channelId, params){
  const tab = (params.get("tab") || "videos"); // videos | playlists
  setTitle("ערוץ");
  app.innerHTML = `
    <div class="card" style="padding:16px">
      ${skelList(6)}
    </div>
  `;

  const data = await jget(`/api/channel?channel_id=${encodeURIComponent(channelId)}&limit=60`);
  const ch = data?.channel ?? data?.ch ?? data;
  const videos = data?.videos ?? [];
  const playlists = data?.playlists ?? [];

  setTitle(ch?.title ?? "ערוץ");

  app.innerHTML = `
    <div class="card">
      <div class="channelHeader">
        <div class="avatar"><img loading="lazy" src="${channelAvatar(ch)}" alt=""></div>
        <div class="stack" style="gap:4px; min-width:0">
          <div class="h1" style="margin:0">${esc(ch?.title ?? "(ללא כותרת)")}</div>
          <div class="muted" style="font-size:13px">${esc(channelId)}</div>
        </div>
      </div>

      <div class="tabs">
        <button class="tab ${tab==="videos"?"tab--on":""}" data-tab="videos">סרטונים</button>
        <button class="tab ${tab==="playlists"?"tab--on":""}" data-tab="playlists">פלייליסטים</button>
      </div>
    </div>

    <div style="height:14px"></div>

    ${tab==="videos" ? `
      <div class="card" style="padding:16px">
        <div class="h2">סרטונים</div>
        <div class="stack">
          ${videos.map(v => `
            <a class="item" data-link href="/${esc(v.video_id)}">
              <div class="item__media">
                <div class="thumb">
                  <img loading="lazy" src="${videoThumb(esc(v.video_id))}" alt="">
                </div>
              </div>
              <div class="item__body">
                <div class="item__title">${esc(v.title)}</div>
                <div class="item__meta">
                  <span>${fmtDate(v.published_at)}</span>
                </div>
              </div>
            </a>
          `).join("")}
        </div>
      </div>
    ` : `
      <div class="card" style="padding:16px">
        <div class="h2">פלייליסטים</div>
        ${playlists.length ? `
          <div class="grid">
            ${playlists.map(p => `
              <a class="card" data-link href="/${esc(p.playlist_id)}" style="padding:12px; display:block">
                <div class="thumb">
                  <img loading="lazy" src="${playlistThumb(p)}" alt="">
                </div>
                <div style="padding-top:10px">
                  <div class="item__title">${esc(p.title ?? "(ללא כותרת)")}</div>
                </div>
              </a>
            `).join("")}
          </div>
        ` : `<div class="muted">אין פלייליסטים שמורים לערוץ זה.</div>`}
      </div>
    `}
  `;

  // tabs wiring
  app.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const t = btn.getAttribute("data-tab");
      navTo(`/${encodeURIComponent(channelId)}?tab=${encodeURIComponent(t)}`);
    });
  });
}

async function pageVideo(videoId){
  setTitle("סרטון");
  app.innerHTML = `
    <div class="card" style="padding:16px">${skelList(6)}</div>
  `;

  // ננסה להביא את הוידאו דרך search לפי ה־ID (מינימום תלות ב־endpoint חדש)
  const s = await jget(`/api/search?q=${encodeURIComponent(videoId)}&limit=5`);
  const candidates = s?.videos ?? s?.results ?? s ?? [];
  const v = candidates.find(x => x.video_id === videoId) || candidates[0];

  if (!v) {
    renderNotFound();
    return;
  }

  // הצעות: נביא עוד סרטונים מהערוץ
  let channelData = null;
  try {
    channelData = await jget(`/api/channel?channel_id=${encodeURIComponent(v.channel_id)}&limit=40`);
  } catch {
    channelData = { videos: [] };
  }
  const suggested = (channelData?.videos ?? []).filter(x => x.video_id !== videoId).slice(0, 18);

  app.innerHTML = `
    <div class="watch">
      <section class="watchMain">
        <div class="player card">
          <iframe
            src="https://www.youtube-nocookie.com/embed/${esc(videoId)}"
            title="${esc(v.title)}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>

        <div style="height:12px"></div>

        <div class="card" style="padding:16px">
          <div class="h1" style="margin:0 0 8px">${esc(v.title)}</div>
          <div class="item__meta" style="margin-bottom:10px">
            <span>${fmtDate(v.published_at)}</span>
          </div>

          <div class="row" style="justify-content:space-between; flex-wrap:wrap">
            <a class="row" data-link href="/${esc(v.channel_id)}" style="gap:10px">
              <div class="avatar" style="width:40px; height:40px; flex:0 0 40px">
                <img loading="lazy" src="${channelAvatar(channelData?.channel ?? {})}" alt="">
              </div>
              <div class="stack" style="gap:2px">
                <div style="font-weight:700">${esc(v.channel_title ?? "ערוץ")}</div>
                <div class="muted" style="font-size:12px">${esc(v.channel_id)}</div>
              </div>
            </a>

            <a class="btn" href="https://www.youtube.com/watch?v=${esc(videoId)}" target="_blank" rel="noreferrer">פתח ביוטיוב</a>
          </div>
        </div>
      </section>

      <aside class="watchSide">
        <div class="card" style="padding:16px">
          <div class="h2">מוצעים</div>
          <div class="stack">
            ${suggested.map(x => `
              <a class="item" data-link href="/${esc(x.video_id)}" style="padding:10px">
                <div class="item__media" style="width:160px; flex:0 0 160px">
                  <div class="thumb">
                    <img loading="lazy" src="${videoThumb(esc(x.video_id))}" alt="">
                  </div>
                </div>
                <div class="item__body">
                  <div class="item__title">${esc(x.title)}</div>
                  <div class="item__meta">
                    <span>${fmtDate(x.published_at)}</span>
                  </div>
                </div>
              </a>
            `).join("") || `<div class="muted">אין הצעות כרגע.</div>`}
          </div>
        </div>
      </aside>
    </div>
  `;
}

async function pagePlaylist(playlistId){
  setTitle("פלייליסט");
  app.innerHTML = `
    <div class="card" style="padding:16px">
      <div class="h1">פלייליסט</div>
      <div class="muted">כדי שעמוד פלייליסט יעבוד “כמו יוטיוב”, צריך endpoint שמחזיר פרטים + סרטונים של הפלייליסט.</div>
      <div class="hr"></div>
      <div class="muted">מזהה: ${esc(playlistId)}</div>
    </div>
  `;
}

async function route(){
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const params = url.searchParams;

  try {
    if (path === "/") return await pageHome();
    if (path === "/channels") return await pageChannels();
    if (path === "/playlists") return await pagePlaylists();
    if (path === "/search") return await pageSearch(params);

    // מזהה דינמי: /UC... או /PL... או /videoId
    const id = path.slice(1);
    if (!id) return renderNotFound();

    if (isChannelId(id)) return await pageChannel(id, params);
    if (isPlaylistId(id)) return await pagePlaylist(id);
    if (looksLikeVideoId(id)) return await pageVideo(id);

    return renderNotFound();
  } catch (e) {
    renderError(e?.message ?? String(e));
  }
}

route();
