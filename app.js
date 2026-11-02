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
    tags: s.tags, codec: s.codec, bitrate: s.bitrate, hls: s.hls, clickcount: s.clickcount || 0, votes: s.votes || 0, clicktrend: s.clicktrend || 0,
    geo_lat: s.geo_lat, geo_long: s.geo_long,
    badCodec: BAD_CODECS.some((c) => (s.codec || "").toUpperCase().includes(c)),
  };
}
let listSort = (() => { try { return JSON.parse(localStorage.getItem("listSort")) || ""; } catch { return ""; } })();
// Orden de las listas (barra bajo las pestañas): votes, clickcount o clicktrend
function sortKey() { return listSort || "clickcount"; }
function sortItems(arr) { const k = sortKey(); return arr.sort((a, b) => (Number(b[k]) || 0) - (Number(a[k]) || 0)); }
async function searchStations(params, offset) {
  const data = await api("stations/search", {
    hidebroken: "false", order: sortKey(), reverse: "true",
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
// Emisoras que han sonado bien en esta sesión: se les quita el aviso de "caída" hasta reabrir la app
const workedNow = new Set();
let myVotes = store.get("myVotes", {}); // uuid → "on" | "off" (existir = ya enviado)

const isFav = (id) => favs.some((f) => f.stationuuid === id);
// Carpetas de favoritas: lista de carpetas y a qué carpeta va cada emisora
let folders = store.get("folders", []);       // [{ id, name }]
let favFolder = store.get("favFolder", {});   // uuid → id de carpeta
let curFolder = "";                           // carpeta que se está viendo ("" = todas)
function saveFolders() { store.set("folders", folders); store.set("favFolder", favFolder); }
function toggleFav(st) {
  if (isFav(st.stationuuid)) { favs = favs.filter((f) => f.stationuuid !== st.stationuuid); delete favFolder[st.stationuuid]; saveFolders(); }
  else { favs.push(st); if (curFolder) { favFolder[st.stationuuid] = curFolder; saveFolders(); } }
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
// Logos elegidos por ti (copiados de Google) — se guardan solo en este iPhone
let myLogos = store.get("myLogos", {});
function setLogo(img, st) {
  img.dataset.logoFor = st.stationuuid || st.name;
  const mine = myLogos[st.stationuuid];
  if (mine) { img.onload = null; img.onerror = () => { img.onerror = null; img.src = initialsIcon(st.name); }; img.src = mine; return; }
  const list = logoCandidates(st);
  let i = 0;
  img.dataset.logoFor = st.stationuuid || st.name;
  const next = () => {
    if (i < list.length) img.src = list[i];
    else { img.src = initialsIcon(st.name); wikidataInto(img, st); }
    i++;
  };
  img.onerror = () => { if (i <= list.length) next(); };
  img.onload = () => { if (img.naturalWidth < 8 && i <= list.length) next(); };
  next();
}

// ---------- Logos de Wikidata (solo si Radio Browser no tiene) ----------
// Wikidata es la base de datos abierta de Wikipedia. Tiene el logo oficial de las emisoras
// conocidas. Buscamos por nombre y solo aceptamos resultados descritos como radio/emisora.
const WD_API = "https://www.wikidata.org/w/api.php";
try { localStorage.removeItem("wdLogos"); } catch {}
const wdCache = (() => { try { return JSON.parse(localStorage.getItem("wdLogos2") || "{}"); } catch { return {}; } })();
let wdSaveTimer = null;
function wdSave() { clearTimeout(wdSaveTimer); wdSaveTimer = setTimeout(() => { try { localStorage.setItem("wdLogos2", JSON.stringify(wdCache)); } catch {} }, 1000); }
const wdQueue = [];
let wdActive = 0;
function wdRun(task) {
  return new Promise((res) => { wdQueue.push(() => task().then(res, () => res(null))); wdPump(); });
}
function wdPump() {
  while (wdActive < 2 && wdQueue.length) {
    const t = wdQueue.shift(); wdActive++;
    t().finally(() => { wdActive--; wdPump(); });
  }
}
function cleanStationName(n) {
  return (n || "")
    .split(/\s[-–|•:]\s|\s\(|\[/)[0]
    .replace(/\b\d{2,3}([.,]\d)?\s*(fm|mhz)\b/gi, " ")
    .replace(/\b(fm|am|mhz|online|radio online|en vivo|live|stream|hd|hq)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}
async function wdQuery(params) {
  const res = await fetch(WD_API + "?" + new URLSearchParams({ format: "json", origin: "*", ...params }));
  if (!res.ok) throw new Error("wd");
  return res.json();
}
const RADIO_WORDS = /radio|r[aá]dio|emisora|station|broadcast|cadena|estaci[oó]n|sender|rundfunk/i;
async function wdFindLogo(name, cc) {
  const r = await wdQuery({ action: "wbsearchentities", search: name, language: "es", uselang: "es", type: "item", limit: "6" });
  const hits = (r.search || []).filter((h) => RADIO_WORDS.test(h.description || "") || RADIO_WORDS.test(h.label || ""));
  if (!hits.length) return "";
  const e = await wdQuery({ action: "wbgetentities", ids: hits.map((h) => h.id).join("|"), props: "claims" });
  const val = (claims, p) => claims[p] && claims[p][0] && claims[p][0].mainsnak.datavalue && claims[p][0].mainsnak.datavalue.value;
  const withLogo = [];
  for (const h of hits) {
    const claims = (e.entities && e.entities[h.id] && e.entities[h.id].claims) || {};
    const logo = val(claims, "P154");
    if (logo) withLogo.push({ logo, country: (val(claims, "P17") || {}).id });
  }
  if (!withLogo.length) return "";
  // Si sabemos el país de la emisora, el de Wikidata tiene que coincidir (evita logos de otra emisora con el mismo nombre)
  let pick = withLogo[0];
  if (cc) {
    const ids = [...new Set(withLogo.map((w) => w.country).filter(Boolean))];
    const iso = {};
    if (ids.length) {
      const c = await wdQuery({ action: "wbgetentities", ids: ids.join("|"), props: "claims" });
      for (const id of ids) iso[id] = (val((c.entities[id] || {}).claims || {}, "P297") || "").toUpperCase();
    }
    pick = withLogo.find((w) => !w.country || iso[w.country] === cc);
    if (!pick) return "";
  }
  return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(pick.logo) + "?width=128";
}
async function wikidataLogo(st) {
  const full = cleanStationName(st.name);
  if (!full || full.length < 3) return "";
  const cc = (st.countrycode || "").toUpperCase();
  const key = cc + "|" + full;
  if (key in wdCache) return wdCache[key];
  let url = await wdRun(() => wdFindLogo(full, cc));
  if (url === null) return ""; // fallo de red: no lo guardamos para reintentar otro día
  wdCache[key] = url || "";
  wdSave();
  return url || "";
}
async function wikidataInto(img, st) {
  const id = img.dataset.logoFor;
  const url = await wikidataLogo(st);
  if (!url || img.dataset.logoFor !== id) return;
  img.onload = null;
  img.onerror = () => { img.onerror = null; img.src = initialsIcon(st.name); };
  img.src = url;
}
function artworkUrl(st) {
  if (myLogos[st.stationuuid]) return myLogos[st.stationuuid];
  const list = logoCandidates(st);
  return list.length ? list[1] : new URL("icons/icon-512.png", location.href).href;
}
const REGION = (() => { try { return new Intl.DisplayNames(["es"], { type: "region" }); } catch { return null; } })();
function countryName(st) {
  try { return (st.countrycode && REGION && REGION.of(st.countrycode)) || st.country; } catch { return st.country; }
}
function meta(st) {
  const tags = (st.tags || "").split(",").filter(Boolean).slice(0, 2).join(", ");
  const dist = st.distKm != null ? "a " + (st.distKm < 1 ? "menos de 1" : Math.round(st.distKm)) + " km" : "";
  return [dist, countryName(st), tags, st.bitrate ? st.bitrate + " kbps" : ""].filter(Boolean).join(" · ");
}

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "").replace(".", ",") + " M";
  if (n >= 1e4) return Math.round(n / 1e3) + " mil";
  return n.toLocaleString("es-ES");
}
// Indicadores de popularidad de Radio Browser: votos, escuchas (clics) y tendencia de escuchas
// Mano (me gusta) monocroma: usa el color del texto
const THUMB_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L13.17 1 6.59 7.59A1.96 1.96 0 0 0 6 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
const HEADPHONES_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-1a7 7 0 0 1 14 0v1h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z"/></svg>';
function fillPop(el, st) {
  el.textContent = "";
  if (st.votes == null && st.clickcount == null) return false;
  const t = Number(st.clicktrend) || 0;
  const hand = document.createElement("span");
  hand.className = "voteIcon";
  hand.setAttribute("aria-label", "votos");
  hand.innerHTML = THUMB_SVG;
  const ears = document.createElement("span");
  ears.className = "voteIcon";
  ears.setAttribute("aria-label", "escuchas");
  ears.innerHTML = HEADPHONES_SVG;
  el.append(hand, fmtNum(st.votes) + " · ", ears, fmtNum(st.clickcount) + " · ");
  const tr = document.createElement("span");
  tr.className = t > 0 ? "trendUp" : t < 0 ? "trendDown" : "";
  tr.textContent = t > 0 ? "▲ +" + fmtNum(t) : t < 0 ? "▼ −" + fmtNum(-t) : "= 0";
  el.append(tr);
  return true;
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
  main.innerHTML = `<div class="stName"></div><div class="stMeta"></div><div class="stPop"></div>`;
  main.children[0].textContent = st.name;
  main.children[1].textContent = meta(st);
  if (!fillPop(main.children[2], st)) main.children[2].remove();
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
    paintVote();
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
  return {
    search(params) { state.params = params; return load(true); },
    reload() { if (state.params) load(true); },
  };
}

// ---------- Pestañas ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  };
});
// ---------- Recientes: las 10 últimas emisoras escuchadas ----------
let recent = store.get("recent", []);
function addRecent(st) {
  recent = [{ ...st, playedAt: Date.now() }, ...recent.filter((r) => r.stationuuid !== st.stationuuid)].slice(0, 10);
  store.set("recent", recent);
  renderRecent();
}
function agoText(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "Ahora mismo";
  if (m < 60) return "Hace " + m + " min";
  const h = Math.round(m / 60);
  if (h < 24) return "Hace " + h + " h";
  const d = Math.round(h / 24);
  return d === 1 ? "Ayer" : "Hace " + d + " días";
}
function renderRecent() {
  const ul = $("recentList");
  ul.innerHTML = "";
  recent.forEach((st) => {
    const li = stationItem(st, recent);
    const m = li.querySelector(".stMeta");
    if (m && st.playedAt) m.textContent = agoText(st.playedAt) + " · " + m.textContent;
    ul.append(li);
  });
  $("recentEmpty").hidden = recent.length > 0;
  $("recentClear").hidden = !recent.length;
  refreshListsState();
}
$("recentClear").onclick = () => { recent = []; store.set("recent", recent); renderRecent(); };
document.querySelector('.tabs button[data-tab="recent"]').addEventListener("click", renderRecent);
setTimeout(renderRecent, 0); // cuando ya esté listo el reproductor

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
  $("qCountryClear").hidden = !selCountries.length;
  $("qTagClear").hidden = !selTags.length;
}
$("qCountryClear").onclick = () => { selCountries = []; store.set("selCountries", selCountries); updatePickButtons(); };
$("qTagClear").onclick = () => { selTags = []; store.set("selTags", selTags); updatePickButtons(); };

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
// ---------- Emisoras cerca de mí (100 km) ----------
const NEAR_KM = 100;
function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function searchNear(near) {
  const data = await api("stations/search", {
    hidebroken: "false", has_geo_info: "true", order: "clickcount", reverse: "true", limit: 1000,
    geo_lat: near.lat.toFixed(4), geo_long: near.lon.toFixed(4), geo_distance: String(NEAR_KM * 1000),
  });
  const seen = new Set(), items = [];
  for (const s of data) {
    if (!playable(s) || seen.has(s.stationuuid) || s.geo_lat == null || s.geo_long == null) continue;
    const d = distKm(near.lat, near.lon, Number(s.geo_lat), Number(s.geo_long));
    if (!(d <= NEAR_KM)) continue;
    seen.add(s.stationuuid);
    items.push({ ...slim(s), distKm: d });
  }
  items.sort((x, y) => x.distKm - y.distKm);
  return { items, full: false };
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("nogeo"));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => rej(e), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  });
}
async function searchMulti(f, offset) {
  if (f.near) return offset > 0 ? { items: [], full: false } : searchNear(f.near);
  const cb = combos(f);
  if (cb.length === 1) return searchStations(cb[0], offset);
  if (offset > 0) return { items: [], full: false };
  const items = sortItems(await multiFetch(f, sortKey(), 100));
  return { items, full: false };
}
updatePickButtons();

