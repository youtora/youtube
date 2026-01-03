const $ = (id) => document.getElementById(id);

const state = {
  channels: [],
  channelById: new Map(),
};

function esc(s){return (s||"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]))}
function fmtDate(unix){
  if(!unix) return "";
  try { return new Date(unix*1000).toLocaleDateString('he-IL', { year:'numeric', month:'2-digit', day:'2-digit' }); }
  catch { return ""; }
}
function ytVideoThumb(videoId, q="mqdefault"){ return videoId ? `https://i.ytimg.com/vi/${videoId}/${q}.jpg` : ""; }

async function api(url){
  const r = await fetch(url);
  const t = await r.text();
  if(!r.ok) throw new Error(`${r.status} ${t.slice(0,160)}`);
  return JSON.parse(t);
}

function setPage(html){
  $("page").innerHTML = `<div class="pagePad">${html}</div>`;
}

function linkify(){
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if(!a) return;
    const href = a.getAttribute("href") || "";
    const target = a.getAttribute("target");
    if(target === "_blank") return;
    if(a.hasAttribute("data-external")) return;
    if(!href.startsWith("/")) return;
    e.preventDefault();
    navigate(href);
  });
}

function navigate(path){
  history.pushState({}, "", path);
  render();
}

window.addEventListener("popstate", render);

function route(){
  const p = location.pathname.replace(/\/+$/,"") || "/";
  const parts = p.split("/").filter(Boolean);
  return { p, parts, qs: new URLSearchParams(location.search) };
}

function renderSidebar(){
  const box = $("channelsList");
  if(!state.channels.length){
    box.innerHTML = `<div class="muted pad">אין ערוצים עדיין.</div>`;
    return;
  }
  box.innerHTML = state.channels.map(ch => `
    <a class="item" href="/channel/${encodeURIComponent(ch.channel_id)}" data-link>
      ${ch.thumbnail_url ? `<img class="avatar" loading="lazy" decoding="async" src="${esc(ch.thumbnail_url)}" onerror="this.style.display='none'">`
                         : `<div class="avatar"></div>`}
      <div style="min-width:0">
        <div class="t">${esc(ch.title || ch.channel_id)}</div>
        <div class="s">${esc(ch.channel_id)}</div>
      </div>
    </a>
  `).join("");
}

