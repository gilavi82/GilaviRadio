// Copia de respaldo de la lista de emisoras (por si Radio Browser deja de funcionar).
// La ejecuta cada semana el workflow "respaldo.yml". Descarga todas las emisoras, se queda
// solo con los datos que usan las apps y escribe salida/emisoras.json, una emisora por línea.
// Las apps (web, iPhone y Android) solo usan esta copia si fallan todos los servidores.
import { mkdirSync, writeFileSync } from "node:fs";

const SERVERS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
];
// Orden fijo de los datos de cada emisora. Si se cambia, subir "v" y adaptar las apps.
const FIELDS = ["stationuuid", "name", "url_resolved", "favicon", "homepage", "tags", "countrycode", "state",
  "language", "codec", "bitrate", "hls", "votes", "clickcount", "clicktrend", "lastcheckok", "geo_lat", "geo_long"];
const PAGE = 10000;
const MIN_STATIONS = 20000; // si llegan menos, algo va mal: no se toca la copia anterior

async function get(path) {
  let last;
  for (const base of SERVERS) {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const res = await fetch(base + "/json/" + path, {
          headers: { "User-Agent": "GilaviRadio-respaldo/1.0 (github.com/gilavi82/GilaviRadio)" },
          signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      } catch (e) { last = e; console.log(`  ${base}: ${e.message}`); }
    }
  }
  throw last;
}

const str = (v) => (v == null ? "" : String(v).trim());
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const geo = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n !== 0 ? Math.round(n * 1e4) / 1e4 : null; };

const all = new Map();
for (let offset = 0; ; offset += PAGE) {
  console.log(`Descargando emisoras desde ${offset}…`);
  const page = await get(`stations?hidebroken=false&order=stationuuid&limit=${PAGE}&offset=${offset}`);
  for (const s of page) {
    const url = str(s.url_resolved) || str(s.url);
    if (!s.stationuuid || !/^https?:\/\//i.test(url)) continue;
    let lat = geo(s.geo_lat), lon = geo(s.geo_long);
    if (lat == null || lon == null) lat = lon = null;
    all.set(s.stationuuid, [
      s.stationuuid, str(s.name), url, str(s.favicon), str(s.homepage),
      str(s.tags).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).join(","),
      str(s.countrycode).toUpperCase(), str(s.state), str(s.language), str(s.codec),
      int(s.bitrate), s.hls == 1 ? 1 : 0, int(s.votes), int(s.clickcount), int(s.clicktrend),
      s.lastcheckok == 0 ? 0 : 1, lat, lon,
    ]);
  }
  if (page.length < PAGE) break;
}

const rows = [...all.values()].sort((a, b) => b[13] - a[13] || b[12] - a[12] || (a[0] < b[0] ? -1 : 1));
console.log(`Emisoras: ${rows.length}`);
if (rows.length < MIN_STATIONS) { console.error("Demasiado pocas emisoras: no se actualiza la copia."); process.exit(1); }

const head = { v: 1, generated: new Date().toISOString(), count: rows.length, fields: FIELDS };
const text = JSON.stringify(head).slice(0, -1) + ',"stations":[\n' + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]}\n";
mkdirSync("salida", { recursive: true });
writeFileSync("salida/emisoras.json", text);
console.log(`Tamaño: ${(text.length / 1048576).toFixed(1)} MB`);
