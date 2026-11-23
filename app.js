const C = window.CONFIG || {};
const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(v);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const uniq = (arr, k) => [...new Set(arr.map(r => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

let records = [], history = [], priceChart = null, histChart = null;
let sb = null, user = null, vip = false;

/* ---------- Datos ---------- */
async function getJson(url) {
  try { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); }
  catch { return []; }
}
async function loadData() {
  [records, history] = await Promise.all([getJson("precios.json"), getJson("historial.json")]);
  if (!records.length) {
    $("priceTable").innerHTML = `<tr><td colspan="6" class="empty-cell">No se pudo cargar precios.json. Verifica que esté en la raíz del repositorio.</td></tr>`;
    return;
  }
  const fechas = records.map(r => r.fecha).filter(f => /\d{2}\/\d{2}\/\d{4}/.test(f || ""))
    .map(f => f.split("/").reverse().join("-")).sort();
  $("lastUpdate").textContent = fechas.length ? "Datos al " + fechas.at(-1).split("-").reverse().join("/") : "Base de datos local";
  fill("productFilter", uniq(records, "producto"), "Todos los productos");
  fill("regionFilter", uniq(records, "region"), "Todas las regiones");
  fill("typeFilter", uniq(records, "tipo"), "Todos los tipos");
  const prods = uniq(records, "producto");
  fill("chartProduct", prods, "Selecciona producto"); $("chartProduct").value = prods[0] || "";
  fill("hProduct", prods, "Producto"); $("hProduct").value = prods[0] || "";
  const regs = uniq(records, "region");
  fill("hRegion", regs, "Región"); $("hRegion").value = regs[0] || "";
  fill("hRegion2", regs, "— Sin comparar —", true);
  fill("hType", uniq(records, "tipo"), "Tipo"); $("hType").value = uniq(records, "tipo").includes("Mayorista") ? "Mayorista" : ($("hType").options[1]?.value || "");
  $("statProducts").textContent = prods.length;
  $("statRegions").textContent = regs.length;
  $("statRecords").textContent = records.length;
  render(); drawHistory();
}
function fill(id, values, first, keepEmpty) {
  const s = $(id);
  const noBlank = id.startsWith("h") && !keepEmpty;
  s.innerHTML = noBlank ? "" : `<option value="">${first}</option>`;
  values.forEach(v => s.add(new Option(v, v)));
}

/* ---------- Tabla ---------- */
const filtered = () => records.filter(r =>
  (!$("productFilter").value || r.producto === $("productFilter").value) &&
  (!$("regionFilter").value || r.region === $("regionFilter").value) &&
  (!$("typeFilter").value || r.tipo === $("typeFilter").value));
function statusFor(r) {
  const s = (r.categoriaEstado || "").toLowerCase();
  if (s === "sin_dato" || !num(r.precio)) return ["Sin dato", "missing"];
  if (s === "referencia" || s === "estimado") return ["Referencia", "reference"];
  return ["Registrado", ""];
}
function render() {
  const rows = filtered();
  $("resultCount").textContent = `${rows.length} de ${records.length} registros`;
  $("priceTable").innerHTML = rows.map(r => {
    const [label, cls] = statusFor(r);
    const price = num(r.precio) ? `<span class="price-value">${money(Number(r.precio))}</span>` : "—";
    const name = esc(r.producto) + (r.variedad ? ` <small>· ${esc(r.variedad)}</small>` : "");
    return `<tr><td>${name}</td><td>${esc(r.region)}</td><td>${price} <small>${esc(r.unidad || "")}</small></td><td>${esc(r.tipo || "—")}</td><td>${esc(r.fecha || "No indicada")}</td><td><span class="status ${cls}">${label}</span></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="empty-cell">No hay registros para estos filtros.</td></tr>`;
  drawRegional();
}

/* ---------- Gráfico regional (gratis) ---------- */
function drawRegional() {
  const p = $("chartProduct").value;
  const data = records.filter(r => r.producto === p && num(r.precio));
  const regs = [...new Set(data.map(r => r.region))];
  const tipos = [...new Set(data.map(r => r.tipo))];
  const colors = ["#9ab83b", "#123d2b", "#d5a64b"];
  const avg = (reg, t) => { const x = data.filter(r => r.region === reg && r.tipo === t).map(r => Number(r.precio)); return x.length ? x.reduce((a, b) => a + b) / x.length : null; };
  if (priceChart) priceChart.destroy();
  priceChart = new Chart($("priceChart"), {
    type: "bar",
    data: { labels: regs, datasets: tipos.map((t, i) => ({ label: t, data: regs.map(r => avg(r, t)), backgroundColor: colors[i % 3], borderRadius: 6, maxBarThickness: 30 })) },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => "S/ " + v } } }, plugins: { legend: { display: tipos.length > 1 } } }
  });
  if (data.length) {
    const s = [...data].sort((a, b) => a.precio - b.precio), lo = s[0], hi = s.at(-1);
    $("quickInsight").innerHTML = `Para <strong>${esc(p)}</strong> hay ${data.length} registros con precio. El menor es <strong>${money(lo.precio)}</strong> en ${esc(lo.region)} (${esc(lo.tipo)}) y el mayor <strong>${money(hi.precio)}</strong> en ${esc(hi.region)} (${esc(hi.tipo)}).<br><br>Las fechas pueden diferir entre regiones.`;
  } else $("quickInsight").textContent = "No hay precios numéricos para este producto.";
}

