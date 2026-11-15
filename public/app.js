(function () {
'use strict';

/* ---------- أدوات ---------- */
var $ = function (s, r) { return (r || document).querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var money = function (n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
var R = function (n) { return '<span class="num">' + money(n) + '</span> <span class="cur">ر.س</span>'; };
var LS = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } }
};
var vid = LS.get('bs_vid', null);
if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); LS.set('bs_vid', vid); }

function api(path, opts) {
  return fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {})).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) throw new Error(d.error || 'حدث خطأ، حاول مرة ثانية');
      return d;
    });
  });
}
function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function track(type, pid) { post('/api/track', { vid: vid, type: type, product_id: pid }).catch(function () { }); }

var toastTimer;
function toast(msg, link) {
  var t = $('#toast'); t.innerHTML = '<span>' + esc(msg) + '</span>' + (link ? '<a href="' + link.href + '">' + esc(link.text) + '</a>' : '');
  t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
}

var ICON = {
  ig: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
  tt: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.2 4.4 5 4.8"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-4.2M8.6 13.4l6.8 4.2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  menu: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  wa: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 8 19.6L3 21z"/><path d="M9 9.5c.3 2.3 2.4 4.4 4.7 4.7l1.3-1.2-1.8-1-.8.6c-.9-.4-1.6-1.1-2-2l.6-.8-1-1.8L9 9.5z"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  bead: '<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="30" cy="30" r="22" stroke-dasharray="1 8.5" stroke-linecap="round" stroke-width="7"/><circle cx="30" cy="30" r="10" stroke-dasharray="14 6" stroke-linecap="round" stroke-width="2.4"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-7"/></svg>'
};
function starsHTML(avg) {
  var out = ''; var r = Math.round(avg);
  for (var i = 1; i <= 5; i++) out += ICON.star.replace('<svg', '<svg class="' + (i <= r ? 'on' : '') + '"');
  return '<span class="stars" aria-label="' + avg + ' من 5">' + out + '</span>';
}

/* ---------- الحالة ---------- */
var store = null, storeAt = 0, loadErr = false;
var acct = null;
var acctReady = api('/api/account/me').then(function (d) { acct = d.customer || null; }).catch(function () { });
var cart = LS.get('bs_cart', {});
var shipType = LS.get('bs_ship', 'slow') === 'fast' ? 'fast' : 'slow';
var curCat = null;
var cleanup = null;

function saveCart() { LS.set('bs_cart', cart); }
function cartCount() { var n = 0; Object.keys(cart).forEach(function (k) { n += cart[k]; }); return n; }
function prod(id) { if (!store) return null; for (var i = 0; i < store.products.length; i++) if (store.products[i].id === Number(id)) return store.products[i]; return null; }
function cartLines() {
  var out = [];
  Object.keys(cart).forEach(function (id) {
    var p = prod(id); if (p) out.push({ p: p, qty: Math.min(cart[id], Math.max(p.stock, 0)) || 0, want: cart[id] });
  });
  return out;
}
function subtotalOf(lines) { return lines.reduce(function (a, l) { return a + l.p.price * l.qty; }, 0); }
function shipFee(sub, type) {
  var s = store.settings; var base = type === 'fast' ? Number(s.fast_price) : Number(s.slow_price);
  var free = sub >= Number(s.free_min) && (type === 'slow' || s.free_applies_fast === '1');
  return free ? 0 : base;
}
function addToCart(id, n) {
  var p = prod(id); if (!p) return;
  if (p.soldOut) { toast('نفدت الكمية'); return; }
  var cur = cart[id] || 0;
  if (cur + n > p.stock) { toast('المتوفر ' + p.stock + ' فقط'); return; }
  cart[id] = Math.min(20, cur + n); saveCart(); updateBadge(); track('cart', p.id);
  toast('تمت الإضافة إلى السلة', { href: '#/cart', text: 'عرض السلة' });
}
function updateBadge() { var b = $('.cnt'); if (b) { b.textContent = cartCount(); b.setAttribute('data-n', cartCount()); } }

function loadStore(force) {
  if (!force && store && Date.now() - storeAt < 30000) return Promise.resolve();
  return api('/api/store').then(function (d) { store = d; storeAt = Date.now(); loadErr = false; }).catch(function () { loadErr = true; });
}

