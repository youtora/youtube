/* SPA + Infinite Scroll (RTL, יוטיוב-סטייל) */

const app = document.getElementById("app");
const navHome = document.getElementById("navHome");
const navChannels = document.getElementById("navChannels");
const navPlaylists = document.getElementById("navPlaylists");

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");

let currentCleanup = null;
let currentAbort = null;

function setActiveNav(pathname) {
  const p = pathname || "/";
  navHome.classList.toggle("active", p === "/");
  navChannels.classList.toggle("active", p === "/channels");
  navPlaylists.classList.toggle("active", p === "/playlists");
}

function navigate(to) {
  if (to === location.pathname + location.search) return;
  history.pushState({}, "", to);
  route();
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (!a) return;

  // allow new tab / modifier keys
  if (a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  e.preventDefault();
  navigate(a.getAttribute("href"));
});

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = (searchInput.value || "").trim();
  if (!q) return;
  navigate(`/search?q=${encodeURIComponent(q)}`);
});

window.addEventListener("popstate", route);

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDate(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  try {
    return d.toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function videoThumb(video_id) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(video_id)}/mqdefault.jpg`;
}

function pickPlaylistThumbVideoId(p) {
  // API יכול להחזיר thumb_video_id (מומלץ), ואם לא – ננסה חילוץ מ-thumbnail_url (אופציונלי)
  const v = p?.thumb_video_id || p?.thumbnail_video_id || p?.thumbnailVideoId || null;
  if (v) return v;

  const url = p?.thumbnail_url || p?.thumbnailUrl || null;
  if (!url) return null;
  const m = String(url).match(/\/vi\/([^/]+)\//);
  return m ? m[1] : null;
}

function channelThumbUrl(ch) {
  return ch?.thumbnail_url || ch?.thumbnailUrl || ch?.channel_thumbnail_url || ch?.channel_thumbnail || null;
}

function apiThumbUrlFromChannelRow(ch) {
  return ch?.thumbnail_url || ch?.thumbnailUrl || null;
}

function cardVideo(v) {
  const title = v?.title || "";
  const video_id = v?.video_id || v?.videoId || "";
  const channel_id = v?.channel_id || v?.channelId || "";
  const channel_title = v?.channel_title || v?.channelTitle || "";
  const channel_thumb = v?.channel_thumbnail_url || v?.channel_thumbnail || null;
  const published_at = v?.published_at || v?.publishedAt || null;

  return `
    <a class="card" href="/${encodeURIComponent(video_id)}" data-nav>
      <span class="thumb">
        <img loading="lazy" src="${videoThumb(video_id)}" alt="">
      </span>
      <div class="cardBody">
        <p class="title">${escapeHtml(title)}</p>
        <div class="row">
          <span class="avatar">${channel_thumb ? `<img loading="lazy" src="${escapeHtml(channel_thumb)}" alt="">` : ""}</span>
          <div class="meta" style="min-width:0;flex:1">
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(channel_title || channel_id)}
            </span>
            <span>•</span>
            <span>${escapeHtml(fmtDate(published_at))}</span>
          </div>
        </div>
      </div>
    </a>
  `;
}

function cardChannel(ch) {
  const channel_id = ch?.channel_id || ch?.channelId || "";
  const title = ch?.title || "";
  const thumb = apiThumbUrlFromChannelRow(ch);

  return `
    <a class="card" href="/${encodeURIComponent(channel_id)}" data-nav>
      <span class="thumb" style="aspect-ratio: 16/9; display:flex; align-items:center; justify-content:center;">
        <span class="avatar" style="width:84px;height:84px;">
          ${thumb ? `<img loading="lazy" src="${escapeHtml(thumb)}" alt="">` : ""}
        </span>
      </span>
      <div class="cardBody">
        <p class="title" style="min-height:auto;-webkit-line-clamp:1">${escapeHtml(title || channel_id)}</p>
        <div class="meta"><span class="chip">ערוץ</span></div>
      </div>
    </a>
  `;
}

function cardPlaylist(p) {
  const playlist_id = p?.playlist_id || p?.playlistId || "";
  const title = p?.title || "";
  const channel_id = p?.channel_id || p?.channelId || "";
  const channel_title = p?.channel_title || p?.channelTitle || "";
  const pub = p?.published_at || p?.publishedAt || null;
  const thumbVid = pickPlaylistThumbVideoId(p);

  return `
    <a class="card" href="/${encodeURIComponent(playlist_id)}" data-nav>
      <span class="thumb">
        ${
          thumbVid
            ? `<img loading="lazy" src="${videoThumb(thumbVid)}" alt="">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#777">Playlist</div>`
        }
      </span>
      <div class="cardBody">
        <p class="title">${escapeHtml(title || playlist_id)}</p>
        <div class="meta">
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:65%;">
            ${escapeHtml(channel_title || channel_id)}
          </span>
          ${pub ? `<span>•</span><span>${escapeHtml(fmtDate(pub))}</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

async function fetchJSON(url, { signal } = {}) {
  const r = await fetch(url, { signal });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

function cleanupPage() {
  if (currentCleanup) {
    try { currentCleanup(); } catch {}
    currentCleanup = null;
  }
  if (currentAbort) {
    try { currentAbort.abort(); } catch {}
    currentAbort = null;
  }
}

function makeInfiniteScroll({ sentinel, loadMore, button }) {
  // fallback button always works
  button?.addEventListener("click", () => loadMore());

  if (!("IntersectionObserver" in window)) return () => {};

  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[0];
      if (e && e.isIntersecting) loadMore();
    },
    { root: null, rootMargin: "900px 0px", threshold: 0.01 }
  );

  io.observe(sentinel);
  return () => io.disconnect();
}

/* ---------------- Pages ---------------- */

async function pageHome() {
  setActiveNav("/");
  app.innerHTML = `
    <h1 class="h1">סרטונים אחרונים</h1>
    <div class="grid" id="list"></div>
    <div class="loadMore"><button class="btn" id="btnMore">טען עוד</button></div>
    <div class="sentinel" id="sentinel"></div>
  `;

  const list = document.getElementById("list");
  const btn = document.getElementById("btnMore");
  const sentinel = document.getElementById("sentinel");

  const state = { loading: false, done: false, cursor: null };

  async function loadMore() {
    if (state.loading || state.done) return;
    state.loading = true;
    btn.disabled = true;
    btn.textContent = "טוען...";

    try {
      const url =
        `/api/latest?limit=24` + (state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : "");
      const data = await fetchJSON(url, { signal: currentAbort.signal });

      const videos = data?.videos || [];
      const next = data?.next_cursor || data?.nextCursor || null;

      if (!videos.length && !state.cursor) {
        list.innerHTML = `<div class="empty">אין עדיין סרטונים במסד.</div>`;
      } else {
        const frag = document.createDocumentFragment();
        const tmp = document.createElement("div");
        tmp.innerHTML = videos.map(cardVideo).join("");
        while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
        list.appendChild(frag);
      }

      state.cursor = next;
      if (!next || videos.length === 0) state.done = true;
    } catch (err) {
      console.error(err);
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = state.done ? "אין עוד" : "טען עוד";
      if (state.done) btn.style.display = "none";
    }
  }

  currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });
  await loadMore();
}

async function pageChannels() {
  setActiveNav("/channels");
  app.innerHTML = `
    <h1 class="h1">ערוצים</h1>
    <div class="grid" id="grid"></div>
  `;

  const grid = document.getElementById("grid");
  const data = await fetchJSON("/api/channels", { signal: currentAbort.signal });
  const channels = data?.channels || [];

  if (!channels.length) {
    grid.innerHTML = `<div class="empty">אין ערוצים עדיין.</div>`;
    return;
  }

  grid.innerHTML = channels.map(cardChannel).join("");
}

async function pagePlaylists() {
  setActiveNav("/playlists");
  app.innerHTML = `
    <h1 class="h1">פלייליסטים</h1>
    <div class="grid" id="grid"></div>
    <div class="loadMore"><button class="btn" id="btnMore">טען עוד</button></div>
    <div class="sentinel" id="sentinel"></div>
  `;

  const grid = document.getElementById("grid");
  const btn = document.getElementById("btnMore");
  const sentinel = document.getElementById("sentinel");

  const state = { loading: false, done: false, cursor: null };

  async function loadMore() {
    if (state.loading || state.done) return;
    state.loading = true;
    btn.disabled = true;
    btn.textContent = "טוען...";

    try {
      const url =
        `/api/playlists?limit=24` + (state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : "");
      const data = await fetchJSON(url, { signal: currentAbort.signal });

      const playlists = data?.playlists || [];
      const next = data?.next_cursor || data?.nextCursor || null;

      if (!playlists.length && !state.cursor) {
        grid.innerHTML = `<div class="empty">אין פלייליסטים עדיין.</div>`;
      } else {
        const frag = document.createDocumentFragment();
        const tmp = document.createElement("div");
        tmp.innerHTML = playlists.map(cardPlaylist).join("");
        while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
        grid.appendChild(frag);
      }

      state.cursor = next;
      if (!next || playlists.length === 0) state.done = true;
    } catch (err) {
      console.error(err);
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = state.done ? "אין עוד" : "טען עוד";
      if (state.done) btn.style.display = "none";
    }
  }

  currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });
  await loadMore();
}

async function pageSearch(q) {
  setActiveNav("/search");
  const qq = (q || "").trim();
  searchInput.value = qq;

  app.innerHTML = `
    <h1 class="h1">חיפוש</h1>
    <div class="muted" style="margin-bottom:10px">תוצאות עבור: <b>${escapeHtml(qq)}</b></div>
    <div class="grid" id="grid"></div>
    <div class="loadMore"><button class="btn" id="btnMore">טען עוד</button></div>
    <div class="sentinel" id="sentinel"></div>
  `;

  const grid = document.getElementById("grid");
  const btn = document.getElementById("btnMore");
  const sentinel = document.getElementById("sentinel");

  const state = { loading: false, done: false, cursor: null };

  async function loadMore() {
    if (state.loading || state.done) return;
    if (!qq) {
      grid.innerHTML = `<div class="empty">הקלד משהו בשורת החיפוש.</div>`;
      btn.style.display = "none";
      state.done = true;
      return;
    }

    state.loading = true;
    btn.disabled = true;
    btn.textContent = "טוען...";

    try {
      const url =
        `/api/search?q=${encodeURIComponent(qq)}&limit=24` +
        (state.cursor ? `&cursor=${encodeURIComponent(state.cursor)}` : "");
      const data = await fetchJSON(url, { signal: currentAbort.signal });

      const videos = data?.videos || [];
      const next = data?.next_cursor || data?.nextCursor || null;

      if (!videos.length && !state.cursor) {
        grid.innerHTML = `<div class="empty">לא נמצאו תוצאות.</div>`;
      } else {
        const frag = document.createDocumentFragment();
        const tmp = document.createElement("div");
        tmp.innerHTML = videos.map(cardVideo).join("");
        while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
        grid.appendChild(frag);
      }

      state.cursor = next;
      if (!next || videos.length === 0) state.done = true;
    } catch (err) {
      console.error(err);
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = state.done ? "אין עוד" : "טען עוד";
      if (state.done) btn.style.display = "none";
    }
  }

  currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });
  await loadMore();
}

async function pageChannel(channel_id, tab = "videos") {
  setActiveNav(""); // channel is not a top nav item

  app.innerHTML = `
    <div id="head"></div>
    <div class="tabs">
      <a href="/${encodeURIComponent(channel_id)}?tab=videos" data-nav id="tabVideos">סרטונים</a>
      <a href="/${encodeURIComponent(channel_id)}?tab=playlists" data-nav id="tabPlaylists">פלייליסטים</a>
    </div>
    <div id="content"></div>
  `;

  const tabVideos = document.getElementById("tabVideos");
  const tabPlaylists = document.getElementById("tabPlaylists");
  tabVideos.classList.toggle("active", tab === "videos");
  tabPlaylists.classList.toggle("active", tab === "playlists");

  const head = document.getElementById("head");
  const content = document.getElementById("content");

  // fetch channel info + first page for selected tab
  const url =
    `/api/channel?channel_id=${encodeURIComponent(channel_id)}` +
    (tab === "videos" ? `&include_videos=1&videos_limit=24` : `&include_playlists=1&playlists_limit=24`);
  const data = await fetchJSON(url, { signal: currentAbort.signal });

  const ch = data?.channel;
  if (!ch) {
    content.innerHTML = `<div class="empty">ערוץ לא נמצא.</div>`;
    return;
  }

  const thumb = apiThumbUrlFromChannelRow(ch);
  head.innerHTML = `
    <div class="row" style="gap:12px; margin:10px 0 6px;">
      <span class="avatar" style="width:64px;height:64px;">
        ${thumb ? `<img loading="lazy" src="${escapeHtml(thumb)}" alt="">` : ""}
      </span>
      <div style="min-width:0">
        <div style="font-size:20px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(ch.title || ch.channel_id)}
        </div>
        <div class="muted" style="font-size:13px">Channel ID: ${escapeHtml(ch.channel_id)}</div>
      </div>
    </div>
  `;

  if (tab === "videos") {
    content.innerHTML = `
      <div class="grid" id="grid"></div>
      <div class="loadMore"><button class="btn" id="btnMore">טען עוד</button></div>
      <div class="sentinel" id="sentinel"></div>
    `;

    const grid = document.getElementById("grid");
    const btn = document.getElementById("btnMore");
    const sentinel = document.getElementById("sentinel");

    const state = {
      loading: false,
      done: false,
      cursor: data?.videos_next_cursor || null,
      first: (data?.videos || []),
    };

    if (!state.first.length) {
      grid.innerHTML = `<div class="empty">אין סרטונים לערוץ הזה עדיין.</div>`;
    } else {
      grid.innerHTML = state.first.map(cardVideo).join("");
    }

    async function loadMore() {
      if (state.loading || state.done) return;
      if (!state.cursor) { state.done = true; btn.style.display="none"; return; }

      state.loading = true;
      btn.disabled = true;
      btn.textContent = "טוען...";

      try {
        const more = await fetchJSON(
          `/api/channel?channel_id=${encodeURIComponent(channel_id)}&include_videos=1&videos_limit=24&videos_cursor=${encodeURIComponent(state.cursor)}`,
          { signal: currentAbort.signal }
        );

        const videos = more?.videos || [];
        const next = more?.videos_next_cursor || null;

        const frag = document.createDocumentFragment();
        const tmp = document.createElement("div");
        tmp.innerHTML = videos.map(cardVideo).join("");
        while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
        grid.appendChild(frag);

        state.cursor = next;
        if (!next || videos.length === 0) state.done = true;
      } catch (err) {
        console.error(err);
      } finally {
        state.loading = false;
        btn.disabled = false;
        btn.textContent = state.done ? "אין עוד" : "טען עוד";
        if (state.done) btn.style.display = "none";
      }
    }

    currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });

  } else {
    content.innerHTML = `
      <div class="grid" id="grid"></div>
      <div class="loadMore"><button class="btn" id="btnMore">טען עוד</button></div>
      <div class="sentinel" id="sentinel"></div>
    `;

    const grid = document.getElementById("grid");
    const btn = document.getElementById("btnMore");
    const sentinel = document.getElementById("sentinel");

    const state = {
      loading: false,
      done: false,
      cursor: data?.playlists_next_cursor || null,
      first: (data?.playlists || []),
    };

    if (!state.first.length) {
      grid.innerHTML = `<div class="empty">אין פלייליסטים לערוץ הזה עדיין.</div>`;
    } else {
      grid.innerHTML = state.first.map(cardPlaylist).join("");
    }

    async function loadMore() {
      if (state.loading || state.done) return;
      if (!state.cursor) { state.done = true; btn.style.display="none"; return; }

      state.loading = true;
      btn.disabled = true;
      btn.textContent = "טוען...";

      try {
        const more = await fetchJSON(
          `/api/channel?channel_id=${encodeURIComponent(channel_id)}&include_playlists=1&playlists_limit=24&playlists_cursor=${encodeURIComponent(state.cursor)}`,
          { signal: currentAbort.signal }
        );

        const playlists = more?.playlists || [];
        const next = more?.playlists_next_cursor || null;

        const frag = document.createDocumentFragment();
        const tmp = document.createElement("div");
        tmp.innerHTML = playlists.map(cardPlaylist).join("");
        while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
        grid.appendChild(frag);

        state.cursor = next;
        if (!next || playlists.length === 0) state.done = true;
      } catch (err) {
        console.error(err);
      } finally {
        state.loading = false;
        btn.disabled = false;
        btn.textContent = state.done ? "אין עוד" : "טען עוד";
        if (state.done) btn.style.display = "none";
      }
    }

    currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });
  }
}

async function pagePlaylist(playlist_id) {
  setActiveNav("");

  app.innerHTML = `
    <div id="head"></div>
    <div class="tabs">
      <a href="/${encodeURIComponent(playlist_id)}" data-nav class="active">סרטונים</a>
    </div>
    <div id="content"></div>
  `;

  const head = document.getElementById("head");
  const content = document.getElementById("content");

  const data = await fetchJSON(`/api/playlist?playlist_id=${encodeURIComponent(playlist_id)}&videos_limit=24`, {
    signal: currentAbort.signal
  });

  const p = data?.playlist;
  if (!p) {
    content.innerHTML = `<div class="empty">פלייליסט לא נמצא.</div>`;
    return;
  }

  const chThumb = channelThumbUrl(p);
  const thumbVid = pickPlaylistThumbVideoId(p);

  head.innerHTML = `
    <div class="row" style="gap:12px; margin:10px 0 6px;">
      <span class="avatar" style="width:64px;height:64px;border-radius:14px;">
        ${
          thumbVid
            ? `<img loading="lazy" src="${videoThumb(thumbVid)}" alt="">`
            : (chThumb ? `<img loading="lazy" src="${escapeHtml(chThumb)}" alt="">` : "")
        }
      </span>
      <div style="min-width:0">
        <div style="font-size:20px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(p.title || p.playlist_id)}
        </div>
        <div class="muted" style="font-size:13px">
          <a href="/${encodeURIComponent(p.channel_id)}" data-nav style="color:var(--link)">
            ${escapeHtml(p.channel_title || p.channel_id)}
          </a>
        </div>
      </div>
    </div>
  `;

  content.innerHTML = `
    <div class="grid" id="grid"></div>
    <div class="loadMore"><button class="btn" id="btnMore">טען עוד</button></div>
    <div class="sentinel" id="sentinel"></div>
  `;

  const grid = document.getElementById("grid");
  const btn = document.getElementById("btnMore");
  const sentinel = document.getElementById("sentinel");

  const state = {
    loading: false,
    done: false,
    cursor: data?.videos_next_cursor || null
  };

  const first = data?.videos || [];
  if (!first.length) {
    grid.innerHTML = `<div class="empty">אין סרטונים לפלייליסט הזה עדיין.</div>`;
    btn.style.display = "none";
    state.done = true;
  } else {
    grid.innerHTML = first.map(cardVideo).join("");
  }

  async function loadMore() {
    if (state.loading || state.done) return;
    if (!state.cursor) { state.done = true; btn.style.display="none"; return; }

    state.loading = true;
    btn.disabled = true;
    btn.textContent = "טוען...";

    try {
      const more = await fetchJSON(
        `/api/playlist?playlist_id=${encodeURIComponent(playlist_id)}&videos_limit=24&videos_cursor=${encodeURIComponent(state.cursor)}`,
        { signal: currentAbort.signal }
      );

      const videos = more?.videos || [];
      const next = more?.videos_next_cursor || null;

      const frag = document.createDocumentFragment();
      const tmp = document.createElement("div");
      tmp.innerHTML = videos.map(cardVideo).join("");
      while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
      grid.appendChild(frag);

      state.cursor = next;
      if (!next || videos.length === 0) state.done = true;
    } catch (err) {
      console.error(err);
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = state.done ? "אין עוד" : "טען עוד";
      if (state.done) btn.style.display = "none";
    }
  }

  currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });
}

async function pageWatch(video_id) {
  setActiveNav("");

  app.innerHTML = `
    <div class="watchLayout">
      <section class="watchMain" id="main"></section>
      <aside class="watchSide">
        <div class="miniList" id="side"></div>
        <div class="loadMore" style="justify-content:flex-start; margin-top:10px">
          <button class="btn" id="btnMore">טען עוד</button>
        </div>
        <div class="sentinel" id="sentinel"></div>
      </aside>
    </div>
  `;

  const main = document.getElementById("main");
  const side = document.getElementById("side");
  const btn = document.getElementById("btnMore");
  const sentinel = document.getElementById("sentinel");

  const embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video_id)}?rel=0&modestbranding=1`;
  main.innerHTML = `
    <div class="player"><iframe src="${embed}" allowfullscreen></iframe></div>
    <div id="meta"></div>
  `;

  const meta = document.getElementById("meta");

  // ננסה להביא פרטים + מוצעים
  let info = null;
  try {
    info = await fetchJSON(`/api/video?video_id=${encodeURIComponent(video_id)}`, { signal: currentAbort.signal });
  } catch {
    // fallback: נשאיר רק נגן
  }

  const v = info?.video || null;
  const suggestedFirst = info?.suggested || [];

  if (v) {
    meta.innerHTML = `
      <div class="watchTitle">${escapeHtml(v.title || "")}</div>
      <div class="watchBar">
        <div class="row" style="gap:10px; min-width:0">
          <span class="avatar">
            ${
              (v.channel_thumbnail_url || v.channel_thumbnail)
                ? `<img loading="lazy" src="${escapeHtml(v.channel_thumbnail_url || v.channel_thumbnail)}" alt="">`
                : ""
            }
          </span>
          <div style="min-width:0">
            <a href="/${encodeURIComponent(v.channel_id)}" data-nav style="display:block;color:var(--text);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(v.channel_title || v.channel_id)}
            </a>
            <div class="muted" style="font-size:12px">${escapeHtml(fmtDate(v.published_at))}</div>
          </div>
        </div>
        <a class="chip" href="https://www.youtube.com/watch?v=${encodeURIComponent(video_id)}" target="_blank" rel="noopener noreferrer">
          פתח ביוטיוב
        </a>
      </div>
    `;
  } else {
    meta.innerHTML = `<div class="watchTitle">וידאו: ${escapeHtml(video_id)}</div>`;
  }

  // Suggested list with infinite scroll (נביא מהערוץ של הסרטון אם יש)
  const state = { loading: false, done: false, cursor: null, channel_id: v?.channel_id || null };

  function miniItem(x) {
    const vid = x?.video_id || x?.videoId || "";
    const title = x?.title || "";
    const chTitle = x?.channel_title || x?.channelTitle || x?.channel_id || "";
    const pub = x?.published_at || null;
    return `
      <a class="mini" href="/${encodeURIComponent(vid)}" data-nav>
        <span class="miniThumb"><img loading="lazy" src="${videoThumb(vid)}" alt=""></span>
        <span class="miniBody">
          <p class="miniTitle">${escapeHtml(title)}</p>
          <div class="miniMeta">${escapeHtml(chTitle)}${pub ? ` • ${escapeHtml(fmtDate(pub))}` : ""}</div>
        </span>
      </a>
    `;
  }

  // first render
  const first = suggestedFirst.filter(x => (x.video_id || x.videoId) !== video_id).slice(0, 18);
  if (!first.length) {
    side.innerHTML = `<div class="empty">אין מוצעים עדיין.</div>`;
  } else {
    side.innerHTML = first.map(miniItem).join("");
  }

  state.cursor = info?.suggested_next_cursor || null;

  async function loadMore() {
    if (state.loading || state.done) return;

    // אם אין cursor, ננסה להביא עוד מהערוץ דרך /api/channel
    if (!state.cursor) {
      state.done = true;
      btn.style.display = "none";
      return;
    }

    state.loading = true;
    btn.disabled = true;
    btn.textContent = "טוען...";

    try {
      // נשתמש ב־/api/video להמשכים (מימוש למטה ב־API)
      const more = await fetchJSON(
        `/api/video?video_id=${encodeURIComponent(video_id)}&suggested_limit=18&suggested_cursor=${encodeURIComponent(state.cursor)}`,
        { signal: currentAbort.signal }
      );

      const items = (more?.suggested || []).filter(x => (x.video_id || x.videoId) !== video_id);
      const next = more?.suggested_next_cursor || null;

      const frag = document.createDocumentFragment();
      const tmp = document.createElement("div");
      tmp.innerHTML = items.map(miniItem).join("");
      while (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
      side.appendChild(frag);

      state.cursor = next;
      if (!next || items.length === 0) state.done = true;
    } catch (err) {
      console.error(err);
    } finally {
      state.loading = false;
      btn.disabled = false;
      btn.textContent = state.done ? "אין עוד" : "טען עוד";
      if (state.done) btn.style.display = "none";
    }
  }

  currentCleanup = makeInfiniteScroll({ sentinel, loadMore, button: btn });
  // לא חייבים לקרוא כאן – זה יופעל כשגוללים, אבל אפשר:
  // await loadMore();
}

/* -------------- Router -------------- */

async function route() {
  cleanupPage();
  currentAbort = new AbortController();

  const url = new URL(location.href);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams.get("q") || "";
  const tab = url.searchParams.get("tab") || "videos";

  try {
    // fixed routes
    if (pathname === "/") return await pageHome();
    if (pathname === "/channels") return await pageChannels();
    if (pathname === "/playlists") return await pagePlaylists();
    if (pathname === "/search") return await pageSearch(q);

    // dynamic by id
    const slug = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (!slug) return await pageHome();

    // channel
    if (slug.startsWith("UC")) return await pageChannel(slug, tab === "playlists" ? "playlists" : "videos");

    // playlist
    if (slug.startsWith("PL")) return await pagePlaylist(slug);

    // otherwise treat as video id
    return await pageWatch(slug);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty">שגיאה בטעינה. בדוק קונסול.</div>`;
  }
}

route();
