// Descarga precios del SISAP (MIDAGRI) y genera precios.json + historial.json.
// Lo ejecuta GitHub Actions cada día (ver actualizar.yml). Equivale a tu actualizar.php.
import * as cheerio from "cheerio";
import fs from "node:fs";

const SISAP = "http://sistemas.midagri.gob.pe/sisap/portal2/ciudades";
const DIAS = Number(process.env.DIAS || 30);
const MAX_HISTORIAL_DIAS = 730; // 2 años
const PRODUCTOS = { "0104": "Papa", "0401": "Arroz", "0212": "Cebolla", "0228": "Tomate", "0403": "Choclo" };
const REGIONES = { ancash: "Áncash", cajamarca: "Cajamarca", cusco: "Cusco", junin: "Junín", puno: "Puno", "san martin": "San Martín", amazonas: "Amazonas", piura: "Piura", ica: "Ica", "la libertad": "La Libertad" };
const TIPOS = { May: "Mayorista", Min: "Minorista" };

const norm = s => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
const fmt = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const cookies = new Map();

async function pedir(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AgroPrecios/1.0)", "X-Requested-With": "XMLHttpRequest", Referer: SISAP + "/", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
        signal: AbortSignal.timeout(180000)
      });
      for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const [k, ...v] = kv.split("="); cookies.set(k, v.join("=")); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return new TextDecoder("iso-8859-1").decode(await r.arrayBuffer());
    } catch (e) {
      if (i === 3) throw e;
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

function consulta(codigo, desde, hasta) {
  const p = new URLSearchParams();
  p.set("region", "*"); p.append("productos[]", codigo);
  p.append("variables[]", "may_precio_prom"); p.append("variables[]", "min_precio_prom");
  p.set("periodicidad", "intervalo"); p.set("fecha", fmt(hasta)); p.set("desde", fmt(desde)); p.set("hasta", fmt(hasta));
  p.append("anios[]", String(hasta.getFullYear())); p.append("meses[]", String(hasta.getMonth() + 1).padStart(2, "0"));
  p.set("checkTransformacion", "1"); p.set("__ajax_carga_final", "consulta"); p.set("ajax", "true");
  return `${SISAP}/resumenes/filtrar?${p}`;
}

function expandir($, tr, saltar) {
  const cols = [];
  $(tr).children("td").each((i, td) => {
    if (i < saltar) return;
    const n = Math.max(1, parseInt($(td).attr("colspan") || "1", 10));
    for (let k = 0; k < n; k++) cols.push($(td).text().trim());
  });
  return cols;
}

// Devuelve todos los puntos [{ciudad, variedad, tipo, iso, fecha, precio}]
function puntos(html) {
  const $ = cheerio.load(html);
  const enc = $("tr.encabezado");
  if (enc.length < 3) return [];
  const ciudades = expandir($, enc[0], 1), variedades = expandir($, enc[1], 0), variables = expandir($, enc[2], 0);
  const out = [];
  $("tr.contenido").each((_, tr) => {
    const tds = $(tr).children("td");
    const fecha = $(tds[0]).text().trim();
    const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return;
    for (let i = 1; i < tds.length; i++) {
      const v = $(tds[i]).text().trim().replace(",", ".");
      if (v === "" || !Number.isFinite(Number(v))) continue;
      out.push({ ciudad: norm(ciudades[i - 1] || ""), variedad: variedades[i - 1] || "", tipo: (variables[i - 1] || "").slice(0, 3), iso: `${m[3]}-${m[2]}-${m[1]}`, fecha, precio: Number(v) });
    }
  });
  return out;
}

function registro(producto, variedad, region, tipo, precio, fecha) {
  const ok = precio !== null;
  return { producto, variedad, region, precio, unidad: "S/ por kg", fecha, tipo, fuente: ok ? "SISAP - MIDAGRI" : `SISAP - MIDAGRI: sin reporte en los últimos ${DIAS} días`, estado: ok ? "REAL - SISAP" : "SIN DATO", categoriaEstado: ok ? "registrado" : "sin_dato" };
}

const hasta = new Date(); const desde = new Date(Date.now() - DIAS * 864e5);
const registros = []; const historialNuevo = [];

await pedir(SISAP + "/"); // abre sesión
for (const [codigo, producto] of Object.entries(PRODUCTOS)) {
  process.stdout.write(`Consultando ${producto}... `);
  let pts = [];
  for (let i = 1; i <= 3 && !pts.length; i++) {
    if (i > 1) await new Promise(r => setTimeout(r, 5000));
    pts = puntos(await pedir(consulta(codigo, desde, hasta)));
  }
  if (!pts.length) throw new Error(`El SISAP no devolvió precios de ${producto}`);
  const ultimo = new Map();
  for (const p of pts) {
    const reg = REGIONES[p.ciudad]; if (!reg || !TIPOS[p.tipo]) continue;
    historialNuevo.push({ d: p.iso, p: producto, v: p.variedad, r: reg, t: TIPOS[p.tipo], x: p.precio });
    const k = `${p.ciudad}|${p.variedad}|${p.tipo}`;
    if (!ultimo.has(k) || p.iso >= ultimo.get(k).iso) ultimo.set(k, p);
  }
  for (const [ciudad, region] of Object.entries(REGIONES)) {
    for (const [clave, tipo] of Object.entries(TIPOS)) {
      const hits = [...ultimo.values()].filter(p => p.ciudad === ciudad && p.tipo === clave);
      if (hits.length) hits.forEach(p => registros.push(registro(producto, p.variedad, region, tipo, p.precio, p.fecha)));
      else registros.push(registro(producto, null, region, tipo, null, null));
    }
  }
  console.log("ok");
}
if (!registros.some(r => r.precio !== null)) throw new Error("El SISAP no devolvió precios");
fs.writeFileSync("precios.json", JSON.stringify(registros, null, 2) + "\n");

// Historial acumulado (sin duplicados, máximo 2 años)
let previo = []; try { previo = JSON.parse(fs.readFileSync("historial.json", "utf8")); } catch {}
const mapa = new Map();
[...previo, ...historialNuevo].forEach(h => mapa.set(`${h.d}|${h.p}|${h.v}|${h.r}|${h.t}`, h));
const corte = new Date(Date.now() - MAX_HISTORIAL_DIAS * 864e5).toISOString().slice(0, 10);
const hist = [...mapa.values()].filter(h => h.d >= corte).sort((a, b) => a.d.localeCompare(b.d));
fs.writeFileSync("historial.json", "[\n" + hist.map(h => JSON.stringify(h)).join(",\n") + "\n]\n");
console.log(`Listo: ${registros.length} registros, historial de ${hist.length} puntos.`);
