// Gastos Casa v3 — control de gastos e ingresos del hogar (HTML/JS sin build).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, onSnapshot, setDoc, updateDoc, deleteField, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Configuración del proyecto Firebase. No es un secreto: identifica el proyecto.
// Lo que protege los datos son las reglas de Firestore y el código de hogar.
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyDyVWhQy4LTT5AQttdywkaL7NHpjEpW0Pk",
  authDomain: "gastos-casa-ichi-y-pablo.firebaseapp.com",
  projectId: "gastos-casa-ichi-y-pablo",
  storageBucket: "gastos-casa-ichi-y-pablo.firebasestorage.app",
  messagingSenderId: "970981116469",
  appId: "1:970981116469:web:85b7295c412fca646cff7c"
};
const APP_VERSION = "3.0";

/* ═════════ Utilidades ═════════ */
const $ = s => document.querySelector(s);
const LS = {
  get: k => localStorage.getItem("gc_" + k),
  set: (k, v) => localStorage.setItem("gc_" + k, v),
  del: k => localStorage.removeItem("gc_" + k)
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const safeId = id => String(id || "").replace(/[^A-Za-z0-9_]/g, "") || newId();
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));

function curYM() { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function ymAdd(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + "-" + pad((t % 12) + 1);
}
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const cap = s => s[0].toUpperCase() + s.slice(1);
function ymLabel(ym, mode) {
  const [y, m] = ym.split("-").map(Number);
  const n = MONTHS[m - 1];
  if (mode === "short") return n.slice(0, 3);
  if (mode === "shortY") return n.slice(0, 3) + " " + String(y).slice(2);
  if (mode === "lower") return n + " " + y;
  return cap(n) + " " + y;
}
function dayLabel(date) {
  if (date === today()) return "Hoy";
  const d = new Date(); d.setDate(d.getDate() - 1);
  if (date === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`) return "Ayer";
  const [, m, dd] = date.split("-").map(Number);
  return dd + " de " + MONTHS[m - 1];
}

function parseAmount(s) {
  s = String(s ?? "").trim().replace(/[€$£\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? round2(n) : NaN;
}
const amountToInput = n => (n === "" || n == null) ? "" : String(n).replace(".", ",");

function fmt(n, compact) {
  const cur = data?.currency || "EUR";
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency", currency: cur, useGrouping: "always",
      ...(compact ? { maximumFractionDigits: 0 } : {})
    }).format(n || 0);
  } catch { return (n || 0).toFixed(2) + " " + cur; }
}
const curSymbol = () => ({ EUR: "€", USD: "$", GBP: "£", CHF: "CHF" }[data?.currency] || "€");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}
async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("gastos:" + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ═════════ Modelo ═════════ */
const SCOPES = ["partner", "me", "joint"];            // orden de los apartados
const SCOPE_COLOR = { partner: "#D4604E", me: "#2F6DB5", joint: "#0E7C66", home: "#1E3A33" };
const KIND = { fixed: "Fijo", variable: "Variable", extra: "Extraordinario", income: "Ingreso" };
const KIND_COLOR = { fixed: "#0E7C66", variable: "#3F72AF", extra: "#D6921F", income: "#1F9D55" };
const PALETTE = ["#0E7C66", "#3F72AF", "#D6921F", "#C0566E", "#6A5FB0", "#2E9FB5", "#7F9A2E", "#C9683A", "#8B6E4E", "#A0527F", "#2F6B8F", "#5E736C"];
const EMOJIS = "☕🍽️🍺🍷🍹🥐🍔🍕🍣🛒🥦🥩🧴🧻🏠🔑🏢🛡️🔧🪴🛋️🧺💡🚿🔥📶📱💻📺🎬🎵🎮📚🎟️🏋️⚽🎾🧘✈️🏨🗺️🏖️🚗⛽🅿️🚇🚕🚲👕👗👟👜💍💄💇💊🩺🦷🐶🐱👶🎓🎁🎂🎄💼💶📈🏦🧾💳🏷️💰📦❤️⭐".match(/\p{Extended_Pictographic}\uFE0F?/gu);

const DEFAULT_CATS = [
  { name: "Vivienda", icon: "🏠", items: [["Alquiler", "🔑"], ["Hipoteca", "🏦"], ["Comunidad", "🏢"], ["Seguro de hogar", "🛡️"], ["Reparaciones", "🔧"], ["Decoración", "🪴"]] },
  { name: "Suministros", icon: "💡", items: [["Luz", "💡"], ["Agua", "🚿"], ["Gas", "🔥"], ["Internet y móvil", "📶"]] },
  { name: "Supermercado", icon: "🛒", items: [["Compra", "🛒"], ["Fruta y verdura", "🥦"], ["Carne y pescado", "🥩"], ["Droguería", "🧴"]] },
  { name: "Ocio", icon: "🎟️", items: [["Cafés", "☕"], ["Restaurantes", "🍽️"], ["Copas", "🍹"], ["Cine", "🎬"], ["Conciertos", "🎵"], ["Planes", "🎟️"]] },
  { name: "Moda", icon: "👗", items: [["Ropa", "👕"], ["Calzado", "👟"], ["Complementos", "👜"]] },
  { name: "Transporte", icon: "🚗", items: [["Gasolina", "⛽"], ["Parking", "🅿️"], ["Transporte público", "🚇"], ["Taxi", "🚕"], ["Seguro del coche", "🛡️"]] },
  { name: "Suscripciones", icon: "📺", items: [["Streaming", "📺"], ["Música", "🎵"], ["Gimnasio", "🏋️"], ["Apps", "📱"]] },
  { name: "Salud y belleza", icon: "💊", items: [["Farmacia", "💊"], ["Médico", "🩺"], ["Dentista", "🦷"], ["Peluquería", "💇"], ["Cosmética", "💄"]] },
  { name: "Viajes", icon: "✈️", items: [["Vuelos", "✈️"], ["Alojamiento", "🏨"], ["Actividades", "🗺️"]] },
  { name: "Regalos", icon: "🎁", items: [["Cumpleaños", "🎂"], ["Navidad", "🎄"], ["Detalles", "🎁"]] },
  { name: "Finanzas", icon: "💳", items: [["Seguros", "🛡️"], ["Comisiones", "💳"], ["Préstamos", "🧾"]] },
  { name: "Otros", icon: "📦", items: [["Varios", "📦"]] }
].map(c => ({ ...c, items: c.items.map(([name, icon]) => ({ name, icon })) }));
const DEFAULT_INCOME_CATS = [
  { name: "Trabajo", icon: "💼", items: [["Nómina", "💼"], ["Paga extra", "💶"], ["Bonus", "📈"]] },
  { name: "Otros ingresos", icon: "💰", items: [["Devolución de Hacienda", "🧾"], ["Intereses", "🏦"], ["Ventas", "🏷️"], ["Regalos", "🎁"], ["Otros", "💰"]] }
].map(c => ({ ...c, items: c.items.map(([name, icon]) => ({ name, icon })) }));

function defaultData() {
  return {
    version: 3, currency: "EUR",
    names: { me: "Pablo", partner: "Ichi", joint: "Conjunta" }, photos: {},
    categories: clone(DEFAULT_CATS), incomeCategories: clone(DEFAULT_INCOME_CATS),
    fixed: {}, tx: {}
  };
}

// Convierte cualquier versión guardada al formato actual.
function normalize(o) {
  o = o || {};
  const toMap = x => {
    if (Array.isArray(x)) { const m = {}; for (const it of x) { const id = safeId(it.id); m[id] = { ...it, id }; } return m; }
    return x && typeof x === "object" ? x : {};
  };
  const fixed = toMap(o.fixed);
  for (const f of Object.values(fixed)) {
    f.type = f.type === "income" ? "income" : "expense";
    f.history = (f.history || []).map(h => ({ since: h.since, amount: round2(h.amount) })).sort((a, b) => a.since < b.since ? -1 : 1);
    if (f.active === false && !f.until) f.until = ymAdd(curYM(), -1);
    delete f.active;
    f.until = f.until || null;
    f.overrides = f.overrides || {};
  }
  const tx = toMap(o.tx);
  for (const t of Object.values(tx)) {
    t.amount = round2(t.amount); t.ym = t.ym || (t.date || "").slice(0, 7);
    if (!KIND[t.kind] || t.kind === "fixed") t.kind = "variable";
  }
  const fixCats = (list, defs) => {
    if (!Array.isArray(list) || !list.length) return clone(defs);
    return list.map(c => ({ ...c, items: Array.isArray(c.items) ? c.items : (clone(defs.find(d => d.name === c.name)?.items || [])) }));
  };
  const d = defaultData();
  const empty = !Object.keys(tx).length && !Object.keys(fixed).length;
  return {
    version: 3,
    currency: o.currency || d.currency,
    names: { ...d.names, ...(o.names || {}) },
    photos: o.photos || {},
    categories: (o.version || 1) < 3 && empty ? d.categories : fixCats(o.categories, DEFAULT_CATS),
    incomeCategories: fixCats(o.incomeCategories, DEFAULT_INCOME_CATS),
    fixed, tx
  };
}

// Importe de un fijo en un mes: excepción de ese mes si la hay; si no, la
// última entrada del histórico con since <= mes. Así los cambios no alteran el pasado.
function fixedAmount(f, ym) {
  const h = f.history || [];
  if (!h.length || ym < h[0].since) return 0;
  if (f.until && ym > f.until) return 0;
  if (f.overrides && f.overrides[ym] != null) return Number(f.overrides[ym]) || 0;
  let a = 0;
  for (const e of h) { if (e.since <= ym) a = Number(e.amount) || 0; else break; }
  return a;
}
const scopesOf = s => s === "home" ? SCOPES : [s];

function monthItems(scope, ym) {
  const sc = scopesOf(scope), out = [];
  for (const f of Object.values(data.fixed)) {
    if (!sc.includes(f.scope)) continue;
    const a = fixedAmount(f, ym);
    if (a > 0) out.push({
      kind: f.type === "income" ? "income" : "fixed", recurring: true, id: f.id,
      concept: f.concept, category: f.category, amount: a, scope: f.scope, date: ym + "-01",
      once: f.overrides?.[ym] != null
    });
  }
  for (const t of Object.values(data.tx)) if (t.ym === ym && sc.includes(t.scope)) out.push(t);
  return out;
}
function totals(items) {
  const t = { fixed: 0, variable: 0, extra: 0, income: 0, expense: 0 };
  for (const i of items) {
    t[i.kind] += i.amount;
    if (i.kind !== "income") t.expense += i.amount;
  }
  for (const k in t) t[k] = round2(t[k]);
  t.saving = round2(t.income - t.expense);
  t.rate = t.income > 0 ? t.saving / t.income * 100 : null;
  return t;
}

const catsFor = type => type === "income" ? data.incomeCategories : data.categories;
const typeOfKind = k => k === "income" ? "income" : "expense";
const catOf = (name, type) => catsFor(type).find(c => c.name === name);
function catColor(name) {
  const i = data.categories.findIndex(c => c.name === name);
  return i < 0 ? "#8FA39C" : PALETTE[i % PALETTE.length];
}
function iconOf(category, concept, type) {
  const c = catOf(category, type) || catOf(category, type === "income" ? "expense" : "income");
  const it = c?.items?.find(i => i.name.toLowerCase() === String(concept || "").toLowerCase());
  return it?.icon || c?.icon || (type === "income" ? "💰" : "📦");
}
const scopeName = s => s === "home" ? "Casa" : (data?.names[s] || s);

/* ═════════ Estado ═════════ */
let fbApp, auth, db, ref, unsub = null, creating = false, migrated = false;
let data = null;
const ui = { scope: LS.get("scope") || "partner", ym: curYM(), range: Number(LS.get("range") || 6), showFixed: false };
const charts = {};

/* ═════════ Arranque ═════════ */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

function boot() {
  if (!LS.get("code")) return showSetup();
  if (LS.get("pin")) return showLock(start);
  start();
}
function showScreen(id) { for (const s of ["setup", "lock", "app"]) $("#" + s).classList.toggle("hidden", s !== id); }

function genCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(16));
  return [...r].map(b => abc[b % abc.length]).join("").match(/.{4}/g).join("-");
}
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
function parseConfig(text) {
  const out = {}, re = /(\w+)\s*:\s*["']([^"']+)["']/g;
  let m; while ((m = re.exec(text))) out[m[1]] = m[2];
  return out.apiKey && out.projectId && out.appId ? out : null;
}

function showSetup() {
  showScreen("setup");
  $("#genCode").onclick = () => { $("#setCode").value = genCode(); $("#setErr").textContent = ""; };
  $("#setGo").onclick = () => {
    const code = cleanCode($("#setCode").value);
    if (code.replace(/-/g, "").length < 12) {
      $("#setErr").textContent = "El código necesita al menos 12 letras o números. Si es la primera vez, pulsa «generar código».";
      return;
    }
    const raw = $("#setConfig").value.trim();
    if (raw) {
      const cfg = parseConfig(raw);
      if (!cfg) { $("#setErr").textContent = "La configuración de Firebase no es válida: faltan apiKey, projectId o appId."; return; }
      LS.set("config", JSON.stringify(cfg));
    }
    LS.set("code", code);
    start();
  };
}

function showLock(then) {
  showScreen("lock");
  const inp = $("#pinIn");
  inp.value = ""; $("#pinErr").textContent = "";
  setTimeout(() => inp.focus(), 50);
  const go = async () => {
    if (await hashPin(inp.value) === LS.get("pin")) then();
    else { $("#pinErr").textContent = "PIN incorrecto."; inp.value = ""; }
  };
  $("#pinGo").onclick = go;
  inp.onkeydown = e => { if (e.key === "Enter") go(); };
}
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (LS.get("pin") && hiddenAt && Date.now() - hiddenAt > 3 * 60 * 1000 && !$("#app").classList.contains("hidden"))
    showLock(() => showScreen("app"));
});

function start() {
  showScreen("app");
  bindStatic();
  applyAccent();
  $("#monthLabel").textContent = ymLabel(ui.ym);
  if (!data) $("#moves").innerHTML = `<div class="empty">Conectando con vuestro hogar…</div>`;
  if (fbApp) return subscribe();
  const cfg = JSON.parse(LS.get("config") || "null") || DEFAULT_CONFIG;
  try {
    fbApp = initializeApp(cfg);
    auth = getAuth(fbApp);
    db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) { return showError(e); }
  onAuthStateChanged(auth, user => { if (user) subscribe(); else signInAnonymously(auth).catch(showError); });
}

function subscribe() {
  if (unsub) return;
  ref = doc(db, "households", LS.get("code"));
  unsub = onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    setSync(snap.metadata);
    if (!snap.exists()) {
      if (!snap.metadata.fromCache && !creating) {
        creating = true;
        setDoc(ref, { ...defaultData(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }).catch(showError);
      }
      return;
    }
    $("#errBanner").classList.add("hidden");
    const raw = snap.data();
    data = normalize(raw);
    if ((raw.version || 1) < 3 && !migrated && !snap.metadata.fromCache) {
      migrated = true;
      write({ version: 3, categories: data.categories, incomeCategories: data.incomeCategories });
    }
    renderAll();
  }, showError);
}

function showError(e) {
  const code = e?.code || "";
  const msg = {
    "auth/operation-not-allowed": "El acceso anónimo no está activado. En Firebase: Seguridad → Authentication → Método de acceso → Anónimo → Habilitar.",
    "auth/unauthorized-domain": "Este dominio no está autorizado. En Firebase: Authentication → Configuración → Dominios autorizados, añade esta dirección.",
    "auth/network-request-failed": "Sin conexión. La app se conectará sola cuando vuelva la red.",
    "permission-denied": "Firebase ha rechazado el acceso. Revisa las reglas de Firestore.",
    "unavailable": "Sin conexión. Los cambios se guardan en el móvil y se sincronizan al volver la red."
  }[code] || ("Error: " + (e?.message || e));
  const b = $("#errBanner"); b.textContent = msg; b.classList.remove("hidden");
  console.error(e);
}
function setSync(meta) {
  const el = $("#sync"); el.className = "sync";
  if (!navigator.onLine || meta?.fromCache) { el.classList.add("offline"); el.textContent = "Sin conexión"; }
  else if (meta?.hasPendingWrites) { el.classList.add("pending"); el.textContent = "Guardando"; }
  else el.textContent = "Sincronizado";
}
window.addEventListener("offline", () => setSync({ fromCache: true }));
window.addEventListener("online", () => { if (auth && !auth.currentUser) signInAnonymously(auth).catch(showError); });

// Cada gasto se guarda en su propio campo: si los dos móviles guardan a la vez, no se pisan.
function write(fields) {
  if (!ref) return;
  fields.updatedAt = serverTimestamp();
  fields.updatedBy = auth?.currentUser?.uid || "";
  updateDoc(ref, fields).catch(showError);
}
const saveTx = t => write({ ["tx." + t.id]: t });
const delTx = id => write({ ["tx." + id]: deleteField() });
const saveFixed = f => write({ ["fixed." + f.id]: f });
const delFixed = id => write({ ["fixed." + id]: deleteField() });
const saveCats = (type, list) => write({ [type === "income" ? "incomeCategories" : "categories"]: list });

/* ═════════ Pantalla principal ═════════ */
let bound = false;
function bindStatic() {
  if (bound) return; bound = true;
  $("#prevM").onclick = () => { ui.ym = ymAdd(ui.ym, -1); renderAll(); };
  $("#nextM").onclick = () => { ui.ym = ymAdd(ui.ym, 1); renderAll(); };
  $("#fab").onclick = () => data && openTx();
  $("#btnFixed").onclick = () => data && openFixedList();
  $("#btnCats").onclick = () => data && openCategories("expense");
  $("#btnSettings").onclick = openSettings;
  $("#stIncome").onclick = () => data && openCategoryDetail(null, "income");
  $("#sheetBg").onclick = closeSheet;
  $("#rangeSeg").onclick = e => { const v = e.target.dataset?.v; if (v) { ui.range = +v; LS.set("range", v); renderAll(); } };
  $("#photoFile").onchange = onPhotoPicked;
}

function applyAccent() {
  const c = SCOPE_COLOR[ui.scope] || SCOPE_COLOR.home;
  document.documentElement.style.setProperty("--accent", c);
}

function renderAll() {
  if (!data) return;
  if (ui.scope !== "home" && !SCOPES.includes(ui.scope)) ui.scope = "partner";
  applyAccent();
  const items = monthItems(ui.scope, ui.ym);
  const t = totals(items);
  renderPeople();
  renderHero(t);
  renderTiles(items, t);
  renderBars();
  renderMoves(items);
}

function avatar(scope, size = "m") {
  const cls = `av av-${size}`;
  if (scope === "home") return `<span class="${cls}" style="background:${tint(SCOPE_COLOR.home, .12)}">🏠</span>`;
  const p = data?.photos?.[scope];
  if (p) return `<span class="${cls}" style="background-image:url('${p}')"></span>`;
  if (scope === "joint") {
    const a = data?.photos?.partner, b = data?.photos?.me;
    if (a && b) return `<span class="${cls} av-duo"><span style="background-image:url('${a}')"></span><span style="background-image:url('${b}')"></span></span>`;
    return `<span class="${cls}" style="background:${tint(SCOPE_COLOR.joint, .14)}">💞</span>`;
  }
  const name = data?.names?.[scope] || "?";
  return `<span class="${cls}" style="background:${tint(SCOPE_COLOR[scope], .16)};color:${SCOPE_COLOR[scope]}">${esc(name[0].toUpperCase())}</span>`;
}

function renderPeople() {
  $("#people").innerHTML = [...SCOPES, "home"].map(s => {
    const t = totals(monthItems(s, ui.ym));
    const on = s === ui.scope;
    return `<button type="button" class="person ${on ? "on" : ""}" data-s="${s}" style="--c:${SCOPE_COLOR[s]}" aria-pressed="${on}">
      <span class="ring">${avatar(s, "l")}${on && s !== "home" ? `<span class="cam" aria-hidden="true">📷</span>` : ""}</span>
      <span class="pn">${esc(scopeName(s))}</span><span class="pt num">${fmt(t.expense, true)}</span></button>`;
  }).join("");
  $("#people").querySelectorAll(".person").forEach(b => b.onclick = () => {
    const s = b.dataset.s;
    if (s === ui.scope && s !== "home") return openPhoto(s);
    ui.scope = s; LS.set("scope", s); renderAll();
  });
}

function renderHero(t) {
  $("#monthLabel").textContent = ymLabel(ui.ym);
  $("#heroLabel").textContent = ui.scope === "home" ? "Gastos de la casa" : ui.scope === "joint" ? "Gastos conjuntos" : "Gastos de " + scopeName(ui.scope);
  $("#totalAmt").textContent = fmt(t.expense);
  const prevYM = ymAdd(ui.ym, -1);
  const prev = totals(monthItems(ui.scope, prevYM)).expense;
  let cmp = "";
  if (prev > 0 && t.expense > 0) {
    const d = (t.expense - prev) / prev * 100;
    cmp = `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)} % frente a ${MONTHS[+prevYM.slice(5) - 1]}`;
  } else if (!t.expense) cmp = "Todavía no hay gastos este mes";
  $("#totalCmp").textContent = cmp;
  const cols = { fixed: "#FFFFFF", variable: "rgba(255,255,255,.62)", extra: "#FFD27A" };
  $("#strip").innerHTML = t.expense ? ["fixed", "variable", "extra"].filter(k => t[k] > 0)
    .map(k => `<span style="flex:${t[k]};background:${cols[k]}"></span>`).join("") : "";
  $("#legend").innerHTML = [["fixed", "Fijos"], ["variable", "Variables"], ["extra", "Extra"]]
    .map(([k, l]) => `<span><i style="background:${cols[k]}"></i>${l} ${fmt(t[k], true)}</span>`).join("");
  $("#vIncome").textContent = t.income ? fmt(t.income, true) : "—";
  $("#vSaving").textContent = t.income ? fmt(t.saving, true) : "—";
  $("#vRate").textContent = t.rate == null ? "—" : Math.round(t.rate) + " %";
}

function renderTiles(items, t) {
  const by = {};
  for (const i of items) if (i.kind !== "income") by[i.category || "Otros"] = (by[i.category || "Otros"] || 0) + i.amount;
  const showBudget = ui.scope === "home";
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (showBudget) for (const c of data.categories) if (c.budget > 0 && !(c.name in by)) rows.push([c.name, 0]);
  if (!rows.length) {
    $("#tiles").innerHTML = `<div class="empty" style="grid-column:1/-1">Cuando añadáis gastos, aquí veréis cuánto se va en cada categoría.</div>`;
    return;
  }
  const max = Math.max(...rows.map(r => r[1]), 1);
  $("#tiles").innerHTML = rows.map(([name, amt]) => {
    const c = catOf(name, "expense"), col = catColor(name);
    const b = showBudget && c?.budget > 0 ? c.budget : 0;
    const over = b && amt > b;
    const w = b ? Math.min(100, amt / b * 100) : amt / max * 100;
    const pct = t.expense ? Math.round(amt / t.expense * 100) : 0;
    return `<button type="button" class="tile" data-c="${esc(name)}">
      <span class="ti" style="background:${tint(col, .14)}">${c?.icon || "📦"}</span>
      <span class="tn">${esc(name)}</span>
      <span class="ta num">${fmt(amt)}</span>
      <span class="tb"><span style="width:${w}%;background:${over ? "var(--danger)" : col}"></span></span>
      <span class="tbud num ${over ? "over" : ""}">${b ? (over ? `${fmt(amt - b, true)} por encima de ${fmt(b, true)}` : `Quedan ${fmt(b - amt, true)} de ${fmt(b, true)}`) : `${pct} % del total`}</span>
    </button>`;
  }).join("");
  $("#tiles").querySelectorAll(".tile").forEach(b => b.onclick = () => openCategoryDetail(b.dataset.c, "expense"));
}

function renderBars() {
  document.querySelectorAll("#rangeSeg button").forEach(b => b.classList.toggle("on", +b.dataset.v === ui.range));
  const months = [];
  for (let i = ui.range - 1; i >= 0; i--) months.push(ymAdd(ui.ym, -i));
  const tots = months.map(m => totals(monthItems(ui.scope, m)));
  const exp = round2(tots.reduce((s, t) => s + t.expense, 0));
  const inc = round2(tots.reduce((s, t) => s + t.income, 0));
  const n = tots.filter(t => t.expense > 0).length || 1;
  $("#rangeNote").innerHTML = `En ${ui.range} meses: gastos ${fmt(exp, true)} (media ${fmt(exp / n, true)} al mes)` +
    (inc ? `, ingresos ${fmt(inc, true)}, ahorro ${fmt(inc - exp, true)}.` : ".");
  if (!window.Chart) return;
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#667872";
  const font = { family: "Bricolage Grotesque, system-ui, sans-serif", size: 11 };
  const ds = ["fixed", "variable", "extra"].map(k => ({
    type: "bar", label: { fixed: "Fijos", variable: "Variables", extra: "Extra" }[k],
    data: tots.map(t => t[k]), backgroundColor: KIND_COLOR[k], borderRadius: 5, stack: "g", order: 2
  }));
  if (inc) ds.push({
    type: "line", label: "Ingresos", data: tots.map(t => t.income), borderColor: KIND_COLOR.income,
    backgroundColor: KIND_COLOR.income, borderWidth: 2.5, pointRadius: 3, tension: .3, stack: "i", order: 1
  });
  drawChart("bars", {
    data: { labels: months.map(m => ymLabel(m, ui.range > 6 ? "short" : "shortY")), datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: muted, font } },
        y: { stacked: true, beginAtZero: true, ticks: { color: muted, font, callback: v => fmt(v, true) }, grid: { color: "rgba(127,127,127,.14)" }, border: { display: false } }
      },
      plugins: {
        legend: { position: "bottom", labels: { color: muted, boxWidth: 9, boxHeight: 9, usePointStyle: true, font: { ...font, size: 12 } } },
        tooltip: { callbacks: { label: c => " " + c.dataset.label + ": " + fmt(c.parsed.y) } }
      }
    }
  });
}
function drawChart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($("#" + id), cfg); }

function rowHTML(i) {
  const type = typeOfKind(i.kind);
  const col = type === "income" ? KIND_COLOR.income : catColor(i.category);
  const tag = i.kind === "fixed" ? `<span class="tag tag-fixed">Fijo</span>` : i.kind === "extra" ? `<span class="tag tag-extra">Extra</span>` : i.kind === "income" ? `<span class="tag tag-income">${i.recurring ? "Recurrente" : "Ingreso"}</span>` : "";
  const sub = [i.category, i.note].filter(Boolean).map(esc).join(", ") + (i.once ? ", solo este mes" : "");
  return `<li><button type="button" class="row" data-kind="${i.recurring ? "fixed" : "tx"}" data-id="${i.id}">
    <span class="ri" style="background:${tint(col, .13)}">${iconOf(i.category, i.concept, type)}${ui.scope === "home" ? avatar(i.scope, "s") : ""}</span>
    <span class="rm"><div class="c">${esc(i.concept)}</div><div class="s">${tag}${sub}</div></span>
    <span class="ra num ${type === "income" ? "plus" : ""}">${type === "income" ? "+" : ""}${fmt(i.amount)}</span></button></li>`;
}
function bindRows(root) {
  root.querySelectorAll(".row[data-id]").forEach(b => b.onclick = () => {
    if (b.dataset.kind === "fixed") openFixedEdit(data.fixed[b.dataset.id]);
    else openTx(data.tx[b.dataset.id]);
  });
}

function renderMoves(items) {
  if (!items.length) {
    $("#moves").innerHTML = `<div class="empty">No hay movimientos en ${ymLabel(ui.ym, "lower")}. Pulsa «Añadir» para apuntar el primero, o crea vuestros gastos fijos en «Fijos y nóminas».</div>`;
    return;
  }
  const fixed = items.filter(i => i.kind === "fixed").sort((a, b) => b.amount - a.amount);
  const income = items.filter(i => i.kind === "income").sort((a, b) => b.amount - a.amount);
  const loose = items.filter(i => i.kind === "variable" || i.kind === "extra").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const days = {};
  for (const i of loose) (days[i.date] = days[i.date] || []).push(i);
  let html = "";
  if (income.length) html += `<div class="group"><div class="group-h"><span>Ingresos</span><span class="num">+${fmt(income.reduce((s, i) => s + i.amount, 0))}</span></div><ul class="rows">${income.map(rowHTML).join("")}</ul></div>`;
  if (fixed.length) {
    const sum = fixed.reduce((s, i) => s + i.amount, 0);
    html += `<div class="group"><div class="group-h"><button type="button" id="tgFixed"><span>Gastos fijos (${fixed.length}) ${ui.showFixed ? "▴" : "▾"}</span><span class="num">${fmt(sum)}</span></button></div>
      ${ui.showFixed ? `<ul class="rows">${fixed.map(rowHTML).join("")}</ul>` : ""}</div>`;
  }
  for (const [d, list] of Object.entries(days)) {
    html += `<div class="group"><div class="group-h"><span>${dayLabel(d)}</span><span class="num">${fmt(list.reduce((s, i) => s + i.amount, 0))}</span></div><ul class="rows">${list.map(rowHTML).join("")}</ul></div>`;
  }
  $("#moves").innerHTML = html;
  $("#tgFixed")?.addEventListener("click", () => { ui.showFixed = !ui.showFixed; renderMoves(items); });
  bindRows($("#moves"));
}

/* ═════════ Hojas ═════════ */
function openSheet(html) {
  const s = $("#sheet");
  s.innerHTML = `<div class="grab"></div><button type="button" class="sheet-x" aria-label="Cerrar">×</button>` + html;
  s.querySelector(".sheet-x").onclick = closeSheet;
  s.classList.remove("hidden"); $("#sheetBg").classList.remove("hidden");
  s.scrollTop = 0;
  bindSegs(s);
  return s;
}
function bindSegs(root) {
  root.querySelectorAll(".seg[data-name]").forEach(seg => {
    if (seg._b) return; seg._b = 1;
    seg.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]"); if (!b) return;
      seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      seg.dispatchEvent(new CustomEvent("pick", { detail: b.dataset.v }));
    });
  });
}
function closeSheet() { $("#sheet").classList.add("hidden"); $("#sheetBg").classList.add("hidden"); $("#sheet").innerHTML = ""; }
const segHTML = (name, opts, val) => `<div class="seg" data-name="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === val ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
const segVal = (s, name) => s.querySelector(`.seg[data-name="${name}"] .on`)?.dataset.v;
const whoHTML = sel => `<div class="who">${SCOPES.map(s => `<button type="button" data-s="${s}" class="${s === sel ? "on" : ""}" style="--c:${SCOPE_COLOR[s]}">${avatar(s, "s")}<span class="n">${esc(data.names[s])}</span></button>`).join("")}</div>`;
function bindWho(s, onPick) {
  s.querySelectorAll(".who button").forEach(b => b.onclick = () => {
    s.querySelectorAll(".who button").forEach(x => x.classList.toggle("on", x === b)); onPick(b.dataset.s);
  });
}
const paletteHTML = () => `<div class="pal">${EMOJIS.map(e => `<button type="button" data-e="${e}">${e}</button>`).join("")}</div>`;
// Muestra la paleta de iconos bajo un botón de icono y aplica el elegido.
function attachPalette(btn, holder) {
  btn.onclick = () => {
    if (holder.innerHTML) { holder.innerHTML = ""; return; }
    holder.innerHTML = paletteHTML();
    holder.querySelectorAll("button[data-e]").forEach(p => p.onclick = () => { btn.textContent = p.dataset.e; holder.innerHTML = ""; });
  };
}

/* ── Añadir o editar movimiento ── */
function openTx(t) {
  const isNew = !t;
  const st = t ? { ...t } : {
    kind: "variable", scope: ui.scope === "home" ? "joint" : ui.scope,
    date: ui.ym === curYM() ? today() : ui.ym + "-01", category: "", concept: "", amount: "", note: ""
  };
  const s = openSheet(`
    <h3>${isNew ? "Nuevo movimiento" : "Editar movimiento"}</h3>
    ${segHTML("kind", [["variable", "Gasto"], ["extra", "Extraordinario"], ["income", "Ingreso"]], st.kind)}
    <div class="big-amount"><input id="fAmount" class="num" inputmode="decimal" placeholder="0" value="${esc(amountToInput(st.amount))}" aria-label="Importe"><span>${curSymbol()}</span></div>
    <span class="lbl">Quién</span>${whoHTML(st.scope)}
    <span class="lbl">Categoría</span><div class="chips" id="fCats"></div>
    <span class="lbl">Concepto</span><div class="chips wrap" id="fConcepts"></div>
    <div id="fNew"></div>
    <div class="row2">
      <div><span class="lbl">Fecha</span><input id="fDate" class="inp" type="date" value="${esc(st.date)}"></div>
      <div><span class="lbl">Nota</span><input id="fNote" class="inp" value="${esc(st.note)}" placeholder="Opcional"></div>
    </div>
    <div id="fErr" class="err"></div>
    <div class="actions">${isNew ? "" : `<button type="button" id="fDel" class="btn danger">Borrar</button>`}<button type="button" id="fSave" class="btn primary">Guardar</button></div>`);

  const type = () => typeOfKind(st.kind);
  const ensureCat = () => {
    const list = catsFor(type());
    if (!list.some(c => c.name === st.category)) {
      st.category = type() === "income" ? (list[0]?.name || "") : (list.find(c => c.name === "Ocio")?.name || list[0]?.name || "");
      st.concept = "";
    }
  };
  const drawCats = () => {
    ensureCat();
    const el = s.querySelector("#fCats");
    el.innerHTML = catsFor(type()).map(c => `<button type="button" class="chip ${c.name === st.category ? "on" : ""}" data-c="${esc(c.name)}">${c.icon} ${esc(c.name)}</button>`).join("");
    el.querySelectorAll(".chip").forEach(b => b.onclick = () => { st.category = b.dataset.c; st.concept = ""; drawCats(); });
    el.querySelector(".chip.on")?.scrollIntoView({ block: "nearest", inline: "center" });
    drawConcepts();
  };
  const drawConcepts = () => {
    const c = catOf(st.category, type());
    const items = (c?.items || []).slice();
    if (st.concept && !items.some(i => i.name === st.concept)) items.unshift({ name: st.concept, icon: c?.icon || "📦" });
    const el = s.querySelector("#fConcepts");
    el.innerHTML = items.map(i => `<button type="button" class="chip ${i.name === st.concept ? "on" : ""}" data-n="${esc(i.name)}">${i.icon} ${esc(i.name)}</button>`).join("") +
      `<button type="button" class="chip add" id="fAddC">+ Nuevo concepto</button>`;
    el.querySelectorAll(".chip[data-n]").forEach(b => b.onclick = () => { st.concept = b.dataset.n; drawConcepts(); });
    el.querySelector("#fAddC").onclick = openNewConcept;
  };
  const openNewConcept = () => {
    const box = s.querySelector("#fNew");
    box.innerHTML = `<div class="mini"><div class="mini-row">
      <button type="button" class="emoji-btn" id="nIco">${catOf(st.category, type())?.icon || "📦"}</button>
      <input id="nName" class="inp" placeholder="Nombre del concepto">
      <button type="button" class="btn small primary" id="nOk">Añadir</button></div><div id="nPal"></div>
      <p class="hint" style="margin:8px 0 0">Se guarda en «${esc(st.category)}» para usarlo siempre. Toca el icono para cambiarlo.</p></div>`;
    attachPalette(box.querySelector("#nIco"), box.querySelector("#nPal"));
    box.querySelector("#nName").focus();
    box.querySelector("#nOk").onclick = () => {
      const name = box.querySelector("#nName").value.trim();
      if (!name) return;
      const list = clone(catsFor(type()));
      const c = list.find(x => x.name === st.category);
      if (!c) return;
      c.items = c.items || [];
      if (!c.items.some(i => i.name.toLowerCase() === name.toLowerCase())) c.items.push({ name, icon: box.querySelector("#nIco").textContent });
      if (type() === "income") data.incomeCategories = list; else data.categories = list;
      saveCats(type(), list);
      st.concept = name; box.innerHTML = ""; drawConcepts();
    };
  };
  s.querySelector('.seg[data-name="kind"]').addEventListener("pick", e => {
    const wasIncome = st.kind === "income"; st.kind = e.detail;
    if (wasIncome !== (st.kind === "income")) drawCats();
  });
  bindWho(s, v => st.scope = v);
  drawCats();
  if (isNew) setTimeout(() => s.querySelector("#fAmount").focus(), 90);

  s.querySelector("#fSave").onclick = () => {
    const amount = parseAmount(s.querySelector("#fAmount").value);
    if (!(amount > 0)) { s.querySelector("#fErr").textContent = "Escribe un importe mayor que cero."; return; }
    if (!st.concept) { s.querySelector("#fErr").textContent = "Elige un concepto o crea uno nuevo."; return; }
    const date = s.querySelector("#fDate").value || today();
    const out = { id: st.id || newId(), kind: st.kind, scope: st.scope, date, ym: date.slice(0, 7), amount,
      category: st.category, concept: st.concept, note: s.querySelector("#fNote").value.trim() };
    saveTx(out); closeSheet();
    toast(out.ym === ui.ym ? (out.kind === "income" ? "Ingreso guardado" : "Gasto guardado") : `Guardado en ${ymLabel(out.ym, "lower")}`);
  };
  s.querySelector("#fDel")?.addEventListener("click", () => {
    if (!confirm("¿Borrar este movimiento?")) return;
    delTx(st.id); closeSheet(); toast("Movimiento borrado");
  });
}

/* ── Detalle de una categoría (o de los ingresos) ── */
function openCategoryDetail(catName, type) {
  const items = monthItems(ui.scope, ui.ym).filter(i => typeOfKind(i.kind) === type && (!catName || i.category === catName));
  const total = items.reduce((s, i) => s + i.amount, 0);
  const by = {};
  for (const i of items) { const k = i.concept || "Sin concepto"; by[k] = by[k] || { amt: 0, n: 0, cat: i.category }; by[k].amt += i.amount; by[k].n++; }
  const c = catName ? catOf(catName, type) : null;
  const col = type === "income" ? KIND_COLOR.income : catColor(catName);
  const s = openSheet(`
    <h3>${c ? c.icon + " " + esc(catName) : "Ingresos"}</h3>
    <p class="hint">${esc(scopeName(ui.scope))}, ${ymLabel(ui.ym, "lower")}: <b class="num">${fmt(total)}</b>${c?.budget && ui.scope === "home" ? ` de ${fmt(c.budget)} de presupuesto` : ""}</p>
    ${items.length ? `<h4>Por concepto</h4><ul class="list">${Object.entries(by).sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => `
      <li style="padding:10px 0"><div style="display:flex;gap:10px;align-items:center">
        <span class="ri" style="background:${tint(col, .13)};width:34px;height:34px;font-size:17px">${iconOf(v.cat, k, type)}</span>
        <span style="flex:1">${esc(k)} <span class="muted" style="font-size:13px">${v.n > 1 ? "× " + v.n : ""}</span></span>
        <b class="num">${fmt(v.amt)}</b></div>
        <div class="tb" style="height:5px;border-radius:3px;background:var(--soft);margin:8px 0 0 44px;overflow:hidden"><span style="display:block;height:100%;width:${total ? v.amt / total * 100 : 0}%;background:${col}"></span></div></li>`).join("")}</ul>
      <h4>Movimientos</h4><ul class="rows">${items.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(rowHTML).join("")}</ul>`
      : `<div class="empty">No hay ${type === "income" ? "ingresos" : "gastos"} aquí este mes.</div>`}
    <div class="actions"><button type="button" id="dAdd" class="btn primary">${type === "income" ? "Añadir ingreso" : "Añadir gasto aquí"}</button></div>`);
  bindRows(s);
  s.querySelector("#dAdd").onclick = () => {
    const base = { kind: type === "income" ? "income" : "variable", scope: ui.scope === "home" ? "joint" : ui.scope,
      date: ui.ym === curYM() ? today() : ui.ym + "-01", category: catName || "", concept: "", amount: "", note: "" };
    openTxPreset(base);
  };
}
function openTxPreset(base) {
  // Abre la hoja de alta con valores ya elegidos, sin tratarla como edición.
  openTx(null);
  const s = $("#sheet");
  s.querySelector(`.seg[data-name="kind"] button[data-v="${base.kind}"]`)?.click();
  s.querySelector(`.who button[data-s="${base.scope}"]`)?.click();
  if (base.category) s.querySelector(`#fCats .chip[data-c="${CSS.escape(base.category)}"]`)?.click();
}