// ---------- Populares y búsqueda ----------
const home = pagedList("homeList", "homeMore");
const results = pagedList("searchList", "searchMore", searchMulti);
function paintSortBar() {
  document.querySelectorAll("#sortBar button").forEach((b) => b.classList.toggle("on", b.dataset.sort === listSort));
}
document.querySelectorAll("#sortBar button").forEach((b) => {
  b.onclick = () => {
    // Pulsar el botón activo lo quita (vuelve a tu orden en Favoritas y a escuchas en las demás)
    listSort = listSort === b.dataset.sort ? "" : b.dataset.sort;
    store.set("listSort", listSort);
    paintSortBar();
    renderFavs();
    home.reload();
    results.reload();
  };
});
paintSortBar();

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
let lastSearchKind = "search";
$("nearGo").onclick = async () => {
  lastSearchKind = "near";
  document.activeElement.blur();
  $("rCard").hidden = true;
  const ul = $("searchList");
  ul.innerHTML = `<li class="msg">Buscando tu ubicación…</li>`;
  $("searchMore").hidden = true;
  let near;
  try { near = await getPosition(); } catch (e) {
    ul.innerHTML = `<li class="msg">${e && e.code === 1
      ? "No tengo permiso para ver tu ubicación. Actívalo en Ajustes → Privacidad y seguridad → Localización → Sitios web de Safari."
      : "No se pudo saber tu ubicación. Inténtalo de nuevo."}</li>`;
    return;
  }
  await results.search({ near });
  if (!ul.querySelector(".st")) ul.innerHTML = `<li class="msg">No hay emisoras con ubicación conocida a menos de ${NEAR_KM} km de ti.</li>`;
  else toast("Emisoras a menos de " + NEAR_KM + " km, de la más cercana a la más lejana");
};
$("searchForm").onsubmit = (e) => {
  lastSearchKind = "search";
  e.preventDefault();
  document.activeElement.blur();
  $("rCard").hidden = true;
  results.search(searchFilters());
};

