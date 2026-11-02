"use strict";

// ---------- Radio Browser API (gratuita y abierta) ----------
const SERVERS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
];
let serverIdx = 0;

async function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  let lastErr;
  for (let i = 0; i < SERVERS.length; i++) {
    const base = SERVERS[(serverIdx + i) % SERVERS.length];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${base}/json/${path}${qs ? "?" + qs : ""}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      serverIdx = (serverIdx + i) % SERVERS.length;
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Se muestran TODAS las emisoras, sin filtros. Si una no suena, se avisa al intentarlo.
// La web va por HTTPS: las que solo dan dirección http se intentan por https
// (muchos servidores aceptan las dos).
const BAD_CODECS = ["OGG", "OPUS", "FLAC", "WMA", "VORBIS"];
function playable(s) {
  if (!s.url_resolved && s.url) s.url_resolved = s.url;
  return s.url_resolved && /^https?:\/\//i.test(s.url_resolved);
}
function slim(s) {
  return {
    stationuuid: s.stationuuid, name: (s.name || "").trim(),
    url_resolved: s.url_resolved.replace(/^http:\/\//i, "https://"),
    httpOnly: /^http:\/\//i.test(s.url_resolved),
    favicon: s.favicon, country: s.country, countrycode: s.countrycode,
    tags: s.tags, codec: s.codec, bitrate: s.bitrate, hls: s.hls, clickcount: s.clickcount || 0,
    badCodec: BAD_CODECS.some((c) => (s.codec || "").toUpperCase().includes(c)),
  };
}
async function searchStations(params, offset) {
  const data = await api("stations/search", {
    hidebroken: "false", order: "clickcount", reverse: "true",
    limit: 60, offset, ...params,
  });
  return { items: data.filter(playable).map(slim), full: data.length === 60 };
}

// ---------- Almacenamiento local ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let favs = store.get("favs", []);
const isFav = (id) => favs.some((f) => f.stationuuid === id);
function toggleFav(st) {
  if (isFav(st.stationuuid)) favs = favs.filter((f) => f.stationuuid !== st.stationuuid);
  else favs.push(st);
  store.set("favs", favs);
  renderFavs();
  refreshListsState();
}

// ---------- Utilidades de interfaz ----------
const $ = (id) => document.getElementById(id);
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2500);
}
const PLACEHOLDER = "icons/icon-192.png";