/* ── Fijos y nóminas ── */
function fixedStatus(f, ym) {
  const first = f.history[0]?.since;
  if (first && ym < first) return `Empieza en ${ymLabel(first, "lower")}`;
  if (f.until && ym > f.until) return `De baja desde ${ymLabel(ymAdd(f.until, 1), "lower")}`;
  return null;
}
function openFixedList() {
  const all = Object.values(data.fixed);
  const block = (type, title) => {
    const html = SCOPES.map(sc => {
      const fs = all.filter(f => f.scope === sc && f.type === type).sort((a, b) => fixedAmount(b, ui.ym) - fixedAmount(a, ui.ym));
      if (!fs.length) return "";
      const sum = fs.reduce((s, f) => s + fixedAmount(f, ui.ym), 0);
      return `<h4>${avatar(sc, "s")} ${esc(data.names[sc])} <span class="muted num" style="font-weight:500;margin-left:auto">${fmt(sum)}</span></h4>
        <ul class="rows">${fs.map(f => {
          const st = fixedStatus(f, ui.ym);
          return `<li><button type="button" class="row" data-id="${f.id}">
            <span class="ri" style="background:${tint(type === "income" ? KIND_COLOR.income : catColor(f.category), .13)}">${iconOf(f.category, f.concept, type)}</span>
            <span class="rm"><div class="c">${esc(f.concept)}</div><div class="s">${esc(st || f.category)}${f.until && !st ? ", hasta " + ymLabel(f.until, "lower") : ""}</div></span>
            <span class="ra num">${st ? "—" : fmt(fixedAmount(f, ui.ym))}</span></button></li>`;
        }).join("")}</ul>`;
    }).join("");
    return html ? `<h3 style="font-size:19px;margin-top:22px">${title}</h3>${html}` : "";
  };
  const body = block("expense", "Gastos fijos") + block("income", "Ingresos recurrentes");
  const s = openSheet(`
    <h3>Fijos y nóminas</h3>
    <p class="hint">Se suman solos cada mes. Importes de ${ymLabel(ui.ym, "lower")}. En enero o febrero usa «Revisión anual» para actualizarlos todos de una vez.</p>
    <div class="btns"><button type="button" id="fxNew" class="btn small primary">Nuevo gasto fijo</button><button type="button" id="fxInc" class="btn small">Nueva nómina o ingreso</button><button type="button" id="fxRev" class="btn small dark">Revisión anual</button></div>
    ${body || `<div class="empty" style="margin-top:16px">Todavía no hay fijos. Añade el alquiler, los seguros, las suscripciones o las nóminas y se sumarán solos cada mes.</div>`}`);
  s.querySelector("#fxNew").onclick = () => openFixedEdit(null, "expense");
  s.querySelector("#fxInc").onclick = () => openFixedEdit(null, "income");
  s.querySelector("#fxRev").onclick = () => openReview();
  s.querySelectorAll(".row[data-id]").forEach(b => b.onclick = () => openFixedEdit(data.fixed[b.dataset.id]));
}

