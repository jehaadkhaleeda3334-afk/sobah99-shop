'use strict';
/* لوحة إشراف ٩٩ للسبح - واجهة المدير (JS خالص، بدون مكتبات) */

// ---------- أدوات ----------
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nf = (v) => NF.format(Number(v) || 0);
const money = (v) => nf(v) + ' ر.س';
const DTF = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DF = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric' });
const dt = (ts) => { try { return DTF.format(new Date(Number(ts))); } catch { return ''; } };
const dd = (ts) => { try { return DF.format(new Date(Number(ts))); } catch { return ''; } };
const MF = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', month: 'long', year: 'numeric' });
const monthName = (m) => { try { return MF.format(new Date(m + '-15T12:00:00+03:00')); } catch { return m; } };
const WD = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'short' });
const safeImg = (u) => (typeof u === 'string' && /^\/[^/\\]/.test(u) ? u : '');
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* */ } },
};
const riyadhDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const curMonth = () => riyadhDay().slice(0, 7);

const STATUS = { new: 'جديد', accepted: 'مقبول', shipped: 'مشحون', delivered: 'مستلم', cancelled: 'ملغي' };

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') opts.headers['X-BS'] = '1';
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new ApiError('تعذّر الاتصال بالخادم', 0); }
  let data = {};
  try { data = await res.json(); } catch { /* */ }
  if (res.status === 401 && path !== '/api/admin/login') { showLogin(); throw new ApiError(data.error || 'سجّل دخولك أولًا', 401); }
  if (!res.ok) throw new ApiError(data.error || 'حدث خطأ، حاول مرة أخرى', res.status);
  return data;
}

function toast(msg, kind) {
  const box = $('#toasts'); const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 4500 : 2800);
}
const fail = (e) => { if (e && e.status === 401) return; toast((e && e.message) || 'حدث خطأ', 'err'); };

// تأكيد داخل الصفحة
let askResolve = null;
function ask(msg, okLabel, danger) {
  return new Promise((resolve) => {
    askResolve = resolve;
    $('#confirm-msg').textContent = msg;
    const b = $('#confirm-ok'); b.textContent = okLabel || 'تأكيد'; b.className = 'btn ' + (danger === false ? 'primary' : 'danger');
    $('#confirm').showModal();
  });
}
function askDone(v) {
  const r = askResolve; askResolve = null;
  const d = $('#confirm'); if (d.open) d.close();
  if (r) r(v);
}

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn) btn.disabled = false; }
}

// ---------- الحالة ----------
const state = {
  tab: 'dash', telegram: false, cats: [], products: [], orders: [], open: new Set(), ofilter: 'all', oq: '', oseq: 0,
  profitMonth: curMonth(), form: null, uploading: false, settings: null, lastOrderId: null, counts: {},
};

// ---------- التبويبات ----------
const ICONS = {
  dash: '<path d="M4 13h6V4H4zM14 20h6V11h-6zM14 4h6v4h-6zM4 20h6v-4H4z"/>',
  orders: '<path d="M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>',
  products: '<circle cx="12" cy="5" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="18" cy="16" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="6" cy="16" r="2"/><circle cx="6" cy="9" r="2"/>',
  cats: '<path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z"/>',
  banners: '<path d="M3 6h18v12H3zM3 16l5-4 4 3 3-2 6 4"/>',
  reviews: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z"/>',
  subs: '<path d="M3 6h18v12H3zM3 7l9 6 9-6"/>',
  coupons: '<path d="M4 8a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4v0a2 2 0 0 1 0-4V6H4zM14 6v12"/>',
  profit: '<path d="M5 19V10M11 19V5M17 19v-6M3 21h18"/>',
  settings: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
};
const TABS = [
  { id: 'dash', label: 'الرئيسية', load: loadDash },
  { id: 'orders', label: 'الطلبات', badge: 'new_orders', load: loadOrdersTab },
  { id: 'products', label: 'السبح', badge: 'sold_out', load: loadProducts },
  { id: 'cats', label: 'الأقسام', load: loadCats },
  { id: 'banners', label: 'العروض', load: loadBanners },
  { id: 'reviews', label: 'التقييمات', badge: 'pending_reviews', load: loadReviews },
  { id: 'subs', label: 'المشتركين', load: loadSubs },
  { id: 'profit', label: 'الأرباح', load: loadProfit },
  { id: 'coupons', label: 'الخصومات', load: loadCoupons },
  { id: 'settings', label: 'الإعدادات', load: loadSettings },
];

function buildNav() {
  $('#tabs').innerHTML = TABS.map((t) =>
    `<button type="button" class="tab" data-act="tab" data-tab="${t.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id]}</svg><span>${t.label}</span>${t.badge ? `<span class="badge" data-badge="${t.badge}" hidden></span>` : ''}</button>`).join('');
}
function markNav() {
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}
function updateBadges(c) {
  document.querySelectorAll('[data-badge]').forEach((el) => {
    const n = Number(c[el.dataset.badge]) || 0; el.hidden = n <= 0; el.textContent = n > 99 ? '99+' : String(n);
    el.setAttribute('aria-label', n + ' بحاجة لمتابعة');
  });
}

let navSeq = 0;
async function go(tab) {
  const def = TABS.find((t) => t.id === tab) || TABS[0];
  state.tab = def.id; store.set('bs_tab', def.id); markNav();
  const my = ++navSeq; const v = $('#view');
  v.innerHTML = '<p class="spin">جارٍ التحميل...</p>';
  try { await def.load(my); }
  catch (e) {
    if (my !== navSeq || (e && e.status === 401)) return;
    v.innerHTML = `<div class="card empty"><p>${esc(e.message || 'تعذّر التحميل')}</p><button class="btn primary" data-act="tab" data-tab="${def.id}" type="button">إعادة المحاولة</button></div>`;
  }
  if (my === navSeq) window.scrollTo(0, 0);
}
// يعيد true إذا كان التبويب ما زال هو الحالي
const live = (my) => my === navSeq;

// ---------- الدخول / الخروج ----------
function showLogin() {
  stopPoll(); state.lastOrderId = null;
  $('#app').hidden = true; $('#login').hidden = false;
  document.title = 'لوحة إشراف ٩٩ للسبح';
  closeSheet(); if ($('#confirm').open) askDone(false);
}
async function afterLogin() {
  $('#login').hidden = true; $('#app').hidden = false;
  buildNav();
  try { const me = await api('GET', '/api/admin/me'); state.telegram = !!me.telegram; } catch { /* */ }
  const saved = store.get('bs_tab');
  startPoll();
  await go(TABS.some((t) => t.id === saved) ? saved : 'dash');
}
async function boot() {
  try {
    const me = await fetch('/api/admin/me', { credentials: 'same-origin' }).then((r) => r.json());
    if (me && me.admin) { state.telegram = !!me.telegram; return afterLogin(); }
  } catch { /* */ }
  showLogin();
}

// ---------- التنبيه الحي ----------
let pollTimer = null, pollBusy = false, flashTimer = null, audioCtx = null;
function startPoll() { stopPoll(); doPoll(); pollTimer = setInterval(doPoll, 20000); }
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
async function doPoll() {
  if (pollBusy) return; pollBusy = true;
  try {
    const p = await api('GET', '/api/admin/poll');
    state.counts = p; updateBadges(p);
    if (state.lastOrderId == null) state.lastOrderId = p.latest_order_id;
    else if (p.latest_order_id > state.lastOrderId) { state.lastOrderId = p.latest_order_id; newOrderAlert(); }
  } catch { /* صامت */ } finally { pollBusy = false; }
}
function beep() {
  try {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [[880, 0], [660, 0.2]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + at;
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.start(t0); o.stop(t0 + 0.2);
    });
  } catch { /* */ }
}
function newOrderAlert() {
  beep();
  $('#newalert').hidden = false;
  if (!flashTimer && (document.hidden || !document.hasFocus())) {
    let on = false;
    flashTimer = setInterval(() => { on = !on; document.title = on ? '(1) طلب جديد' : 'لوحة إشراف ٩٩ للسبح'; }, 1000);
    document.title = '(1) طلب جديد';
  }
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('جاء طلب جديد', { body: 'افتح لوحة ٩٩ للسبح لمراجعة الطلب' }); } catch { /* */ }
}
function stopFlash() { if (flashTimer) { clearInterval(flashTimer); flashTimer = null; document.title = 'لوحة إشراف ٩٩ للسبح'; } }
window.addEventListener('focus', stopFlash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) stopFlash(); });
function armAudio() {
  if (audioCtx) return;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); } catch { /* */ }
}
document.addEventListener('pointerdown', armAudio, { once: true });
document.addEventListener('keydown', armAudio, { once: true });