// ---------- Logotipos de las emisoras ----------
// 1) el logo original (pasado a https), 2) el mismo logo a través de un proxy de imágenes
// gratuito (para logos que solo existen en http), 3) un icono con las iniciales de la emisora.
function proxied(url) {
  return "https://images.weserv.nl/?w=128&h=128&fit=contain&url=" + encodeURIComponent(url.replace(/^https?:\/\//, ""));
}
function logoCandidates(st) {
  const f = (st.favicon || "").trim();
  if (!/^https?:\/\//i.test(f)) return [];
  const https = f.replace(/^http:\/\//i, "https://");
  return [https, proxied(f)];
}
function initialsIcon(name) {
  const words = (name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  const ini = ((words[0] || "?")[0] + (words[1] ? words[1][0] : "")).toUpperCase();
  let h = 0; for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${h},55%,42%)"/><text x="48" y="50" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="38" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${ini.replace(/[<&>]/g, "")}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function setLogo(img, st) {
  const list = logoCandidates(st);
  let i = 0;
  const next = () => { img.src = i < list.length ? list[i] : initialsIcon(st.name); i++; };
  img.onerror = () => { if (i <= list.length) next(); };
  img.onload = () => { if (img.naturalWidth < 8 && i <= list.length) next(); };
  next();
}
function artworkUrl(st) {
  const list = logoCandidates(st);
  return list.length ? list[1] : new URL("icons/icon-512.png", location.href).href;
}
const REGION = (() => { try { return new Intl.DisplayNames(["es"], { type: "region" }); } catch { return null; } })();
function countryName(st) {
  try { return (st.countrycode && REGION && REGION.of(st.countrycode)) || st.country; } catch { return st.country; }
}
function meta(st) {
  const tags = (st.tags || "").split(",").filter(Boolean).slice(0, 2).join(", ");
  return [countryName(st), tags, st.bitrate ? st.bitrate + " kbps" : ""].filter(Boolean).join(" · ");
}

function stationItem(st, list) {
  const li = document.createElement("li");
  li.className = "st";
  li.dataset.id = st.stationuuid;
  const img = document.createElement("img");
  img.loading = "lazy"; img.alt = "";
  setLogo(img, st);
  const main = document.createElement("div");
  main.className = "stMain";
  main.innerHTML = `<div class="stName"></div><div class="stMeta"></div>`;
  main.firstChild.textContent = st.name;
  main.lastChild.textContent = meta(st);
  const fav = document.createElement("button");
  fav.className = "icon favBtn";
  fav.setAttribute("aria-label", "Favorita");
  fav.onclick = (e) => { e.stopPropagation(); toggleFav(st); };
  li.append(img, main, fav);
  li.onclick = () => play(st, list);
  return li;
}
function refreshListsState() {
  document.querySelectorAll(".st").forEach((li) => {
    const id = li.dataset.id;
    const b = li.querySelector(".favBtn");
    if (b) { b.textContent = isFav(id) ? "★" : "☆";
    b.classList.toggle("fav", isFav(id)); }
    li.classList.toggle("playing", current && current.stationuuid === id);
  });
  if (current && $("rFav")) {
    $("rFav").textContent = isFav(current.stationuuid) ? "★" : "☆";
    $("rFav").classList.toggle("fav", isFav(current.stationuuid));
  }
  if (current) {
    $("pFav").textContent = isFav(current.stationuuid) ? "★" : "☆";
    $("pFav").classList.toggle("fav", isFav(current.stationuuid));
  }
}

// Lista paginada reutilizable
function pagedList(ulId, moreId, loader = searchStations) {
  const ul = $(ulId), more = $(moreId);
  const state = { params: null, offset: 0, items: [] };
  async function load(reset) {
    if (reset) { state.offset = 0; state.items = []; ul.innerHTML = `<li class="msg">Cargando…</li>`; }
    more.hidden = true;
    try {
      const { items, full } = await loader(state.params, state.offset);
      if (reset) ul.innerHTML = "";
      state.offset += 60;
      state.items.push(...items);
      items.forEach((st) => ul.append(stationItem(st, state.items)));
      if (!state.items.length) ul.innerHTML = `<li class="msg">No se encontraron emisoras.</li>`;
      more.hidden = !full;
      refreshListsState();
    } catch {
      ul.innerHTML = `<li class="msg">No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.</li>`;
    }
  }
  more.onclick = () => load(false);
  return { search(params) { state.params = params; return load(true); } };
}

// ---------- Pestañas ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  };
});
// Al abrir: Favoritas si tienes alguna; si no, Populares
document.querySelector(`.tabs button[data-tab="${favs.length ? "favs" : "home"}"]`).click();

// ---------- Filtros múltiples de Buscar (países y géneros) ----------
// Puedes elegir varios países y varios géneros. Al elegir países, la lista de géneros
// muestra solo los que hay en esos países (y al revés). Radio Browser no da ese cruce,
// así que lo calculamos con una muestra de las emisoras más escuchadas de cada país/género.
let allCountries = [], allTags = [];
let selCountries = store.get("selCountries", []);
let selTags = store.get("selTags", []);
const SAMPLE = 1500;
const sampleCache = {};
function countryLabel(code) {
  const c = allCountries.find((x) => x.code === code);
  if (c) return c.name;
  try { return (REGION && REGION.of(code)) || code; } catch { return code; }
}
async function sample(params) {
  const key = JSON.stringify(params);
  if (!sampleCache[key]) {
    sampleCache[key] = api("stations/search", { hidebroken: "false", order: "clickcount", reverse: "true", limit: SAMPLE, ...params })
      .catch((e) => { delete sampleCache[key]; throw e; });
  }
  return sampleCache[key];
}
async function tagFacet(countries) {
  const counts = new Map();
  const lists = await Promise.all(countries.map((c) => sample({ countrycode: c })));
  for (const list of lists) for (const st of list) {
    for (let t of (st.tags || "").split(",")) { t = t.trim().toLowerCase(); if (t) counts.set(t, (counts.get(t) || 0) + 1); }
  }
  return counts;
}
async function countryFacet(tags) {
  const counts = new Map();
  const lists = await Promise.all(tags.map((t) => sample({ tag: t, tagExact: "true" })));
  const seen = new Set();
  for (const list of lists) for (const st of list) {
    const cc = (st.countrycode || "").toUpperCase();
    if (!cc || seen.has(st.stationuuid)) continue;
    seen.add(st.stationuuid);
    counts.set(cc, (counts.get(cc) || 0) + 1);
  }
  return counts;
}
function pickLabel(list, empty, fmt) {
  if (!list.length) return empty;
  return list.length === 1 ? fmt(list[0]) : `${fmt(list[0])} +${list.length - 1}`;
}
function updatePickButtons() {
  $("qCountryBtn").textContent = pickLabel(selCountries, "Cualquier país", countryLabel);
  $("qTagBtn").textContent = pickLabel(selTags, "Cualquier género", (t) => t);
  $("qCountryBtn").classList.toggle("on", selCountries.length > 0);
  $("qTagBtn").classList.toggle("on", selTags.length > 0);
}

let pickKind = "country", pickSel = new Set(), pickOptions = [];
async function openPicker(kind) {
  pickKind = kind;
  pickSel = new Set(kind === "country" ? selCountries : selTags);
  $("pickTitle").textContent = kind === "country" ? "Países" : "Géneros";
  $("pickFilter").value = "";
  $("picker").hidden = false;
  const other = kind === "country" ? selTags : selCountries;
  pickOptions = [];
  if (other.length) {
    $("pickHint").textContent = "Cargando…";
    $("pickList").innerHTML = "";
    try {
      if (kind === "country") {
        const counts = await countryFacet(other);
        pickOptions = [...counts].map(([code, n]) => ({ id: code, name: countryLabel(code), count: n }))
          .sort((a, b) => a.name.localeCompare(b.name, "es"));
      } else {
        const counts = await tagFacet(other);
        pickOptions = [...counts].map(([t, n]) => ({ id: t, name: t, count: n })).sort((a, b) => b.count - a.count);
      }
      $("pickHint").textContent = kind === "country"
        ? `Solo países con emisoras de: ${other.join(", ")}.`
        : `Solo géneros que hay en: ${other.map(countryLabel).join(", ")} (los más comunes primero).`;
    } catch {
      $("pickHint").textContent = "No se pudo cargar la lista ajustada; se muestran todos.";
    }
  } else {
    $("pickHint").textContent = kind === "country" ? "Puedes marcar varios países." : "Puedes marcar varios géneros.";
  }
  if (!pickOptions.length) {
    pickOptions = kind === "country"
      ? allCountries.map((c) => ({ id: c.code, name: c.name, count: c.count }))
      : allTags.map((t) => ({ id: t.name, name: t.name, count: t.count }));
  }
  // Lo ya marcado siempre aparece, aunque no esté en la lista ajustada
  for (const id of pickSel) if (!pickOptions.some((o) => o.id === id)) {
    pickOptions.unshift({ id, name: kind === "country" ? countryLabel(id) : id, count: 0 });
  }
  renderPicker();
}
function renderPicker() {
  const q = $("pickFilter").value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ul = $("pickList");
  ul.innerHTML = "";
  const opts = pickOptions.filter((o) => !q || o.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q));
  // Los marcados arriba
  opts.sort((a, b) => (pickSel.has(b.id) ? 1 : 0) - (pickSel.has(a.id) ? 1 : 0));
  for (const o of opts.slice(0, 400)) {
    const li = document.createElement("li");
    li.classList.toggle("sel", pickSel.has(o.id));
    li.innerHTML = `<span class="chk"></span><span class="pName2"></span><span class="pCount"></span>`;
    li.querySelector(".chk").textContent = pickSel.has(o.id) ? "✓" : "";
    li.querySelector(".pName2").textContent = o.name;
    li.querySelector(".pCount").textContent = o.count ? o.count : "";
    li.onclick = () => {
      pickSel.has(o.id) ? pickSel.delete(o.id) : pickSel.add(o.id);
      li.classList.toggle("sel", pickSel.has(o.id));
      li.querySelector(".chk").textContent = pickSel.has(o.id) ? "✓" : "";
    };
    ul.append(li);
  }
  if (!opts.length) ul.innerHTML = `<li class="msg">Nada coincide.</li>`;
}
$("pickFilter").addEventListener("input", renderPicker);
$("pickClear").onclick = () => { pickSel.clear(); renderPicker(); };
$("pickDone").onclick = () => {
  if (pickKind === "country") { selCountries = [...pickSel]; store.set("selCountries", selCountries); }
  else { selTags = [...pickSel]; store.set("selTags", selTags); }
  $("picker").hidden = true;
  updatePickButtons();
};
$("qCountryBtn").onclick = () => openPicker("country");
$("qTagBtn").onclick = () => openPicker("tag");

// Búsqueda con varios países/géneros: una consulta por combinación, y se juntan
function combos(f) {
  const cs = f.countries.length ? f.countries : [null];
  const ts = f.tags.length ? f.tags : [null];
  const out = [];
  for (const c of cs) for (const t of ts) {
    const p = {};
    if (f.name) p.name = f.name;
    if (c) p.countrycode = c;
    if (t) { p.tag = t; p.tagExact = "true"; }
    out.push(p);
  }
  return out;
}
async function multiFetch(f, order, limitEach) {
  const cb = combos(f).slice(0, 30);
  const lists = await Promise.all(cb.map((p) =>
    api("stations/search", { hidebroken: "false", order, reverse: "true", limit: limitEach, ...p }).catch(() => null)));
  if (lists.every((l) => l === null)) throw new Error("sin conexión");
  const seen = new Set(), out = [];
  for (const l of lists) for (const s of l || []) {
    if (seen.has(s.stationuuid) || !playable(s)) continue;
    seen.add(s.stationuuid); out.push(slim(s));
  }
  return out;
}
async function searchMulti(f, offset) {
  const cb = combos(f);
  if (cb.length === 1) return searchStations(cb[0], offset);
  if (offset > 0) return { items: [], full: false };
  const items = await multiFetch(f, "clickcount", 100);
  items.sort((a, b) => b.clickcount - a.clickcount);
  return { items, full: false };
}
updatePickButtons();

// ---------- Populares y búsqueda ----------
const home = pagedList("homeList", "homeMore");
const results = pagedList("searchList", "searchMore", searchMulti);

async function loadFilters() {
  const homeSel = $("homeCountry");
  const homeCode = store.get("homeCountry", "ES");
  homeSel.innerHTML = `<option value="">🌍 Todo el mundo</option>`;
  try {
    const [countries, tags] = await Promise.all([
      api("countries", {}),
      api("tags", { order: "stationcount", reverse: "true", limit: 500 }),
    ]);
    const list = countries
      .filter((c) => c.iso_3166_1 && c.stationcount > 0)
      .map((c) => { let n = c.name; try { n = (REGION && REGION.of(c.iso_3166_1)) || n; } catch {} return { code: c.iso_3166_1, name: n, count: c.stationcount }; })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    for (const c of list) homeSel.add(new Option(`${c.name} (${c.count})`, c.code));
    allCountries = list;
    allTags = tags.filter((t) => t.name).map((t) => ({ name: t.name, count: t.stationcount }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    updatePickButtons();
  } catch {
    homeSel.add(new Option("España", "ES"));
  }
  homeSel.value = homeCode;
  if (homeSel.value !== homeCode) homeSel.value = "";
}
$("homeCountry").onchange = (e) => {
  store.set("homeCountry", e.target.value);
  home.search(e.target.value ? { countrycode: e.target.value } : {});
};
$("searchForm").onsubmit = (e) => {
  e.preventDefault();
  document.activeElement.blur();
  $("rCard").hidden = true;
  results.search(searchFilters());
};

// ---------- Favoritas ----------
let favSorting = false;
function saveFavOrder() { store.set("favs", favs); renderFavs(); }
function moveFav(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= favs.length) return;
  [favs[i], favs[j]] = [favs[j], favs[i]];
  saveFavOrder();
}
function renderFavs() {
  const ul = $("favsList");
  ul.innerHTML = "";
  favs.forEach((st, i) => {
    const li = stationItem(st, favs);
    if (favSorting) {
      // En modo ordenar: flechas en lugar de la estrella, y tocar no reproduce
      li.onclick = null;
      li.querySelector(".favBtn").remove();
      const mv = document.createElement("div");
      mv.className = "moveBtns";
      mv.innerHTML = `<button aria-label="Subir">▲</button><button aria-label="Bajar">▼</button>`;
      const [up, down] = mv.querySelectorAll("button");
      up.disabled = i === 0; down.disabled = i === favs.length - 1;
      up.onclick = (e) => { e.stopPropagation(); moveFav(i, -1); };
      down.onclick = (e) => { e.stopPropagation(); moveFav(i, 1); };
      li.append(mv);
    }
    ul.append(li);
  });
  $("favsEmpty").hidden = favs.length > 0;
  if (favs.length < 2) favSorting = false;
  $("favBar").hidden = favs.length < 2;
  $("favSortBtn").hidden = favSorting;
  $("favSortTools").hidden = !favSorting;
  $("favHelp").hidden = !favSorting;
  refreshListsState();
}
$("favSortBtn").onclick = () => { favSorting = true; renderFavs(); };
$("favDone").onclick = () => { favSorting = false; renderFavs(); };
$("favAZ").onclick = () => { favs.sort((a, b) => a.name.localeCompare(b.name, "es")); saveFavOrder(); };
$("favMost").onclick = () => {
  const secs = (s) => (stats.stations[s.stationuuid] || {}).sec || 0;
  favs.sort((a, b) => secs(b) - secs(a));
  saveFavOrder();
};

// ---------- Reproductor ----------
const audio = $("audio");
let current = null;
let queue = [];
let wantPlaying = false;
let retries = 0;
let everPlayed = false; // si la emisora llegó a sonar en este intento
let retryTimer = null;
let stallTimer = null;

function setStatus(s) { $("pStatus").textContent = s; }
function setToggle(playing) { $("pToggle").textContent = playing ? "❚❚" : "▶"; }

let randomMode = false;
function play(st, list, fromRandom) {
  randomMode = !!fromRandom;
  current = st;
  queue = list && list.length ? list : [st];
  store.set("last", st);
  retries = 0; everPlayed = false;
  $("player").hidden = false;
  $("pName").textContent = st.name;
  const logo = $("pLogo");
  setLogo(logo, st);
  updateMediaSession();
  start();
  refreshListsState();
  // Cuenta un "clic" en Radio Browser (ayuda a ordenar por popularidad)
  api("url/" + st.stationuuid).catch(() => {});
}

function start() {
  if (!current) return;
  wantPlaying = true;
  clearTimeout(retryTimer);
  setStatus("Conectando…");
  audio.src = current.url_resolved;
  audio.play().catch((e) => {
    if (e && e.name === "NotAllowedError") { wantPlaying = false; setStatus("Pulsa ▶ para escuchar"); setToggle(false); }
  });
  setToggle(true);
}

function stop() {
  wantPlaying = false;
  clearTimeout(retryTimer); clearTimeout(stallTimer);
  audio.pause();
  // Al ser radio en directo, soltamos la conexión para que al volver suene "en vivo"
  audio.removeAttribute("src"); audio.load();
  setToggle(false);
  setStatus("En pausa");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
}

function retry(reason) {
  if (!wantPlaying || !current) return;
  clearTimeout(retryTimer);
  // Si nunca llegó a sonar, no insistimos mucho: avisamos de que no funciona
  if (!everPlayed && retries >= 2) {
    const why = current.badCodec ? "Esta emisora no funciona: su formato de audio no es compatible con el iPhone"
      : current.httpOnly ? "Esta emisora no funciona en la web app (no tiene conexión segura)"
      : "Esta emisora no funciona ahora mismo";
    stop(); setStatus(why);
    // En modo aleatorio saltamos solos a otra emisora
    if (randomMode) { toast("No funcionaba, buscando otra…"); setTimeout(() => { if (randomMode && !wantPlaying) nextRandom(); }, 1200); }
    else toast(why);
    return;
  }
  if (retries >= 8) { stop(); setStatus("No se puede conectar con esta emisora"); return; }
  const delay = Math.min(1000 * 2 ** retries, 15000);
  retries++;
  setStatus(`${reason}. Reintentando…`);
  retryTimer = setTimeout(start, delay);
}

audio.addEventListener("playing", () => {
  retries = 0; everPlayed = true; clearTimeout(stallTimer);
  setStatus("En directo"); setToggle(true);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});
audio.addEventListener("waiting", () => {
  if (!wantPlaying) return;
  setStatus("Cargando…");
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => retry("Conexión lenta"), 12000);
});
audio.addEventListener("stalled", () => { if (wantPlaying) { clearTimeout(stallTimer); stallTimer = setTimeout(() => retry("Conexión perdida"), 8000); } });
audio.addEventListener("error", () => { if (wantPlaying && audio.getAttribute("src")) retry("Error de conexión"); });
audio.addEventListener("ended", () => retry("La emisión se cortó"));
audio.addEventListener("pause", () => {
  // Pausa externa (otra app de audio, llamada…): reflejarlo en la interfaz
  if (wantPlaying && !audio.ended && audio.readyState > 0 && !audio.error) {
    wantPlaying = false; setToggle(false); setStatus("En pausa");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }
});
// ---------- Historial de escucha ----------
const APP_VERSION = "1.6";
let stats = store.get("stats", null) || { since: Date.now(), totalSec: 0, stations: {}, countries: {} };
let listenStart = 0, listenStation = null;

function flushListen() {
  if (!listenStart || !listenStation) return;
  const now = Date.now();
  const sec = Math.round((now - listenStart) / 1000);
  listenStart = now;
  if (sec <= 0 || sec > 6 * 3600) return; // descarta valores raros
  const st = listenStation;
  stats.totalSec += sec;
  const e = stats.stations[st.stationuuid] || { name: st.name, cc: st.countrycode || "", sec: 0 };
  e.name = st.name; e.sec += sec;
  stats.stations[st.stationuuid] = e;
  const cc = (st.countrycode || "").toUpperCase() || "??";
  stats.countries[cc] = (stats.countries[cc] || 0) + sec;
  store.set("stats", stats);
}
function startListen() { flushListen(); listenStation = current; listenStart = Date.now(); }
function endListen() { flushListen(); listenStart = 0; listenStation = null; }

audio.addEventListener("playing", startListen);
for (const ev of ["pause", "waiting", "stalled", "error", "ended", "emptied"]) audio.addEventListener(ev, endListen);
setInterval(flushListen, 15000);
document.addEventListener("visibilitychange", flushListen);
window.addEventListener("pagehide", flushListen);

function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function renderInfo() {
  flushListen();
  const st = Object.values(stats.stations).sort((a, b) => b.sec - a.sec);
  const co = Object.entries(stats.countries).sort((a, b) => b[1] - a[1]);
  const hours = stats.totalSec / 3600;
  $("statHours").textContent = hours >= 10 ? Math.round(hours) + " h" : (Math.round(hours * 10) / 10).toString().replace(".", ",") + " h";
  $("statStations").textContent = st.length;
  $("statCountries").textContent = co.filter(([c]) => c !== "??").length;
  $("statSince").textContent = "Desde el " + new Date(stats.since).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) + ". Total: " + fmtTime(stats.totalSec) + ".";
  const row = (a, b) => { const li = document.createElement("li"); const x = document.createElement("span"), y = document.createElement("span"); x.textContent = a; y.textContent = b; li.append(x, y); return li; };
  const ts = $("statTopStations"); ts.innerHTML = "";
  if (!st.length) ts.append(row("Aún no has escuchado ninguna emisora", ""));
  st.slice(0, 10).forEach((e) => ts.append(row(e.name, fmtTime(e.sec))));
  const tc = $("statTopCountries"); tc.innerHTML = "";
  if (!co.length) tc.append(row("Aún no hay datos", ""));
  co.forEach(([c, sec]) => {
    let n = c === "??" ? "Sin país" : c;
    try { if (c !== "??" && REGION) n = REGION.of(c) || c; } catch {}
    tc.append(row(n, fmtTime(sec)));
  });
  $("appVersion").textContent = APP_VERSION;
}
$("infoBtn").onclick = () => { renderInfo(); $("info").hidden = false; };
$("infoClose").onclick = () => { $("info").hidden = true; };
// ---------- Actualizar la app ----------
// iOS no recarga las web apps al volver a abrirlas: borramos la caché y recargamos a mano.
// Cada paso tiene un tiempo máximo, para que el botón nunca se quede "colgado".
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
async function refreshApp() {
  toast("Actualizando…");
  try {
    // 1) Descarga de nuevo los archivos saltándose la memoria del navegador
    const files = ["./", "index.html", "style.css", "app.js", "sw.js", "version.json", "manifest.webmanifest"];
    await withTimeout(Promise.all(files.map((f) => fetch(f, { cache: "reload" }).catch(() => {}))), 8000);
    // 2) Quita el service worker y su caché; se vuelven a instalar al recargar
    if ("serviceWorker" in navigator) {
      const regs = await withTimeout(navigator.serviceWorker.getRegistrations(), 3000) || [];
      await withTimeout(Promise.all(regs.map((r) => r.unregister())), 3000);
    }
    if ("caches" in window) {
      const keys = await withTimeout(caches.keys(), 3000) || [];
      await withTimeout(Promise.all(keys.map((k) => caches.delete(k))), 3000);
    }
  } catch {}
  location.replace(location.pathname + "?v=" + Date.now());
}
$("appRefresh").onclick = refreshApp;
$("updateNow").onclick = refreshApp;
// Al volver a la app, mira si hay una versión nueva publicada y ofrece actualizar
async function checkUpdate() {
  try {
    const res = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    const { version } = await res.json();
    $("updateBar").hidden = !version || version === APP_VERSION;
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
checkUpdate();

$("statReset").onclick = () => {
  if (!confirm("¿Borrar todo el historial de escucha? Las favoritas no se borran.")) return;
  stats = { since: Date.now(), totalSec: 0, stations: {}, countries: {} };
  if (listenStart) listenStart = Date.now();
  store.set("stats", stats);
  renderInfo();
};

// ---------- Emisora aleatoria (dentro de Buscar, con los filtros de país y género) ----------
let randomPool = [];
let randomKey = "";
let randomBusy = false;
function searchFilters() {
  return { name: $("qName").value.trim(), countries: [...selCountries], tags: [...selTags] };
}
function filtersText(f) {
  const parts = [];
  if (f.countries.length) parts.push(f.countries.map(countryLabel).join(", "));
  if (f.tags.length) parts.push(f.tags.join(", "));
  if (f.name) parts.push("«" + f.name + "»");
  return parts.length ? parts.join(" · ") : "todo el mundo";
}
function showRandomCard(st) {
  $("rCard").hidden = false;
  $("rName").textContent = st.name;
  $("rMeta").textContent = meta(st) || " ";
  setLogo($("rLogo"), st);
  refreshListsState();
}
async function nextRandom() {
  if (randomBusy) return;
  randomBusy = true;
  const p = searchFilters();
  const key = JSON.stringify(p);
  // Si cambian los filtros, empezamos una tanda nueva
  if (key !== randomKey) { randomPool = []; randomKey = key; }
  $("rCard").hidden = false;
  $("rName").textContent = "Buscando…";
  $("rMeta").textContent = "Aleatoria en " + filtersText(p);
  try {
    if (!randomPool.length) {
      // Todas las que cumplen los filtros, en orden aleatorio (sin repetir hasta agotarlas)
      randomPool = await multiFetch(p, "random", Math.max(50, Math.floor(300 / combos(p).length)));
      for (let i = randomPool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [randomPool[i], randomPool[j]] = [randomPool[j], randomPool[i]]; }
      if (current) randomPool = randomPool.filter((s) => s.stationuuid !== current.stationuuid || randomPool.length === 1);
    }
    const st = randomPool.shift();
    if (!st) {
      $("rName").textContent = "No hay emisoras";
      $("rMeta").textContent = "No se encontró ninguna emisora en " + filtersText(p) + ". Prueba con otros filtros.";
      return;
    }
    showRandomCard(st);
    play(st, null, true);
  } catch {
    $("rName").textContent = "Sin conexión";
    $("rMeta").textContent = "No se pudo conectar. Revisa tu conexión.";
  } finally { randomBusy = false; }
}
$("rGo").onclick = () => { document.activeElement.blur(); nextRandom(); };
$("rNext").onclick = nextRandom;
$("rFav").onclick = () => current && toggleFav(current);

window.addEventListener("online", () => { if (wantPlaying) { retries = 0; start(); } });

$("pToggle").onclick = () => (wantPlaying ? stop() : start());
$("pFav").onclick = () => current && toggleFav(current);

function step(dir) {
  if (randomMode) { if (dir > 0) nextRandom(); return; }
  const list = queue.length > 1 ? queue : favs;
  if (!list.length) return;
  const i = list.findIndex((s) => current && s.stationuuid === current.stationuuid);
  const next = list[(i + dir + list.length) % list.length];
  play(next, list);
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !current) return;
  const art = artworkUrl(current);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: current.name,
    artist: [countryName(current), (current.tags || "").split(",")[0]].filter(Boolean).join(" · "),
    album: "GilaviRadio",
    artwork: [{ src: art, sizes: "128x128" }],
  });
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, h) => { try { ms.setActionHandler(a, h); } catch {} };
  set("play", () => start());
  set("pause", () => stop());
  set("stop", () => stop());
  set("nexttrack", () => step(1));
  set("previoustrack", () => step(-1));
}