function openFixedEdit(f, newType) {
  const isNew = !f;
  f = f ? clone(f) : { type: newType || "expense", concept: "", category: "", scope: ui.scope === "home" ? "joint" : ui.scope, history: [], until: null, overrides: {} };
  const st = { type: f.type, scope: f.scope, category: f.category };
  const cur = isNew ? "" : (fixedAmount(f, ui.ym) || f.history[f.history.length - 1]?.amount || "");
  const overrides = Object.entries(f.overrides || {}).sort();
  const s = openSheet(`
    <h3>${isNew ? (f.type === "income" ? "Nueva nómina o ingreso" : "Nuevo gasto fijo") : esc(f.concept)}</h3>
    ${isNew ? segHTML("type", [["expense", "Gasto fijo"], ["income", "Ingreso recurrente"]], f.type) : ""}
    <div class="big-amount"><input id="xAmount" class="num" inputmode="decimal" placeholder="0" value="${esc(amountToInput(cur))}" aria-label="Importe mensual"><span>${curSymbol()}/mes</span></div>
    <span class="lbl">Quién</span>${whoHTML(f.scope)}
    <span class="lbl">Categoría</span><div class="chips" id="xCats"></div>
    <span class="lbl">Concepto</span><input id="xConcept" class="inp" list="xList" value="${esc(f.concept)}" placeholder="Ej.: alquiler, nómina">
    <datalist id="xList"></datalist>
    ${isNew ? `<span class="lbl">Empieza en</span><input id="xSince" class="inp" type="month" value="${ui.ym}">` : `
      <span class="lbl">¿Cómo aplico el cambio de importe?</span>
      <label class="radio"><input type="radio" name="xMode" value="from" checked><span>Desde un mes en adelante, conservando lo anterior (subidas, bajadas)</span></label>
      <div id="xSinceWrap" style="margin:-2px 0 10px 30px"><input id="xSince" class="inp" type="month" value="${ui.ym}"></div>
      <label class="radio"><input type="radio" name="xMode" value="once"><span>Solo en ${ymLabel(ui.ym, "lower")} (una nómina distinta, un recibo puntual)</span></label>
      <label class="radio"><input type="radio" name="xMode" value="all"><span>Corregir todos los meses (me equivoqué al crearlo)</span></label>`}
    <span class="lbl">Último mes que se cobra (opcional)</span><input id="xUntil" class="inp" type="month" value="${esc(f.until || "")}">
    ${!isNew ? `<h4>Histórico</h4><ul class="list hist num">${f.history.slice().reverse().map(h => `<li><span>Desde ${ymLabel(h.since, "lower")}</span><b>${fmt(h.amount)}</b></li>`).join("")}
      ${overrides.map(([m, a]) => `<li><span>Solo ${ymLabel(m, "lower")}</span><span><b>${fmt(a)}</b> <button type="button" class="x" data-ov="${m}" aria-label="Quitar excepción">×</button></span></li>`).join("")}</ul>` : ""}
    <div id="xErr" class="err"></div>
    <div class="actions"><button type="button" id="xSave" class="btn primary">Guardar</button></div>
    ${isNew ? "" : `<div class="actions"><button type="button" id="xStop" class="btn">Dar de baja desde ${ymLabel(ui.ym, "short")}</button><button type="button" id="xDel" class="btn danger">Borrar</button></div>`}`);

  const drawCats = () => {
    const list = catsFor(st.type);
    if (!list.some(c => c.name === st.category)) st.category = st.type === "income" ? list[0]?.name : (list.find(c => c.name === "Vivienda") || list[0])?.name;
    const el = s.querySelector("#xCats");
    el.innerHTML = list.map(c => `<button type="button" class="chip ${c.name === st.category ? "on" : ""}" data-c="${esc(c.name)}">${c.icon} ${esc(c.name)}</button>`).join("");
    el.querySelectorAll(".chip").forEach(b => b.onclick = () => { st.category = b.dataset.c; drawCats(); });
    s.querySelector("#xList").innerHTML = (catOf(st.category, st.type)?.items || []).map(i => `<option value="${esc(i.name)}">`).join("");
  };
  drawCats();
  s.querySelector('.seg[data-name="type"]')?.addEventListener("pick", e => { st.type = e.detail; drawCats(); });
  bindWho(s, v => st.scope = v);
  s.querySelectorAll('input[name="xMode"]').forEach(r => r.onchange = () =>
    s.querySelector("#xSinceWrap").classList.toggle("hidden", s.querySelector('input[name="xMode"]:checked').value !== "from"));
  s.querySelectorAll("button[data-ov]").forEach(b => b.onclick = () => {
    delete f.overrides[b.dataset.ov]; saveFixed(f); toast("Excepción quitada"); openFixedEdit(f);
  });
  const err = m => s.querySelector("#xErr").textContent = m;

  s.querySelector("#xSave").onclick = () => {
    const amount = parseAmount(s.querySelector("#xAmount").value);
    const concept = s.querySelector("#xConcept").value.trim();
    const until = s.querySelector("#xUntil").value || null;
    if (!concept) return err("Escribe un concepto.");
    if (isNaN(amount) || amount < 0) return err("Escribe un importe válido.");
    let history = f.history.slice();
    const overrides = { ...(f.overrides || {}) };
    if (isNew) history = [{ since: s.querySelector("#xSince").value || ui.ym, amount }];
    else {
      const mode = s.querySelector('input[name="xMode"]:checked').value;
      if (mode === "all") { history = [{ since: history[0]?.since || ui.ym, amount }]; for (const k in overrides) delete overrides[k]; }
      else if (mode === "once") overrides[ui.ym] = amount;
      else {
        const since = s.querySelector("#xSince").value || ui.ym;
        if (fixedAmount({ history }, since) !== amount) {
          history = history.filter(h => h.since !== since);
          history.push({ since, amount });
          history.sort((a, b) => a.since < b.since ? -1 : 1);
        }
      }
    }
    if (until && until < history[0].since) return err("El último mes es anterior al primero.");
    saveFixed({ id: f.id || newId(), type: st.type, concept, category: st.category, scope: st.scope, history, until, overrides });
    toast("Guardado"); openFixedList();
  };
  s.querySelector("#xStop")?.addEventListener("click", () => {
    const until = ymAdd(ui.ym, -1);
    if (until < f.history[0].since) { if (!confirm("Aún no se había cobrado ningún mes. ¿Borrarlo?")) return; delFixed(f.id); }
    else saveFixed({ ...f, until });
    toast("Dado de baja"); openFixedList();
  });
  s.querySelector("#xDel")?.addEventListener("click", () => {
    if (!confirm("¿Borrarlo de todos los meses? Si ya no lo pagáis, mejor «Dar de baja» para conservar los meses anteriores.")) return;
    delFixed(f.id); toast("Borrado"); openFixedList();
  });
}