// ---------- Favoritas ----------
let favSorting = false;
// Mientras editas el orden, los cambios no se guardan hasta pulsar Guardar
let favSnapshot = null;
function saveFavOrder() { if (!favSorting) store.set("favs", favs); renderFavs(); }
// Arrastrar y soltar: se coge la emisora por el asa ≡ y se mueve arriba o abajo
function startFavDrag(e, li) {
  e.preventDefault();
  const ul = $("favsList");
  const handle = e.currentTarget;
  let startY = e.clientY;
  li.classList.add("dragging");
  try { handle.setPointerCapture(e.pointerId); } catch {}
  let scrollTimer = null;
  const onMove = (ev) => {
    ev.preventDefault();
    const y = ev.clientY;
    li.style.transform = `translateY(${y - startY}px)`;
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (y < r.top + r.height / 2) { ul.insertBefore(li, prev); startY -= r.height; li.style.transform = `translateY(${y - startY}px)`; }
    }
    if (next) {
      const r = next.getBoundingClientRect();
      if (y > r.top + r.height / 2) { ul.insertBefore(next, li); startY += r.height; li.style.transform = `translateY(${y - startY}px)`; }
    }
    // Desplaza la pantalla si arrastras cerca de los bordes
    clearInterval(scrollTimer);
    const sc = ul.closest(".scroll"), box = sc.getBoundingClientRect();
    const edge = y < box.top + 50 ? -8 : y > box.bottom - 50 ? 8 : 0;
    if (edge) scrollTimer = setInterval(() => { sc.scrollBy(0, edge); startY -= edge; li.style.transform = `translateY(${y - startY}px)`; }, 16);
  };
  const onUp = () => {
    clearInterval(scrollTimer);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    li.classList.remove("dragging");
    li.style.transform = "";
    // Reordena solo las emisoras visibles (puede haber una carpeta elegida), dejando las demás en su sitio
    const order = [...ul.children].map((x) => x.dataset.id);
    const slots = [], items = order.map((id) => favs.find((f) => f.stationuuid === id));
    favs.forEach((f, i) => { if (order.includes(f.stationuuid)) slots.push(i); });
    slots.forEach((s, k) => { favs[s] = items[k]; });
    saveFavOrder();
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}
function renderFavs() {
  const ul = $("favsList");
  ul.innerHTML = "";
  // Con un orden elegido en la barra se muestran ordenadas, sin tocar tu orden guardado
  renderFolderBar();
  const inFolder = curFolder ? favs.filter((f) => favFolder[f.stationuuid] === curFolder) : favs;
  const shown = listSort && !favSorting ? sortItems(inFolder.slice()) : inFolder;
  shown.forEach((st, i) => {
    const li = stationItem(st, shown);
    if ((st.lastcheckok === 0 || st.lastcheckok === "0") && !workedNow.has(st.stationuuid)) {
      const w = document.createElement("div");
      w.className = "stDown";
      const since = st.lastcheckoktime ? new Date(st.lastcheckoktime.endsWith("Z") ? st.lastcheckoktime : st.lastcheckoktime.replace(" ", "T") + "Z") : null;
      const days = since && !isNaN(since) ? Math.floor((Date.now() - since) / 86400000) : null;
      w.textContent = "⚠️ Parece caída" + (days == null ? "" : days < 1 ? " · funcionaba hoy" : days === 1 ? " · funcionaba ayer" : ` · no funciona desde hace ${days} días`);
      const main = li.querySelector(".stMain");
      if (main) main.append(w);
      li.classList.add("down");
    }
    if (favSorting) {
      // En modo ordenar: asa para arrastrar en lugar de la estrella, y tocar no reproduce
      li.onclick = null;
      li.querySelector(".favBtn").remove();
      const h = document.createElement("div");
      h.className = "dragHandle";
      h.setAttribute("aria-label", "Arrastrar para mover");
      h.textContent = "≡";
      h.addEventListener("pointerdown", (e) => startFavDrag(e, li));
      li.append(h);
    }
    ul.append(li);
  });
  $("favsEmpty").hidden = favs.length > 0;
  $("folderEmpty").hidden = !(favs.length && curFolder && !shown.length);
  if (shown.length < 2) favSorting = false;
  $("favBar").hidden = shown.length < 2;
  $("favSortBtn").hidden = favSorting;
  $("favSortTools").hidden = !favSorting;
  $("favHelp").hidden = !favSorting;
  ul.classList.toggle("sorting", favSorting);
  refreshListsState();
}
function renderFolderBar() {
  const bar = $("folderBar");
  bar.hidden = !favs.length;
  bar.innerHTML = "";
  if (curFolder && !folders.some((f) => f.id === curFolder)) curFolder = "";
  const chip = (label, id, extra) => {
    const b = document.createElement("button");
    b.className = "chip" + (id === curFolder ? " on" : "") + (extra || "");
    b.textContent = label;
    b.onclick = () => {
      if (id === null) return newFolder();
      if (id && id === curFolder) return editFolder(id); // tocar la carpeta abierta: renombrar o borrar
      curFolder = id; favSorting = false; renderFavs(); $("favsList").closest(".scroll").scrollTop = 0;
    };
    bar.append(b);
  };
  chip("Todas", "");
  folders.forEach((f) => chip("📁 " + f.name, f.id));
  chip("+ Carpeta", null, " addFolder");
}
function newFolder() {
  const name = (prompt("Nombre de la carpeta nueva (por ejemplo Noticias, Música, Deportes):") || "").trim();
  if (!name) return;
  const id = "f" + Date.now().toString(36);
  folders.push({ id, name: name.slice(0, 30) });
  saveFolders();
  curFolder = id; renderFavs();
  toast("Carpeta creada. Para meter emisoras, abre su ficha (toca el nombre en el reproductor) y elige la carpeta.");
}
function editFolder(id) {
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  const name = prompt("Nuevo nombre de la carpeta. Déjalo vacío para borrarla.", f.name);
  if (name === null) return;
  if (name.trim()) { f.name = name.trim().slice(0, 30); saveFolders(); renderFavs(); return; }
  if (!confirm(`¿Borrar la carpeta "${f.name}"? Las emisoras siguen en tus favoritas.`)) return;
  folders = folders.filter((x) => x.id !== id);
  for (const k in favFolder) if (favFolder[k] === id) delete favFolder[k];
  saveFolders(); curFolder = ""; renderFavs();
}
function paintFolderSelect(st) {
  const row = $("stFolderRow"), sel = $("stFolder");
  const show = !!st && isFav(st.stationuuid);
  row.hidden = !show;
  if (!show) return;
  sel.innerHTML = `<option value="">Sin carpeta</option>` + folders.map((f) => `<option value="${f.id}"></option>`).join("") + `<option value="__new">+ Carpeta nueva…</option>`;
  [...sel.options].forEach((o) => { const f = folders.find((x) => x.id === o.value); if (f) o.textContent = f.name; });
  sel.value = favFolder[st.stationuuid] || "";
}
$("stFolder").onchange = () => {
  const st = stShown, sel = $("stFolder");
  if (!st) return;
  if (sel.value === "__new") {
    const name = (prompt("Nombre de la carpeta nueva:") || "").trim();
    if (name) { const id = "f" + Date.now().toString(36); folders.push({ id, name: name.slice(0, 30) }); favFolder[st.stationuuid] = id; }
  } else if (sel.value) favFolder[st.stationuuid] = sel.value;
  else delete favFolder[st.stationuuid];
  saveFolders(); paintFolderSelect(st); renderFavs();
};
$("favSortBtn").onclick = () => { favSnapshot = favs.slice(); favSorting = true; renderFavs(); };
$("favDone").onclick = () => { favSorting = false; favSnapshot = null; store.set("favs", favs); renderFavs(); toast("Orden guardado"); };
$("favCancel").onclick = () => { if (favSnapshot) favs = favSnapshot; favSnapshot = null; favSorting = false; renderFavs(); };
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
function setPop(st) {
  $("pPop").hidden = !fillPop($("pPop"), st);
}
function play(st, list, fromRandom) {
  randomMode = !!fromRandom;
  current = st;
  queue = list && list.length ? list : [st];
  store.set("last", st);
  addRecent(st);
  retries = 0; everPlayed = false;
  $("player").hidden = false;
  $("pName").textContent = st.name;
  setPop(st);
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

let stallAt = 0;
function armStall(reason, ms) {
  clearTimeout(stallTimer);
  stallAt = audio.currentTime;
  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (!wantPlaying) return;
    if (!audio.paused && audio.currentTime > stallAt + 0.5) return; // sigue sonando
    retry(reason);
  }, ms);
}
audio.addEventListener("playing", () => {
  if (current && !workedNow.has(current.stationuuid)) {
    workedNow.add(current.stationuuid);
    if (current.lastcheckok === 0 || current.lastcheckok === "0" || favs.some((f) => f.stationuuid === current.stationuuid && (f.lastcheckok === 0 || f.lastcheckok === "0"))) renderFavs();
  }
  retries = 0; everPlayed = true; clearTimeout(stallTimer);
  setStatus(liveStatus()); setToggle(true);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});