/* ---------- Historial (límites por plan) ---------- */
const maxDays = () => vip ? (C.DIAS_VIP || 730) : (C.DIAS_GRATIS || 30);
function series(region, days) {
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const by = {};
  history.filter(h => h.p === $("hProduct").value && h.r === region && h.t === $("hType").value && h.d >= cut)
    .forEach(h => (by[h.d] ||= []).push(h.x));
  return Object.entries(by).sort().map(([d, a]) => [d, a.reduce((s, x) => s + x, 0) / a.length]);
}
function drawHistory() {
  const days = Math.min(Number($("hRange").value), maxDays());
  const regs = [$("hRegion").value, vip ? $("hRegion2").value : ""].filter(Boolean);
  const all = regs.map(r => ({ r, s: series(r, days) }));
  const labels = [...new Set(all.flatMap(a => a.s.map(x => x[0])))].sort();
  if (histChart) histChart.destroy();
  histChart = new Chart($("histChart"), {
    type: "line",
    data: { labels, datasets: all.map((a, i) => ({ label: a.r, data: labels.map(l => a.s.find(x => x[0] === l)?.[1] ?? null), borderColor: ["#123d2b", "#9ab83b"][i], backgroundColor: ["#123d2b", "#9ab83b"][i], tension: .3, spanGaps: true, pointRadius: 2 })) },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => "S/ " + v } } } }
  });
  const vals = all[0]?.s.map(x => x[1]) || [];
  let html;
  if (!vals.length) html = `<p class="data-note" style="grid-column:1/-1">Aún no hay historial para esta selección. Se acumula con cada actualización automática diaria.</p>`;
  else {
    const mean = vals.reduce((a, b) => a + b) / vals.length;
    const ch = (vals.at(-1) - vals[0]) / vals[0] * 100;
    html = `<div><small>ÚLTIMO</small><strong>${money(vals.at(-1))}</strong></div><div><small>PROMEDIO</small><strong>${money(mean)}</strong></div>` +
      `<div class="${vip ? "" : "locked"}"><small>MÍN / MÁX ${vip ? "" : "🔒"}</small><strong>${vip ? money(Math.min(...vals)) + " / " + money(Math.max(...vals)) : "VIP"}</strong></div>` +
      `<div class="${vip ? "" : "locked"}"><small>VARIACIÓN ${vip ? "" : "🔒"}</small><strong>${vip ? (ch >= 0 ? "+" : "") + ch.toFixed(1) + "%" : "VIP"}</strong></div>`;
  }
  $("histStats").innerHTML = html;
}
function applyPlanUI() {
  $("planPill").textContent = vip ? "VIP activo" : "Plan gratis";
  $("userPlan").textContent = user ? (vip ? "VIP activo" : "Cuenta gratuita") : "Plan gratuito";
  [...$("hRange").options].forEach(o => { o.textContent = o.textContent.replace("🔒 ", ""); if (!vip && Number(o.value) > (C.DIAS_GRATIS || 30)) o.textContent = "🔒 " + o.textContent; });
  $("hRegion2").disabled = !vip; $("lockNote").hidden = vip; $("hCsv").textContent = vip ? "⬇ Descargar CSV" : "⬇ Descargar CSV (VIP)";
  $("signupStrip").hidden = !!user;
  if (!vip) $("hRange").value = String(C.DIAS_GRATIS || 30);
  drawHistory();
}
function downloadCsv() {
  if (!vip) return openModal("vipModal");
  const days = Number($("hRange").value);
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = history.filter(h => h.p === $("hProduct").value && h.r === $("hRegion").value && h.t === $("hType").value && h.d >= cut);
  const csv = "fecha,producto,variedad,region,tipo,precio_soles_kg\n" + rows.map(h => [h.d, h.p, h.v || "", h.r, h.t, h.x].join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "historial.csv"; a.click();
}

/* ---------- Cuenta y membresía ---------- */
const configured = () => C.SUPABASE_URL && C.SUPABASE_URL.startsWith("https://") && !C.SUPABASE_URL.includes("TU-PROYECTO") && window.supabase;
async function loadMembership() {
  vip = false;
  if (sb && user) {
    const { data } = await sb.from("membresias").select("vence").eq("user_id", user.id).maybeSingle();
    vip = !!(data && new Date(data.vence) > new Date());
  }
  applyPlanUI();
}
function setUser(u) {
  user = u;
  const name = u?.user_metadata?.full_name || u?.email || "Invitado";
  $("userName").textContent = name; $("userAvatar").textContent = u ? name.slice(0, 2).toUpperCase() : "AP";
  $("authButton").textContent = u ? "↪" : "↗"; $("authButton").title = u ? "Cerrar sesión" : "Iniciar sesión";
  $("topLogin").textContent = u ? "Mi cuenta" : "Iniciar sesión";
}
async function login() {
  if (!sb) { $("authMessage").textContent = "El registro con Google aún no está configurado (falta Supabase en config.js)."; openModal("authModal"); return; }
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) $("authMessage").textContent = error.message;
}
function checkout(plan) {
  if (!user) { $("authMessage").textContent = "Primero inicia sesión con Google para vincular tu membresía."; closeModal("vipModal"); openModal("authModal"); return; }
  const url = plan === "annual" ? C.PAGO_ANUAL : C.PAGO_MENSUAL;
  if (!url) { $("paymentMessage").textContent = "El enlace de pago aún no está configurado. No se realizó ningún cobro."; openModal("vipModal"); return; }
  window.open(url + (url.includes("?") ? "&" : "?") + "email=" + encodeURIComponent(user.email), "_blank");
}