/* ── Revisión anual de fijos ── */
function openReview(year) {
  const now = new Date();
  year = year || (now.getMonth() <= 5 ? now.getFullYear() : now.getFullYear() + 1);
  const jan = `${year}-01`, dec = `${year - 1}-12`;
  const list = Object.values(data.fixed).filter(f => !(f.until && f.until < dec) && f.history.length);
  const rows = SCOPES.map(sc => {
    const fs = list.filter(f => f.scope === sc).sort((a, b) => (a.type === b.type ? 0 : a.type > b.type ? 1 : -1) || fixedAmount(b, dec) - fixedAmount(a, dec));
    if (!fs.length) return "";
    return `<h4>${avatar(sc, "s")} ${esc(data.names[sc])}</h4>` + fs.map(f => {
      const before = fixedAmount(f, dec) || f.history[f.history.length - 1].amount;
      const after = f.history.find(h => h.since === jan)?.amount ?? before;
      const ended = f.until && f.until < jan;
      return `<div class="review-row ${ended ? "off" : ""}" data-id="${f.id}">
        <span class="ri" style="background:${tint(f.type === "income" ? KIND_COLOR.income : catColor(f.category), .13)}">${iconOf(f.category, f.concept, f.type)}</span>
        <span class="rm"><div class="c">${esc(f.concept)}</div><div class="s num">${f.type === "income" ? "Ingreso, " : ""}antes ${fmt(before)}</div></span>
        <input class="inp num" inputmode="decimal" value="${esc(amountToInput(after))}" aria-label="Importe ${year}">
        <input type="checkbox" ${ended ? "" : "checked"} aria-label="Sigue en ${year}"></div>`;
    }).join("");
  }).join("");
  const s = openSheet(`
    <h3>Revisión anual</h3>
    <div class="month" style="background:var(--paper);border-radius:14px;padding:4px;margin-bottom:10px">
      <button type="button" id="rPrev" style="background:none;color:var(--ink)">‹</button><b>Fijos para ${year}</b><button type="button" id="rNext" style="background:none;color:var(--ink)">›</button></div>
    <p class="hint">Cambia los importes que suben o bajan en ${year} y desmarca los que ya no pagáis. Se aplica desde enero de ${year}; los meses anteriores no cambian.</p>
    ${rows || `<div class="empty">No hay fijos que revisar.</div>`}
    <div class="actions"><button type="button" id="rAdd" class="btn">Añadir uno nuevo</button><button type="button" id="rSave" class="btn primary">Aplicar a ${year}</button></div>`);
  s.querySelector("#rPrev").onclick = () => openReview(year - 1);
  s.querySelector("#rNext").onclick = () => openReview(year + 1);
  s.querySelector("#rAdd").onclick = () => { ui.ym = jan; renderAll(); openFixedEdit(null, "expense"); };
  s.querySelectorAll(".review-row input[type=checkbox]").forEach(c => c.onchange = () => c.closest(".review-row").classList.toggle("off", !c.checked));
  s.querySelector("#rSave").onclick = () => {
    const fields = {}; let changed = 0, removed = 0;
    for (const r of s.querySelectorAll(".review-row")) {
      const f = clone(data.fixed[r.dataset.id]);
      const keep = r.querySelector("input[type=checkbox]").checked;
      const amount = parseAmount(r.querySelector(".inp").value);
      if (!keep) {
        if (f.history[0].since >= jan) { fields["fixed." + f.id] = deleteField(); removed++; continue; }
        if (f.until !== dec) { f.until = dec; fields["fixed." + f.id] = f; removed++; }
        continue;
      }
      let touched = false;
      if (f.until && f.until < jan) { f.until = null; touched = true; }
      if (!isNaN(amount) && fixedAmount({ history: f.history }, jan) !== amount) {
        f.history = f.history.filter(h => h.since !== jan);
        f.history.push({ since: jan, amount });
        f.history.sort((a, b) => a.since < b.since ? -1 : 1);
        touched = true;
      }
      if (touched) { fields["fixed." + f.id] = f; changed++; }
    }
    if (!changed && !removed) return toast("No has cambiado nada");
    write(fields);
    toast(`${year}: ${changed} actualizados, ${removed} dados de baja`);
    openFixedList();
  };
}