audio.addEventListener("waiting", () => {
  if (!wantPlaying) return;
  setStatus("Cargando…");
  armStall("Conexión lenta", 12000);
});
// Safari lanza "stalled" a menudo en directo aunque el audio siga sonando con lo que tiene guardado.
// Antes eso reiniciaba la emisora (corte de unos segundos). Ahora solo se reintenta si el audio
// de verdad se ha parado: si avanza, no tocamos nada.
audio.addEventListener("stalled", () => { if (wantPlaying) armStall("Conexión perdida", 10000); });
audio.addEventListener("timeupdate", () => {
  if (stallTimer && audio.currentTime > stallAt + 0.5) { clearTimeout(stallTimer); stallTimer = null; if (!audio.paused) setStatus(liveStatus()); }
});
audio.addEventListener("error", () => { if (wantPlaying && audio.getAttribute("src")) retry("Error de conexión"); });
audio.addEventListener("ended", () => retry("La emisión se cortó"));
audio.addEventListener("pause", () => {
  // Pausa externa (otra app de audio, llamada…): reflejarlo en la interfaz
  if (wantPlaying && !audio.ended && audio.readyState > 0 && !audio.error) {
    wantPlaying = false; setToggle(false); setStatus("En pausa");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }
});
// ---------- Hora local de la emisora ----------
const tzOffCache = {};
function tzOffsetMin(tz) {
  if (tz in tzOffCache) return tzOffCache[tz];
  try {
    const d = new Date();
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(d).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return (tzOffCache[tz] = Math.round((asUtc - d.getTime()) / 60000));
  } catch { return (tzOffCache[tz] = null); }
}
function stationTz(st) {
  const v = typeof TZ_BY_COUNTRY !== "undefined" && TZ_BY_COUNTRY[(st.countrycode || "").toUpperCase()];
  if (!v) return null;
  if (typeof v === "string") return { tz: v, approx: false };
  const lat = parseFloat(st.geo_lat), lon = parseFloat(st.geo_long);
  // País con varias zonas: la más cercana a la emisora si sabemos dónde está; si no, la principal
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
    // Solo avisamos de "aprox." si las zonas del país se separan más de una hora (EE. UU., Brasil…)
    const offs = v.map((z) => tzOffsetMin(z[0])).filter((x) => x !== null);
    return { tz: v[0][0], approx: offs.length > 1 && Math.max(...offs) - Math.min(...offs) > 60 };
  }
  let best = v[0], bestD = Infinity;
  for (const z of v) {
    const dLon = (z[2] - lon) * Math.cos((lat * Math.PI) / 180), dLat = z[1] - lat;
    const d = dLon * dLon + dLat * dLat;
    if (d < bestD) { bestD = d; best = z; }
  }
  return { tz: best[0], approx: false };
}
function stationLocalTime(st) {
  const z = st && stationTz(st);
  if (!z) return "";
  try {
    const t = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: z.tz });
    return `🕐 ${t} en ${countryName(st)}${z.approx ? " (aprox.)" : ""}`;
  } catch { return ""; }
}
function liveStatus() {
  const t = stationLocalTime(current);
  return t || "En directo";
}
// Actualiza la hora cada 20 s mientras suena
setInterval(() => {
  if (wantPlaying && current && !audio.paused && audio.readyState > 2) setStatus(liveStatus());
}, 20000);

// ---------- Ficha de la emisora (toda la información de Radio Browser) ----------
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s.endsWith("Z") ? s : s.replace(" ", "T") + "Z");
  return isNaN(d) ? s : d.toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