function attachHeaderHandlers(){
  $("refreshBtn").onclick = () => boot();
  $("searchForm").onsubmit = (e) => {
    e.preventDefault();
    const q = ($("searchInput").value || "").trim();
    if(!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };
}

async function boot(){
  $("channelsList").innerHTML = `<div class="muted pad">טוען…</div>`;
  const data = await api("/api/channels");
  state.channels = data.channels || [];
  state.channelById = new Map(state.channels.map(c => [c.channel_id, c]));
  renderSidebar();
  render();
}

async function render(){
  const { parts, qs } = route();

  // Home
  if(parts.length === 0){
    const count = state.channels.length;
    setPage(`
      <div class="h1">דפדוף ערוצים</div>
      <p class="sub">יש כאן ${count} ערוצים. בחר ערוץ מהסיידבר או חפש למעלה.</p>
      <div class="hr"></div>

      <div class="grid3">
        ${state.channels.slice(0, 60).map(ch => `
          <a class="card" href="/channel/${encodeURIComponent(ch.channel_id)}" data-link>
            <div class="cardBody" style="display:flex;gap:12px;align-items:center">
              ${ch.thumbnail_url ? `<img class="avatar" style="width:54px;height:54px;border-radius:16px" loading="lazy" decoding="async" src="${esc(ch.thumbnail_url)}" onerror="this.style.display='none'">`
                                 : `<div class="avatar" style="width:54px;height:54px;border-radius:16px"></div>`}
              <div style="min-width:0">
                <div class="cardTitle" style="margin:0">${esc(ch.title || ch.channel_id)}</div>
                <div class="cardMeta">${esc(ch.channel_id)}</div>
              </div>
            </div>
          </a>
        `).join("")}
      </div>

      ${count > 60 ? `<div class="muted" style="margin-top:10px">מוצגים 60 ראשונים.</div>` : ``}
    `);
    return;
  }

  // Channel
  if(parts[0] === "channel" && parts[1]){
    const channel_id = decodeURIComponent(parts[1]);
    const subpath = parts[2] || ""; // "videos" / "playlists"
    const tab = (subpath === "playlists") ? "playlists" : "videos";
    await renderChannel(channel_id, tab);
    return;
  }

  // Video
  if(parts[0] === "video" && parts[1]){
    const video_id = decodeURIComponent(parts[1]);
    await renderVideo(video_id);
    return;
  }

  // Playlist
  if(parts[0] === "playlist" && parts[1]){
    const playlist_id = decodeURIComponent(parts[1]);
    await renderPlaylist(playlist_id);
    return;
  }

  // Search
  if(parts[0] === "search"){
    const q = (qs.get("q") || "").trim();
    const channel_id = (qs.get("channel_id") || "").trim();
    await renderSearch(q, channel_id);
    return;
  }

  setPage(`
    <div class="h1">לא נמצא</div>
    <p class="sub">העמוד לא קיים. <a href="/" data-link>חזור לבית</a></p>
  `);
}

async function renderChannel(channel_id, tab){
  setPage(`<div class="muted">טוען ערוץ…</div>`);
  const data = await api(`/api/channel?channel_id=${encodeURIComponent(channel_id)}`);
  const ch = data.channel;
  const playlists = data.playlists || [];
  const videos = data.videos || [];
  const backfill = data.backfill || null;

  const pills = [];
  if(backfill){
    pills.push(`<span class="pill">ייבוא: ${backfill.done ? "הושלם" : "רץ"}</span>`);
    pills.push(`<span class="pill">נספר: ${backfill.imported_count ?? 0}</span>`);
  }

  const header = `
    <div style="display:flex;gap:12px;align-items:center">
      ${ch.thumbnail_url ? `<img class="avatar" style="width:64px;height:64px;border-radius:18px" loading="lazy" decoding="async" src="${esc(ch.thumbnail_url)}" onerror="this.style.display='none'">`
                         : `<div class="avatar" style="width:64px;height:64px;border-radius:18px"></div>`}
      <div style="min-width:0">
        <div class="h1" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ch.title || ch.channel_id)}</div>
        <div class="sub" style="margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ch.channel_id)}</div>
      </div>
    </div>
    <div style="margin-top:10px" class="pills">
      ${pills.join("")}
      <a class="btnLink" target="_blank" rel="noreferrer" href="https://www.youtube.com/channel/${encodeURIComponent(ch.channel_id)}">פתח ביוטיוב</a>
    </div>
  `;

  const tabs = `
    <div class="tabs">
      <a class="tab ${tab==="videos"?"active":""}" href="/channel/${encodeURIComponent(channel_id)}/videos" data-link>סרטונים</a>
      <a class="tab ${tab==="playlists"?"active":""}" href="/channel/${encodeURIComponent(channel_id)}/playlists" data-link>פלייליסטים</a>
    </div>
  `;

  let body = "";
  if(tab === "videos"){
    body = `
      <div class="hr"></div>
      <div class="grid3">
        ${videos.map(v => `
          <a class="card" href="/video/${encodeURIComponent(v.video_id)}" data-link>
            <img class="thumb16x9" loading="lazy" decoding="async" src="${esc(ytVideoThumb(v.video_id))}">
            <div class="cardBody">
              <div class="cardTitle">${esc(v.title || v.video_id)}</div>
              <div class="cardMeta">
                ${fmtDate(v.published_at) ? `<span>${esc(fmtDate(v.published_at))}</span>` : ``}
                <span>${esc(v.video_id)}</span>
              </div>
            </div>
          </a>
        `).join("")}
      </div>
      ${videos.length === 0 ? `<div class="muted">אין עדיין סרטונים במסד לערוץ הזה.</div>` : ``}
    `;
  } else {
    body = `
      <div class="hr"></div>
      <div class="grid3">
        ${playlists.map(p => `
          <a class="card" href="/playlist/${encodeURIComponent(p.playlist_id)}" data-link>
            <img class="thumb16x9" loading="lazy" decoding="async"
                 src="${esc(p.thumb_video_id ? ytVideoThumb(p.thumb_video_id) : "")}"
                 onerror="this.style.display='none'">
            <div class="cardBody">
              <div class="cardTitle">${esc(p.title || p.playlist_id)}</div>
              <div class="cardMeta">
                ${p.item_count!=null ? `<span>${p.item_count} סרטונים</span>` : ``}
                ${fmtDate(p.published_at) ? `<span>${esc(fmtDate(p.published_at))}</span>` : ``}
                <span>${esc(p.playlist_id)}</span>
              </div>
            </div>
          </a>
        `).join("")}
      </div>
      ${playlists.length === 0 ? `<div class="muted">אין פלייליסטים (או עדיין לא נטענו).</div>` : ``}
    `;
  }

  setPage(header + tabs + body);
}

async function renderVideo(video_id){
  setPage(`<div class="muted">טוען סרטון…</div>`);
  const data = await api(`/api/video?video_id=${encodeURIComponent(video_id)}`);
  const v = data.video;
  const rec = data.recommended || [];

  const chThumb = v.thumbnail_url || state.channelById.get(v.channel_id)?.thumbnail_url || "";
  const chTitle = v.channel_title || v.channel_id;

  const player = `
    <iframe class="player"
      src="https://www.youtube.com/embed/${encodeURIComponent(v.video_id)}?rel=0"
      title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen>
    </iframe>
  `;

  const channelLine = `
    <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
      ${chThumb ? `<img class="avatar" loading="lazy" decoding="async" src="${esc(chThumb)}" onerror="this.style.display='none'">` : `<div class="avatar"></div>`}
      <div style="min-width:0">
        <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          <a href="/channel/${encodeURIComponent(v.channel_id)}/videos" data-link>${esc(chTitle)}</a>
        </div>
        <div class="muted" style="font-size:12px">${esc(v.channel_id)}</div>
      </div>
      <div style="margin-inline-start:auto">
        <a class="btnLink" target="_blank" rel="noreferrer" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}">פתח ביוטיוב</a>
      </div>
    </div>
  `;

  const left = `
    <div>
      ${player}
      <div class="h1" style="margin-top:10px">${esc(v.title || v.video_id)}</div>
      <div class="sub">${fmtDate(v.published_at) ? `פורסם: ${esc(fmtDate(v.published_at))}` : ``}</div>
      ${channelLine}
    </div>
  `;

  const right = `
    <div class="rightCol">
      <div style="font-weight:900;margin-bottom:8px">סרטונים מוצעים</div>
      ${rec.length ? rec.map(r => `
        <a class="reco" href="/video/${encodeURIComponent(r.video_id)}" data-link>
          <img class="recoThumb" loading="lazy" decoding="async" src="${esc(ytVideoThumb(r.video_id))}">
          <div style="min-width:0">
            <div class="recoTitle" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.title || r.video_id)}</div>
            <div class="recoMeta">${fmtDate(r.published_at) ? esc(fmtDate(r.published_at)) : ""}</div>
          </div>
        </a>
      `).join("") : `<div class="muted">אין כרגע המלצות מהמסד לערוץ הזה.</div>`}
    </div>
  `;

  setPage(`<div class="vrow">${left}${right}</div>`);
}