/* ---------- UI ---------- */
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

async function boot() {
  if (configured()) {
    sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    setUser(data.session?.user || null);
    sb.auth.onAuthStateChange(async (_e, s) => { setUser(s?.user || null); await loadMembership(); });
  }
  await loadData();
  await loadMembership();

  ["productFilter", "regionFilter", "typeFilter"].forEach(id => $(id).addEventListener("change", render));
  $("chartProduct").addEventListener("change", drawRegional);
  ["hProduct", "hRegion", "hRegion2", "hType"].forEach(id => $(id).addEventListener("change", drawHistory));
  $("hRange").addEventListener("change", () => {
    if (!vip && Number($("hRange").value) > (C.DIAS_GRATIS || 30)) { $("hRange").value = String(C.DIAS_GRATIS || 30); openModal("vipModal"); }
    drawHistory();
  });
  $("clearFilters").addEventListener("click", () => { ["productFilter", "regionFilter", "typeFilter"].forEach(id => $(id).value = ""); render(); });
  ["topVip", "bannerVip", "lockVip"].forEach(id => $(id).addEventListener("click", () => openModal("vipModal")));
  document.querySelectorAll(".vipCheckout").forEach(b => b.addEventListener("click", () => checkout(b.dataset.plan)));
  $("topLogin").addEventListener("click", () => openModal("authModal"));
  $("authButton").addEventListener("click", async () => { if (user && sb) { await sb.auth.signOut(); setUser(null); await loadMembership(); } else openModal("authModal"); });
  $("googleLogin").addEventListener("click", login);
  $("googleLogin2").addEventListener("click", login);
  $("hCsv").addEventListener("click", downloadCsv);
  $("freePlanBtn").addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.close)));
  document.querySelectorAll(".modal-backdrop").forEach(b => b.addEventListener("click", e => { if (e.target === b) b.hidden = true; }));
  $("mobileMenu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  document.querySelectorAll(".nav-link").forEach(l => l.addEventListener("click", () => $("sidebar").classList.remove("open")));
}
boot();