let stShown = null;
async function openStationInfo(st) {
  if (!st) return;
  stShown = st;
  paintFolderSelect(st);
  showStTab("rel");
  showRelated(st);
  $("stGoogle").href = googleLogoUrl(st);
  $("stLogoReset").hidden = !myLogos[st.stationuuid];
  $("stSheet").hidden = false;
  $("stName").textContent = st.name;
  setLogo($("stLogo"), st);
  const ul = $("stInfo");
  ul.innerHTML = `<li><span class="v">Cargando…</span></li>`;
  let d = st;
  try { const r = await api("stations/byuuid/" + st.stationuuid); if (r && r[0]) d = r[0]; } catch {}
  const yes = (v) => (v === 1 || v === true || v === "1" ? "Sí" : v === 0 || v === false || v === "0" ? "No" : "");
  const z = stationTz(d);
  const rows = [
    ["Hora local", stationLocalTime(d).replace("🕐 ", "")],
    ["País", countryName(d)],
    ["Región / provincia", d.state],
    ["Idioma", d.language],
    ["Géneros / etiquetas", (d.tags || "").split(",").filter(Boolean).join(", ")],
    ["Página web", d.homepage ? { link: d.homepage } : ""],
    ["Formato", d.codec],
    ["Calidad", d.bitrate ? d.bitrate + " kbps" : ""],
    ["Emisión HLS", yes(d.hls)],
    ["Dirección del directo", d.url_resolved || d.url ? { link: d.url_resolved || d.url } : ""],
    ["Error de seguridad (SSL)", d.ssl_error ? "Sí" : d.ssl_error === 0 ? "No" : ""],
    ["Funcionaba en la última comprobación", yes(d.lastcheckok)],
    ["Última comprobación", fmtDate(d.lastchecktime_iso8601 || d.lastchecktime)],
    ["Último funcionamiento correcto", fmtDate(d.lastcheckoktime_iso8601 || d.lastcheckoktime)],
    ["Último cambio de datos", fmtDate(d.lastchangetime_iso8601 || d.lastchangetime)],
    ["Clics (popularidad)", d.clickcount != null ? String(d.clickcount) : ""],
    ["Tendencia de clics", d.clicktrend != null ? (d.clicktrend > 0 ? "▲ +" : d.clicktrend < 0 ? "▼ " : "") + d.clicktrend : ""],
    ["Votos", d.votes != null ? String(d.votes) : ""],
    ["Zona horaria", z ? z.tz : ""],
    ["Coordenadas", isFinite(parseFloat(d.geo_lat)) && isFinite(parseFloat(d.geo_long)) ? { link: `https://www.openstreetmap.org/?mlat=${d.geo_lat}&mlon=${d.geo_long}#map=8/${d.geo_lat}/${d.geo_long}`, text: `${(+d.geo_lat).toFixed(3)}, ${(+d.geo_long).toFixed(3)} (ver mapa)` } : ""],
    ["Identificador", d.stationuuid],
  ];
  ul.innerHTML = "";
  for (const [k, v] of rows) {
    if (!v) continue;
    const li = document.createElement("li");
    const a = document.createElement("span"); a.className = "k"; a.textContent = k;
    const b = document.createElement("span"); b.className = "v";
    if (typeof v === "object" && /^https?:\/\//i.test(v.link)) {
      const link = document.createElement("a");
      link.href = v.link; link.target = "_blank"; link.rel = "noopener"; link.textContent = v.text || v.link;
      b.append(link);
    } else b.textContent = typeof v === "object" ? v.text || v.link : v;
    li.append(a, b); ul.append(li);
  }
}
$("stClose").onclick = () => { $("stSheet").hidden = true; };
function showStTab(which) {
  document.querySelectorAll(".stTabs button").forEach((b) => b.classList.toggle("active", b.dataset.st === which));
  $("stPaneInfo").hidden = which !== "info";
  $("stPaneRel").hidden = which !== "rel";
  $("stSheet").scrollTop = 0;
}
document.querySelectorAll(".stTabs button").forEach((b) => { b.onclick = () => showStTab(b.dataset.st); });

// ---------- Emisoras relacionadas ----------
// Radio Browser no tiene "relacionadas", así que las deducimos:
// 1) misma cadena (el nombre empieza igual: COPE…, Onda Cero…)  2) mismo género, primero del mismo país.
const BRAND_SKIP = /^(radio|r[aá]dio|la|el|los|las|the|fm|am|emisora|online|super|top|my|mi|tu|best|hit|hits|music|musica|música|\d+)$/i;
const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function brandOf(st) {
  const words = cleanStationName(st.name).split(" ").filter(Boolean);
  if (!words.length) return "";
  if (words[0].length >= 3 && !BRAND_SKIP.test(words[0])) return words[0];
  if (words.length >= 2 && !BRAND_SKIP.test(words[1])) return words.slice(0, 2).join(" ");
  return "";
}
async function relatedStations(st) {
  const cc = (st.countrycode || "").toUpperCase();
  const tags = (st.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t && t.length > 1).slice(0, 2);
  const brand = brandOf(st);
  const q = (p) => api("stations/search", { hidebroken: "false", order: "clickcount", reverse: "true", ...p }).catch(() => []);
  const reqs = [];
  reqs.push(brand ? q({ name: brand, limit: 40 }) : Promise.resolve([]));
  for (const t of tags) {
    if (cc) reqs.push(q({ tag: t, tagExact: "true", countrycode: cc, limit: 25 }));
    reqs.push(q({ tag: t, tagExact: "true", limit: 25 }));
  }
  if (!tags.length && cc) reqs.push(q({ countrycode: cc, limit: 25 }));
  const [brandList, ...rest] = await Promise.all(reqs);
  const seen = new Set([st.stationuuid]);
  const seenName = new Set([norm(st.name)]);
  const take = (s) => {
    if (!playable(s) || seen.has(s.stationuuid) || seenName.has(norm(s.name))) return false;
    seen.add(s.stationuuid); seenName.add(norm(s.name)); return true;
  };
  const nb = norm(brand);
  const sameBrand = brandList.filter((s) => nb && (norm(cleanStationName(s.name)) + " ").startsWith(nb + " ")).filter(take).slice(0, 8).map(slim);
  const pool = rest.flat();
  pool.sort((x, y) => ((y.countrycode || "").toUpperCase() === cc) - ((x.countrycode || "").toUpperCase() === cc) || (y.clickcount || 0) - (x.clickcount || 0));
  const similar = pool.filter(take).slice(0, 20 - sameBrand.length).map(slim);
  return [...sameBrand, ...similar];
}
async function showRelated(st) {
  const ul = $("stRelated");
  ul.innerHTML = `<li class="msg">Buscando emisoras relacionadas…</li>`;
  let list = [];
  try { list = await relatedStations(st); } catch {}
  if (stShown !== st) return;
  ul.innerHTML = "";
  if (!list.length) { ul.innerHTML = `<li class="msg">No he encontrado emisoras relacionadas.</li>`; return; }
  for (const r of list) {
    const li = stationItem(r, list);
    li.onclick = () => { $("stSheet").hidden = true; play(r, list); };
    ul.append(li);
  }
  refreshListsState();
}

