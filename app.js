const C = window.CONFIG || {};
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
const money = v => new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(v);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const uniq = (arr, k) => [...new Set(arr.map(r => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

let records = [], history = [], priceChart = null, histChart = null;
let sb = null, user = null, vip = false, memb = null;

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
  $("chipBadge").textContent = vip ? "VIP" : "Gratis"; $("chipBadge").classList.toggle("vip", vip);
  $("userPlan").textContent = user ? (vip ? "VIP activo" : "Cuenta gratuita") : "Plan gratuito";
  [...$("hRange").options].forEach(o => { o.textContent = o.textContent.replace("🔒 ", ""); if (!vip && Number(o.value) > (C.DIAS_GRATIS || 30)) o.textContent = "🔒 " + o.textContent; });
  $("hRegion2").disabled = !vip; $("lockNote").hidden = vip; $("hCsv").textContent = vip ? "⬇ Descargar CSV" : "⬇ Descargar CSV (VIP)";
  $("signupStrip").hidden = !!user;
  const dias = vip && memb ? Math.ceil((new Date(memb.vence) - Date.now()) / 864e5) : 0;
  $("topVip").hidden = vip; $("analisis").hidden = vip; $("vipStatus").hidden = !vip;
  if (vip) $("vipStatus").innerHTML = `⭐ <strong>Eres VIP</strong> · vence el ${new Date(memb.vence).toLocaleDateString("es-PE")}` + (dias <= 7 ? ` (en ${dias} día${dias === 1 ? "" : "s"}: renueva para no perder el acceso)` : "");
  document.querySelectorAll(".plan-card .vipCheckout").forEach(b => { b.dataset.t ||= b.textContent; b.textContent = vip ? b.dataset.t.replace("Elegir", "Renovar") : b.dataset.t; });
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
  try {
    if (sb && user) {
      const { data, error } = await sb.from("membresias").select("vence").eq("user_id", user.id).maybeSingle();
      if (error) console.error("membresias:", error.message);
      memb = data || null;
      vip = !!(data && new Date(data.vence) > new Date());
      if (vip) {
        try {
          if (localStorage.getItem("agroVip") !== data.vence) {
            localStorage.setItem("agroVip", data.vence);
            toast("⭐ ¡Tu VIP está activo! Ya tienes historial de hasta 2 años y más herramientas.");
          }
        } catch {}
      }
    }
  } catch (e) { console.error(e); }
  applyPlanUI();
}
const userName = u => u?.user_metadata?.full_name || (u?.email ? u.email.split("@")[0] : "Invitado");
function setUser(u) {
  user = u;
  const name = userName(u);
  $("userName").textContent = u?.user_metadata?.full_name || u?.email || "Invitado";
  $("userAvatar").textContent = u ? name.slice(0, 1).toUpperCase() : "AP";
  $("authButton").textContent = u ? "↪" : "↗"; $("authButton").title = u ? "Cerrar sesión" : "Iniciar sesión";
  $("userChip").hidden = !u; $("topLogin").hidden = !!u;
  if (u) { $("chipAvatar").textContent = name.slice(0, 1).toUpperCase(); $("chipName").textContent = name; }
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 6000);
}
function welcome(u) {
  if (!u || sessionStorage.getItem("agroWelcome")) return;
  sessionStorage.setItem("agroWelcome", "1");
  closeModal("authModal");
  toast("✅ ¡Listo! Tu cuenta quedó registrada. Bienvenido, " + userName(u) + ".");
}
function openAccount() {
  const name = userName(user);
  $("accAvatar").textContent = name.slice(0, 1).toUpperCase();
  $("accName").textContent = name; $("accEmail").textContent = user.email || "—";
  $("accPlan").textContent = vip ? "VIP activo" : "Gratis";
  $("accVence").textContent = vip && memb ? new Date(memb.vence).toLocaleDateString("es-PE") : "—";
  $("accVip").hidden = vip;
  openModal("accountModal");
}
async function logout() {
  try { if (sb) await sb.auth.signOut(); } catch (e) { console.error(e); }
  sessionStorage.removeItem("agroWelcome"); setUser(null); memb = null; await loadMembership();
  closeModal("accountModal"); toast("Sesión cerrada.");
}
async function login() {
  if (!sb) { $("authMessage").textContent = "El registro con Google aún no está configurado (falta Supabase en config.js)."; openModal("authModal"); return; }
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) $("authMessage").textContent = error.message;
}
function checkout(plan) {
  if (!user) { $("authMessage").textContent = "Primero inicia sesión para vincular tu membresía."; closeModal("vipModal"); openModal("authModal"); return; }
  const url = plan === "annual" ? C.PAGO_ANUAL : C.PAGO_MENSUAL;
  const nombre = plan === "annual" ? "VIP anual (S/ 70)" : "VIP mensual (S/ 7)";
  if (url) { window.open(url + (url.includes("?") ? "&" : "?") + "email=" + encodeURIComponent(user.email), "_blank"); return; }
  if (C.YAPE_NUMERO) { openYape(plan); return; }
  if (C.WHATSAPP) {
    const msg = `Hola, quiero el plan ${nombre} de AgroPrecios Perú. Mi correo: ${user.email}`;
    window.open(`https://wa.me/${C.WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank"); return;
  }
  $("paymentMessage").textContent = "El método de pago aún no está configurado. No se realizó ningún cobro.";
  openModal("vipModal");
}

/* ---------- Acceso por correo ---------- */
async function emailLogin(inputId, msgId) {
  const email = $(inputId).value.trim(), msg = $(msgId);
  if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Escribe un correo válido."; return; }
  if (!sb) { msg.textContent = "El acceso aún no está configurado (falta Supabase en config.js)."; return; }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  msg.textContent = error ? error.message : "✓ Te enviamos un enlace a " + email + ". Ábrelo para entrar.";
}

/* ---------- Asistente ---------- */
const plain = s => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
function named(field, q) {
  return [...new Set(records.map(r => r[field]))].find(v => v && new RegExp("\\b" + plain(v) + "\\b").test(q));
}
function ask() {
  const q = plain($("aiQ").value.trim()), out = $("aiA");
  if (!q) { out.textContent = "Escribe una pregunta."; return; }
  const prod = named("producto", q), reg = named("region", q), tipo = named("tipo", q) || (/minorista/.test(q) ? "Minorista" : /mayorista/.test(q) ? "Mayorista" : "");
  if (/tendencia|historial|variacion|evolucion|ultimos? \d* ?(meses|anos)/.test(q)) {
    if (!vip) { out.innerHTML = '🔒 Las respuestas de tendencia e historial son parte de VIP. <a href="#planes" style="text-decoration:underline;font-weight:700">Ver planes</a>'; return; }
    if (!prod) { out.textContent = "Indica el producto, por ejemplo: «tendencia de papa en Puno»."; return; }
    const by = {};
    history.filter(h => h.p === prod && (!reg || h.r === reg) && h.t === (tipo || "Mayorista")).forEach(h => (by[h.d] ||= []).push(h.x));
    const s = Object.entries(by).sort().map(([d, a]) => [d, a.reduce((x, y) => x + y, 0) / a.length]);
    if (s.length < 2) { out.textContent = "Aún no hay suficiente historial para esa consulta."; return; }
    const first = s[0], last = s.at(-1), ch = (last[1] - first[1]) / first[1] * 100;
    out.textContent = `${prod}${reg ? " en " + reg : ""} (${tipo || "Mayorista"}): de ${money(first[1])} el ${first[0]} a ${money(last[1])} el ${last[0]} (${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%). Mín ${money(Math.min(...s.map(x => x[1])))}, máx ${money(Math.max(...s.map(x => x[1])))}.`;
    return;
  }
  let d = records.filter(r => num(r.precio) && (!prod || r.producto === prod) && (!reg || r.region === reg) && (!tipo || r.tipo === tipo));
  if (!d.length) { out.textContent = "No encontré precios numéricos para esa pregunta."; return; }
  const fmtR = r => `${money(r.precio)} en ${r.region} (${r.producto}${r.variedad ? " " + r.variedad : ""}, ${r.tipo}, ${r.fecha || "sin fecha"})`;
  if (/alto|\bmayor\b|mas caro/.test(q)) out.textContent = "El precio más alto: " + fmtR(d.reduce((a, b) => a.precio > b.precio ? a : b));
  else if (/bajo|menor|mas barat/.test(q)) out.textContent = "El precio más bajo: " + fmtR(d.reduce((a, b) => a.precio < b.precio ? a : b));
  else if (/promedio/.test(q)) out.textContent = `Promedio de ${d.length} registros: ${money(d.reduce((s, r) => s + Number(r.precio), 0) / d.length)}. Puede mezclar fechas y tipos.`;
  else out.textContent = "Puedes preguntar por el precio más alto, más bajo o el promedio, indicando producto, región o tipo (mayorista/minorista).";
}

/* ---------- Pago con Yape (manual) ---------- */
let yapePlan = "monthly";
function openYape(plan) {
  yapePlan = plan;
  const annual = plan === "annual";
  $("yapeTitle").textContent = annual ? "VIP anual" : "VIP mensual";
  $("yapeMonto").textContent = annual ? "S/ 70" : "S/ 7";
  $("yapeNum").textContent = C.YAPE_NUMERO;
  $("yapeNombre").textContent = C.YAPE_NOMBRE || "—";
  $("yapeOp").value = "";
  closeModal("vipModal"); openModal("yapeModal");
}
function sendYape() {
  const op = $("yapeOp").value.trim();
  if (op.length < 5) { $("yapeMsg").textContent = "Escribe el número de operación que aparece en tu constancia de Yape."; return; }
  const nombre = yapePlan === "annual" ? "VIP anual (S/ 70)" : "VIP mensual (S/ 7)";
  const msg = `Pagué ${nombre} por Yape. N° de operación: ${op}. Mi correo en AgroPrecios: ${user?.email || "—"}`;
  if (C.WHATSAPP) { window.open(`https://wa.me/${C.WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank"); $("yapeMsg").textContent = "✓ Comprobante enviado. Te activaremos en cuanto confirmemos el pago."; }
  else $("yapeMsg").textContent = "Guarda tu N° de operación (" + op + ") y envíalo al contacto indicado por el administrador.";
}

/* ---------- UI ---------- */
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

async function boot() {
  await loadData();

  ["productFilter", "regionFilter", "typeFilter"].forEach(id => on(id, "change", render));
  on("chartProduct", "change", drawRegional);
  ["hProduct", "hRegion", "hRegion2", "hType"].forEach(id => on(id, "change", drawHistory));
  on("hRange", "change", () => {
    if (!vip && Number($("hRange").value) > (C.DIAS_GRATIS || 30)) { $("hRange").value = String(C.DIAS_GRATIS || 30); openModal("vipModal"); }
    drawHistory();
  });
  on("clearFilters", "click", () => { ["productFilter", "regionFilter", "typeFilter"].forEach(id => $(id).value = ""); render(); });
  ["topVip", "bannerVip", "lockVip"].forEach(id => on(id, "click", () => openModal("vipModal")));
  document.querySelectorAll(".vipCheckout").forEach(b => b.addEventListener("click", () => checkout(b.dataset.plan)));
  on("topLogin", "click", () => openModal("authModal"));
  on("authButton", "click", () => { if (user) logout(); else openModal("authModal"); });
  on("userChip", "click", openAccount);
  on("accLogout", "click", logout);
  on("accVip", "click", () => { closeModal("accountModal"); openModal("vipModal"); });
  on("googleLogin", "click", login);
  on("stripBtn", "click", () => emailLogin("stripEmail", "stripMsg"));
  on("modalBtn", "click", () => emailLogin("modalEmail", "authMessage"));
  on("googleLogin2", "click", login);
  on("yapeSend", "click", sendYape);
  on("aiBtn", "click", ask);
  on("aiQ", "keydown", e => { if (e.key === "Enter") ask(); });
  on("hCsv", "click", downloadCsv);
  on("freePlanBtn", "click", () => scrollTo({ top: 0, behavior: "smooth" }));
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.close)));
  document.querySelectorAll(".modal-backdrop").forEach(b => b.addEventListener("click", e => { if (e.target === b) b.hidden = true; }));
  on("mobileMenu", "click", () => $("sidebar").classList.toggle("open"));
  document.querySelectorAll(".nav-link").forEach(l => l.addEventListener("click", () => $("sidebar").classList.remove("open")));
  try {
    if (configured()) {
      sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
      const { data } = await Promise.race([sb.auth.getSession(), new Promise(r => setTimeout(() => r({ data: {} }), 4000))]);
      setUser(data.session?.user || null); welcome(data.session?.user);
      // Importante: no llamar a Supabase dentro del callback (se cuelga); se difiere con setTimeout.
      sb.auth.onAuthStateChange((ev, s) => {
        setUser(s?.user || null);
        if (ev === "SIGNED_IN") welcome(s?.user);
        setTimeout(loadMembership, 0);
      });
    }
  } catch (e) { console.error("Supabase:", e); sb = null; }
  await loadMembership();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && user) loadMembership(); });
}
boot();