// ---------- رفع الصور ----------
function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('x')); };
    img.src = url;
  });
}
async function prepareImage(file, keepPng) {
  if (file.type === 'image/gif') return file;
  try {
    const bmp = await loadBitmap(file);
    const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, 1400 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    const png = keepPng && file.type === 'image/png';
    if (!png) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
    cx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => (png ? cv.toBlob(r, 'image/png') : cv.toBlob(r, 'image/jpeg', 0.85)));
    return blob || file;
  } catch { return file; }
}
async function uploadImage(file, keepPng) {
  if (!/^image\//.test(file.type)) throw new ApiError('الملف ليس صورة', 0);
  const blob = await prepareImage(file, keepPng);
  const res = await fetch('/api/admin/upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-BS': '1', 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
  let data = {}; try { data = await res.json(); } catch { /* */ }
  if (res.status === 401) { showLogin(); throw new ApiError('سجّل دخولك أولًا', 401); }
  if (!res.ok) throw new ApiError(data.error || 'فشل رفع الصورة', res.status);
  return data.url;
}

// ---------- الرئيسية ----------
function chartSvg(series) {
  const W = 380, H = 220, top = 22, bot = 40, pad = 8;
  const max = Math.max(1, ...series.flatMap((s) => [s.visitors, s.orders]));
  const gw = (W - pad * 2) / series.length, bw = Math.min(18, gw / 2 - 3), ch = H - top - bot;
  let g = '';
  for (let i = 0; i <= 3; i++) { const y = top + (ch * i) / 3; g += `<line x1="${pad}" x2="${W - pad}" y1="${y}" y2="${y}"/>`; }
  series.forEach((s, i) => {
    const cx = W - pad - gw * (i + 0.5);
    const bar = (v, x, color) => {
      const hh = v > 0 ? Math.max(2, (ch * v) / max) : 0;
      return `<rect x="${x}" y="${top + ch - hh}" width="${bw}" height="${hh}" rx="3" fill="${color}"/>` +
        `<text class="v" x="${x + bw / 2}" y="${top + ch - hh - 4}" text-anchor="middle">${nf(v)}</text>`;
    };
    g += bar(s.visitors, cx + 1.5, '#3E536B') + bar(s.orders, cx - bw - 1.5, '#B88A3A');
    let wd = ''; try { wd = WD.format(new Date(s.day + 'T12:00:00+03:00')); } catch { /* */ }
    g += `<text x="${cx}" y="${H - 22}" text-anchor="middle">${esc(wd)}</text><text x="${cx}" y="${H - 9}" text-anchor="middle">${esc(s.day.slice(8))}/${esc(s.day.slice(5, 7))}</text>`;
  });
  const label = 'الزوار والطلبات خلال آخر 7 أيام: ' + series.map((s) => `${s.day} زوار ${s.visitors} وطلبات ${s.orders}`).join('، ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
}
function stockCell(s) { return s <= 0 ? '<span class="pill bad">نفدت الكمية</span>' : nf(s); }
function monthCard(title, r) {
  const net = Number(r.net) || 0; const cls = net > 0 ? 'profit' : net < 0 ? 'loss' : '';
  const word = net > 0 ? 'ربح' : net < 0 ? 'خسارة' : 'لا ربح ولا خسارة';
  return `<div class="statement ${cls}"><div class="muted small">${esc(title)} · ${esc(monthName(r.month))}</div>
    <div class="word">${word}</div><div class="big num">${net === 0 ? money(0) : money(Math.abs(net))}</div>
    <div class="muted small">${nf(r.orders)} طلب محتسب</div></div>`;
}
async function loadDash(my) {
  const d = await api('GET', '/api/admin/dashboard');
  if (!live(my)) return;
  state.counts = d.counts; updateBadges(d.counts);
  const t = d.today;
  const top = d.products.filter((p) => p.sold > 0).slice(0, 5);
  const prev = d.prev_month; const day = Number(riyadhDay().slice(8));
  const showPrev = day <= 5 && (prev.orders > 0 || prev.expenses > 0 || prev.adjust !== 0);
  const pnet = Number(prev.net) || 0;
  $('#view').innerHTML = `
    ${showPrev ? `<div class="banner-report"><div><strong>تقرير الشهر الماضي</strong><div>${esc(monthName(prev.month))}: ${pnet >= 0 ? 'ربح' : 'خسارة'} ${money(Math.abs(pnet))}</div></div>
      <button class="btn primary" type="button" data-act="openProfit" data-month="${esc(prev.month)}">عرض التقرير</button></div>` : ''}
    <div class="page-head"><h1>الرئيسية</h1><button class="btn ghost sm" type="button" data-act="tab" data-tab="dash">تحديث</button></div>
    <div class="grid tiles">
      <div class="tile"><div class="lbl">زوار اليوم</div><div class="val num">${nf(t.visitors)}</div></div>
      <div class="tile"><div class="lbl">طلبات اليوم</div><div class="val num">${nf(t.orders)}</div><div class="sub">المبيعات: ${money(t.sales)}</div></div>
      <div class="tile"><div class="lbl">إضافات للسلة اليوم</div><div class="val num">${nf(t.carts)}</div></div>
      <div class="tile ${d.counts.new_orders > 0 ? 'hot' : ''}"><div class="lbl">طلبات جديدة بانتظارك</div><div class="val num">${nf(d.counts.new_orders)}</div>
        <div class="sub">${d.counts.receipts_waiting > 0 ? nf(d.counts.receipts_waiting) + ' منها وصل إيصالها' : 'لا إيصالات بانتظار المراجعة'}</div></div>
      <div class="tile"><div class="lbl">المشتركين</div><div class="val num">${nf(d.subscribers)}</div></div>
    </div>
    <div class="grid cols2" style="margin-top:14px">
      <div>${monthCard('هذا الشهر', d.month)}</div>
      <div>${monthCard('الشهر الماضي', d.prev_month)}</div>
    </div>
    <div class="card"><h2>الزوار والطلبات - آخر 7 أيام</h2>
      <div class="legend"><span><i style="background:#3E536B"></i>زوار</span><span><i style="background:#B88A3A"></i>طلبات</span></div>
      ${chartSvg(d.series)}</div>
    <div class="grid cols2">
      <div class="card"><h2>الأكثر مبيعًا</h2>
        ${top.length ? `<ol class="list">${top.map((p, i) => `<li><span style="display:flex;align-items:center;gap:10px"><span class="rank">${i + 1}</span>${esc(p.name)}</span><strong class="num">${nf(p.sold)} مباع</strong></li>`).join('')}</ol>` : '<p class="empty">لا مبيعات محتسبة بعد</p>'}</div>
      <div class="card"><h2>تنبيهات المخزون</h2>
        ${d.low_stock.length ? `<ul class="list">${d.low_stock.map((p) => `<li><span>${esc(p.name)}</span><span style="display:flex;align-items:center;gap:8px">${p.stock <= 0 ? '<span class="pill bad">نفدت الكمية</span>' : `<span class="pill warn">باقي ${nf(p.stock)}</span>`}<button class="btn ghost sm" type="button" data-act="editProductById" data-id="${p.id}">تعديل</button></span></li>`).join('')}</ul>` : '<p class="empty">كل المنتجات متوفرة بكميات جيدة</p>'}</div>
    </div>
    <div class="card"><h2>أداء المنتجات</h2>
      ${d.products.length ? `<div class="tscroll"><table class="t"><thead><tr><th>السبحة</th><th>زيارات (اليوم / الكلي)</th><th>إضافة للسلة (اليوم / الكلي)</th><th>المباع</th><th>المخزون</th></tr></thead><tbody>
      ${d.products.map((p) => `<tr><td class="cellname"><button type="button" class="linkbtn" data-act="editProductById" data-id="${p.id}">${esc(p.name)}</button>${p.active ? '' : ' <span class="pill off">مخفية</span>'}</td>
        <td data-label="الزيارات" class="num">${nf(p.views_today)} / ${nf(p.views)}</td><td data-label="الإضافة للسلة" class="num">${nf(p.carts_today)} / ${nf(p.carts)}</td>
        <td data-label="المباع" class="num">${nf(p.sold)}</td><td data-label="المخزون" class="num">${stockCell(p.stock)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">أضف أول سبحة لتظهر الإحصائيات</p>'}
      <p class="muted small">الزيارات تُحسب لكل زائر مرة واحدة في اليوم. المباع يشمل الطلبات المقبولة والمشحونة والمستلمة فقط.</p>
      <div class="actions"><button class="btn outline-danger sm" type="button" data-act="resetStats">تصفير الإحصائيات</button></div></div>`;
}

// ---------- الطلبات ----------
const OFILTERS = [['all', 'الكل'], ['new', 'جديد'], ['accepted', 'مقبول'], ['shipped', 'مشحون'], ['delivered', 'مستلم'], ['cancelled', 'ملغي']];
async function loadOrdersTab(my) {
  $('#view').innerHTML = `<div class="page-head"><h1>الطلبات</h1></div>
    <div class="chips" role="group" aria-label="تصفية الطلبات" id="ochips"></div>
    <input type="search" class="search" id="oq" data-input="osearch" placeholder="ابحث بالكود أو الاسم أو الجوال" aria-label="بحث في الطلبات" value="${esc(state.oq)}">
    <div id="olist"><p class="spin">جارٍ التحميل...</p></div>`;
  renderChips();
  await fetchOrders(my);
}
function renderChips() {
  const c = $('#ochips'); if (!c) return;
  c.innerHTML = OFILTERS.map(([v, l]) => `<button type="button" class="chip" data-act="ofilter" data-v="${v}" aria-pressed="${state.ofilter === v}">${l}</button>`).join('');
}
async function fetchOrders(my) {
  const seq = ++state.oseq;
  const qs = `status=${encodeURIComponent(state.ofilter)}&q=${encodeURIComponent(state.oq)}`;
  const d = await api('GET', '/api/admin/orders?' + qs);
  if (seq !== state.oseq || (my != null && !live(my)) || state.tab !== 'orders') return;
  state.orders = d.orders; renderOrders();
}
function waLink(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^05\d{8}$/.test(p)) p = '966' + p.slice(1);
  else if (/^5\d{8}$/.test(p)) p = '966' + p;
  p = p.replace(/\D/g, '');
  return p ? 'https://wa.me/' + p : '';
}
function waMsg(o) {
  const m = { new: 'استلمنا طلبك', accepted: 'تم قبول طلبك وجاري تجهيزه', shipped: 'تم شحن طلبك وهو في الطريق إليك', delivered: 'تم تسليم طلبك، نتمنى أن ينال إعجابك', cancelled: 'تم إلغاء طلبك' };
  return 'السلام عليكم ' + (o.name || '') + '، ' + (m[o.status] || 'تحديث على طلبك') + ' (رقم الطلب ' + o.code + '). شكرًا لك من متجر ٩٩ للسبح.';
}
function payState(o) {
  if (o.has_receipt) return '<span class="pill ok">وصل إيصال</span>';
  if (o.pay_method === 'cod') return '<span class="pill warn">دفع عند الاستلام</span>';
  if (o.pay_method === 'whatsapp') return '<span class="pill warn">تواصل عبر واتساب</span>';
  return '<span class="pill off">لم يصل إيصال</span>';
}
const RSTATUS = { pending: 'بانتظار المراجعة', approved: 'مقبول، بانتظار وصول السبحة', rejected: 'مرفوض', received: 'وصلت السبحة', refunded: 'تم رد المبلغ' };
function ibanRow(holder, iban) {
  return `<div class="small" style="margin-top:4px">آيبان الاسترجاع: <b dir="ltr" class="sel">${esc(iban)}</b> · ${esc(holder || '')} <button type="button" class="btn ghost sm" data-act="copyText" data-v="${esc(iban)}">نسخ</button></div>`;
}
function requestsBlock(o) {
  const rets = o.returns || []; const cr = o.cancel_request;
  if (!rets.length && !cr) return '';
  let h = '<div class="card" style="margin:12px 0;border-color:var(--bronze)"><h3 style="margin:0 0 8px">طلبات العميل</h3>';
  if (cr) {
    h += `<div style="margin-bottom:10px"><strong>طلب إلغاء:</strong> ${cr === 'pending' ? '<span class="pill warn">بانتظار قرارك</span>' : cr === 'approved' ? '<span class="pill ok">تم القبول</span>' : '<span class="pill off">مرفوض</span>'}
      ${o.cancel_reason ? `<div class="muted small">السبب: ${esc(o.cancel_reason)}</div>` : ''}
      ${o.refund_iban ? ibanRow(o.refund_holder, o.refund_iban) : ''}
      ${cr === 'pending' ? `<div class="actions"><button type="button" class="btn good sm" data-act="cancelDecision" data-id="${o.id}" data-v="1">قبول الإلغاء</button><button type="button" class="btn outline-danger sm" data-act="cancelDecision" data-id="${o.id}" data-v="0">رفض</button></div>` : ''}</div>`;
  }
  for (const r of rets) {
    const it = (o.items || []).find((x) => x.id === r.item_id);
    const next = { pending: [['approved', 'قبول الاسترجاع', 'good'], ['rejected', 'رفض', 'outline-danger']], approved: [['received', 'وصلت السبحة', 'primary']], received: [['refunded', 'تم رد المبلغ', 'good']] }[r.status] || [];
    h += `<div style="margin-bottom:10px;padding-top:8px;border-top:1px dashed var(--line)"><strong>استرجاع:</strong> ${esc(it ? it.name : 'سبحة')} ${it ? `× ${nf(it.qty)}` : ''} <span class="pill ${r.status === 'rejected' ? 'off' : r.status === 'pending' ? 'warn' : 'ok'}">${esc(RSTATUS[r.status] || r.status)}</span>
      <div class="muted small">السبب: ${esc(r.reason)}</div>
      ${r.iban ? ibanRow(r.holder, r.iban) : ''}
      ${next.length ? `<div class="actions">${next.map(([v, l, c]) => `<button type="button" class="btn ${c} sm" data-act="returnSet" data-id="${r.id}" data-v="${v}">${l}</button>`).join('')}</div>` : ''}</div>`;
  }
  return h + '</div>';
}
function orderCard(o) {
  const open = state.open.has(o.id); const st = o.status;
  let body = '';
  if (open) {
    const wa = waLink(o.phone);
    const loc = /^https:\/\//i.test(o.location || '') ? o.location : '';
    const next = { new: [['accepted', 'قبول الطلب', 'good']], accepted: [['shipped', 'تم الشحن', 'primary']], shipped: [['delivered', 'تم التسليم', 'good']], delivered: [], cancelled: [['new', 'إعادة فتح الطلب', 'ghost']] }[st] || [];
    body = `<div class="order-body">
      <ul class="items">${(o.items || []).map((it) => `<li class="item">${safeImg(it.image) ? `<img class="thumb" src="${esc(it.image)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
        <span style="flex:1;min-width:0"><div style="font-weight:600;word-break:break-word">${esc(it.name)}</div><div class="muted small num">${nf(it.qty)} × ${money(it.price)}</div></span><strong class="num">${money(it.price * it.qty)}</strong></li>`).join('')}</ul>
      <dl class="kv">
        <dt>المنتجات</dt><dd class="num">${money(o.subtotal)}</dd>
        <dt>الشحن (${o.ship_type === 'fast' ? 'سريع' : 'عادي'})</dt><dd class="num">${o.shipping_fee > 0 ? money(o.shipping_fee) : 'مجاني'}</dd>
        ${o.discount ? `<dt>كود الخصم</dt><dd><b>${esc(o.coupon_code)}</b> · <span class="num">− ${money(o.discount)}</span></dd>` : ''}
        ${o.cod_fee ? `<dt>رسوم الدفع عند الاستلام</dt><dd class="num">${money(o.cod_fee)}</dd>` : ''}
        <dt>الإجمالي</dt><dd class="num"><strong>${money(o.total)}</strong>${o.pay_method === 'cod' ? ' <span class="pill warn">يُحصَّل عند الاستلام</span>' : ''}</dd>
        ${o.gift_to || o.gift_msg ? `<dt>🎁 هدية</dt><dd>${o.gift_to ? 'إلى: ' + esc(o.gift_to) + '<br>' : ''}${o.gift_msg ? 'الرسالة: ' + esc(o.gift_msg) : ''}</dd>` : ''}
        <dt>الاسم</dt><dd>${esc(o.name)}</dd>
        <dt>الجوال</dt><dd><span class="sel num" dir="ltr">${esc(o.phone)}</span>${wa ? ` &nbsp; <a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">واتساب</a>` : ''}</dd>
        ${wa ? `<dt>إبلاغ العميل</dt><dd><a class="btn good sm" href="${esc(wa)}?text=${encodeURIComponent(waMsg(o))}" target="_blank" rel="noopener noreferrer">أبلغه بحالة الطلب عبر واتساب</a></dd>` : ''}
        ${o.email ? `<dt>البريد</dt><dd><span class="sel" dir="ltr">${esc(o.email)}</span></dd>` : ''}
        <dt>العنوان</dt><dd>${esc(o.city)}، ${esc(o.address)}</dd>
        ${loc ? `<dt>الموقع</dt><dd><a href="${esc(loc)}" target="_blank" rel="noopener noreferrer">فتح الموقع على الخريطة</a></dd>` : ''}
        ${o.note ? `<dt>ملاحظة العميل</dt><dd>${esc(o.note)}</dd>` : ''}
        <dt>الدفع</dt><dd>${payState(o)}${o.has_receipt ? ` <button class="btn ghost sm" type="button" data-act="viewReceipt" data-code="${esc(o.code)}">عرض الإيصال</button> <a class="btn ghost sm" href="/api/admin/receipt/${encodeURIComponent(o.code)}" target="_blank" rel="noopener noreferrer">فتح في تبويب</a>` : ''}</dd>
      </dl>
      ${requestsBlock(o)}
      <div class="actions">
        ${next.map(([v, l, c]) => `<button type="button" class="btn ${c}" data-act="setStatus" data-id="${o.id}" data-v="${v}">${l}</button>`).join('')}
        ${st !== 'cancelled' ? `<button type="button" class="btn outline-danger" data-act="cancelOrder" data-id="${o.id}">إلغاء الطلب</button>` : ''}
      </div>
      <hr style="border:0;border-top:1px dashed var(--line);margin:14px 0">
      <label class="field"><span>تكلفة الشحن الفعلية (ر.س)</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" id="sc-${o.id}" value="${o.shipping_cost == null ? '' : esc(o.shipping_cost)}" placeholder="${esc(o.shipping_fee)}">
        <small>إذا تركتها فارغة يُحسب الشحن بقيمة ما دفعه العميل</small></label>
      <label class="field"><span>ملاحظة</span><textarea id="nt-${o.id}" maxlength="500" placeholder="ملاحظة داخلية لا يراها العميل">${esc(o.admin_note || '')}</textarea></label>
      <button type="button" class="btn primary" data-act="saveOrder" data-id="${o.id}">حفظ التكلفة والملاحظة</button>
    </div>`;
  }
  return `<article class="order ${st === 'new' ? 'is-new' : ''}">
    <button type="button" class="order-head" data-act="toggleOrder" data-id="${o.id}" aria-expanded="${open}">
      <span class="code num">${esc(o.code)}</span><span class="tot num">${money(o.total)}</span>
      <span class="meta">${esc(o.name)} · ${esc(o.city)}<br>${esc(dt(o.created_at))}</span><span style="text-align:left"><span class="pill ${esc(st)}">${esc(STATUS[st] || st)}</span>${o.cancel_request === 'pending' ? ' <span class="pill warn">طلب إلغاء</span>' : ''}${(o.returns || []).some((r) => r.status === 'pending') ? ' <span class="pill warn">طلب استرجاع</span>' : ''}</span>
    </button>${body}</article>`;
}
function renderOrders() {
  const l = $('#olist'); if (!l) return;
  l.innerHTML = state.orders.length ? state.orders.map(orderCard).join('') : '<div class="card empty">لا توجد طلبات مطابقة</div>';
}
async function changeStatus(id, status, btn) {
  await busy(btn, async () => {
    try { await api('PUT', '/api/admin/orders/' + id, { status }); toast('تم الحفظ', 'ok'); await fetchOrders(); doPoll(); } catch (e) { fail(e); }
  });
}

// ---------- السبح ----------
async function ensureCats() { const d = await api('GET', '/api/admin/categories'); state.cats = d.categories; }
async function loadProducts(my) {
  const [p, c] = await Promise.all([api('GET', '/api/admin/products'), api('GET', '/api/admin/categories')]);
  if (!live(my)) return;
  state.products = p.products; state.cats = c.categories; renderProducts();
}
function renderProducts() {
  const catName = (id) => (state.cats.find((c) => c.id === id) || {}).name || 'بدون قسم';
  const v = $('#view'); if (state.tab !== 'products' || !v) return;
  v.innerHTML = `<div class="page-head"><h1>السبح</h1><div style="display:flex;gap:8px;flex-wrap:wrap">${state.products.length ? '<button class="btn ghost" type="button" data-act="bulkPrice">تغيير سعر الكل</button>' : ''}<button class="btn primary" type="button" data-act="addProduct">إضافة سبحة</button></div></div>
    ${state.products.length ? `<div class="plist">${state.products.map((p) => {
    const img = safeImg((p.images || [])[0]); const out = p.stock <= 0;
    return `<article class="pcard ${out ? 'out' : ''}">${img ? `<img class="pthumb" src="${esc(img)}" alt="" loading="lazy">` : '<span class="pthumb"></span>'}
      <div class="pinfo"><div class="pname">${esc(p.name)}</div>
        <div class="pmeta">${esc(catName(p.category_id))} · <span class="num">${money(p.price)}</span></div>
        <div class="pmeta">المخزون: ${out ? '<span class="pill bad">نفدت الكمية</span>' : `<strong class="num">${nf(p.stock)}</strong>`} ${p.active ? '' : '<span class="pill off">مخفية</span>'}</div>
        <div class="pbtns"><button class="btn ghost sm" type="button" data-act="editProduct" data-id="${p.id}">تعديل</button>
          <button class="btn ghost sm" type="button" data-act="toggleProduct" data-id="${p.id}" aria-pressed="${!!p.active}">${p.active ? 'إخفاء' : 'إظهار'}</button>
          <button class="btn outline-danger sm" type="button" data-act="delProduct" data-id="${p.id}">حذف</button></div></div></article>`;
  }).join('')}</div>` : '<div class="card empty">لم تضف أي سبحة بعد. اضغط "إضافة سبحة" للبدء.</div>'}`;
}
function specsPreview(text) {
  const rows = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:：]+)[:：]\s*(.*)$/); return m ? [m[1].trim(), m[2].trim()] : [null, l];
  });
  if (!rows.length) return '<span class="muted small">ستظهر المواصفات هنا كما يراها العميل</span>';
  return '<dl>' + rows.map(([k, v]) => (k ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : `<dd style="grid-column:1/-1">${esc(v)}</dd>`)).join('') + '</dl>';
}
function renderProductImgs() {
  const box = $('#pf-imgs'); if (!box || !state.form) return;
  const imgs = state.form.images;
  box.innerHTML = imgs.length ? imgs.map((u, i) => `<div class="imgbox"><img src="${esc(u)}" alt="">
    ${i === 0 ? '<div class="first">الصورة الرئيسية</div>' : `<button class="btn ghost" type="button" data-act="imgFirst" data-i="${i}">اجعلها الأولى</button>`}
    <button class="btn outline-danger" type="button" data-act="imgDel" data-i="${i}">حذف</button></div>`).join('') : '<p class="muted small">لم تُضف صور بعد</p>';
  const add = $('#pf-add'); if (add) add.hidden = imgs.length >= 8;
}
function openSheet(html) { const s = $('#sheet'); s.innerHTML = html; if (!s.open) s.showModal(); s.scrollTop = 0; }
function closeSheet() { const s = $('#sheet'); if (s.open) s.close(); state.form = null; }
function sheetHead(title) { return `<div class="sheet-head"><button class="icon-btn" type="button" data-act="closeSheet" aria-label="إغلاق">&times;</button><h2 id="sheet-title">${esc(title)}</h2></div>`; }

function openProductForm(p) {
  state.form = { kind: 'product', id: p ? p.id : null, images: p ? [...(p.images || [])] : [] };
  const v = p || { name: '', price: '', cost: '', stock: 0, category_id: null, description: '', specs: '', active: 1 };
  openSheet(`${sheetHead(p ? 'تعديل السبحة' : 'إضافة سبحة')}
  <form class="sheet-body" id="pform" data-form="product" novalidate>
    <label class="field"><span>اسم السبحة</span><input type="text" name="name" maxlength="120" required value="${esc(v.name)}"></label>
    <label class="field"><span>القسم</span><select name="category_id"><option value="">بدون قسم</option>
      ${state.cats.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="row two">
      <label class="field"><span>سعر البيع (ر.س)</span><input type="number" name="price" min="0" step="0.01" inputmode="decimal" required value="${esc(v.price)}"></label>
      <label class="field"><span>سعر التكلفة (للأرباح فقط، لا يظهر للعميل)</span><input type="number" name="cost" min="0" step="0.01" inputmode="decimal" value="${esc(v.cost)}"></label>
    </div>
    <label class="field"><span>الكمية المتوفرة</span><input type="number" name="stock" min="0" step="1" inputmode="numeric" required value="${esc(v.stock)}"></label>
    <label class="field"><span>الوصف</span><textarea name="description" maxlength="2000">${esc(v.description)}</textarea></label>
    <label class="field"><span>المواصفات</span><textarea name="specs" id="pf-specs" data-input="specs" maxlength="2000" dir="rtl" placeholder="المادة: كهرمان">${esc(v.specs)}</textarea>
      <small>اكتب كل مواصفة في سطر بهذا الشكل: المادة: كهرمان</small></label>
    <div class="specs" id="pf-prev" aria-live="polite">${specsPreview(v.specs)}</div>
    <div class="field" style="margin-top:14px"><span style="font-weight:600;font-size:14px;display:block">الصور (حتى 8 صور، الأولى هي الرئيسية)</span>
      <div id="pf-imgs" class="imgs"></div>
      <label class="btn ghost" id="pf-add" style="cursor:pointer">إضافة صور<input type="file" accept="image/*" multiple hidden data-change="prodImages"></label>
      <small class="muted" id="pf-up"></small></div>
    <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> ظاهرة في المتجر</label>
    <div class="sheet-foot"><button class="btn primary" type="submit">حفظ</button><button class="btn ghost" type="button" data-act="closeSheet">إلغاء</button></div>
  </form>`);
  renderProductImgs();
}
async function handleProductImages(input) {
  const f = state.form; if (!f) return;
  const room = 8 - f.images.length; const files = [...input.files].slice(0, Math.max(0, room));
  const over = input.files.length > room; input.value = '';
  if (!files.length) { toast('الحد الأقصى 8 صور', 'err'); return; }
  state.uploading = true; const up = $('#pf-up');
  try {
    for (let i = 0; i < files.length; i++) {
      if (up) up.textContent = `جارٍ رفع الصورة ${i + 1} من ${files.length}...`;
      try { const url = await uploadImage(files[i]); if (state.form === f) { f.images.push(url); renderProductImgs(); } } catch (e) { fail(e); }
    }
    if (over) toast('تم أخذ أول ' + files.length + ' صور فقط (الحد 8)', 'err');
  } finally { state.uploading = false; if (up) up.textContent = ''; }
}
async function saveProduct(form) {
  const f = state.form; if (!f) return;
  if (state.uploading) return toast('انتظر انتهاء رفع الصور', 'err');
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim(); const price = Number(fd.get('price')); const cost = fd.get('cost') === '' ? 0 : Number(fd.get('cost')); const stock = Number(fd.get('stock'));
  if (!name) return toast('اكتب اسم السبحة', 'err');
  if (fd.get('price') === '' || !(price >= 0)) return toast('اكتب سعر بيع صحيحًا', 'err');
  if (!(cost >= 0)) return toast('سعر التكلفة غير صحيح', 'err');
  if (!Number.isInteger(stock) || stock < 0) return toast('الكمية يجب أن تكون رقمًا صحيحًا من 0 فأكثر', 'err');
  const body = { name, price, cost, stock, category_id: fd.get('category_id') || null, description: String(fd.get('description') || ''), specs: String(fd.get('specs') || ''), images: f.images, active: fd.has('active') };
  await busy(form.querySelector('[type=submit]'), async () => {
    try {
      if (f.id) await api('PUT', '/api/admin/products/' + f.id, body); else await api('POST', '/api/admin/products', body);
      toast('تم الحفظ', 'ok'); closeSheet(); await refreshProducts(); doPoll();
    } catch (e) { fail(e); }
  });
}
async function refreshProducts() {
  const d = await api('GET', '/api/admin/products'); state.products = d.products;
  if (state.tab === 'products') renderProducts();
  else if (state.tab === 'dash') go('dash');
}
async function editProductById(id) {
  try {
    if (!state.cats.length) await ensureCats();
    const d = await api('GET', '/api/admin/products'); state.products = d.products;
    const p = state.products.find((x) => x.id === Number(id));
    if (!p) return toast('السبحة غير موجودة', 'err');
    openProductForm(p);
  } catch (e) { fail(e); }
}

// ---------- الأقسام ----------
async function loadCats(my) {
  const d = await api('GET', '/api/admin/categories'); if (!live(my)) return;
  state.cats = d.categories; renderCats();
}
function renderCats() {
  if (state.tab !== 'cats') return;
  $('#view').innerHTML = `<div class="page-head"><h1>الأقسام</h1></div>
    <div class="card"><h2>إضافة قسم</h2>
      <form data-form="catAdd" novalidate class="row two" style="align-items:end">
        <label class="field" style="margin:0"><span>اسم القسم</span><input type="text" name="name" maxlength="40" required></label>
        <label class="field" style="margin:0"><span>رقم الترتيب</span><input type="number" name="sort" step="1" inputmode="numeric" value="${state.cats.length + 1}"></label>
        <button class="btn primary" type="submit">إضافة</button>
      </form></div>
    <div class="card"><h2>الأقسام الحالية</h2>
      <p class="muted small">عند حذف قسم لا تُحذف سبحه، بل تصبح بدون قسم. الأقسام ذات الرقم الأصغر تظهر أولًا.</p>
      ${state.cats.length ? state.cats.map((c) => `<div class="catrow"><input type="text" id="cn-${c.id}" value="${esc(c.name)}" maxlength="40" aria-label="اسم القسم"><input type="number" id="cs-${c.id}" value="${esc(c.sort)}" step="1" aria-label="رقم الترتيب">
        <div class="acts"><button class="btn primary sm" type="button" data-act="saveCat" data-id="${c.id}">حفظ</button><button class="btn outline-danger sm" type="button" data-act="delCat" data-id="${c.id}">حذف</button></div></div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">') : '<p class="empty">لا توجد أقسام</p>'}</div>`;
}

// ---------- العروض ----------
async function loadBanners(my) {
  const [b, p] = await Promise.all([api('GET', '/api/admin/banners'), api('GET', '/api/admin/products')]);
  if (!live(my)) return; state.banners = b.banners; state.products = p.products; renderBanners();
}
function renderBanners() {
  if (state.tab !== 'banners') return;
  const pn = (id) => (state.products.find((p) => p.id === id) || {}).name;
  $('#view').innerHTML = `<div class="page-head"><h1>العروض</h1><button class="btn primary" type="button" data-act="addBanner">إضافة عرض</button></div>
    <p class="muted">العروض هي الشرائح المتحركة في أعلى المتجر. ${'صورة طولية أو مربعة واضحة، يفضّل 1080×1350'}.</p>
    ${state.banners.length ? state.banners.map((b) => `<article class="card"><div class="bn-row"><img class="bn-img" style="max-width:110px" src="${esc(safeImg(b.image))}" alt="" loading="lazy">
      <div style="flex:1;min-width:0"><div style="font-weight:600;word-break:break-word">${b.title ? esc(b.title) : '<span class="muted">بدون عنوان</span>'}</div>
      <div class="muted small">${b.product_id ? 'مرتبط بـ: ' + esc(pn(b.product_id) || 'سبحة محذوفة') : 'بدون سبحة مرتبطة'} · ترتيب ${nf(b.sort)}</div>
      <div style="margin:6px 0">${b.active ? '<span class="pill ok">ظاهر</span>' : '<span class="pill off">مخفي</span>'}</div>
      <div class="actions" style="margin:0"><button class="btn ghost sm" type="button" data-act="editBanner" data-id="${b.id}">تعديل</button>
      <button class="btn ghost sm" type="button" data-act="toggleBanner" data-id="${b.id}">${b.active ? 'إخفاء' : 'إظهار'}</button>
      <button class="btn outline-danger sm" type="button" data-act="delBanner" data-id="${b.id}">حذف</button></div></div></div></article>`).join('') : '<div class="card empty">لا توجد عروض بعد</div>'}`;
}
function openBannerForm(b) {
  state.form = { kind: 'banner', id: b ? b.id : null, image: b ? b.image : '' };
  const v = b || { title: '', product_id: null, sort: (state.banners || []).length + 1, active: 1 };
  openSheet(`${sheetHead(b ? 'تعديل العرض' : 'إضافة عرض')}
  <form class="sheet-body" data-form="banner" novalidate>
    <div class="field"><span style="font-weight:600;font-size:14px;display:block">صورة العرض</span>
      <div id="bf-prev"></div>
      <label class="btn ghost" style="cursor:pointer;margin-top:8px">اختيار صورة<input type="file" accept="image/*" hidden data-change="bannerImage"></label>
      <small class="muted" style="display:block">صورة طولية أو مربعة واضحة، يفضّل 1080×1350</small><small class="muted" id="bf-up"></small></div>
    <label class="field"><span>نص العنوان (اختياري)</span><input type="text" name="title" maxlength="80" value="${esc(v.title)}"></label>
    <label class="field"><span>السبحة المرتبطة (اختياري)</span><select name="product_id"><option value="">بدون</option>
      ${state.products.map((p) => `<option value="${p.id}" ${p.id === v.product_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="field"><span>رقم الترتيب</span><input type="number" name="sort" step="1" inputmode="numeric" value="${esc(v.sort)}"></label>
    <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> ظاهر في المتجر</label>
    <div class="sheet-foot"><button class="btn primary" type="submit">حفظ</button><button class="btn ghost" type="button" data-act="closeSheet">إلغاء</button></div>
  </form>`);
  renderBannerPrev();
}
function renderBannerPrev() {
  const b = $('#bf-prev'); if (!b || !state.form) return;
  b.innerHTML = state.form.image ? `<img class="bn-img" src="${esc(safeImg(state.form.image))}" alt="معاينة الصورة">` : '<p class="muted small">لم تُختر صورة بعد</p>';
}

// ---------- التقييمات ----------
async function loadReviews(my) {
  const d = await api('GET', '/api/admin/reviews'); if (!live(my)) return;
  state.reviews = d.reviews; renderReviews();
}
function reviewCard(r) {
  const stars = '<span class="stars" aria-label="' + r.rating + ' من 5">' + [1, 2, 3, 4, 5].map((i) => (i <= r.rating ? '★' : '<span class="off">★</span>')).join('') + '</span>';
  return `<article class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${esc(r.product || 'سبحة محذوفة')}</strong>${stars}</div>
    <div class="rev-text">${r.text ? esc(r.text) : '<span class="muted">بدون نص</span>'}</div>
    <div class="muted small">${esc(r.name)} · ${esc(dd(r.created_at))}</div>
    <div class="actions">${r.approved ? `<button class="btn ghost sm" type="button" data-act="revSet" data-id="${r.id}" data-v="0">إلغاء الاعتماد</button><button class="btn outline-danger sm" type="button" data-act="revDel" data-id="${r.id}">حذف</button>`
    : `<button class="btn good sm" type="button" data-act="revSet" data-id="${r.id}" data-v="1">اعتماد</button><button class="btn outline-danger sm" type="button" data-act="revDel" data-id="${r.id}">رفض وحذف</button>`}</div></article>`;
}
function renderReviews() {
  if (state.tab !== 'reviews') return;
  const pend = state.reviews.filter((r) => !r.approved), ok = state.reviews.filter((r) => r.approved);
  $('#view').innerHTML = `<div class="page-head"><h1>التقييمات</h1></div>
    <h2>بانتظار الموافقة (${nf(pend.length)})</h2>${pend.length ? pend.map(reviewCard).join('') : '<div class="card empty">لا توجد تقييمات بانتظار الموافقة</div>'}
    <h2 style="margin-top:20px">المعتمدة (${nf(ok.length)})</h2>${ok.length ? ok.map(reviewCard).join('') : '<div class="card empty">لا توجد تقييمات معتمدة</div>'}`;
}

// ---------- المشتركين ----------
async function loadSubs(my) {
  const d = await api('GET', '/api/admin/subscribers'); if (!live(my)) return;
  $('#view').innerHTML = `<div class="page-head"><h1>المشتركين</h1><a class="btn bronze" href="/api/admin/subscribers.csv" download="subscribers.csv">تحميل CSV</a></div>
    <div class="tile" style="margin-bottom:14px"><div class="lbl">عدد المشتركين</div><div class="val num">${nf(d.subscribers.length)}</div></div>
    <div class="card">${d.subscribers.length ? `<ul class="list">${d.subscribers.map((s) => `<li><span class="sel" dir="ltr">${esc(s.email)}</span><span class="muted small">${esc(dd(s.created_at))}</span></li>`).join('')}</ul>` : '<p class="empty">لا يوجد مشتركون بعد</p>'}</div>`;
}

// ---------- الأرباح ----------
async function loadProfit(my) {
  const m = state.profitMonth;
  const r = await api('GET', '/api/admin/report?month=' + encodeURIComponent(m)); if (!live(my)) return;
  state.report = r; renderProfit();
}
function renderProfit() {
  if (state.tab !== 'profit') return;
  const r = state.report, m = state.profitMonth; const net = Number(r.net) || 0;
  const cls = net > 0 ? 'profit' : net < 0 ? 'loss' : ''; const word = net > 0 ? 'ربح' : net < 0 ? 'خسارة' : 'لا ربح ولا خسارة';
  const row = (l, v, extra) => `<div class="brow ${extra || ''}"><span>${l}</span><span class="num" dir="ltr">${v}</span></div>`;
  $('#view').innerHTML = `<div class="page-head"><h1>الأرباح</h1></div>
    <label class="field" style="max-width:260px"><span>الشهر</span><input type="month" id="pmonth" data-change="profitMonth" value="${esc(m)}"></label>
    <div class="statement ${cls}"><div class="muted small">${esc(monthName(m))}</div><div class="word">${word}</div><div class="big num">${net === 0 ? money(0) : money(Math.abs(net))}</div></div>
    <div class="card"><h2>تفاصيل الحساب</h2>
      ${row('عدد الطلبات المحتسبة (مقبول / مشحون / مستلم)', nf(r.orders))}
      ${r.cancelled ? row('طلبات ملغاة (غير محتسبة)', nf(r.cancelled)) : ''}
      ${row('مبيعات المنتجات', '+ ' + money(r.revenue))}
      ${row('رسوم الشحن المحصّلة', '+ ' + money(r.shipping_fees))}
      ${row('تكلفة البضاعة', '- ' + money(r.cogs))}
      ${row('تكلفة الشحن الفعلية', '- ' + money(r.shipping_cost))}
      ${row('المصاريف', '- ' + money(r.expenses))}
      ${row('التعديلات', (r.adjust >= 0 ? '+ ' : '- ') + money(Math.abs(r.adjust)))}
      ${row('الصافي', (net < 0 ? '- ' : '') + money(Math.abs(net)), 'total')}
      <p class="hint">الصافي = مبيعات المنتجات + رسوم الشحن المحصّلة - تكلفة البضاعة - تكلفة الشحن الفعلية - المصاريف ± التعديلات. تُحتسب فقط الطلبات المقبولة والمشحونة والمستلمة؛ الجديدة والملغاة لا تدخل في الحساب.</p></div>
    <div class="card"><h2>المصاريف والتعديلات</h2>
      ${r.items.length ? `<ul class="list">${r.items.map((e) => `<li><span><strong>${esc(e.label)}</strong><br><span class="muted small">${e.kind === 'adjust' ? 'تعديل على الربح' : 'مصروف'}</span></span>
        <span style="display:flex;align-items:center;gap:8px"><strong class="num" dir="ltr">${e.kind === 'adjust' ? (e.amount >= 0 ? '+ ' : '- ') : '- '}${money(Math.abs(e.amount))}</strong><button class="btn outline-danger sm" type="button" data-act="delExpense" data-id="${e.id}">حذف</button></span></li>`).join('')}</ul>` : '<p class="empty">لا توجد مصاريف أو تعديلات لهذا الشهر</p>'}</div>
    <div class="card"><h2>إضافة بند</h2>
      <form data-form="expense" novalidate>
        <label class="field"><span>النوع</span><select name="kind" data-change="expKind"><option value="expense">مصروف</option><option value="adjust">تعديل على الربح</option></select>
          <small id="kind-hint">المصروف يُخصم من الربح.</small></label>
        <label class="field"><span>الوصف</span><input type="text" name="label" maxlength="80" required placeholder="مثال: إعلانات، تغليف"></label>
        <label class="field"><span>المبلغ (ر.س)</span><input type="number" name="amount" step="0.01" inputmode="decimal" required></label>
        <button class="btn primary" type="submit">إضافة</button></form></div>`;
}

// ---------- أكواد الخصم ----------
async function loadCoupons(my) {
  const r = await api('GET', '/api/admin/coupons'); if (!live(my)) return;
  state.coupons = r.coupons; renderCoupons();
}
function couponLine(c) {
  const val = c.type === 'fixed' ? money(c.value) : nf(c.value) + '%';
  const bits = [`خصم ${val}`];
  if (c.min_order > 0) bits.push('أقل طلب ' + money(c.min_order));
  bits.push(c.max_uses > 0 ? `استُخدم ${nf(c.uses)} من ${nf(c.max_uses)}` : `استُخدم ${nf(c.uses)} مرة`);
  if (c.expires_at) bits.push('ينتهي ' + new Date(c.expires_at).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' }));
  return bits.join(' · ');
}
function renderCoupons() {
  if (state.tab !== 'coupons') return; const list = state.coupons || [];
  $('#view').innerHTML = `<div class="page-head"><h1>أكواد الخصم</h1></div>
    <div class="card"><h2>إنشاء كود جديد</h2>
      <form data-form="coupon" novalidate>
        <label class="field"><span>الكود (يكتبه العميل)</span><input type="text" name="code" maxlength="20" dir="ltr" class="ltr" placeholder="مثال: SOBAH10" required></label>
        <label class="field"><span>نوع الخصم</span><select name="type"><option value="percent">نسبة مئوية %</option><option value="fixed">مبلغ ثابت (ر.س)</option></select></label>
        <label class="field"><span>قيمة الخصم</span><input type="number" name="value" step="0.01" min="0" inputmode="decimal" required></label>
        <label class="field"><span>أقل مبلغ للطلب (اختياري)</span><input type="number" name="min_order" step="1" min="0" inputmode="decimal"></label>
        <label class="field"><span>أقصى عدد استخدامات (اختياري، فاضي = بدون حد)</span><input type="number" name="max_uses" step="1" min="0" inputmode="numeric"></label>
        <label class="field"><span>تاريخ الانتهاء (اختياري)</span><input type="date" name="expires"></label>
        <button class="btn primary" type="submit">إنشاء الكود</button></form>
      <p class="hint">الخصم يُحسب على سعر السبح فقط (بدون الشحن)، والشحن المجاني يُحسب بعد الخصم. كل عميل يستخدم الكود مرة واحدة فقط.</p></div>
    <div class="card"><h2>الأكواد</h2>${list.length ? `<ul class="list">${list.map((c) => `<li><span><strong dir="ltr">${esc(c.code)}</strong> ${c.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill off">موقوف</span>'}${c.featured ? ' <span class="pill warn">ظاهر في الواجهة</span>' : ''}<br><span class="muted small">${esc(couponLine(c))}</span></span>
      <span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" type="button" data-act="featureCoupon" data-id="${c.id}" data-v="${c.featured ? 0 : 1}">${c.featured ? 'إخفاء من الواجهة' : 'إظهار في الواجهة'}</button><button class="btn ghost sm" type="button" data-act="toggleCoupon" data-id="${c.id}" data-v="${c.active ? 0 : 1}">${c.active ? 'إيقاف' : 'تفعيل'}</button><button class="btn outline-danger sm" type="button" data-act="delCoupon" data-id="${c.id}">حذف</button></span></li>`).join('')}</ul>` : '<p class="empty">ما فيه أكواد بعد</p>'}</div>`;
}

// ---------- الإعدادات ----------
const SFIELDS = [
  ['store_name', 'اسم المتجر', 'text'], ['whatsapp', 'رقم واتساب', 'ltr', 'رقم واتساب بالصيغة الدولية مثل 966501234567'],
  ['bank_name', 'اسم البنك', 'text'], ['iban', 'رقم الآيبان', 'ltr'], ['account_name', 'اسم صاحب الحساب (يظهر للعميل للتأكد قبل التحويل)', 'text'], ['transfer_mobile', 'رقم الجوال للتحويل الفوري (اختياري)', 'ltr', 'إذا ربطت جوالك بحسابك البنكي للتحويل برقم الجوال، اكتبه هنا مثل 0501234567 — يظهر للعميل كأسرع طريقة دفع'],
  ['free_min', 'حد الشحن المجاني (ر.س)', 'number'], ['fast_price', 'سعر الشحن السريع (ر.س)', 'number'], ['fast_days', 'مدة الشحن السريع (نص يظهر للعميل)', 'text'],
  ['slow_price', 'سعر الشحن العادي (ر.س)', 'number'], ['slow_days', 'مدة الشحن العادي (نص يظهر للعميل)', 'text'],
  ['cod_fee', 'رسوم الدفع عند الاستلام (ر.س)', 'number'], ['cod_cities', 'مدن الدفع عند الاستلام', 'text', 'افصل بينها بفاصلة مثل: الرياض، الخرج — اتركها فارغة لكل المدن'],
  ['promo_text', 'نص الشريط الترويجي', 'text'], ['support_text', 'نص خدمة العملاء', 'text'],
  ['return_fee', 'رسوم شحن الإرجاع على العميل (ر.س)، اتركها فارغة إن لم تحدد مبلغًا', 'text'],
  ['return_policy', 'سياسة الاسترجاع (كل سطر نقطة)', 'area', 'تظهر أسفل المتجر. اكتب كل شرط في سطر مستقل.'],
  ['tiktok', 'رابط حساب تيك توك (يظهر في المتجر)', 'ltr', 'مثال: https://www.tiktok.com/@اسم_الحساب — اتركه فارغًا لإخفائه'],
  ['instagram', 'رابط حساب انستقرام (يظهر في المتجر)', 'ltr', 'مثال: https://www.instagram.com/اسم_الحساب أو اكتب اليوزر فقط — اتركه فارغًا لإخفائه'],
];
async function loadSettings(my) {
  const d = await api('GET', '/api/admin/settings'); if (!live(my)) return;
  state.settings = d.settings; renderSettings();
}
function notifStatus() { return !('Notification' in window) ? 'غير مدعومة في هذا المتصفح' : Notification.permission === 'granted' ? 'مفعّلة' : Notification.permission === 'denied' ? 'محظورة من إعدادات المتصفح' : 'غير مفعّلة'; }
const RESET_LABELS = { stats: 'الإحصائيات (الزيارات والمشاهدات)', profits: 'الطلبات والأرباح والمصروفات', customers: 'حسابات العملاء', subscribers: 'المشتركين', reviews: 'التقييمات' };
async function downloadBackup(scope) {
  const d = await api('GET', '/api/admin/export?scope=' + encodeURIComponent(scope));
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'sobah99-backup-' + scope + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function renderSettings() {
  if (state.tab !== 'settings') return; const s = state.settings;
  const fld = ([k, l, type, hint]) => type === 'area' ? `<label class="field"><span>${l}</span><textarea name="${k}" rows="7" maxlength="1500">${esc(s[k])}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>` : `<label class="field"><span>${l}</span><input ${type === 'number' ? 'type="number" min="0" step="0.01" inputmode="decimal"' : 'type="text"'} name="${k}" maxlength="300" value="${esc(s[k])}" ${type === 'ltr' ? 'dir="ltr" class="ltr"' : ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  $('#view').innerHTML = `<div class="page-head"><h1>الإعدادات</h1></div>
    <form data-form="settings" novalidate>
      <div class="card"><h2>المتجر والدفع</h2>${SFIELDS.slice(0, SFIELDS.findIndex((f) => f[0] === 'free_min')).map(fld).join('')}</div>
      <div class="card"><h2>الشحن</h2>${SFIELDS.slice(SFIELDS.findIndex((f) => f[0] === 'free_min'), SFIELDS.findIndex((f) => f[0] === 'promo_text')).map(fld).join('')}
        <label class="check"><input type="checkbox" name="free_applies_fast" ${s.free_applies_fast === '1' ? 'checked' : ''}> يشمل الشحن المجاني الخيار السريع أيضًا</label>
        <label class="check"><input type="checkbox" name="cod_enabled" ${s.cod_enabled === '1' ? 'checked' : ''}> تفعيل الدفع عند الاستلام</label></div>
      <div class="card"><h2>نصوص</h2>${SFIELDS.slice(SFIELDS.findIndex((f) => f[0] === 'promo_text')).map(fld).join('')}</div>
      <div class="card"><h2>رمز الدفع (QR)</h2>
        <img class="qr-preview" id="qr-prev" src="${esc(safeImg(s.qr_image) || '')}" alt="رمز QR الحالي">
        <div class="actions"><label class="btn ghost" style="cursor:pointer">استبدال الصورة<input type="file" accept="image/*" hidden data-change="qrImage"></label>
        <button class="btn ghost" type="button" data-act="qrReset">استرجاع الافتراضي</button></div>
        <small class="muted" id="qr-up"></small></div>
      <button class="btn primary block" type="submit">حفظ الإعدادات</button>
    </form>
    <div class="card" style="margin-top:14px"><h2>التنبيهات</h2>
      <p>تنبيهات تيليجرام: ${state.telegram ? '<span class="pill ok">مفعّلة</span>' : '<span class="pill off">غير مفعّلة</span>'}</p>
      ${state.telegram ? '' : '<p class="hint">لتفعيل التنبيهات على جوالك أنشئ بوت في تيليجرام وضع TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في إعدادات الاستضافة</p>'}
      <div class="actions"><button class="btn ghost" type="button" data-act="testNotify">إرسال تنبيه تجريبي</button></div>
      <hr style="border:0;border-top:1px dashed var(--line);margin:14px 0">
      <p>تنبيهات المتصفح: <strong id="notif-state">${notifStatus()}</strong></p>
      <button class="btn ghost" type="button" data-act="browserNotif">تفعيل تنبيهات المتصفح</button></div>
    <div class="card" style="margin-top:14px;border-color:var(--err,#b42318)"><h2>تصفير البيانات</h2>
      <p class="hint">قبل أي تصفير يُحمَّل لك ملف نسخة احتياطية تلقائيًا على جوالك (في التنزيلات). إذا ما نزل الملف يتوقف التصفير. السبح والأقسام والإعدادات ما تتأثر.</p>
      <div class="actions"><button class="btn ghost" type="button" data-act="exportAll">تحميل نسخة كاملة الآن</button></div>
      ${Object.entries(RESET_LABELS).map(([k, l]) => `<div class="actions" style="margin-top:8px"><button class="btn outline-danger block" type="button" data-act="resetData" data-scope="${k}">تصفير ${l}</button></div>`).join('')}
      <div class="actions" style="margin-top:14px"><button class="btn danger block" type="button" data-act="resetData" data-scope="all">تصفير كل شيء</button></div></div>`;
}

// ---------- الأوامر (click) ----------
const acts = {
  tab: (el) => go(el.dataset.tab),
  logout: async (el) => { await busy(el, async () => { try { await api('POST', '/api/admin/logout'); } catch { /* */ } showLogin(); }); },
  alertClose: () => { $('#newalert').hidden = true; },
  alertOpen: () => { $('#newalert').hidden = true; state.ofilter = 'new'; state.oq = ''; go('orders'); },
  askYes: () => askDone(true), askNo: () => askDone(false),
  closeSheet: () => closeSheet(),
  closeReceipt: () => { const d = $('#receipt'); if (d.open) d.close(); $('#receipt-body').textContent = ''; },
  openProfit: (el) => { state.profitMonth = el.dataset.month; go('profit'); },
  editProductById: (el) => editProductById(el.dataset.id),

  ofilter: (el) => { state.ofilter = el.dataset.v; renderChips(); fetchOrders().catch(fail); },
  toggleOrder: (el) => { const id = Number(el.dataset.id); if (state.open.has(id)) state.open.delete(id); else state.open.add(id); renderOrders(); },
  setStatus: (el) => changeStatus(el.dataset.id, el.dataset.v, el),
  cancelOrder: async (el) => { if (await ask('سيتم إلغاء الطلب وإرجاع الكميات إلى المخزون. هل أنت متأكد؟', 'نعم، إلغاء الطلب')) changeStatus(el.dataset.id, 'cancelled', el); },
  saveOrder: (el) => {
    const id = el.dataset.id; const sc = $('#sc-' + id).value.trim(); const note = $('#nt-' + id).value;
    if (sc !== '' && !(Number(sc) >= 0)) return toast('تكلفة الشحن غير صحيحة', 'err');
    return busy(el, async () => {
      try { await api('PUT', '/api/admin/orders/' + id, { shipping_cost: sc === '' ? null : Number(sc), admin_note: note }); toast('تم الحفظ', 'ok'); await fetchOrders(); } catch (e) { fail(e); }
    });
  },
  cancelDecision: async (el) => {
    const ok = el.dataset.v === '1';
    if (!(await ask(ok ? 'سيتم إلغاء الطلب وإرجاع الكميات للمخزون. تذكّر رد المبلغ للعميل إن كان دفع.' : 'رفض طلب الإلغاء؟', ok ? 'قبول الإلغاء' : 'رفض'))) return;
    return busy(el, async () => { try { await api('POST', '/api/admin/orders/' + el.dataset.id + '/cancel-decision', { approve: ok }); toast('تم الحفظ', 'ok'); await fetchOrders(); doPoll(); } catch (e) { fail(e); } });
  },
  copyText: (el) => { const v = el.dataset.v; const ok = () => toast('تم النسخ', 'ok'); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok, () => toast(v)); else toast(v); },
  returnSet: (el) => busy(el, async () => { try { await api('PUT', '/api/admin/returns/' + el.dataset.id, { status: el.dataset.v }); toast('تم الحفظ', 'ok'); await fetchOrders(); } catch (e) { fail(e); } }),
  viewReceipt: (el) => {
    const body = $('#receipt-body'); body.textContent = '';
    const img = document.createElement('img'); img.alt = 'إيصال التحويل'; img.src = '/api/admin/receipt/' + encodeURIComponent(el.dataset.code);
    img.addEventListener('error', () => { body.textContent = 'تعذّر عرض الإيصال هنا (قد يكون ملف PDF). استخدم زر "فتح في تبويب".'; });
    body.appendChild(img); $('#receipt').showModal();
  },

  bulkPrice: (el) => {
    const v = window.prompt('اكتب السعر الجديد لكل السبح (ر.س):', '');
    if (v == null) return;
    const price = Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, ''));
    if (!(price > 0)) { toast('اكتب سعر صحيح', 'bad'); return; }
    const below = state.products.filter((p) => Number(p.cost) > price).length;
    if (!window.confirm('بيصير سعر كل السبح (' + state.products.length + ') = ' + price + ' ر.س' + (below ? '\nتنبيه: ' + below + ' منها تكلفتها أعلى من هذا السعر، يعني بتخسر فيها.' : '') + '\nمتأكد؟')) return;
    return busy(el, async () => { try { const r = await api('POST', '/api/admin/products/bulk-price', { price }); toast('تم تغيير سعر ' + r.changed + ' سبحة إلى ' + r.price + ' ر.س', 'ok'); await refreshProducts(); } catch (e) { fail(e); } });
  },
  addProduct: async () => { try { if (!state.cats.length) await ensureCats(); openProductForm(null); } catch (e) { fail(e); } },
  editProduct: (el) => { const p = state.products.find((x) => x.id === Number(el.dataset.id)); if (p) openProductForm(p); },
  toggleProduct: (el) => {
    const p = state.products.find((x) => x.id === Number(el.dataset.id)); if (!p) return;
    return busy(el, async () => {
      try { await api('PUT', '/api/admin/products/' + p.id, { ...p, active: !p.active }); toast('تم الحفظ', 'ok'); await refreshProducts(); } catch (e) { fail(e); }
    });
  },
  delProduct: async (el) => {
    const p = state.products.find((x) => x.id === Number(el.dataset.id)); if (!p) return;
    if (!(await ask(`حذف "${p.name}" نهائيًا؟ لا يمكن التراجع عن ذلك.`, 'حذف السبحة'))) return;
    try { await api('DELETE', '/api/admin/products/' + p.id); toast('تم الحذف', 'ok'); await refreshProducts(); doPoll(); } catch (e) { fail(e); }
  },
  imgFirst: (el) => { const f = state.form; if (!f) return; const i = Number(el.dataset.i); const [u] = f.images.splice(i, 1); f.images.unshift(u); renderProductImgs(); },
  imgDel: (el) => { const f = state.form; if (!f) return; f.images.splice(Number(el.dataset.i), 1); renderProductImgs(); },

  saveCat: (el) => {
    const id = el.dataset.id; const name = $('#cn-' + id).value.trim(); const sort = Number($('#cs-' + id).value);
    if (!name) return toast('اكتب اسم القسم', 'err');
    return busy(el, async () => { try { await api('PUT', '/api/admin/categories/' + id, { name, sort: Number.isFinite(sort) ? sort : 99 }); toast('تم الحفظ', 'ok'); await loadCats(navSeq); } catch (e) { fail(e); } });
  },
  delCat: async (el) => {
    const c = state.cats.find((x) => x.id === Number(el.dataset.id)); if (!c) return;
    if (!(await ask(`حذف قسم "${c.name}"؟ ستصبح سبحه بدون قسم.`, 'حذف القسم'))) return;
    try { await api('DELETE', '/api/admin/categories/' + c.id); toast('تم الحذف', 'ok'); await loadCats(navSeq); } catch (e) { fail(e); }
  },

  addBanner: () => openBannerForm(null),
  editBanner: (el) => { const b = state.banners.find((x) => x.id === Number(el.dataset.id)); if (b) openBannerForm(b); },
  toggleBanner: (el) => {
    const b = state.banners.find((x) => x.id === Number(el.dataset.id)); if (!b) return;
    return busy(el, async () => { try { await api('PUT', '/api/admin/banners/' + b.id, { ...b, active: !b.active }); toast('تم الحفظ', 'ok'); await loadBanners(navSeq); } catch (e) { fail(e); } });
  },
  delBanner: async (el) => {
    if (!(await ask('حذف هذا العرض نهائيًا؟', 'حذف العرض'))) return;
    try { await api('DELETE', '/api/admin/banners/' + el.dataset.id); toast('تم الحذف', 'ok'); await loadBanners(navSeq); } catch (e) { fail(e); }
  },

  revSet: (el) => busy(el, async () => { try { await api('PUT', '/api/admin/reviews/' + el.dataset.id, { approved: el.dataset.v === '1' }); toast('تم الحفظ', 'ok'); await loadReviews(navSeq); doPoll(); } catch (e) { fail(e); } }),
  revDel: async (el) => {
    if (!(await ask('حذف هذا التقييم نهائيًا؟', 'حذف التقييم'))) return;
    try { await api('DELETE', '/api/admin/reviews/' + el.dataset.id); toast('تم الحذف', 'ok'); await loadReviews(navSeq); doPoll(); } catch (e) { fail(e); }
  },

  delExpense: async (el) => {
    if (!(await ask('حذف هذا البند؟', 'حذف'))) return;
    try { await api('DELETE', '/api/admin/expenses/' + el.dataset.id); toast('تم الحذف', 'ok'); await loadProfit(navSeq); } catch (e) { fail(e); }
  },

  qrReset: () => { state.settings.qr_image = ''; $('#qr-prev').removeAttribute('src'); toast('اضغط "حفظ الإعدادات" لتأكيد الاسترجاع'); },
  featureCoupon: (el) => busy(el, async () => { try { await api('PUT', '/api/admin/coupons/' + el.dataset.id, { featured: el.dataset.v === '1' }); await loadCoupons(navSeq); } catch (e) { fail(e); } }),
  toggleCoupon: (el) => busy(el, async () => { try { await api('PUT', '/api/admin/coupons/' + el.dataset.id, { active: el.dataset.v === '1' }); await loadCoupons(navSeq); } catch (e) { fail(e); } }),
  delCoupon: async (el) => { if (!(await ask('حذف هذا الكود؟', 'حذف'))) return; try { await api('DELETE', '/api/admin/coupons/' + el.dataset.id); toast('تم الحذف', 'ok'); await loadCoupons(navSeq); } catch (e) { fail(e); } },
  exportAll: (el) => busy(el, async () => { try { await downloadBackup('all'); toast('تم تحميل النسخة', 'ok'); } catch (e) { fail(e); } }),
  resetData: async (el) => {
    const sc = el.dataset.scope; const label = sc === 'all' ? 'كل شيء (الإحصائيات والطلبات والأرباح والمصروفات وحسابات العملاء والمشتركين والتقييمات)' : RESET_LABELS[sc];
    if (!(await ask('سيتم تصفير ' + label + '. سننزّل لك نسخة احتياطية أولًا. لا يمكن التراجع بعدها.', 'تصفير'))) return;
    try {
      await downloadBackup(sc); toast('تم تحميل النسخة الاحتياطية، جاري التصفير…');
      await new Promise((r) => setTimeout(r, 1200));
      await api('POST', '/api/admin/reset', { scope: sc }); toast('تم التصفير', 'ok'); await go('dash');
    } catch (e) { fail(e); }
  },
  resetStats: async () => {
    if (!(await ask('تصفير كل إحصائيات الزيارات ومشاهدات السبح والإضافات للسلة؟ لن تتأثر الطلبات ولا الأرباح ولا الكميات. لا يمكن التراجع.', 'تصفير'))) return;
    try { await api('POST', '/api/admin/reset-stats'); toast('تم تصفير الإحصائيات', 'ok'); await go('dash'); } catch (e) { fail(e); }
  },
  testNotify: (el) => busy(el, async () => {
    try {
      const r = await api('POST', '/api/admin/test-notify');
      let box = $('#tg-result'); if (!box) { box = document.createElement('p'); box.id = 'tg-result'; box.className = 'small'; box.style.cssText = 'margin-top:10px;line-height:1.8;word-break:break-word'; el.insertAdjacentElement('afterend', box); }
      if (r.ok) { box.style.color = 'var(--ok, #1c7c3f)'; box.textContent = 'أُرسل التنبيه ✅ تفقد تيليجرام (البوت @' + (r.bot || '') + ')'; toast('أُرسل التنبيه التجريبي', 'ok'); }
      else { box.style.color = 'var(--err, #b42318)'; box.textContent = (r.detail || '') + (r.error ? ' — رد تيليجرام: ' + r.error : ''); toast('لم يُرسل التنبيه، اقرأ السبب تحت الزر', 'err'); }
    } catch (e) { fail(e); }
  }),
  browserNotif: async () => {
    if (!('Notification' in window)) return toast('المتصفح لا يدعم التنبيهات', 'err');
    try { await Notification.requestPermission(); } catch { /* */ }
    const n = $('#notif-state'); if (n) n.textContent = notifStatus();
    toast(Notification.permission === 'granted' ? 'تم تفعيل تنبيهات المتصفح' : 'لم يتم تفعيل التنبيهات', Notification.permission === 'granted' ? 'ok' : 'err');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const fn = acts[el.dataset.act]; if (!fn) return;
  Promise.resolve().then(() => fn(el, ev)).catch(fail);
});

// ---------- النماذج ----------
const forms = {
  login: async (form) => {
    const err = $('#login-error'); err.hidden = true;
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || !password) { err.textContent = 'اكتب البريد وكلمة المرور'; err.hidden = false; return; }
    await busy(form.querySelector('[type=submit]'), async () => {
      try { await api('POST', '/api/admin/login', { email, password }); form.password.value = ''; await afterLogin(); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  },
  product: saveProduct,
  catAdd: async (form) => {
    const name = form.name.value.trim(); if (!name) return toast('اكتب اسم القسم', 'err');
    const sort = Number(form.sort.value);
    await busy(form.querySelector('[type=submit]'), async () => { try { await api('POST', '/api/admin/categories', { name, sort: Number.isFinite(sort) ? sort : 99 }); toast('تم الحفظ', 'ok'); await loadCats(navSeq); } catch (e) { fail(e); } });
  },
  banner: async (form) => {
    const f = state.form; if (!f) return;
    if (state.uploading) return toast('انتظر انتهاء رفع الصورة', 'err');
    if (!f.image) return toast('ارفع صورة العرض', 'err');
    const fd = new FormData(form); const sort = Number(fd.get('sort'));
    const body = { image: f.image, title: String(fd.get('title') || ''), product_id: fd.get('product_id') ? Number(fd.get('product_id')) : null, sort: Number.isFinite(sort) ? sort : 99, active: fd.has('active') };
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        if (f.id) await api('PUT', '/api/admin/banners/' + f.id, body); else await api('POST', '/api/admin/banners', body);
        toast('تم الحفظ', 'ok'); closeSheet(); await loadBanners(navSeq);
      } catch (e) { fail(e); }
    });
  },
  expense: async (form) => {
    const kind = form.kind.value, label = form.label.value.trim(), raw = form.amount.value.trim(), amount = Number(raw);
    if (!label) return toast('اكتب وصف البند', 'err');
    if (raw === '' || !Number.isFinite(amount)) return toast('اكتب المبلغ', 'err');
    if (kind === 'expense' && amount < 0) return toast('مبلغ المصروف يجب أن يكون موجبًا', 'err');
    await busy(form.querySelector('[type=submit]'), async () => {
      try { await api('POST', '/api/admin/expenses', { month: state.profitMonth, kind, label, amount }); toast('تم الحفظ', 'ok'); await loadProfit(navSeq); } catch (e) { fail(e); }
    });
  },
  coupon: async (form) => {
    const body = { code: form.code.value.trim(), type: form.type.value, value: form.value.value, min_order: form.min_order.value, max_uses: form.max_uses.value, expires: form.expires.value };
    if (!body.code) return toast('اكتب الكود', 'err'); if (!(Number(body.value) > 0)) return toast('اكتب قيمة الخصم', 'err');
    await busy(form.querySelector('[type=submit]'), async () => { try { await api('POST', '/api/admin/coupons', body); toast('تم إنشاء الكود', 'ok'); await loadCoupons(navSeq); } catch (e) { fail(e); } });
  },
  settings: async (form) => {
    const body = {};
    for (const [k, , type] of SFIELDS) {
      const v = form.elements[k].value.trim(); body[k] = v;
      if (type === 'number' && (v === '' || !(Number(v) >= 0))) return toast('تأكد من أن الأسعار أرقام صحيحة', 'err');
    }
    if (!body.store_name) return toast('اكتب اسم المتجر', 'err');
    body.free_applies_fast = form.elements.free_applies_fast.checked;
    body.cod_enabled = form.elements.cod_enabled.checked;
    body.qr_image = state.settings.qr_image || '';
    await busy(form.querySelector('[type=submit]'), async () => {
      try { await api('PUT', '/api/admin/settings', body); toast('تم الحفظ', 'ok'); await loadSettings(navSeq); } catch (e) { fail(e); }
    });
  },
};
document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-form]'); if (!form) return;
  ev.preventDefault();
  const fn = forms[form.dataset.form]; if (fn) Promise.resolve().then(() => fn(form)).catch(fail);
});

// ---------- تغيّر الحقول / الإدخال ----------
const changes = {
  prodImages: (el) => handleProductImages(el),
  bannerImage: async (el) => {
    const f = state.form; const file = el.files[0]; el.value = ''; if (!f || !file) return;
    state.uploading = true; const up = $('#bf-up'); if (up) up.textContent = 'جارٍ رفع الصورة...';
    try { const url = await uploadImage(file); if (state.form === f) { f.image = url; renderBannerPrev(); } } catch (e) { fail(e); }
    finally { state.uploading = false; if (up) up.textContent = ''; }
  },
  qrImage: async (el) => {
    const file = el.files[0]; el.value = ''; if (!file) return;
    const up = $('#qr-up'); if (up) up.textContent = 'جارٍ رفع الصورة...';
    try { const url = await uploadImage(file, true); state.settings.qr_image = url; const p = $('#qr-prev'); if (p) p.src = url; toast('اضغط "حفظ الإعدادات" لتأكيد التغيير'); } catch (e) { fail(e); }
    finally { if (up) up.textContent = ''; }
  },
  profitMonth: (el) => { if (/^\d{4}-\d{2}$/.test(el.value)) { state.profitMonth = el.value; go('profit'); } },
  expKind: (el) => { const h = $('#kind-hint'); if (h) h.textContent = el.value === 'adjust' ? 'التعديل: المبلغ الموجب يزيد الربح والسالب (مثل -50) يخفضه.' : 'المصروف يُخصم من الربح.'; },
};
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]'); if (!el) return;
  const fn = changes[el.dataset.change]; if (fn) Promise.resolve().then(() => fn(el)).catch(fail);
});
let searchTimer = null;
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-input]'); if (!el) return;
  if (el.dataset.input === 'specs') { const p = $('#pf-prev'); if (p) p.innerHTML = specsPreview(el.value); }
  if (el.dataset.input === 'osearch') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.oq = el.value.trim(); fetchOrders().catch(fail); }, 300);
  }
});
$('#confirm').addEventListener('close', () => askDone(false));
$('#confirm').addEventListener('cancel', () => { /* Esc يغلق ويُعالج في close */ });
$('#sheet').addEventListener('close', () => { state.form = null; });

boot();