// ---------- Logo propio desde Google ----------
// Enlace normal (no window.open): en la app de pantalla de inicio del iPhone window.open puede no hacer nada
function googleLogoUrl(st) {
  return "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent('logo cuadrado "' + st.name + '"');
}
function blobToLogo(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      const S = 160, c = document.createElement("canvas");
      c.width = c.height = S;
      const k = Math.min(S / im.naturalWidth, S / im.naturalHeight);
      const w = im.naturalWidth * k, h = im.naturalHeight * k;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, S, S);
      g.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    im.src = url;
  });
}
function saveMyLogo(st, src) {
  if (src) myLogos[st.stationuuid] = src; else delete myLogos[st.stationuuid];
  store.set("myLogos", myLogos);
  // Repinta todas las imágenes de esa emisora (listas, reproductor, ficha)
  document.querySelectorAll("img").forEach((img) => { if (img.dataset.logoFor === st.stationuuid) setLogo(img, st); });
  if (current && current.stationuuid === st.stationuuid) updateMediaSession();
  $("stLogoReset").hidden = !src;
}
$("stPaste").onclick = async () => {
  const st = stShown;
  if (!st) return;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) { saveMyLogo(st, await blobToLogo(await it.getType(type))); toast("Logo guardado"); return; }
        if (it.types.includes("text/plain")) {
          const txt = (await (await it.getType("text/plain")).text()).trim();
          if (/^https?:\/\/\S+$/i.test(txt)) { saveMyLogo(st, txt.replace(/^http:/i, "https:")); toast("Logo guardado"); return; }
        }
      }
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      const txt = (await navigator.clipboard.readText()).trim();
      if (/^https?:\/\/\S+$/i.test(txt)) { saveMyLogo(st, txt.replace(/^http:/i, "https:")); toast("Logo guardado"); return; }
    }
    toast("No hay ninguna imagen copiada. En Google, mantén el dedo sobre el logo y pulsa Copiar.");
  } catch {
    toast("No se pudo leer lo copiado. Pulsa \"Pegar\" cuando el iPhone lo pregunte.");
  }
};
$("stLogoReset").onclick = () => { if (stShown) { saveMyLogo(stShown, null); toast("Vuelve el logo de antes"); } };
$("pLogo").addEventListener("click", () => openStationInfo(current));
document.querySelector(".pInfo").addEventListener("click", () => openStationInfo(current));
$("rLogo").addEventListener("click", () => openStationInfo(current));