/* ---------- الهيكل المشترك ---------- */
function header(opts) {
  opts = opts || {};
  return '<header class="head"><div class="wrap">' +
    (opts.back ? '<button class="back" data-act="back" type="button">' + ICON.back + ' رجوع</button>' : '<a class="logo" href="#/" aria-label="٩٩ للسبح"><img src="/img/logo.png" alt="٩٩ للسبح"></a>') +
    (opts.back ? '<a class="logo" href="#/" aria-label="٩٩ للسبح"><img src="/img/logo.png" alt="٩٩ للسبح"></a>' : '') +
    '<div class="hact"><a class="cartbtn" href="#/cart" aria-label="السلة">' + ICON.bag + '<span>السلة</span><span class="cnt num" data-n="' + cartCount() + '">' + cartCount() + '</span></a>' +
    '<button class="menubtn" type="button" data-act="menu" aria-label="القائمة" aria-haspopup="dialog">' + ICON.menu + (acct && acct.unread ? '<i class="nbadge"></i>' : '') + '</button></div>' +
    '</div></header>';
}
function strip() {
  var s = store.settings;
  return '<div class="strip">' + esc(s.promo_text) + '</div>';
}
function whyHTML() {
  var cats = (store.categories || []).filter(function (c) { return store.products.some(function (p) { return p.category_id === c.id; }); });
  var why = [
    ['سبح مختارة بعناية', 'نختار كل سبحة بنفسنا من حيث الحجر والصنعة والمظهر.'],
    ['تنوّع في الأحجار والتصاميم', 'خيارات تناسب ذوقك، وتصلح لك أو هدية لمن تحب.'],
    ['طلب سهل من جوالك', 'تختار السبحة وتكمل طلبك في دقائق بدون تسجيل معقّد.'],
    ['دفع سهل', 'تحويل بنكي أو دفع عند الاستلام حسب المتاح، وترسل الإيصال من نفس الصفحة.'],
    ['تواصل مباشر', 'نرد عليك عبر واتساب لأي استفسار قبل الطلب وبعده.']
  ];
  var offer = ['سبح بأنواع الأحجار المختلفة'].concat(cats.map(function (c) { return c.name; }), ['شحن سريع أو عادي حسب رغبتك']);
  return '<section class="why" aria-label="عن ٩٩ للسبح"><div class="wrap">' +
    '<h2 class="gt">لماذا تختار ٩٩ للسبح؟</h2><ul class="whyl">' + why.map(function (w) { return '<li><i aria-hidden="true"></i><div><b>' + esc(w[0]) + '</b><span>' + esc(w[1]) + '</span></div></li>'; }).join('') + '</ul>' +
    '<h2 class="gt">ماذا نقدّم؟</h2><ul class="offl">' + offer.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ul></div></section>';
}
function igURL() { var u = store && store.settings && store.settings.instagram; return /^https:\/\/(www\.)?instagram\.com\//.test(u || '') ? u : ''; }
function ttURL() { var u = store && store.settings && store.settings.tiktok; return /^https:\/\//.test(u || '') ? u : ''; }
function offerBanner() {
  var o = store && store.offer; if (!o) return '';
  var head = o.type === 'fixed' && o.value >= 39 ? 'سبحة مجانية 🎁 تدفع الشحن بس' : (o.type === 'fixed' ? 'خصم ' + money(o.value) + ' ر.س' : 'خصم ' + o.value + '%');
  var who = o.max ? 'لأول ' + o.max + ' طلبات فقط' : 'لفترة محدودة';
  return '<div class="wrap"><div class="offer"><div class="ot"><b>' + head + '</b><small>' + who + ' · اختر أي سبحة واكتب الكود في السلة</small>' +
    (o.left != null ? '<span class="left">باقي <b class="num">' + o.left + '</b> من ' + o.max + '</span>' : '') + '</div>' +
    '<button type="button" class="ocode" data-act="copy" data-v="' + esc(o.code) + '" aria-label="نسخ الكود"><span dir="ltr">' + esc(o.code) + '</span><small>اضغط للنسخ</small></button></div></div>';
}
function trustHTML() {
  var sv = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var items = [
    [sv('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'), 'شحن لكل مدن المملكة'],
    [sv('<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>'), 'استبدال مجاني إذا فيها عيب'],
    codOn() ? [sv('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/>'), 'الدفع عند الاستلام متاح'] : [sv('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'), 'دفع آمن بالتحويل البنكي'],
    [sv('<path d="M4 20l1.4-4A8 8 0 1 1 8 18.6z"/>'), 'تواصل مباشر على واتساب']
  ];
  return '<div class="wrap"><div class="trust">' + items.map(function (i) { return '<div>' + i[0] + '<span>' + i[1] + '</span></div>'; }).join('') + '</div></div>';
}
function ttBanner() {
  var u = ttURL(); if (!u) return '';
  return '<div class="wrap"><a class="ttbar" href="' + esc(u) + '" target="_blank" rel="noopener"><span class="tti">' + ICON.tt + '</span><span class="ttx"><b>تابعنا على تيك توك</b><small>شوف السبح بالفيديو قبل ما تطلب</small></span><span class="tta">متابعة</span></a></div>';
}
function footer() {
  var s = store.settings; var wa = s.whatsapp;
  var pol = String(s.return_policy || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var yr = new Date().getFullYear();
  return whyHTML() + '<footer class="foot"><div class="wrap fcols">' +
    '<div class="fbrand"><img src="/img/logo-light.png" alt="٩٩ للسبح"><div>سبح مختارة بعناية</div></div>' +
    '<div class="fcontact"><h3 class="gt2">تواصل معنا</h3><div>' + esc(s.support_text || '') + '</div>' +
    '<div class="fbtns">' + (wa ? '<a class="fwa" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener">' + ICON.wa + '<span>راسلنا على واتساب</span></a>' : '') +
    (ttURL() ? '<a class="ftt" href="' + esc(ttURL()) + '" target="_blank" rel="noopener">' + ICON.tt + '<span>تابعنا على تيك توك</span></a>' : '') +
    (igURL() ? '<a class="fig" href="' + esc(igURL()) + '" target="_blank" rel="noopener">' + ICON.ig + '<span>تابعنا على انستقرام</span></a>' : '') + '</div>' +
    '<div class="fpay">' + esc(s.promo_text) + '</div></div></div>' +
    (pol.length ? '<div class="wrap"><details class="pol"><summary>سياسة الاسترجاع والاستبدال</summary><ul>' + pol.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></details></div>' : '') +
    '<div class="wrap rights">© <span class="num">' + yr + '</span> ' + esc(s.store_name || '٩٩ للسبح') + '. جميع الحقوق محفوظة.</div></footer>';
}
function gotoTop() { window.scrollTo(0, 0); }

/* ---------- الصفحة الرئيسية ---------- */
function productCard(p) {
  var img = p.images && p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="' + esc(p.name) + '" loading="lazy">' : ICON.bead;
  return '<li class="card' + (p.soldOut ? ' so' : '') + '"><a class="ph' + (p.images && p.images[0] ? '' : ' empty') + '" href="#/p/' + p.id + '">' + img +
    (p.soldOut ? '<span class="soldtag">نفدت الكمية</span>' : '') + '</a>' +
    '<a class="nm" href="#/p/' + p.id + '">' + esc(p.name) + '</a>' +
    (p.rating_count ? '<div class="meta">' + starsHTML(p.rating_avg) + '<span class="num">(' + p.rating_count + ')</span></div>' : '') +
    '<div class="row"><span class="pr">' + R(p.price) + '</span><button class="add" type="button" data-act="add" data-id="' + p.id + '"' + (p.soldOut ? ' disabled' : '') + '>' + (p.soldOut ? 'نفدت' : 'أضف للسلة') + '</button></div></li>';
}
function gridHTML() {
  var list = store.products.filter(function (p) { return curCat == null || p.category_id === curCat; });
  if (!store.products.length) return '<li style="grid-column:1/-1"><div class="empty-box">' + ICON.bead + '<h3>المجموعة قيد التجهيز</h3><p>نضيف السبح قريبًا، ارجع لنا بعد قليل.</p></div></li>';
  if (!list.length) return '<li style="grid-column:1/-1"><div class="empty-box"><h3>لا توجد سبح في هذا القسم الآن</h3><p>جرّب قسمًا آخر.</p></div></li>';
  return list.map(productCard).join('');
}
function chipsHTML() {
  var cats = store.categories.filter(function (c) { return store.products.some(function (p) { return p.category_id === c.id; }); });
  if (!cats.length) return '';
  return '<nav class="chips" aria-label="الأقسام"><div class="wrap"><button class="chip" type="button" data-act="cat" data-id="" aria-pressed="' + (curCat == null) + '">الكل</button>' +
    cats.map(function (c) { return '<button class="chip" type="button" data-act="cat" data-id="' + c.id + '" aria-pressed="' + (curCat === c.id) + '">' + esc(c.name) + '</button>'; }).join('') + '</div></nav>';
}
function welcomeHTML() {
  var v = store.settings && store.settings.welcome_video; if (!/^\/media\/[A-Za-z0-9_.-]+\.mp4$/.test(v || '')) return '';
  return '<section class="wv" aria-label="فيديو ترحيبي"><video id="wvid" src="' + esc(v) + '" muted autoplay loop playsinline preload="metadata"></video>' +
    '<a class="cue" href="#products" data-act="cue">تصفّح السبح' + ICON.down + '</a></section>';
}
function startWelcome() {
  var v = $('#wvid'); if (!v) return;
  v.muted = true;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; return; }
  var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; });
}
function storyHTML() {
  var bn = store.banners;
  var slides;
  if (!bn.length) {
    slides = '<div class="sl brand on"><div class="cap"><img class="lg" src="/img/logo.png" alt="٩٩ للسبح"><p>تميّزٌ في عالم السُّبح</p></div></div>';
  } else {
    slides = bn.map(function (b, i) {
      var p = b.product_id ? prod(b.product_id) : null;
      return '<div class="sl' + (i === 0 ? ' on' : '') + (!b.title && !p ? ' plain' : '') + '"><img src="' + esc(b.image) + '" alt="' + esc(b.title || 'عرض') + '"' + (i ? ' loading="lazy"' : '') + '><div class="cap">' +
        (b.title ? '<h2>' + esc(b.title) + '</h2>' : '') + (p ? '<a class="go" href="#/p/' + p.id + '">شاهد السبحة</a>' : '') + '</div></div>';
    }).join('');
  }
  var bars = bn.length > 1 ? '<div class="bars" aria-hidden="true">' + bn.map(function () { return '<i><b></b></i>'; }).join('') + '</div>' : '';
  return '<section class="story" id="story" aria-label="العروض">' + bars + slides +
    (bn.length > 1 ? '<button class="tap next" type="button" data-act="snext" aria-label="التالي"></button><button class="tap prev" type="button" data-act="sprev" aria-label="السابق"></button>' : '') +
    '<a class="cue" href="#products" data-act="cue">تصفّح السبح' + ICON.down + '</a></section>';
}
function startStory() {
  var root = $('#story'); if (!root) return;
  var slides = root.querySelectorAll('.sl'); var bars = root.querySelectorAll('.bars i');
  if (slides.length < 2) return;
  var idx = 0, downAt = 0;
  function set(n) {
    idx = (n + slides.length) % slides.length;
    slides.forEach(function (s, i) { s.classList.toggle('on', i === idx); });
    bars.forEach(function (b, i) { b.className = i < idx ? 'done' : ''; });
    var cur = bars[idx]; void cur.offsetWidth; cur.className = 'cur';
  }
  bars.forEach(function (b) { b.firstChild.addEventListener('animationend', function () { if (b.className === 'cur') set(idx + 1); }); });
  root.addEventListener('pointerdown', function () { downAt = Date.now(); root.classList.add('paused'); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { root.addEventListener(ev, function () { root.classList.remove('paused'); }); });
  root._next = function () { if (Date.now() - downAt < 350 || !downAt) set(idx + 1); };
  root._prev = function () { if (Date.now() - downAt < 350 || !downAt) set(idx - 1); };
  set(0);
}
function pendingBanner() {
  var c = LS.get('bs_pending', '');
  if (!c || !(LS.get('bs_orders', {}) || {})[c]) return '';
  return '<div class="pendbar"><span>عندك طلب <b class="num">' + esc(c) + '</b> بانتظار الدفع</span><a href="#/pay/' + esc(c) + '">أكمل الدفع</a></div>';
}
function renderHome() {
  $('#app').innerHTML = strip() + pendingBanner() + header() + storyHTML() + offerBanner() + trustHTML() + ttBanner() + chipsHTML() +
    '<main class="wrap sec" id="products"><div class="sec-h"><h2>السبح</h2><small class="num">' + store.products.length + ' سبحة</small></div><ul class="grid" id="grid">' + gridHTML() + '</ul></main>' + footer();
  startStory();
}

/* ---------- صفحة السبحة ---------- */
function parseSpecs(txt) {
  return String(txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
    var m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(l); return m ? [m[1], m[2]] : ['', l];
  });
}
function dateAr(ts) { try { return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ts)); } catch (e) { return ''; } }
function reviewsHTML(list) {
  if (!list.length) return '<p class="hint">لا توجد تقييمات بعد، كن أول من يقيّم هذه السبحة.</p>';
  return list.map(function (r) {
    return '<div class="rv"><div class="who">' + esc(r.name) + ' ' + starsHTML(r.rating) + '<span class="when">' + dateAr(r.created_at) + '</span></div>' + (r.text ? '<p>' + esc(r.text) + '</p>' : '') + '</div>';
  }).join('');
}
function renderProduct(id) {
  var p = prod(id);
  if (!p) { $('#app').innerHTML = header({ back: true }) + '<main class="wrap page"><div class="empty-box"><h3>السبحة غير متوفرة</h3><a class="btn" href="#/">رجوع للمتجر</a></div></main>'; return; }
  track('view', p.id);
  var imgs = p.images && p.images.length ? p.images.map(function (u) { return '<div><img src="' + esc(u) + '" alt="' + esc(p.name) + '"></div>'; }).join('') : '<div class="big-empty">' + ICON.bead + '</div>';
  var dots = p.images && p.images.length > 1 ? '<div class="dots" aria-hidden="true">' + p.images.map(function (_, i) { return '<i class="' + (i === 0 ? 'on' : '') + '"></i>'; }).join('') + '</div>' : '';
  var specs = parseSpecs(p.specs);
  var specHTML = specs.length ? '<section class="box"><h3>المواصفات</h3><table class="spec"><tbody>' + specs.map(function (s) {
    return s[0] ? '<tr><td>' + esc(s[0]) + '</td><td>' + esc(s[1]) + '</td></tr>' : '<tr><td colspan="2">' + esc(s[1]) + '</td></tr>';
  }).join('') + '</tbody></table></section>' : '';
  var cat = store.categories.filter(function (c) { return c.id === p.category_id; })[0];
  $('#app').innerHTML = header({ back: true }) +
    '<main class="wrap page"><div class="two"><div><div class="gal"><div class="sc" id="sc">' + imgs + '</div>' + (p.soldOut ? '<div class="soldband">نفدت الكمية</div>' : '') + dots + '</div>' +
    '<div class="sharebar"><button class="sharebtn" type="button" data-act="share" data-id="' + p.id + '">' + ICON.share + ' مشاركة</button>' +
    '<div class="social" id="soc" hidden></div></div></div>' +
    '<div class="stack"><div>' + (cat ? '<span class="hint">' + esc(cat.name) + '</span>' : '') + '<h1 class="pname">' + esc(p.name) + '</h1>' +
    '<div class="rv-sum">' + (p.rating_count ? starsHTML(p.rating_avg) + '<span class="num">' + p.rating_avg + ' (' + p.rating_count + ' تقييم)</span>' : '<span class="hint">لا توجد تقييمات بعد</span>') + '</div>' +
    '<div class="pprice" style="margin-top:6px">' + R(p.price) + '</div>' +
    (!p.soldOut && p.stock <= 3 ? '<p class="hint" style="color:var(--err)">باقي <span class="num">' + p.stock + '</span> فقط</p>' : '') + '</div>' +
    specHTML + (p.description ? '<section class="box"><h3>الوصف</h3><p class="desc">' + esc(p.description) + '</p></section>' : '') +
    '<section class="box" id="rvbox"><h3>تقييم العملاء</h3><div id="rvlist"><p class="hint">جاري التحميل…</p></div></section>' +
    '<section class="box"><h3>أضف تقييمك</h3><form id="rvform" class="stack" novalidate><div class="starpick" id="starpick" role="radiogroup" aria-label="التقييم">' +
    [1, 2, 3, 4, 5].map(function (i) { return '<button type="button" data-act="star" data-v="' + i + '" aria-label="' + i + ' نجوم">' + ICON.star + '</button>'; }).join('') + '</div>' +
    '<div class="field"><label for="rvname">اسمك</label><input id="rvname" maxlength="40" autocomplete="name"></div>' +
    '<div class="field"><label for="rvtext">رأيك في السبحة</label><textarea id="rvtext" maxlength="600"></textarea></div>' +
    '<button class="btn ghost" type="submit">إرسال التقييم</button><p class="hint">يراجع المتجر التقييم قبل نشره.</p></form></section></div></div></main>' +
    '<div class="buybar"><div class="in"><div class="tot"><small>السعر</small><b class="pr">' + R(p.price) + '</b></div>' +
    '<button class="btn" type="button" data-act="add" data-id="' + p.id + '"' + (p.soldOut ? ' disabled' : '') + '>' + (p.soldOut ? 'نفدت الكمية' : 'أضف إلى السلة') + '</button></div></div>';

  // تمرير الصور والنقاط
  var sc = $('#sc'), dEls = document.querySelectorAll('.gal .dots i');
  if (sc && dEls.length) sc.addEventListener('scroll', function () {
    var i = Math.round(Math.abs(sc.scrollLeft) / sc.clientWidth); dEls.forEach(function (d, k) { d.classList.toggle('on', k === i); });
  }, { passive: true });
  // التقييمات من السيرفر
  api('/api/products/' + p.id).then(function (d) {
    var el = $('#rvlist'); if (el) el.innerHTML = reviewsHTML(d.reviews);
    if (d.product && d.product.views !== undefined) { var soc = $('#soc'); if (soc) { soc.hidden = false; soc.innerHTML = '<span><b class="num">' + d.product.sold + '</b> اشتروا هذي السبحة</span><span><b class="num">' + d.product.views + '</b> شاهدوها</span>'; } }
  }).catch(function () { var el = $('#rvlist'); if (el) el.innerHTML = '<p class="hint">تعذّر تحميل التقييمات.</p>'; });
  var rating = 0;
  $('#starpick').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="star"]'); if (!b) return; rating = Number(b.getAttribute('data-v'));
    document.querySelectorAll('#starpick button').forEach(function (x, i) { x.classList.toggle('on', i < rating); });
  });
  $('#rvform').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!rating) { toast('اختر عدد النجوم'); return; }
    post('/api/reviews', { product_id: p.id, rating: rating, name: $('#rvname').value, text: $('#rvtext').value }).then(function () {
      $('#rvform').innerHTML = '<p class="free">شكرًا لك، وصلنا تقييمك وسيظهر بعد المراجعة.</p>';
    }).catch(function (er) { toast(er.message); });
  });
}
function shareProduct(id) {
  var p = prod(id); if (!p) return;
  var url = location.origin + '/p/' + p.id;
  var data = { title: p.name + ' | ٩٩ للسبح', text: p.name + ' - ' + money(p.price) + ' ر.س', url: url };
  if (navigator.share) { navigator.share(data).catch(function () { }); return; }
  var done = function () { toast('تم نسخ رابط السبحة'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { toast(url); });
  else toast(url);
}

/* ---------- السلة ---------- */
function renderCart(skipCpn) {
  var lines = cartLines().filter(function (l) { return l.qty > 0; });
  if (!lines.length) {
    $('#app').innerHTML = header({ back: true }) + '<main class="wrap page"><h1>السلة</h1><div class="empty-box">' + ICON.bag.replace('<svg', '<svg style="width:60px"') + '<h3>سلتك فارغة</h3><p>أضف سبحة من المتجر وارجع لإتمام الطلب.</p><a class="btn" href="#/">تصفّح السبح</a></div></main>';
    return;
  }
  if (!skipCpn && couponCode) { coupon = null; cpnBusy = true; }
  var sub = subtotalOf(lines), s = store.settings, free = Number(s.free_min);
  var disc = coupon ? coupon.discount : 0, net = sub - disc;
  var fee = shipFee(net, shipType), total = net + fee;
  var left = Math.max(0, free - net), pct = Math.min(100, Math.round(net / free * 100));
  var items = lines.map(function (l) {
    var p = l.p, img = p.images && p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="">' : ICON.bead;
    return '<div class="line"><div class="t">' + img + '</div><div><div class="n">' + esc(p.name) + '</div><div class="u">' + R(p.price) + '</div>' +
      '<div class="ops"><div class="qty"><button type="button" data-act="dec" data-id="' + p.id + '" aria-label="إنقاص">−</button><span class="num">' + l.qty + '</span><button type="button" data-act="inc" data-id="' + p.id + '" aria-label="زيادة">+</button></div>' +
      '<span class="lt">' + R(p.price * l.qty) + '</span></div><button class="rm" type="button" data-act="rm" data-id="' + p.id + '">حذف</button></div></div>';
  }).join('');
  function opt(type, label, days) {
    var f = shipFee(net, type);
    return '<label><input type="radio" name="ship" value="' + type + '"' + (shipType === type ? ' checked' : '') + '><span class="tx"><b>' + label + '</b><small>يصلك ' + esc(/^\d+$/.test(String(days).trim()) ? 'خلال ' + days + ' أيام' : days) + '</small></span>' +
      (f === 0 ? '<span class="free">مجاني</span>' : '<span class="pr">' + R(f) + '</span>') + '</label>';
  }
  $('#app').innerHTML = header({ back: true }) + '<main class="wrap page"><h1>السلة</h1><div class="two"><div class="stack">' +
    '<section class="box">' + items + '</section>' +
    '<section class="box stack"><h3>طريقة الشحن</h3><div class="radio" id="shipbox">' + opt('slow', 'شحن عادي', s.slow_days) + opt('fast', 'شحن سريع', s.fast_days) + '</div>' +
    (left > 0 ? '<div class="stack" style="gap:6px"><div class="meter"><b style="width:' + pct + '%"></b></div><p class="hint">باقي <b class="num">' + money(left) + '</b> ر.س ويصير الشحن العادي مجاني</p></div>' : '<p class="hint okk">الشحن العادي مجاني على طلبك' + (s.free_applies_fast === '1' ? ' والسريع أيضًا' : '') + '</p>') + '</section></div>' +
    '<div class="stack"><section class="box cpnbox"><h3 style="margin-bottom:8px">🎟️ كود الخصم</h3><div id="cpnslot">' + cpnBoxHTML() + '</div></section>' +
    '<section class="box"><h3 style="margin-bottom:10px">الفاتورة</h3><div class="inv num"><div><span>مجموع السبح</span><span>' + R(sub) + '</span></div>' +
    (disc ? '<div><span>الخصم</span><span class="free">− ' + R(disc) + '</span></div>' : '') +
    '<div><span>الشحن (' + (shipType === 'fast' ? 'سريع' : 'عادي') + ')</span><span>' + (fee === 0 ? '<span class="free">مجاني</span>' : R(fee)) + '</span></div>' +
    '<div class="tot"><span>الإجمالي</span><span>' + R(total) + '</span></div></div></section>' +
    '<a class="btn block" href="#/checkout">اتمام الطلب</a></div></div></main>';
  if (!skipCpn && couponCode) checkCoupon(lines, function () { if (/^#\/cart/.test(location.hash)) renderCart(true); });
}

/* ---------- إتمام الطلب ---------- */
var payMethod = 'transfer';
function codOn() { var s = store && store.settings; return s && s.cod_enabled === '1'; }
function codFee() { return codOn() && payMethod === 'cod' ? Number(store.settings.cod_fee) || 0 : 0; }
var coupon = null, couponCode = LS.get('bs_coupon', '') || '', cpnBusy = false;
function cpnBoxHTML() {
  if (cpnBusy) return '<div class="cpn-ok"><span>جاري تطبيق الكود…</span></div>';
  if (coupon) return '<div class="cpn-ok"><span>كود الخصم <b>' + esc(coupon.code) + '</b> مفعّل ✅</span><button type="button" class="linkbtn" data-act="removecoupon">إزالة</button></div>';
  return '<div class="cpn-row"><input id="cpn" placeholder="اكتب كود الخصم هنا" autocomplete="off" autocapitalize="characters" dir="ltr"><button type="button" class="btn ghost sm" data-act="applycoupon">تطبيق</button></div><p class="hint" id="cpnmsg" role="status"></p>';
}
function checkCoupon(lines, done, code) {
  var em = $('#c_email');
  post('/api/coupons/check', { code: code || couponCode, items: lines.map(function (l) { return { id: l.p.id, qty: l.qty }; }), shipping: shipType, email: em ? em.value : '' }).then(function (d) {
    coupon = d; couponCode = d.code; LS.set('bs_coupon', couponCode); cpnBusy = false; done(null);
  }).catch(function (e) {
    coupon = null; couponCode = ''; LS.set('bs_coupon', ''); cpnBusy = false; done(e);
  });
}
function sumHTML(lines, sub, fee) {
  var disc = coupon ? coupon.discount : 0, f2 = shipFee(sub - disc, shipType), cf = codFee(), total = sub - disc + f2 + cf;
  return '<h3 style="margin-bottom:10px">ملخص الطلب</h3>' + lines.map(function (l) {
    return '<div class="inv num" style="margin-bottom:6px"><div><span>' + esc(l.p.name) + ' × ' + l.qty + '</span><span>' + R(l.p.price * l.qty) + '</span></div></div>';
  }).join('') +
    '<div class="cpn" id="cpnslot">' + cpnBoxHTML() + '</div>' +
    '<div class="inv num" style="border-top:1px solid var(--line);padding-top:8px;margin-top:6px">' +
    (disc ? '<div><span>الخصم</span><span class="free">− ' + R(disc) + '</span></div>' : '') +
    '<div><span>الشحن (' + (shipType === 'fast' ? 'سريع' : 'عادي') + ')</span><span>' + (f2 === 0 ? '<span class="free">مجاني</span>' : R(f2)) + '</span></div>' +
    (cf ? '<div><span>رسوم الدفع عند الاستلام</span><span>' + R(cf) + '</span></div>' : '') +
    '<div class="tot"><span>الإجمالي</span><span>' + R(total) + '</span></div></div>';
}
function refreshCouponView() {
  var ls = cartLines().filter(function (l) { return l.qty > 0; });
  if (/^#\/cart/.test(location.hash)) { renderCart(true); return; }
  var sb = $('#sumbox'); if (sb) sb.innerHTML = sumHTML(ls, subtotalOf(ls), 0);
}
function applyCoupon() {
  var inp = $('#cpn'), msg = $('#cpnmsg'); if (!inp) return; var code = inp.value.trim(); if (!code) { msg.textContent = 'اكتب كود الخصم'; return; }
  var lines = cartLines().filter(function (l) { return l.qty > 0; });
  msg.style.color = ''; msg.textContent = 'جاري التحقق…';
  checkCoupon(lines, function (err) {
    if (err) { var m = $('#cpnmsg'); if (m) { m.style.color = 'var(--err)'; m.textContent = err.message; } return; }
    refreshCouponView();
  }, code);
}
function renderCheckout() {
  if (!codOn()) payMethod = 'transfer';
  if (couponCode) { coupon = null; cpnBusy = true; }
  var lines = cartLines().filter(function (l) { return l.qty > 0; });
  if (!lines.length) { location.hash = '#/cart'; return; }
  var sub = subtotalOf(lines), fee = shipFee(sub, shipType), total = sub + fee;
  var saved = LS.get('bs_cust', {}); var email = LS.get('bs_email', '') || saved.email || '';
  function f(id, label, val, extra) { return '<div class="field" data-f="' + id + '"><label for="c_' + id + '">' + label + '</label><input id="c_' + id + '" value="' + esc(val || '') + '" ' + (extra || '') + '><div class="er"></div></div>'; }
  $('#app').innerHTML = header({ back: true }) + '<main class="wrap page"><h1>بيانات التوصيل</h1><div class="two"><form id="cform" class="stack box" novalidate>' +
    f('name', 'الاسم الكامل', saved.name, 'autocomplete="name"') +
    f('phone', 'رقم الجوال', saved.phone, 'type="tel" inputmode="numeric" autocomplete="tel" placeholder="05xxxxxxxx" class="ltr"') +
    (acct ? f('email', 'البريد الإلكتروني (حسابك)', acct.email, 'type="email" class="ltr" readonly') :
      f('email', 'البريد الإلكتروني', email, 'type="email" inputmode="email" autocomplete="email" class="ltr"') +
      '<div class="field" data-f="password"><label for="c_password">كلمة المرور (8 أحرف على الأقل)</label><input id="c_password" type="password" autocomplete="new-password" class="ltr"><div class="er"></div>' +
      '<div class="hint">ننشئ لك حسابًا ببريدك وكلمة المرور. إذا كان عندك حساب بنفس البريد اكتب كلمة مرورك. <button type="button" class="linkbtn" data-act="openauth">تسجيل الدخول</button></div></div>') +
    f('city', 'المدينة', saved.city, 'autocomplete="address-level2"') +
    '<div class="field" data-f="address"><label for="c_address">العنوان (الحي، الشارع، أقرب معلم)</label><textarea id="c_address" autocomplete="street-address">' + esc(saved.address || '') + '</textarea><div class="er"></div></div>' +
    '<div class="field"><label for="c_location">موقعك على الخريطة (اختياري)</label><input id="c_location" class="ltr" placeholder="https://maps.google.com/..." value="' + esc(saved.location || '') + '">' +
    '<button class="btn ghost" type="button" data-act="locate" style="margin-top:8px;min-height:44px;font-size:15px">تحديد موقعي الحالي</button><div class="hint" id="locmsg"></div></div>' +
    '<div class="field"><label for="c_note">ملاحظات (اختياري)</label><input id="c_note" maxlength="300"></div>' +
    '<fieldset class="gift"><label class="check"><input type="checkbox" id="g_on"> هذا الطلب هدية 🎁</label><div id="g_box" hidden>' +
    '<div class="field"><label for="g_to">اسم المُهدى إليه</label><input id="g_to" maxlength="60"></div>' +
    '<div class="field"><label for="g_msg">رسالة تنكتب على كرت الإهداء (اختياري)</label><textarea id="g_msg" maxlength="160" style="min-height:70px"></textarea></div><p class="hint">التغليف وكرت الإهداء مجانًا.</p></div></fieldset>' +
    (codOn() ? '<fieldset class="paym"><legend>طريقة الدفع</legend><div class="radio">' +
      '<label><input type="radio" name="pay" value="transfer"' + (payMethod !== 'cod' ? ' checked' : '') + '><span class="tx"><b>تحويل بنكي</b><small>تحوّل بعد الطلب وترفع الإيصال</small></span></label>' +
      '<label><input type="radio" name="pay" value="cod"' + (payMethod === 'cod' ? ' checked' : '') + '><span class="tx"><b>الدفع عند الاستلام</b><small>' + (store.settings.cod_cities ? 'متاح في: ' + esc(store.settings.cod_cities) : 'تدفع كاش للمندوب') + '</small></span><span class="pr">+' + R(Number(store.settings.cod_fee) || 0) + '</span></label>' +
      '</div></fieldset>' : '') +
    '<p class="hint" id="cerr" style="color:var(--err)" role="alert"></p>' +
    '<button class="btn block" id="cgo" type="submit">اتمام وإرسال الطلب</button></form>' +
    '<section class="box" id="sumbox">' + sumHTML(lines, sub, fee) + '</section></div></main>';
  if (couponCode) checkCoupon(lines, function () { if (/^#\/checkout/.test(location.hash)) { var sb = $('#sumbox'); if (sb) sb.innerHTML = sumHTML(lines, sub, 0); } });
}
function validateCheckout() {
  var rules = {
    name: function (v) { return v.trim().length >= 3 ? '' : 'اكتب الاسم الكامل'; },
    phone: function (v) { v = v.replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[\s-]/g, ''); return /^(05\d{8}|\+?9665\d{8})$/.test(v) ? '' : 'اكتب رقم جوال سعودي يبدأ بـ 05'; },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'اكتب بريدًا إلكترونيًا صحيحًا'; },
    city: function (v) { return v.trim().length >= 2 ? '' : 'اكتب المدينة'; },
    address: function (v) { return v.trim().length >= 6 ? '' : 'اكتب عنوان التوصيل'; }
  };
  if (!acct) rules.password = function (v) { return v.length >= 8 ? '' : 'كلمة المرور 8 أحرف على الأقل'; };
  var ok = true, first = null;
  Object.keys(rules).forEach(function (k) {
    var inp = $('#c_' + k), msg = rules[k](inp.value), box = $('[data-f="' + k + '"]');
    box.classList.toggle('bad', !!msg); $('.er', box).textContent = msg;
    if (msg) { ok = false; if (!first) first = inp; }
  });
  if (first) first.focus();
  return ok;
}
function submitOrder() {
  if (!validateCheckout()) return;
  var cust = { name: $('#c_name').value, phone: $('#c_phone').value, email: $('#c_email').value, city: $('#c_city').value, address: $('#c_address').value, location: $('#c_location').value, note: $('#c_note').value };
  if (!acct) cust.password = $('#c_password').value;
  var lines = cartLines().filter(function (l) { return l.qty > 0; });
  var btn = $('#cgo'); btn.disabled = true; btn.textContent = 'جاري إرسال الطلب…'; $('#cerr').textContent = '';
  post('/api/orders', { items: lines.map(function (l) { return { id: l.p.id, qty: l.qty }; }), shipping: shipType, customer: cust, coupon: coupon ? coupon.code : couponCode, pay: payMethod, gift: $('#g_on') && $('#g_on').checked ? { to: $('#g_to').value, msg: $('#g_msg').value } : null }).then(function (o) {
    LS.set('bs_cust', { name: cust.name, phone: cust.phone, email: cust.email, city: cust.city, address: cust.address, location: cust.location });
    LS.set('bs_email', cust.email);
    if (o.customer) acct = o.customer;
    var orders = LS.get('bs_orders', {}); orders[o.code] = o.token; LS.set('bs_orders', orders);
    var snap = { lines: lines.map(function (l) { return { name: l.p.name, qty: l.qty, price: l.p.price }; }), name: cust.name, city: cust.city, address: cust.address };
    LS.set('bs_last', Object.assign({ code: o.code, total: o.total, subtotal: o.subtotal, fee: o.shipping_fee }, snap));
    cart = {}; saveCart(); storeAt = 0; LS.set('bs_pending', o.cod ? '' : o.code); coupon = null; couponCode = ''; LS.set('bs_coupon', '');
    location.hash = '#/pay/' + o.code;
  }).catch(function (e) { btn.disabled = false; btn.textContent = 'اتمام وإرسال الطلب'; $('#cerr').textContent = e.message; storeAt = 0; });
}
function locate() {
  var msg = $('#locmsg');
  if (!navigator.geolocation) { msg.textContent = 'جوالك لا يدعم تحديد الموقع، الصق رابط موقعك يدويًا.'; return; }
  msg.textContent = 'جاري تحديد موقعك…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    $('#c_location').value = 'https://www.google.com/maps?q=' + pos.coords.latitude.toFixed(6) + ',' + pos.coords.longitude.toFixed(6);
    msg.textContent = 'تم تحديد موقعك.';
  }, function () { msg.textContent = 'ما قدرنا نحدد موقعك. فعّل صلاحية الموقع أو الصق رابط موقعك.'; }, { enableHighAccuracy: true, timeout: 12000 });
}

/* ---------- الدفع ---------- */
function shrink(file) {
  return new Promise(function (resolve) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height)); var c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) { URL.revokeObjectURL(url); resolve(b || file); }, 'image/jpeg', 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
function waText(o) {
  var lines = ['السلام عليكم، طلب رقم ' + o.code, 'الاسم: ' + o.name, 'المدينة: ' + o.city, ''];
  o.items.forEach(function (i) { lines.push('- ' + i.name + ' × ' + i.qty); });
  lines.push('', 'الإجمالي: ' + money(o.total) + ' ر.س', 'سأرسل لكم إيصال التحويل هنا.');
  return lines.join('\n');
}
function renderPay(code) {
  var token = (LS.get('bs_orders', {}) || {})[code];
  if (!token) { $('#app').innerHTML = header() + '<main class="wrap page"><div class="empty-box"><h3>ما لقينا هذا الطلب على جوالك</h3><p>إذا أرسلت الطلب من جهاز ثاني افتحه من نفس الجهاز، أو تواصل معنا.</p><a class="btn" href="#/">رجوع للمتجر</a></div></main>'; return; }
  $('#app').innerHTML = header() + '<main class="wrap page"><p class="hint">جاري تحميل طلبك…</p></main>';
  api('/api/orders/' + encodeURIComponent(code) + '?token=' + encodeURIComponent(token)).then(function (d) {
    var o = d.order, s = store.settings; var done = o.has_receipt;
    if (o.pay_method === 'cod') {
      $('#app').innerHTML = header() + '<main class="wrap page"><div class="stack"><a class="homelink" href="#/">' + ICON.back + ' الرجوع للرئيسية</a>' +
        '<section class="box okpanel">' + ICON.ok + '<h2>تم تسجيل طلبك</h2><p>رقم الطلب <span class="codepill">' + esc(o.code) + '</span></p>' +
        '<p>الدفع <b>عند الاستلام</b>: جهّز مبلغ <b class="num">' + money(o.total) + '</b> ر.س كاش.</p>' +
        '<div class="warn">بنتواصل معك على واتساب لتأكيد الطلب وموعد التوصيل.</div>' +
        (s.whatsapp ? '<a class="btn wa" href="https://wa.me/' + esc(s.whatsapp) + '?text=' + encodeURIComponent('السلام عليكم، طلبي رقم ' + o.code + ' (دفع عند الاستلام)') + '" target="_blank" rel="noopener">أكّد طلبك على واتساب</a>' : '') +
        '<a class="btn ghost" href="#/">متابعة التسوق</a></section></div></main>';
      return;
    }
    var supportLinks = (s.whatsapp ? '<a class="btn wa" href="https://wa.me/' + esc(s.whatsapp) + '" target="_blank" rel="noopener">راسلنا على واتساب</a>' : '');
    var okPanel = '<section class="box okpanel" id="okpanel"' + (done ? '' : ' hidden') + '>' + ICON.ok + '<h2>تم استلام طلبك</h2><p>وصلنا إيصال التحويل للطلب <span class="codepill">' + esc(o.code) + '</span>، ونراجعه ونبدأ بتجهيز طلبك.</p>' +
      '<div class="warn">إذا تأخر الطلب ولم يصل، راسلنا على واتساب أو خدمة العملاء.</div>' + supportLinks + '<a class="btn ghost" href="#/">متابعة التسوق</a></section>';
    var waBlock = s.whatsapp ? '<section class="box stack"><h3>الطريقة الأولى: عبر واتساب</h3><p class="hint">يفتح لك محادثة معنا ومعها رقم طلبك جاهز، وترسل لنا الإيصال بعد التحويل.</p>' +
      '<a class="btn wa block" id="wabtn" href="https://wa.me/' + esc(s.whatsapp) + '?text=' + encodeURIComponent(waText(o)) + '" target="_blank" rel="noopener">أرسل الطلب عبر واتساب</a></section>' + (s.iban ? '<div class="or">أو</div>' : '') : '';
    $('#app').innerHTML = header() + '<main class="wrap page"><div class="stack"><a class="homelink" href="#/">' + ICON.back + ' الرجوع للرئيسية</a><div><h1>تم تسجيل طلبك</h1><p>رقم الطلب <span class="codepill">' + esc(o.code) + '</span></p></div>' + okPanel +
      '<div id="paybody" class="stack"' + (done ? ' hidden' : '') + '><section class="box" style="text-align:center"><p class="hint">المبلغ المطلوب تحويله</p><div class="paynum num">' + money(o.total) + ' <span class="cur">ر.س</span></div></section>' +
      waBlock + (s.iban ? ('<section class="box stack"><h3>' + (s.whatsapp ? 'الطريقة الثانية: ' : '') + 'التحويل البنكي' + (s.bank_name ? ' عبر ' + esc(s.bank_name) : '') + '</h3>' +
      '<ol class="steps"><li><span>افتح تطبيق البنك واختر مستفيد جديد.</span></li><li><span>' + (s.qr_image ? 'امسح رمز QR أدناه أو الصق الآيبان.' : 'الصق الآيبان أدناه.') + '</span></li><li><span>حوّل مبلغ <b class="num">' + money(o.total) + '</b> ر.س.</span></li><li><span>أرفق صورة الإيصال بالأسفل.</span></li></ol>' +
      (/^05\d{8}$/.test(s.transfer_mobile || '') ? '<div class="fastpay"><div><small>الأسرع: حوّل برقم الجوال</small><b class="num" dir="ltr">' + esc(s.transfer_mobile) + '</b><span class="hint">من تطبيق أي بنك، اختر التحويل برقم الجوال واكتب الرقم، بدون إضافة مستفيد.</span></div><button class="btn ghost sm" type="button" data-act="copy" data-v="' + esc(s.transfer_mobile) + '">نسخ الرقم</button></div>' : '') +
      (s.qr_image ? '<img class="qr" src="' + esc(s.qr_image) + '" alt="رمز QR للتحويل">' +
      '<a class="btn ghost block" href="' + esc(s.qr_image) + '" download="sobah99-qr.png">حفظ صورة الرمز</a>' +
      '<p class="hint">احفظ الصورة، وبعدها في تطبيق البنك اختر مسح رمز QR ثم «من الصور». إذا انفتحت الصورة بدل ما تنحفظ، اضغط عليها مطولًا واختر حفظ.</p>' : '') +
      (s.account_name ? '<div class="accname"><small>اسم المستفيد</small><b>' + esc(s.account_name) + '</b></div>' : '') +
      '<div class="iban" id="iban">' + esc(s.iban.replace(/(.{4})/g, '$1 ').trim()) + '</div>' +
      '<div class="cprow"><button class="btn ghost" type="button" data-act="copy" data-v="' + esc(s.iban) + '">نسخ الآيبان</button><button class="btn ghost" type="button" data-act="copy" data-v="' + esc(String(o.total)) + '">نسخ المبلغ</button></div>' +
      '<p class="hint">تأكد أن الاسم الذي يظهر لك في تطبيق البنك قبل التأكيد هو اسم المستفيد أعلاه.</p></section>') : (s.whatsapp ? '' : '<section class="box"><p class="hint">تواصل معنا لإكمال الدفع.</p></section>')) +
      '<section class="box trust"><h3>تحوّل وأنت مطمئن</h3><ul><li>ما يُخصم شيء إلا المبلغ الظاهر لك، وطلبك برقم خاص تتابعه من "طلباتي".</li><li>يوصلك إشعار عند قبول طلبك وعند شحنه وتسليمه.</li><li>تقدر تلغي طلبك أو تطلب استرجاع السبحة حسب سياسة المتجر.</li><li>تواصل معنا بأي وقت على واتساب.</li></ul></section>' +
      '<section class="box stack"><h3>ارفاق إيصال التحويل</h3><p class="hint">صوّر الإيصال أو اختره من الجوال، ويصلنا مباشرة مع طلبك.</p>' +
      '<input type="file" id="rfile" accept="image/*,application/pdf" hidden><button class="btn block" id="rbtn" type="button" data-act="pickreceipt">اختيار صورة الإيصال</button><p class="hint" id="rmsg" role="status"></p></section>' +
      '<section class="box stack"><p class="hint">ما حوّلت الحين؟ طلبك محفوظ، وتقدر ترجع وتكمل الدفع لاحقًا من الصفحة الرئيسية.</p><a class="btn ghost block" href="#/">الرجوع للرئيسية</a></section></div></div></main>';
    var rf = $('#rfile');
    if (rf) rf.addEventListener('change', function () {
      var file = rf.files && rf.files[0]; if (!file) return;
      var msg = $('#rmsg'), btn = $('#rbtn'); btn.disabled = true; msg.style.color = ''; msg.textContent = 'جاري رفع الإيصال…';
      shrink(file).then(function (blob) {
        return fetch('/api/orders/' + encodeURIComponent(code) + '/receipt?token=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'تعذّر رفع الإيصال'); }); })
        .then(function () { LS.set('bs_pending', ''); $('#paybody').hidden = true; $('#okpanel').hidden = false; gotoTop(); })
        .catch(function (e) { btn.disabled = false; msg.style.color = 'var(--err)'; msg.textContent = e.message; });
    });
    var wa = $('#wabtn'); if (wa) wa.addEventListener('click', function () { post('/api/orders/' + encodeURIComponent(code) + '/method?token=' + encodeURIComponent(token), { method: 'whatsapp' }).catch(function () { }); });
  }).catch(function (e) {
    $('#app').innerHTML = header() + '<main class="wrap page"><div class="empty-box"><h3>' + esc(e.message) + '</h3><a class="btn" href="#/">رجوع للمتجر</a></div></main>';
  });
}

/* ---------- نافذة البريد ---------- */
function emailModal(force) {
  if (!force && (acct || LS.get('bs_skip', false))) return;
  var root = $('#modal-root'); var mode = 'register';
  function draw() {
    var reg = mode === 'register';
    root.innerHTML = '<div class="scrim" id="emscrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="emt"><img src="/img/logo.png" alt="٩٩ للسبح"><h2 id="emt">أهلًا بك في ٩٩ للسبح</h2>' +
      '<p>' + (reg ? 'أنشئ حسابك ليصلك جديد السبح وتتابع طلباتك.' : 'سجّل دخولك إلى حسابك.') + '</p>' +
      '<form id="emform" class="stack" novalidate><div class="field"><input id="emin" type="email" inputmode="email" autocomplete="email" class="ltr" placeholder="البريد الإلكتروني" aria-label="البريد الإلكتروني"></div>' +
      '<div class="field"><input id="empw" type="password" autocomplete="' + (reg ? 'new-password' : 'current-password') + '" class="ltr" placeholder="كلمة المرور' + (reg ? ' (8 أحرف على الأقل)' : '') + '" aria-label="كلمة المرور"><div class="er" id="emer" style="color:var(--err);font-size:14px;margin-top:6px" role="alert"></div></div>' +
      '<button class="btn block" type="submit">' + (reg ? 'إنشاء حساب' : 'تسجيل الدخول') + '</button></form>' +
      '<button class="skip" type="button" id="emswitch">' + (reg ? 'عندي حساب، تسجيل الدخول' : 'ما عندي حساب، إنشاء حساب جديد') + '</button>' +
      '<button class="skip" type="button" id="emskip">تخطي</button></div></div>';
    $('#emswitch').addEventListener('click', function () { mode = reg ? 'login' : 'register'; draw(); });
    $('#emskip').addEventListener('click', function () { LS.set('bs_skip', true); root.innerHTML = ''; });
    $('#emform').addEventListener('submit', function (e) {
      e.preventDefault(); var er = $('#emer'); var btn = $('#emform button'); er.textContent = '';
      var email = $('#emin').value.trim(), pw = $('#empw').value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { er.textContent = 'اكتب بريدًا إلكترونيًا صحيحًا'; return; }
      if (!pw) { er.textContent = 'اكتب كلمة المرور'; return; }
      btn.disabled = true;
      post('/api/account/auth', { email: email, password: pw, mode: mode }).then(function (d) {
        if (d.admin) { location.href = '/admin'; return; }
        acct = d.customer; LS.set('bs_email', email); root.innerHTML = ''; toast(reg ? 'تم إنشاء حسابك' : 'تم تسجيل الدخول'); route();
      }).catch(function (x) { btn.disabled = false; er.textContent = x.message; });
    });
  }
  draw();
}


/* ---------- طلباتي ---------- */
var myOrders = [];
var ST_AR = { new: 'قيد المراجعة', accepted: 'تم قبول الطلب', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي' };
var RT_AR = { pending: 'طلب الاسترجاع قيد المراجعة', approved: 'تم قبول الاسترجاع، بانتظار وصول السبحة إلينا', rejected: 'تم رفض طلب الاسترجاع', received: 'وصلتنا السبحة وهي قيد المراجعة', refunded: 'تم رد المبلغ' };
function orderStatusText(o) {
  if (o.status === 'new') return o.has_receipt ? 'تم استلام الإيصال، قيد المراجعة' : 'بانتظار الدفع';
  return ST_AR[o.status] || o.status;
}
function orderCardHTML(o) {
  var items = o.items.map(function (it) {
    var rr = o.returns.filter(function (r) { return r.item_id === it.id && r.status !== 'rejected'; })[0];
    var rej = !rr && o.returns.filter(function (r) { return r.item_id === it.id && r.status === 'rejected'; })[0];
    var act = '';
    if (rr) act = '<div class="rtst">' + esc(RT_AR[rr.status] || rr.status) + '</div>';
    else if (o.status === 'delivered') act = (rej ? '<div class="rtst bad">' + esc(RT_AR.rejected) + '</div>' : '') + '<button class="btn ghost sm" type="button" data-act="returnreq" data-code="' + esc(o.code) + '" data-item="' + it.id + '">طلب استرجاع</button>';
    return '<li class="oi">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<span class="ph0"></span>') +
      '<div class="oit"><b>' + esc(it.name) + '</b><span class="num">' + it.qty + ' × ' + R(it.price) + '</span>' + act + '</div></li>';
  }).join('');
  var foot = '';
  if (o.status === 'new' && !o.has_receipt) foot += '<a class="btn sm" href="#/pay/' + esc(o.code) + '">إكمال الدفع</a>';
  if (o.status === 'new' || o.status === 'accepted') {
    if (o.cancel_request === 'pending') foot += '<span class="rtst">طلب الإلغاء قيد المراجعة</span>';
    else foot += (o.cancel_request === 'rejected' ? '<span class="rtst bad">رُفض طلب الإلغاء السابق</span>' : '') + '<button class="btn ghost sm" type="button" data-act="cancelorder" data-code="' + esc(o.code) + '">' + (o.status === 'new' && !o.has_receipt ? 'إلغاء الطلب' : 'طلب إلغاء') + '</button>';
  }
  return '<article class="box ocard"><div class="oh"><span class="codepill">' + esc(o.code) + '</span><span class="ost s-' + esc(o.status) + '">' + esc(orderStatusText(o)) + '</span></div>' +
    '<div class="hint">' + esc(dateAr(o.created_at)) + ' · الإجمالي <b class="num">' + R(o.total) + '</b></div><ul class="ois">' + items + '</ul>' + (foot ? '<div class="oacts">' + foot + '</div>' : '') + '</article>';
}
function renderMyOrders() {
  var shell = function (inner) { $('#app').innerHTML = header({ back: true }) + '<main class="wrap page"><h1>طلباتي</h1>' + inner + '</main>'; };
  if (!acct) { shell('<div class="empty-box"><h3>سجّل دخولك لعرض طلباتك</h3><p>الطلبات التي تتم بعد تسجيل حسابك تظهر هنا.</p><button class="btn" type="button" data-act="openauth">تسجيل الدخول / حساب جديد</button></div>'); return; }
  shell('<p class="hint">جاري تحميل طلباتك…</p>');
  api('/api/account/orders').then(function (d) {
    myOrders = d.orders || [];
    var tk = LS.get('bs_orders', {}) || {}; myOrders.forEach(function (o) { if (!tk[o.code]) tk[o.code] = o.token; }); LS.set('bs_orders', tk);
    if (!myOrders.length) { shell('<div class="empty-box"><h3>ما عندك طلبات بعد</h3><a class="btn" href="#/">تصفّح السبح</a></div>'); return; }
    var notes = d.notes || [];
    var nh = notes.length ? '<div class="nlist"><h3>الإشعارات</h3>' + notes.map(function (n) { return '<div class="nit' + (n.read ? '' : ' new') + '">' + esc(n.text) + '<small>' + dateAr(n.created_at) + '</small></div>'; }).join('') + '</div>' : '';
    if (acct) acct.unread = 0;
    shell(nh + '<div class="stack">' + myOrders.map(orderCardHTML).join('') + '</div>');
  }).catch(function (e) {
    if (/سجّل دخولك/.test(e.message)) { acct = null; renderMyOrders(); return; }
    shell('<div class="empty-box"><h3>' + esc(e.message) + '</h3><button class="btn" type="button" data-act="reload">إعادة المحاولة</button></div>');
  });
}
function dialogShell(title, inner) {
  $('#modal-root').innerHTML = '<div class="scrim"><div class="dlg" role="dialog" aria-modal="true" style="text-align:start"><h2 style="text-align:center">' + esc(title) + '</h2>' + inner + '</div></div>';
}
function cancelDialog(code) {
  var o = myOrders.filter(function (x) { return x.code === code; })[0]; if (!o) return;
  var direct = o.status === 'new' && !o.has_receipt;
  dialogShell(direct ? 'إلغاء الطلب' : 'طلب إلغاء الطلب',
    '<p>' + (direct ? 'سيتم إلغاء طلبك ' : 'طلبك مدفوع، سنرسل طلب الإلغاء لمراجعتنا. ') + '<b class="num">' + esc(code) + '</b>' + (direct ? '.' : ' ولن يُرد لك المبلغ إلا بعد الموافقة على الإلغاء.') + '</p>' +
    '<div class="field"><label for="crs">السبب (اختياري)</label><input id="crs" maxlength="300"></div>' + (direct ? '' : '<div class="field"><label for="rbn">اسم صاحب الحساب</label><input id="rbn" maxlength="80" autocomplete="name"></div><div class="field"><label for="rib">رقم الآيبان لإرجاع المبلغ</label><input id="rib" dir="ltr" placeholder="SA00 0000 0000 0000 0000 0000" maxlength="34" autocomplete="off"></div>' ) + '<p class="hint" id="dlge" style="color:var(--err)" role="alert"></p>' +
    '<button class="btn block" id="dlgok" type="button">' + (direct ? 'نعم، ألغِ الطلب' : 'إرسال طلب الإلغاء') + '</button><button class="skip" type="button" data-act="dlgclose">رجوع</button>');
  $('#dlgok').addEventListener('click', function () {
    var err0 = $('#dlge'); err0.textContent = '';
    if (!direct) {
      if (!ibanOk($('#rib').value)) { err0.textContent = 'اكتب آيبان سعودي صحيح (SA + 22 رقم)'; return; }
      if ($('#rbn').value.trim().length < 3) { err0.textContent = 'اكتب اسم صاحب الحساب'; return; }
    }
    var b = this; b.disabled = true;
    post('/api/account/orders/' + encodeURIComponent(code) + '/cancel', { reason: $('#crs').value, iban: direct ? '' : $('#rib').value, holder: direct ? '' : $('#rbn').value }).then(function (d) {
      $('#modal-root').innerHTML = ''; toast(d.cancelled ? 'تم إلغاء الطلب' : 'تم إرسال طلب الإلغاء'); renderMyOrders();
    }).catch(function (e) { b.disabled = false; $('#dlge').textContent = e.message; });
  });
}
function ibanOk(v) { return /^SA\d{22}$/.test(String(v || '').replace(/[\s-]/g, '').toUpperCase()); }
function returnDialog(code, itemId) {
  var o = myOrders.filter(function (x) { return x.code === code; })[0]; if (!o) return;
  var it = o.items.filter(function (x) { return x.id === itemId; })[0]; if (!it) return;
  var fee = store && store.settings && store.settings.return_fee;
  dialogShell('طلب استرجاع',
    '<p><b>' + esc(it.name) + '</b> <span class="num">× ' + it.qty + '</span></p>' +
    '<div class="warn"><b>قبل ما تكمل، انتبه:</b><ul style="margin:6px 0 0;padding-inline-start:20px;line-height:1.9"><li>تكلفة شحن إرجاع السبحة تكون على حسابك' + (fee ? ' (<span class="num">' + esc(fee) + '</span> ر.س)' : '') + '.</li>' +
    '<li>لن يُرد لك مبلغ السبحة إلا بعد وصولها إلينا ومراجعتها.</li><li>قبول الاسترجاع يخضع لسياسة الاسترجاع والاستبدال.</li></ul></div>' +
    '<div class="field"><label for="rrs">سبب الاسترجاع</label><textarea id="rrs" maxlength="300" style="min-height:80px"></textarea></div>' +
    '<div class="field"><label for="rbn">اسم صاحب الحساب</label><input id="rbn" maxlength="80" autocomplete="name"></div><div class="field"><label for="rib">رقم الآيبان لإرجاع المبلغ</label><input id="rib" dir="ltr" placeholder="SA00 0000 0000 0000 0000 0000" maxlength="34" autocomplete="off"></div>' +
    '<label class="check" style="display:flex;gap:10px;align-items:flex-start;font-size:15px"><input type="checkbox" id="rack" style="margin-top:6px"> اطلعت على الشروط أعلاه وأوافق عليها</label>' +
    '<p class="hint" id="dlge" style="color:var(--err)" role="alert"></p>' +
    '<button class="btn block" id="dlgok" type="button">إرسال طلب الاسترجاع</button><button class="skip" type="button" data-act="dlgclose">رجوع</button>');
  $('#dlgok').addEventListener('click', function () {
    var err = $('#dlge'); err.textContent = '';
    if ($('#rrs').value.trim().length < 3) { err.textContent = 'اكتب سبب الاسترجاع'; return; }
    if (!ibanOk($('#rib').value)) { err.textContent = 'اكتب آيبان سعودي صحيح (SA + 22 رقم)'; return; }
    if ($('#rbn').value.trim().length < 3) { err.textContent = 'اكتب اسم صاحب الحساب'; return; }
    if (!$('#rack').checked) { err.textContent = 'وافق على الشروط للمتابعة'; return; }
    var b = this; b.disabled = true;
    post('/api/account/orders/' + encodeURIComponent(code) + '/return', { item_id: itemId, reason: $('#rrs').value, ack: true, iban: $('#rib').value, holder: $('#rbn').value }).then(function () {
      $('#modal-root').innerHTML = ''; toast('تم إرسال طلب الاسترجاع'); renderMyOrders();
    }).catch(function (e) { b.disabled = false; err.textContent = e.message; });
  });
}

/* ---------- القائمة الجانبية ---------- */
function closeMenu() { var m = $('#menu-root'); if (m) m.innerHTML = ''; document.body.style.overflow = ''; }
function openMenu() {
  var root = $('#menu-root'); if (!root) { root = document.createElement('div'); root.id = 'menu-root'; document.body.appendChild(root); }
  var st = store || { categories: [], products: [], settings: {} };
  var cats = (st.categories || []).filter(function (c) { return (st.products || []).some(function (p) { return p.category_id === c.id; }); });
  var wa = st.settings && st.settings.whatsapp;
  root.innerHTML = '<div class="mscrim" data-act="menuclose"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="القائمة">' +
    '<div class="dh"><a class="logo" href="#/" data-act="menuclose"><img src="/img/logo.png" alt="٩٩ للسبح"></a><button class="x" type="button" data-act="menuclose" aria-label="إغلاق">✕</button></div>' +
    (ttURL() ? '<a class="dtt" href="' + esc(ttURL()) + '" target="_blank" rel="noopener">' + ICON.tt + '<span>تابعنا على تيك توك</span></a>' : '') +
    '<nav class="dl"><button type="button" data-act="mcat" data-id="">جميع الأنواع</button>' +
    cats.map(function (c) { return '<button type="button" data-act="mcat" data-id="' + c.id + '">' + esc(c.name) + '</button>'; }).join('') +
    '<a href="#/cart" data-act="menuclose">السلة</a></nav>' +
    (acct ? '<div class="dacc"><div class="who"><small>الحساب</small><b dir="ltr">' + esc(acct.email) + '</b></div><a class="mo" href="#/orders" data-act="menuclose">طلباتي' + (acct.unread ? ' <span class="ncount">' + acct.unread + '</span>' : '') + '</a><button type="button" class="lo" data-act="logout">تسجيل الخروج</button></div>'
      : '<div class="dacc"><button type="button" class="li" data-act="openauth">تسجيل الدخول / حساب جديد</button></div>') +
    '<div class="df"><span>تواصل معنا</span>' + (wa ? '<a class="wal" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" aria-label="واتساب">' + ICON.wa + '</a>' : '') +
    (ttURL() ? '<a class="wal stt" href="' + esc(ttURL()) + '" target="_blank" rel="noopener" aria-label="تيك توك">' + ICON.tt + '</a>' : '') +
    (igURL() ? '<a class="wal sig" href="' + esc(igURL()) + '" target="_blank" rel="noopener" aria-label="انستقرام">' + ICON.ig + '</a>' : '') + '</div></aside>';
  document.body.style.overflow = 'hidden';
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

/* ---------- التوجيه ---------- */
function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  var h = location.hash || '#/'; var m;
  var go = function () {
    if (loadErr || !store) { $('#app').innerHTML = '<main class="wrap page"><div class="empty-box"><h3>تعذّر تحميل المتجر</h3><p>تأكد من الاتصال بالإنترنت وحاول مرة ثانية.</p><button class="btn" data-act="reload" type="button">إعادة المحاولة</button></div></main>'; return; }
    if (h === '#/' || h === '' || h === '#') renderHome();
    else if ((m = /^#\/p\/(\d+)/.exec(h))) renderProduct(m[1]);
    else if (h === '#/cart') renderCart();
    else if (h === '#/checkout') renderCheckout();
    else if (h === '#/orders') renderMyOrders();
    else if ((m = /^#\/pay\/([\w-]+)/.exec(h))) renderPay(m[1]);
    else renderHome();
    if (h !== '#/' && h !== '' && h !== '#') gotoTop();
  };
  Promise.all([loadStore(/^#\/(pay|checkout)/.test(h) ? true : false), acctReady]).then(go);
}

/* ---------- الأحداث ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  if (act === 'add') { addToCart(id, 1); }
  else if (act === 'menu') { openMenu(); }
  else if (act === 'applycoupon') { applyCoupon(); }
  else if (act === 'removecoupon') { coupon = null; couponCode = ''; LS.set('bs_coupon', ''); refreshCouponView(); }
  else if (act === 'cancelorder') { cancelDialog(el.getAttribute('data-code')); }
  else if (act === 'returnreq') { returnDialog(el.getAttribute('data-code'), Number(el.getAttribute('data-item'))); }
  else if (act === 'dlgclose') { $('#modal-root').innerHTML = ''; }
  else if (act === 'menuclose') { closeMenu(); }
  else if (act === 'logout') { post('/api/account/logout', {}).catch(function () { }).then(function () { acct = null; closeMenu(); toast('تم تسجيل الخروج'); route(); }); }
  else if (act === 'openauth') { closeMenu(); emailModal(true); }
  else if (act === 'mcat') { closeMenu(); curCat = id ? Number(id) : null; if (location.hash !== '#/' && location.hash !== '' && location.hash !== '#') { location.hash = '#/'; setTimeout(function () { var pr = $('#products'); if (pr) pr.scrollIntoView(); }, 350); } else { var g2 = $('#grid'); if (g2) g2.innerHTML = gridHTML(); document.querySelectorAll('.chip').forEach(function (c) { var cid = c.getAttribute('data-id'); c.setAttribute('aria-pressed', String((cid ? Number(cid) : null) === curCat)); }); var pr2 = $('#products'); if (pr2) pr2.scrollIntoView({ behavior: 'smooth' }); } }
  else if (act === 'back') { if (history.length > 1) history.back(); else location.hash = '#/'; }
  else if (act === 'cat') { curCat = id ? Number(id) : null; var g = $('#grid'); if (g) g.innerHTML = gridHTML(); document.querySelectorAll('.chip').forEach(function (c) { var cid = c.getAttribute('data-id'); c.setAttribute('aria-pressed', String((cid ? Number(cid) : null) === curCat)); }); }
  else if (act === 'snext') { var s1 = $('#story'); if (s1 && s1._next) s1._next(); }
  else if (act === 'sprev') { var s2 = $('#story'); if (s2 && s2._prev) s2._prev(); }
  else if (act === 'cue') { e.preventDefault(); var pr = $('#products'); if (pr) pr.scrollIntoView({ behavior: 'smooth' }); }
  else if (act === 'share') { shareProduct(id); }
  else if (act === 'inc') { var p = prod(id); if (p && (cart[id] || 0) < p.stock) { cart[id] = (cart[id] || 0) + 1; saveCart(); renderCart(); } else toast('وصلت للكمية المتوفرة'); }
  else if (act === 'dec') { cart[id] = (cart[id] || 1) - 1; if (cart[id] <= 0) delete cart[id]; saveCart(); renderCart(); }
  else if (act === 'rm') { delete cart[id]; saveCart(); renderCart(); }
  else if (act === 'locate') { locate(); }
  else if (act === 'pickreceipt') { var f = $('#rfile'); if (f) f.click(); }
  else if (act === 'copy') {
    var v = el.getAttribute('data-v'); var done = function () { toast('تم النسخ'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () { toast(v); }); else toast(v);
  }
  else if (act === 'reload') { storeAt = 0; route(); }
});
document.addEventListener('change', function (e) {
  if (e.target.name === 'pay') { payMethod = e.target.value === 'cod' ? 'cod' : 'transfer'; var ls0 = cartLines().filter(function (l) { return l.qty > 0; }), sb0 = $('#sumbox'); if (sb0) sb0.innerHTML = sumHTML(ls0, subtotalOf(ls0), 0); return; }
  if (e.target.id === 'g_on') { var gb = $('#g_box'); if (gb) gb.hidden = !e.target.checked; return; }
  if (e.target.name === 'ship') { shipType = e.target.value === 'fast' ? 'fast' : 'slow'; LS.set('bs_ship', shipType); renderCart(); }
});
document.addEventListener('submit', function (e) { if (e.target.id === 'cform') { e.preventDefault(); submitOrder(); } });
window.addEventListener('hashchange', function () { closeMenu(); route(); });

/* ---------- البداية ---------- */
track('visit');
route();
setTimeout(function () { if (!/^#\/(pay|checkout)/.test(location.hash)) acctReady.then(function () { emailModal(); }); }, 900);
})();