async function renderPlaylist(playlist_id){
  setPage(`<div class="muted">טוען פלייליסט…</div>`);
  const data = await api(`/api/playlist?playlist_id=${encodeURIComponent(playlist_id)}`);
  const p = data.playlist;

  const chThumb = p.thumbnail_url || state.channelById.get(p.channel_id)?.thumbnail_url || "";
  const chTitle = p.channel_title || p.channel_id;

  const player = `
    <iframe class="player"
      src="https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.playlist_id)}&rel=0"
      title="YouTube playlist player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen>
    </iframe>
  `;

  setPage(`
    <div style="display:flex;gap:12px;align-items:center">
      ${p.thumb_video_id ? `<img class="avatar" style="width:64px;height:64px;border-radius:18px" loading="lazy" decoding="async" src="${esc(ytVideoThumb(p.thumb_video_id, "mqdefault"))}" onerror="this.style.display='none'">`
                        : `<div class="avatar" style="width:64px;height:64px;border-radius:18px"></div>`}
      <div style="min-width:0">
        <div class="h1" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title || p.playlist_id)}</div>
        <div class="sub" style="margin:4px 0 0">${esc(p.playlist_id)}</div>
      </div>
    </div>

    <div class="pills" style="margin-top:10px">
      ${p.item_count!=null ? `<span class="pill">${p.item_count} סרטונים</span>` : ``}
      ${fmtDate(p.published_at) ? `<span class="pill">פורסם: ${esc(fmtDate(p.published_at))}</span>` : ``}
      <a class="btnLink" target="_blank" rel="noreferrer" href="https://www.youtube.com/playlist?list=${encodeURIComponent(p.playlist_id)}">פתח ביוטיוב</a>
    </div>

    <div class="hr"></div>

    ${player}

    <div class="hr"></div>

    <div style="display:flex;gap:10px;align-items:center">
      ${chThumb ? `<img class="avatar" loading="lazy" decoding="async" src="${esc(chThumb)}" onerror="this.style.display='none'">` : `<div class="avatar"></div>`}
      <div style="min-width:0">
        <div style="font-weight:900">
          <a href="/channel/${encodeURIComponent(p.channel_id)}/playlists" data-link>${esc(chTitle)}</a>
        </div>
        <div class="muted" style="font-size:12px">${esc(p.channel_id)}</div>
      </div>
    </div>
  `);
}