// ---------- Historial de escucha ----------
const APP_VERSION = "6.9";
// ---------- Compartir emisora ----------
// El enlace lleva el identificador de la emisora: https://…/GilaviRadio/?emisora=<id>
function shareUrl(st) {
  return new URL("./?emisora=" + encodeURIComponent(st.stationuuid), location.href.split("?")[0]).href;
}
$("stShare").onclick = async () => {
  const st = stShown;
  if (!st) return;
  const url = shareUrl(st);
  const text = "Escucha " + st.name + " en GilaviRadio";
  try {
    if (navigator.share) { await navigator.share({ title: st.name, text, url }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text + ": " + url); toast("Enlace copiado"); }
  catch { prompt("Copia este enlace:", url); }
};
// Si la app se abre desde un enlace compartido, prepara esa emisora en el reproductor
async function openSharedStation() {
  const id = new URLSearchParams(location.search).get("emisora");
  if (!id) return;
  history.replaceState(null, "", location.pathname);
  try {
    const r = await api("stations/byuuid/" + encodeURIComponent(id));
    if (!r || !r[0] || !playable(r[0])) { toast("No he encontrado la emisora compartida"); return; }
    const st = slim(r[0]);
    current = st; queue = [st];
    $("player").hidden = false;
    $("pName").textContent = st.name;
    setPop(st); setLogo($("pLogo"), st);
    setStatus("Te han compartido esta emisora. Pulsa ▶");
    updateMediaSession(); refreshListsState();
    toast("Emisora compartida: " + st.name + ". Pulsa ▶ para escucharla");
  } catch { toast("No se pudo cargar la emisora compartida"); }
}
// Buscar: plegar el buscador al bajar por la lista
(() => {
  const tab = $("tab-search"), sc = tab.querySelector(".scroll");
  const fold = (on) => {
    if (tab.classList.contains("folded") === on) return;
    if (on) {
      const f = searchFilters();
      $("searchSummary").textContent = lastSearchKind === "near" ? "Cerca de mí" : lastSearchKind === "random" ? "Aleatoria en " + filtersText(f) : filtersText(f);
    }
    tab.classList.toggle("folded", on);
    $("searchShow").hidden = !on;
  };
  sc.addEventListener("scroll", () => { if (sc.scrollTop > 40 && sc.scrollHeight > sc.clientHeight + 120) fold(true); }, { passive: true });
  $("searchShow").onclick = () => { fold(false); sc.scrollTop = 0; };
})();
// ---------- Mapa de emisoras ----------
// Leaflet (mapas libres) va dentro de la app, en vendor/. El fondo es OpenStreetMap (gratis, sin clave).
// Radio Browser no busca por zona del mapa, así que buscamos alrededor del centro de lo que ves.
let map = null, mapLayer = null;
const mapMarkers = new Map();
const mapStations = [];
function loadLeaflet() {
  if (window.L && L.markerClusterGroup) return Promise.resolve();
  const add = (tag, attrs) => new Promise((res, rej) => { const el = document.createElement(tag); Object.assign(el, attrs); el.onload = res; el.onerror = rej; document.head.append(el); });
  return Promise.all([
    add("link", { rel: "stylesheet", href: "vendor/leaflet/leaflet.css" }),
    add("link", { rel: "stylesheet", href: "vendor/leaflet/MarkerCluster.css" }),
    add("link", { rel: "stylesheet", href: "vendor/leaflet/MarkerCluster.Default.css" }),
  ]).then(() => add("script", { src: "vendor/leaflet/leaflet.js" }))
    .then(() => add("script", { src: "vendor/leaflet/leaflet.markercluster.js" }));
}
function addMapStations(list) {
  let added = 0;
  for (const s of list) {
    const lat = Number(s.geo_lat), lon = Number(s.geo_long);
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0) || mapMarkers.has(s.stationuuid) || !playable(s)) continue;
    const st = slim(s);
    const m = L.circleMarker([lat, lon], { radius: 9, color: "#0f172a", weight: 2, fillColor: "#fb923c", fillOpacity: 0.95, st });
    m.on("click", () => showMapList([st], m.getLatLng()));
    mapMarkers.set(st.stationuuid, m);
    mapStations.push(st);
    mapLayer.addLayer(m);
    added++;
  }
  $("mapHint").textContent = `${mapMarkers.size} emisoras en el mapa. Solo salen las que tienen ubicación conocida. Mueve o acerca el mapa para cargar más.`;
  return added;
}
let mapTimer = null, mapWorldLoaded = false;
async function loadMapArea() {
  if (!map) return;
  const c = map.getCenter(), b = map.getBounds();
  const r = Math.min(2500, Math.max(20, distKm(c.lat, c.lng, b.getNorth(), b.getEast())));
  try {
    if (map.getZoom() <= 3) {
      if (mapWorldLoaded) return;
      mapWorldLoaded = true;
      addMapStations(await api("stations/search", { hidebroken: "false", has_geo_info: "true", order: "clickcount", reverse: "true", limit: 1500 }));
    } else {
      addMapStations(await api("stations/search", {
        hidebroken: "false", has_geo_info: "true", order: "clickcount", reverse: "true", limit: 500,
        geo_lat: c.lat.toFixed(4), geo_long: c.lng.toFixed(4), geo_distance: String(Math.round(r * 1000)),
      }));
    }
  } catch { $("mapHint").textContent = "No se pudieron cargar emisoras. Revisa tu conexión."; }
}
async function openMap() {
  $("mapSheet").hidden = false;
  document.body.classList.add("mapOpen");
  try { await loadLeaflet(); } catch { $("mapHint").textContent = "No se pudo cargar el mapa."; return; }
  if (!map) {
    const v = store.get("mapView", { lat: 40.2, lng: -3.7, z: 5 });
    map = L.map("map", { zoomControl: false, worldCopyJump: true }).setView([v.lat, v.lng], v.z);
    map.attributionControl.setPosition("topright"); // abajo la tapa el reproductor
    // OpenStreetMap: gratis y sin clave. Se oscurece con un filtro CSS para que vaya con la app.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "darkTiles",
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    // Al tocar un grupo no se acerca el mapa: se abre la lista de sus emisoras
    // (muchas emisoras comparten la misma ubicación y el grupo nunca se separaría)
    mapLayer = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true, zoomToBoundsOnClick: false, spiderfyOnMaxZoom: false });
    mapLayer.on("clusterclick", (e) => {
      const list = e.layer.getAllChildMarkers().map((mk) => mk.options.st).filter(Boolean);
      showMapList(list, e.layer.getLatLng(), e.layer.getBounds());
    });
    map.on("click", () => { $("mapList").hidden = true; });
    map.addLayer(mapLayer);
    map.on("moveend", () => {
      const c = map.getCenter();
      store.set("mapView", { lat: c.lat, lng: c.lng, z: map.getZoom() });
      clearTimeout(mapTimer); mapTimer = setTimeout(loadMapArea, 400);
    });
    loadMapArea();
  }
  setTimeout(() => map.invalidateSize(), 50);
  // Siempre empieza en tu posición actual (si das permiso); si no, donde lo dejaste
  getPosition().then((p) => { if (!$("mapSheet").hidden) map.setView([p.lat, p.lon], 9); }).catch(() => {});
}
// Buscador de lugares con sugerencias mientras escribes.
// Photon (de Komoot, con datos de OpenStreetMap): gratis, sin clave y pensado para autocompletar.
let mapQTimer = null, mapQSeq = 0;
async function mapPlaceSearch(q) {
  const ul = $("mapResults"), seq = ++mapQSeq;
  if (q.length < 2) { ul.hidden = true; return; }
  ul.hidden = false;
  if (!ul.children.length) ul.innerHTML = "<li>Buscando…</li>";
  try {
    const params = { q, limit: "7" };
    if (map) { const c = map.getCenter(); params.lat = c.lat.toFixed(2); params.lon = c.lng.toFixed(2); }
    const res = await fetch("https://photon.komoot.io/api/?" + new URLSearchParams(params));
    const data = await res.json();
    if (seq !== mapQSeq) return; // ya se escribió otra cosa
    const feats = (data.features || []);
    ul.innerHTML = "";
    if (!feats.length) { ul.innerHTML = "<li>No he encontrado ese lugar.</li>"; return; }
    for (const f of feats) {
      const p = f.properties || {}, [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
      const li = document.createElement("li");
      li.innerHTML = "<span></span><small></small>";
      li.children[0].textContent = p.name || p.city || p.state || p.country || "";
      li.children[1].textContent = [p.city !== p.name ? p.city : "", p.state !== p.name ? p.state : "", p.country !== p.name ? p.country : ""].filter(Boolean).join(", ");
      li.onclick = () => {
        ul.hidden = true; $("mapQ").blur();
        const e = p.extent; // [oeste, norte, este, sur]
        if (e && e.length === 4) map.fitBounds([[e[3], e[0]], [e[1], e[2]]], { maxZoom: 11 });
        else map.setView([lat, lon], 10);
      };
      ul.append(li);
    }
  } catch { if (seq === mapQSeq) ul.innerHTML = "<li>No se pudo buscar. Revisa tu conexión.</li>"; }
}
$("mapSearch").onsubmit = (e) => { e.preventDefault(); clearTimeout(mapQTimer); mapPlaceSearch($("mapQ").value.trim()); };
$("mapQ").addEventListener("input", () => {
  const q = $("mapQ").value.trim();
  $("mapQClear").hidden = !$("mapQ").value;
  clearTimeout(mapQTimer);
  if (!q) { $("mapResults").hidden = true; $("mapResults").innerHTML = ""; return; }
  mapQTimer = setTimeout(() => mapPlaceSearch(q), 300);
});
$("mapQClear").onclick = () => { $("mapQ").value = ""; $("mapQClear").hidden = true; $("mapResults").hidden = true; $("mapResults").innerHTML = ""; $("mapQ").focus(); };
let mapListArea = null;
function showMapList(list, center, bounds) {
  list = list.slice().sort((x, y) => (y.clickcount || 0) - (x.clickcount || 0));
  mapListArea = { center, bounds };
  $("mapListTitle").textContent = list.length === 1 ? "1 emisora" : list.length + " emisoras aquí";
  $("mapZoom").hidden = map.getZoom() >= 14;
  const ul = $("mapListUl");
  ul.innerHTML = "";
  for (const st of list) {
    const li = stationItem(st, list);
    li.onclick = () => play(st, list);
    ul.append(li);
  }
  $("mapList").hidden = false;
  ul.scrollTop = 0;
  refreshListsState();
}
$("mapListClose").onclick = () => { $("mapList").hidden = true; };
$("mapZoom").onclick = () => {
  $("mapList").hidden = true;
  const a = mapListArea;
  if (!a) return;
  if (a.bounds && a.bounds.isValid() && !a.bounds.getNorthEast().equals(a.bounds.getSouthWest())) map.fitBounds(a.bounds, { maxZoom: 15, padding: [30, 30] });
  else map.setView(a.center, Math.min(map.getZoom() + 3, 15));
};
$("mapGo").onclick = () => { document.activeElement.blur(); openMap(); };
$("mapClose").onclick = () => { $("mapSheet").hidden = true; document.body.classList.remove("mapOpen"); };
$("mapLocate").onclick = async () => {
  try { const p = await getPosition(); map && map.setView([p.lat, p.lon], 9); }
  catch { toast("No se pudo saber tu ubicación."); }
};
// Botón ✕ para borrar el nombre en Buscar
(() => {
  const q = $("qName"), x = $("qClear");
  const paint = () => { x.hidden = !q.value; };
  q.addEventListener("input", paint);
  x.onclick = () => { q.value = ""; paint(); q.focus(); };
  paint();
})();
// Actualiza votos/escuchas/tendencia de las favoritas (los datos guardados se quedan viejos)
async function refreshFavStats() {
  if (!favs.length) return;
  const ids = favs.map((f) => f.stationuuid);
  const fresh = {};
  for (let i = 0; i < ids.length; i += 50) {
    try { (await api("stations/byuuid", { uuids: ids.slice(i, i + 50).join(",") })).forEach((d) => { fresh[d.stationuuid] = d; }); } catch { return; }
  }
  let changed = false;
  for (const f of favs) {
    const d = fresh[f.stationuuid];
    if (!d) continue;
    f.votes = d.votes || 0; f.clickcount = d.clickcount || 0; f.clicktrend = d.clicktrend || 0;
    // Comprobación de Radio Browser: 1 = funcionaba en su última prueba, 0 = falló
    f.lastcheckok = d.lastcheckok; f.lastcheckoktime = d.lastcheckoktime_iso || d.lastcheckoktime || "";
    changed = true;
  }
  if (current && fresh[current.stationuuid]) {
    const d = fresh[current.stationuuid];
    Object.assign(current, { votes: d.votes || 0, clickcount: d.clickcount || 0, clicktrend: d.clicktrend || 0 });
    setPop(current);
  }
  if (changed && !favSorting) { store.set("favs", favs); renderFavs(); refreshListsState(); }
}
setTimeout(refreshFavStats, 1500);
// La barra "Editar orden" va fija justo encima de la barra de reproducción
(() => {
  const pl = $("player");
  const place = () => {
    const h = pl.hidden ? 0 : pl.offsetHeight;
    document.documentElement.style.setProperty("--playerH", h ? h + "px" : "env(safe-area-inset-bottom)");
  };
  if (window.ResizeObserver) new ResizeObserver(place).observe(pl);
  new MutationObserver(place).observe(pl, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", place);
  place();
  // Al abrir la app, el iPhone a veces calcula mal la parte de abajo de la pantalla hasta que
  // cambias de pestaña. Hacemos lo mismo que un cambio de pestaña, sin que se note.
  const relayout = () => {
    const t = document.querySelector(".tab.active");
    if (t) { t.classList.remove("active"); void t.offsetHeight; t.classList.add("active"); }
    place();
  };
  window.addEventListener("load", () => { relayout(); setTimeout(relayout, 300); setTimeout(relayout, 1200); });
  window.addEventListener("pageshow", () => setTimeout(relayout, 100));
  window.addEventListener("orientationchange", () => setTimeout(relayout, 300));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(relayout, 100); });
})();
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
    const files = ["./", "index.html", "style.css", "app.js", "tz.js", "sw.js", "version.json", "manifest.webmanifest"];
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
  const rp = document.createElement("div");
  if (fillPop(rp, st)) $("rMeta").append(rp);
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
$("rGo").onclick = () => {
  lastSearchKind = "random"; document.activeElement.blur(); nextRandom(); };