/* ── Categorías y conceptos ── */
function openCategories(type) {
  const list = catsFor(type);
  const s = openSheet(`
    <h3>Categorías</h3>
    ${segHTML("ctype", [["expense", "Gastos"], ["income", "Ingresos"]], type)}
    <p class="hint" style="margin-top:12px">Toca una categoría para cambiar su icono, su presupuesto o sus conceptos.</p>
    <ul class="rows">${list.map((c, i) => `<li><button type="button" class="row" data-i="${i}">
      <span class="ri" style="background:${tint(type === "income" ? KIND_COLOR.income : catColor(c.name), .13)}">${c.icon}</span>
      <span class="rm"><div class="c">${esc(c.name)}</div><div class="s">${(c.items || []).slice(0, 5).map(x => x.icon).join(" ")} ${(c.items || []).length} conceptos</div></span>
      <span class="ra num muted" style="font-weight:500;font-size:14px">${c.budget ? fmt(c.budget, true) + "/mes" : ""}</span></button></li>`).join("")}</ul>
    <div class="actions"><button type="button" id="cNew" class="btn primary">Nueva categoría</button></div>`);
  s.querySelector('.seg[data-name="ctype"]').addEventListener("pick", e => openCategories(e.detail));
  s.querySelectorAll(".row[data-i]").forEach(b => b.onclick = () => openCatEdit(type, +b.dataset.i));
  s.querySelector("#cNew").onclick = () => openCatEdit(type, -1);
}