async function renderSearch(q, channel_id){
  if(!q){
    setPage(`<div class="h1">חיפוש</div><p class="sub">הקלד מילה בשורת החיפוש למעלה.</p>`);
    return;
  }

  $("searchInput").value = q;

  setPage(`<div class="muted">מחפש…</div>`);
  const url = `/api/search?q=${encodeURIComponent(q)}${channel_id ? `&channel_id=${encodeURIComponent(channel_id)}` : ""}`;
  const data = await api(url);
  const results = data.results || [];

  setPage(`
    <div class="h1">תוצאות חיפוש</div>
    <p class="sub">${channel_id ? `בתוך ערוץ: ${esc(channel_id)} · ` : ""}מילת חיפוש: <b>${esc(q)}</b></p>
    <div class="hr"></div>

    ${results.length ? `
      <div class="grid3">
        ${results.map(r => `
          <a class="card" href="/video/${encodeURIComponent(r.video_id)}" data-link>
            <img class="thumb16x9" loading="lazy" decoding="async" src="${esc(ytVideoThumb(r.video_id))}">
            <div class="cardBody">
              <div class="cardTitle">${esc(r.title || r.video_id)}</div>
              <div class="cardMeta">
                ${fmtDate(r.published_at) ? `<span>${esc(fmtDate(r.published_at))}</span>` : ``}
                <span>${esc(r.channel_title || r.channel_id)}</span>
              </div>
            </div>
          </a>
        `).join("")}
      </div>
    ` : `<div class="muted">אין תוצאות.</div>`}
  `);
}

// init
linkify();
attachHeaderHandlers();
boot().catch(err => {
  setPage(`<div class="h1">שגיאה</div><p class="sub">${esc(err.message)}</p>`);
});