$("rNext").onclick = nextRandom;
$("rFav").onclick = () => current && toggleFav(current);

window.addEventListener("online", () => { if (wantPlaying) { retries = 0; start(); } });

$("pToggle").onclick = () => (wantPlaying ? stop() : start());
$("pFav").onclick = () => current && toggleFav(current);

// ---------- Votar la emisora en Radio Browser ----------
// Solo se envía UN voto por emisora desde esta app. Radio Browser no permite borrar votos:
// si lo vuelves a pulsar se quita la marca aquí, pero el voto ya enviado se queda allí,
// y si lo marcas otra vez no se envía de nuevo.
function paintVote() {
  const b = $("pVote");
  if (!b || !current) return;
  const on = myVotes[current.stationuuid] === "on";
  b.classList.toggle("voted", on);
  b.setAttribute("aria-label", on ? "Quitar mi voto" : "Votar esta emisora");
}
$("pVote").innerHTML = THUMB_SVG;
$("pVote").onclick = async () => {
  const st = current;
  if (!st) return;
  const id = st.stationuuid, state = myVotes[id];
  if (state === "on") {
    myVotes[id] = "off"; store.set("myVotes", myVotes); paintVote();
    toast("Voto quitado. El voto ya enviado no se puede borrar, sigue contando.");
    return;
  }
  if (state === "off") {
    myVotes[id] = "on"; store.set("myVotes", myVotes); paintVote();
    toast("Marcada otra vez. No se envía un voto nuevo: ya votaste esta emisora.");
    return;
  }
  const b = $("pVote");
  b.disabled = true;
  try {
    const r = await api("vote/" + id);
    myVotes[id] = "on"; store.set("myVotes", myVotes);
    if (r && r.ok) {
      st.votes = (Number(st.votes) || 0) + 1;
      setPop(st);
      document.querySelectorAll(".st").forEach((li) => { if (li.dataset.id === id) { const p = li.querySelector(".stPop"); if (p) fillPop(p, st); } });
      toast("¡Voto enviado!");
    } else toast("No se pudo votar ahora. Inténtalo más tarde.");
  } catch {
    toast("No se pudo enviar el voto. Revisa tu conexión.");
  } finally { b.disabled = false; paintVote(); }
};

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
  setupMediaButtons();
}
// Pantalla bloqueada: anterior / siguiente en vez de ±10 s.
// iOS pone los botones de ±10 s si existen los de avanzar/retroceder, así que los quitamos
// explícitamente, y lo repetimos cada vez que empieza a sonar (Safari los vuelve a poner).
function setupMediaButtons() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a, h) => { try { ms.setActionHandler(a, h); } catch {} };
  set("seekbackward", null);
  set("seekforward", null);
  set("seekto", null);
  set("play", () => start());
  set("pause", () => stop());
  set("stop", () => stop());
  set("nexttrack", () => step(1));
  set("previoustrack", () => step(-1));
}
setupMediaButtons();
audio.addEventListener("playing", setupMediaButtons);
audio.addEventListener("loadedmetadata", setupMediaButtons);

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
    setPop(last);
    setLogo($("pLogo"), last);
    setStatus("Pulsa ▶ para escuchar");
    updateMediaSession();
    refreshListsState();
  }
  openSharedStation();
  await loadFilters();
  const code = $("homeCountry").value;
  home.search(code ? { countrycode: code } : {});
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