// ---------- Temporizador de apagado ----------
// Se comprueba con la hora real cada pocos segundos, para que funcione aunque iOS
// ralentice la app con la pantalla bloqueada.
let sleepEnd = 0, sleepTick = null;
function sleepLeftMin() { return Math.max(0, Math.ceil((sleepEnd - Date.now()) / 60000)); }
function updateSleepLabel() {
  const on = sleepEnd > 0;
  $("sleepBtn").classList.toggle("on", on);
  $("sleepLabel").textContent = on ? sleepLeftMin() + " min" : "Apagar";
  $("sleepState").textContent = on ? `Se apagará en ${sleepLeftMin()} min (a las ${new Date(sleepEnd).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}).` : "El temporizador está desactivado.";
  $("sleepOff").hidden = !on;
}
function setSleep(min) {
  clearInterval(sleepTick);
  if (!min) { sleepEnd = 0; updateSleepLabel(); toast("Temporizador desactivado"); return; }
  sleepEnd = Date.now() + min * 60000;
  sleepTick = setInterval(() => {
    if (Date.now() >= sleepEnd) { clearInterval(sleepTick); sleepEnd = 0; stop(); toast("Temporizador: radio apagada"); }
    updateSleepLabel();
  }, 5000);
  updateSleepLabel();
  toast(`La radio se apagará en ${min} minutos`);
}
$("sleepBtn").onclick = () => { updateSleepLabel(); $("sleepSheet").hidden = false; };
$("sleepClose").onclick = () => { $("sleepSheet").hidden = true; };
document.querySelectorAll("[data-min]").forEach((b) => b.onclick = () => { setSleep(+b.dataset.min); $("sleepSheet").hidden = true; });
$("sleepOff").onclick = () => { setSleep(0); $("sleepSheet").hidden = true; };
$("sleepCustomForm").onsubmit = (e) => {
  e.preventDefault();
  const min = Math.round(+$("sleepCustom").value);
  if (!(min >= 1 && min <= 1440)) { toast("Escribe un número de minutos entre 1 y 1440"); return; }
  store.set("sleepCustom", min);
  document.activeElement.blur();
  setSleep(min);
  $("sleepSheet").hidden = true;
};
$("sleepCustom").value = store.get("sleepCustom", "") || "";

// ---------- Arranque ----------
(async function init() {
  renderFavs();
  const last = store.get("last", null);
  if (last) {
    current = last; queue = favs.length ? favs : [last];
    $("player").hidden = false;
    $("pName").textContent = last.name;
    setLogo($("pLogo"), last);
    setStatus("Pulsa ▶ para escuchar");
    updateMediaSession();
    refreshListsState();
  }
  await loadFilters();
  const code = $("homeCountry").value;
  home.search(code ? { countrycode: code } : {});
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