function openCatEdit(type, idx) {
  const isNew = idx < 0;
  const c = isNew ? { name: "", icon: "📦", items: [] } : clone(catsFor(type)[idx]);
  const itemRow = (it = { name: "", icon: c.icon }) => `<div class="concept-edit" data-orig="${esc(it.name)}">
      <button type="button" class="emoji-btn">${it.icon || c.icon}</button>
      <input class="inp nm" value="${esc(it.name)}" placeholder="Concepto">
      <button type="button" class="x" aria-label="Quitar">×</button></div><div class="palh"></div>`;
  const s = openSheet(`
    <h3>${isNew ? "Nueva categoría" : "Editar categoría"}</h3>
    <div class="mini-row"><button type="button" class="emoji-btn" id="cIco">${c.icon}</button>
      <input id="cName" class="inp" value="${esc(c.name)}" placeholder="Nombre de la categoría"></div>
    <div id="cPal"></div>
    ${type === "expense" ? `<span class="lbl">Presupuesto mensual de la casa (opcional)</span><input id="cBudget" class="inp num" inputmode="decimal" value="${esc(amountToInput(c.budget ?? ""))}" placeholder="Sin límite">` : ""}
    <span class="lbl">Conceptos</span>
    <div id="cItems">${(c.items || []).map(itemRow).join("")}</div>
    <button type="button" id="cAddItem" class="btn small">Añadir concepto</button>
    <div id="cErr" class="err"></div>
    <div class="actions">${isNew ? "" : `<button type="button" id="cDel" class="btn danger">Borrar</button>`}<button type="button" id="cSave" class="btn primary">Guardar</button></div>`);
  attachPalette(s.querySelector("#cIco"), s.querySelector("#cPal"));
  const bindItems = () => s.querySelectorAll(".concept-edit").forEach(r => {
    if (r._b) return; r._b = 1;
    attachPalette(r.querySelector(".emoji-btn"), r.nextElementSibling);
    r.querySelector(".x").onclick = () => { r.nextElementSibling.remove(); r.remove(); };
  });
  bindItems();
  s.querySelector("#cAddItem").onclick = () => {
    s.querySelector("#cItems").insertAdjacentHTML("beforeend", itemRow());
    bindItems(); [...s.querySelectorAll("#cItems .concept-edit .nm")].pop()?.focus();
  };
  const err = m => s.querySelector("#cErr").textContent = m;
  const fallbackName = type === "income" ? "Otros ingresos" : "Otros";

  // Aplica renombrados y borrados a todos los movimientos y fijos afectados.
  const remapFields = (catMap, conceptMap, targetCat) => {
    const fields = {};
    for (const [col, map] of [["tx", data.tx], ["fixed", data.fixed]]) for (const x of Object.values(map)) {
      const xt = col === "tx" ? typeOfKind(x.kind) : x.type;
      if (xt !== type) continue;
      if (catMap[x.category]) fields[`${col}.${x.id}.category`] = catMap[x.category];
      if (x.category === targetCat && conceptMap[x.concept]) fields[`${col}.${x.id}.concept`] = conceptMap[x.concept];
    }
    return fields;
  };

  s.querySelector("#cSave").onclick = () => {
    const name = s.querySelector("#cName").value.trim();
    if (!name) return err("Escribe un nombre.");
    const list = clone(catsFor(type));
    if (list.some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) return err("Ya hay una categoría con ese nombre.");
    const items = [], conceptMap = {};
    for (const r of s.querySelectorAll(".concept-edit")) {
      const n = r.querySelector(".nm").value.trim();
      if (!n) continue;
      if (items.some(i => i.name.toLowerCase() === n.toLowerCase())) return err(`El concepto «${n}» está repetido.`);
      items.push({ name: n, icon: r.querySelector(".emoji-btn").textContent });
      if (r.dataset.orig && r.dataset.orig !== n) conceptMap[r.dataset.orig] = n;
    }
    const out = { name, icon: s.querySelector("#cIco").textContent, items };
    const b = type === "expense" ? parseAmount(s.querySelector("#cBudget").value) : NaN;
    if (b > 0) out.budget = b;
    if (isNew) list.push(out); else list[idx] = out;
    const catMap = !isNew && c.name !== name ? { [c.name]: name } : {};
    const fields = { [type === "income" ? "incomeCategories" : "categories"]: list, ...remapFields(catMap, conceptMap, c.name) };
    write(fields); toast("Categoría guardada"); openCategories(type);
  };
  s.querySelector("#cDel")?.addEventListener("click", () => {
    const list = clone(catsFor(type));
    if (list.length <= 1) return err("Tiene que quedar al menos una categoría.");
    if (!confirm(`¿Borrar «${c.name}»? Sus movimientos pasarán a «${c.name === fallbackName ? list.find(x => x.name !== c.name).name : fallbackName}».`)) return;
    list.splice(idx, 1);
    let target = c.name === fallbackName ? list[0].name : fallbackName;
    if (!list.some(x => x.name === target)) list.push({ name: target, icon: type === "income" ? "💰" : "📦", items: [] });
    write({ [type === "income" ? "incomeCategories" : "categories"]: list, ...remapFields({ [c.name]: target }, {}, null) });
    toast("Categoría borrada"); openCategories(type);
  });
}

/* ── Fotos ── */
let photoTarget = null;
function openPhoto(scope) {
  const has = !!data.photos?.[scope];
  const s = openSheet(`
    <h3>Foto de ${esc(scopeName(scope))}</h3>
    <div style="display:flex;justify-content:center;margin:6px 0 14px">${avatar(scope, "xl")}</div>
    ${scope === "joint" && !has ? `<p class="hint" style="text-align:center">Sin foto propia, se muestran juntas las de ${esc(data.names.partner)} y ${esc(data.names.me)}.</p>` : ""}
    <div class="actions"><button type="button" id="phPick" class="btn primary">${has ? "Cambiar foto" : "Elegir foto"}</button>
    ${has ? `<button type="button" id="phDel" class="btn danger">Quitar</button>` : ""}</div>`);
  s.querySelector("#phPick").onclick = () => { photoTarget = scope; $("#photoFile").click(); };
  s.querySelector("#phDel")?.addEventListener("click", () => { write({ ["photos." + scope]: deleteField() }); closeSheet(); toast("Foto quitada"); });
}
async function onPhotoPicked(e) {
  const file = e.target.files[0]; e.target.value = "";
  if (!file || !photoTarget) return;
  try {
    const url = await squareImage(file, 320);
    write({ ["photos." + photoTarget]: url });
    closeSheet(); toast("Foto guardada en los dos móviles");
  } catch { toast("No se ha podido leer la imagen"); }
}
async function squareImage(file, size) {
  const src = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  URL.revokeObjectURL(src);
  return c.toDataURL("image/jpeg", 0.8);
}

/* ── Ajustes ── */
function openSettings() {
  const code = LS.get("code") || "";
  const hasPin = !!LS.get("pin");
  const ok = !!data;
  const s = openSheet(`
    <h3>Ajustes</h3>
    ${ok ? `
    <h4>Fotos</h4>
    <div class="photo-row">${SCOPES.map(sc => `<button type="button" data-ph="${sc}">${avatar(sc, "l")}${esc(data.names[sc])}</button>`).join("")}</div>
    <div class="set"><h4>Nombres y moneda</h4>
      <div class="row2"><div><span class="lbl">Perfil 1</span><input id="nPa" class="inp" value="${esc(data.names.partner)}"></div>
        <div><span class="lbl">Perfil 2</span><input id="nMe" class="inp" value="${esc(data.names.me)}"></div></div>
      <div class="row2"><div><span class="lbl">Compartidos</span><input id="nJo" class="inp" value="${esc(data.names.joint)}"></div>
        <div><span class="lbl">Moneda</span><select id="nCur" class="inp">${["EUR", "USD", "GBP", "CHF"].map(c => `<option ${c === data.currency ? "selected" : ""}>${c}</option>`).join("")}</select></div></div>
      <div style="margin-top:10px"><button type="button" id="nSave" class="btn small">Guardar nombres</button></div></div>
    <div class="set"><h4>Categorías, conceptos y fijos</h4>
      <div class="btns"><button type="button" id="goCats" class="btn small">Categorías de gasto</button><button type="button" id="goInc" class="btn small">Categorías de ingreso</button><button type="button" id="goFix" class="btn small">Fijos y nóminas</button></div></div>` : ""}
    <div class="set"><h4>Código de hogar</h4>
      <p class="hint">Tu pareja abre la app y escribe este mismo código. No lo compartáis con nadie más: quien lo tenga puede ver y cambiar los datos.</p>
      <div class="code-box">${esc(code)}</div>
      <div style="margin-top:10px"><button type="button" id="shareCode" class="btn small">Enviar código</button></div></div>
    <div class="set"><h4>PIN en este móvil</h4>
      <p class="hint">${hasPin ? "Activado: se pide al abrir la app y tras 3 minutos en segundo plano." : "Desactivado."}</p>
      <div class="btns"><button type="button" id="pinSet" class="btn small">${hasPin ? "Cambiar PIN" : "Poner PIN"}</button>${hasPin ? `<button type="button" id="pinOff" class="btn small">Quitar PIN</button>` : ""}</div></div>
    ${ok ? `<div class="set"><h4>Copias y Excel</h4>
      <p class="hint">Guardad una copia de vez en cuando en Archivos o en el correo.</p>
      <div class="btns"><button type="button" id="expJson" class="btn small">Guardar copia</button><button type="button" id="impJson" class="btn small">Restaurar copia</button><button type="button" id="expCsv" class="btn small">Exportar a Excel</button></div></div>` : ""}
    <div class="set"><h4>Este móvil</h4>
      <button type="button" id="logout" class="btn small danger">Desconectar</button>
      <p class="hint">Los datos siguen en la nube. Para volver, escribe otra vez el código de hogar.</p></div>
    <p class="hint">Versión ${APP_VERSION}</p>`);
  s.querySelectorAll("button[data-ph]").forEach(b => b.onclick = () => openPhoto(b.dataset.ph));
  s.querySelector("#nSave")?.addEventListener("click", () => {
    write({ names: { partner: s.querySelector("#nPa").value.trim() || "Pareja", me: s.querySelector("#nMe").value.trim() || "Yo", joint: s.querySelector("#nJo").value.trim() || "Conjunta" }, currency: s.querySelector("#nCur").value });
    toast("Nombres guardados");
  });
  s.querySelector("#goCats")?.addEventListener("click", () => openCategories("expense"));
  s.querySelector("#goInc")?.addEventListener("click", () => openCategories("income"));
  s.querySelector("#goFix")?.addEventListener("click", openFixedList);
  s.querySelector("#shareCode").onclick = async () => {
    const text = `Código de hogar para Gastos Casa: ${code}\nAbre ${location.origin + location.pathname} y escríbelo al entrar.`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast("Código copiado"); } } catch { }
  };
  s.querySelector("#pinSet").onclick = async () => {
    const p = prompt("Nuevo PIN (4 a 8 números):");
    if (p === null) return;
    if (!/^\d{4,8}$/.test(p)) return toast("El PIN debe tener entre 4 y 8 números");
    if (prompt("Repite el PIN:") !== p) return toast("Los PIN no coinciden");
    LS.set("pin", await hashPin(p)); toast("PIN activado"); openSettings();
  };
  s.querySelector("#pinOff")?.addEventListener("click", () => { LS.del("pin"); toast("PIN quitado"); openSettings(); });
  s.querySelector("#expJson")?.addEventListener("click", () =>
    downloadFile(`gastos-copia-${today()}.json`, JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2), "application/json"));
  s.querySelector("#impJson")?.addEventListener("click", () => $("#importFile").click());
  s.querySelector("#expCsv")?.addEventListener("click", exportCsv);
  s.querySelector("#logout").onclick = () => { if (confirm("¿Desconectar este móvil del hogar?")) { LS.del("code"); LS.del("config"); location.reload(); } };
}

$("#importFile").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const obj = normalize(JSON.parse(await file.text()));
    if (!confirm(`La copia tiene ${Object.keys(obj.tx).length} movimientos y ${Object.keys(obj.fixed).length} fijos. Sustituirá todos los datos actuales en los dos móviles. ¿Continuar?`)) return;
    setDoc(ref, { ...obj, updatedAt: serverTimestamp(), updatedBy: auth?.currentUser?.uid || "" }).catch(showError);
    closeSheet(); toast("Copia restaurada");
  } catch (err) { alert("No se ha podido leer la copia: " + err.message); }
};

function exportCsv() {
  const q = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = n => round2(n).toFixed(2).replace(".", ",");
  const rows = [["Mes", "Fecha", "Perfil", "Movimiento", "Tipo", "Categoría", "Concepto", "Importe", "Nota"]];
  const txs = Object.values(data.tx);
  let first = txs.reduce((m, t) => t.ym < m ? t.ym : m, curYM());
  for (const f of Object.values(data.fixed)) if (f.history[0]?.since < first) first = f.history[0].since;
  const last = curYM() > ui.ym ? curYM() : ui.ym;
  for (let ym = first; ym <= last; ym = ymAdd(ym, 1)) {
    for (const f of Object.values(data.fixed)) {
      const a = fixedAmount(f, ym);
      if (a > 0) rows.push([ym, ym + "-01", data.names[f.scope], f.type === "income" ? "Ingreso" : "Gasto", f.type === "income" ? "Recurrente" : "Fijo", f.category, f.concept, num(a), f.overrides?.[ym] != null ? "Importe solo este mes" : ""]);
    }
    for (const t of txs.filter(t => t.ym === ym).sort((a, b) => a.date.localeCompare(b.date)))
      rows.push([ym, t.date, data.names[t.scope], t.kind === "income" ? "Ingreso" : "Gasto", KIND[t.kind], t.category, t.concept, num(t.amount), t.note || ""]);
  }
  downloadFile(`gastos-${today()}.csv`, "\uFEFF" + rows.map(r => r.map(q).join(";")).join("\r\n"), "text/csv;charset=utf-8");
}
async function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

boot();
