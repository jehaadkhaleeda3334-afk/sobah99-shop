'use strict';
/**
 * سيرفر متجر ٩٩ للسبح
 * بدون أي مكتبات خارجية: يحتاج Node.js 22.13 أو أحدث فقط.
 * تشغيل: node server.js
 */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------- الإعدادات من متغيرات البيئة ----------
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const SITE_URL = String(process.env.SITE_URL || '').replace(/\/+$/, '');
const cleanEnv = (v) => String(v || '').replace(/[\s\u200B-\u200F\u202A-\u202E\uFEFF"'`]/g, '');
const TG_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN).replace(/^bot(?=\d)/i, '');
const TG_CHAT = cleanEnv(process.env.TELEGRAM_CHAT_ID);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const RECEIPT_DIR = path.join(DATA_DIR, 'receipts');
for (const d of [DATA_DIR, UPLOAD_DIR, RECEIPT_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- قاعدة البيانات ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0, category_id INTEGER, description TEXT NOT NULL DEFAULT '', specs TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, image TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', product_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', city TEXT NOT NULL, address TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', ship_type TEXT NOT NULL, shipping_fee REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL, total REAL NOT NULL, shipping_cost REAL, pay_method TEXT NOT NULL DEFAULT '',
  receipt_file TEXT NOT NULL DEFAULT '', receipt_at INTEGER, admin_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0, qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, name TEXT NOT NULL, rating INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '', approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, vid TEXT NOT NULL, product_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_day_type ON events(day, type);
CREATE INDEX IF NOT EXISTS idx_events_prod ON events(product_id, type);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'stock_taken')) {
  db.exec('ALTER TABLE orders ADD COLUMN stock_taken INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE orders SET stock_taken=1 WHERE status != 'cancelled'"); // الطلبات القديمة كانت تخصم عند الإنشاء
}
db.exec(`CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL
)`);
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'customer_id')) db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER');
for (const [col, def] of [['cancel_request', "TEXT NOT NULL DEFAULT ''"], ['cancel_reason', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS return_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, item_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`);
for (const [tbl, col] of [['return_requests', 'iban'], ['return_requests', 'holder'], ['orders', 'refund_iban'], ['orders', 'refund_holder']]) {
  if (!db.prepare(`PRAGMA table_info(${tbl})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
}
function cleanIban(v) {
  const x = String(v || '').replace(/[\s-]/g, '').toUpperCase();
  if (!/^SA\d{22}$/.test(x)) throw new HttpError(400, 'اكتب آيبان سعودي صحيح (يبدأ بـ SA ويتكون من 24 خانة)');
  return x;
}
function cleanHolder(v) { const x = clip(v, 80); if (x.length < 3) throw new HttpError(400, 'اكتب اسم صاحب الحساب'); return x; }
db.exec(`CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, type TEXT NOT NULL DEFAULT 'percent', value REAL NOT NULL,
  min_order REAL NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
)`);
for (const [col, def] of [['discount', 'REAL NOT NULL DEFAULT 0'], ['coupon_code', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
}
if (!db.prepare('PRAGMA table_info(coupons)').all().some((c) => c.name === 'featured')) db.exec('ALTER TABLE coupons ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
// عرض الإطلاق: سبحة مجانية لأول 5 طلبات (يدفع العميل الشحن فقط)
for (const [col, def] of [['cod_fee', 'REAL NOT NULL DEFAULT 0'], ['gift_to', "TEXT NOT NULL DEFAULT ''"], ['gift_msg', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
}
const normCity = (v) => String(v || '').trim().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^ال/, '').replace(/\s+/g, '').toLowerCase();
function codAllowed(s, city) {
  if (s.cod_enabled !== '1') return false;
  const list = String(s.cod_cities || '').split(/[,،\n]+/).map(normCity).filter(Boolean);
  return !list.length || list.includes(normCity(city));
}
function couponUses(code) { return db.prepare("SELECT COUNT(*) c FROM orders WHERE coupon_code=? AND status != 'cancelled'").get(code).c; }
// يتحقق من الكود ويحسب الخصم على مجموع السبح (بدون الشحن)
function applyCoupon(raw, subtotal, email) {
  const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) return { code: '', discount: 0 };
  const c = db.prepare('SELECT * FROM coupons WHERE code=?').get(code);
  if (!c || !c.active) throw new HttpError(400, 'كود الخصم غير صحيح');
  if (c.expires_at && now() > c.expires_at) throw new HttpError(400, 'انتهت صلاحية كود الخصم');
  if (c.max_uses > 0 && couponUses(code) >= c.max_uses) throw new HttpError(400, 'انتهت الكمية المتاحة من هذا الكود');
  if (c.min_order > 0 && subtotal < c.min_order) throw new HttpError(400, `الكود يتطلب طلبًا لا يقل عن ${c.min_order} ر.س`);
  if (email && db.prepare("SELECT 1 FROM orders WHERE coupon_code=? AND email=? AND status != 'cancelled'").get(code, email)) throw new HttpError(400, 'استخدمت هذا الكود من قبل');
  let d = c.type === 'fixed' ? c.value : Math.round(subtotal * c.value) / 100;
  d = Math.min(Math.round(d * 100) / 100, subtotal);
  return { code, discount: d, type: c.type, value: c.value };
}
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, order_code TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
)`);
function notifyCustomer(orderId, text) {
  const o = db.prepare('SELECT customer_id, code FROM orders WHERE id=?').get(orderId); if (!o || !o.customer_id) return;
  db.prepare('INSERT INTO notifications(customer_id,order_code,text,created_at) VALUES (?,?,?,?)').run(o.customer_id, o.code, text, now());
}
const STATUS_NOTE = {
  accepted: 'تم قبول طلبك ✅ وجاري تجهيزه',
  shipped: 'تم شحن طلبك 🚚 وهو في الطريق إليك',
  delivered: 'تم تسليم طلبك 🎉 نتمنى أن ينال إعجابك',
  cancelled: 'تم إلغاء طلبك',
  new: 'تمت إعادة طلبك إلى حالة الانتظار',
};
const RETURN_NOTE = {
  approved: 'تمت الموافقة على طلب الاسترجاع، يرجى إرسال السبحة',
  rejected: 'نعتذر، تم رفض طلب الاسترجاع',
  received: 'استلمنا السبحة المرتجعة وجاري مراجعتها',
  refunded: 'تمت مراجعة السبحة وإرجاع المبلغ لك 💰',
};
// الكمية تُخصم فقط بعد وصول الإيصال أو قبول الطلب، وتُرجع عند الإلغاء
function takeStock(oid) {
  const o = db.prepare('SELECT id, stock_taken, admin_note FROM orders WHERE id=?').get(oid); if (!o || o.stock_taken) return;
  let short = false;
  for (const it of db.prepare('SELECT product_id, qty FROM order_items WHERE order_id=?').all(oid)) {
    const p = db.prepare('SELECT stock FROM products WHERE id=?').get(it.product_id); if (!p) continue;
    if (p.stock < it.qty) short = true;
    db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id=?').run(it.qty, it.product_id);
  }
  const note = short ? ((o.admin_note ? o.admin_note + ' | ' : '') + 'تنبيه: الكمية لم تكن تكفي عند الدفع، راجع الطلب') : o.admin_note;
  db.prepare('UPDATE orders SET stock_taken=1, admin_note=? WHERE id=?').run(note, oid);
}
function releaseStock(oid) {
  const o = db.prepare('SELECT stock_taken FROM orders WHERE id=?').get(oid); if (!o || !o.stock_taken) return;
  for (const it of db.prepare('SELECT product_id, qty FROM order_items WHERE order_id=?').all(oid)) db.prepare('UPDATE products SET stock = stock + ? WHERE id=?').run(it.qty, it.product_id);
  db.prepare('UPDATE orders SET stock_taken=0 WHERE id=?').run(oid);
}

const DEFAULT_SETTINGS = {
  store_name: '٩٩ للسبح',
  whatsapp: '966502370665',
  bank_name: '',
  iban: '',
  account_name: '',
  transfer_mobile: '',
  cod_enabled: '1',
  cod_fee: '10',
  cod_cities: '',
  qr_image: '',
  free_min: '90',
  free_applies_fast: '0',
  fast_price: '45', fast_days: 'خلال 24 ساعة',
  slow_price: '19', slow_days: 'من يوم إلى 5 أيام',
  promo_text: 'تميّزٌ في عالم السُّبح · توصيل لكل مناطق المملكة',
  support_text: 'خدمة العملاء عبر واتساب',
  return_fee: '',
  tiktok: '',
  instagram: '',
  welcome_video: '',
  return_policy: 'يحق لك طلب الاسترجاع أو الاستبدال خلال 7 أيام من استلام الطلب.\nيشترط أن تكون السبحة بحالتها الأصلية وغير مستخدمة ومعها تغليفها.\nتواصل معنا عبر واتساب برقم الطلب وصور السبحة لننظر في طلبك.\nإذا وصلتك السبحة تالفة أو مختلفة عن طلبك فنتحمل تكلفة الشحن والاستبدال.\nعند قبول الاسترجاع يُعاد المبلغ بنفس طريقة الدفع بعد استلامنا السبحة وفحصها.',
};
const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);
// تحديث القيم القديمة للشحن إذا لم يغيّرها المالك
for (const [k, o, n] of [['slow_price', '20', '19'], ['slow_days', '5', 'من يوم إلى 5 أيام'], ['fast_days', '2', 'خلال 24 ساعة']]) db.prepare('UPDATE settings SET value=? WHERE key=? AND value=?').run(n, k, o);
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  ['كهرمان', 'يسر', 'عقيق', 'فيروز', 'كوك'].forEach((n, i) =>
    db.prepare('INSERT INTO categories(name,sort) VALUES (?,?)').run(n, i + 1));
}
function getSettings() {
  const o = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) o[r.key] = r.value;
  return o;
}
function secretKey() {
  let r = db.prepare("SELECT value FROM settings WHERE key='_secret'").get();
  if (!r) { const v = crypto.randomBytes(32).toString('hex'); db.prepare("INSERT INTO settings(key,value) VALUES('_secret',?)").run(v); return v; }
  return r.value;
}
const SECRET = secretKey();

// ---------- أدوات عامة ----------
const now = () => Date.now();
const dayKey = (ts) => new Date(ts + 3 * 3600e3).toISOString().slice(0, 10);   // توقيت الرياض
const monthKey = (ts) => dayKey(ts).slice(0, 7);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const buckets = new Map();
function limit(req, key, max, windowMs) {
  const ip = clientIp(req); const k = key + '|' + ip; const t = now();
  let b = buckets.get(k);
  if (!b || t > b.reset) b = { n: 0, reset: t + windowMs };
  b.n++; buckets.set(k, b);
  if (b.n > max) throw new HttpError(429, 'محاولات كثيرة، حاول بعد قليل');
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 600e3).unref();
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function isHttps(req) { return String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || SITE_URL.startsWith('https'); }
function origin(req) { return SITE_URL || ((isHttps(req) ? 'https' : 'http') + '://' + (req.headers.host || 'localhost')); }

function json(res, status, obj, headers = {}) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store', ...headers });
  res.end(b);
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'الحجم كبير')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req, 200 * 1024);
  if (!b.length) return {};
  try { const v = JSON.parse(b.toString('utf8')); return v && typeof v === 'object' ? v : {}; } catch { throw new HttpError(400, 'بيانات غير صحيحة'); }
}

// ---------- الجلسة (المدير) ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function makeSession() { const exp = now() + 14 * 24 * 3600e3; const v = String(exp); return v + '.' + sign(v); }
function parseCookies(req) {
  const o = {}; for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o;
}
function isAdmin(req) {
  const c = parseCookies(req).bs_admin; if (!c) return false;
  const [exp, sig] = c.split('.'); if (!exp || !sig || Number(exp) < now()) return false;
  const good = sign(exp); return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, 'سجّل دخولك أولًا');
  if (req.method !== 'GET' && req.headers['x-bs'] !== '1') throw new HttpError(403, 'طلب مرفوض');
}

// ---------- تنبيهات تيليجرام (اختياري) ----------
function notify(text) {
  return new Promise((resolve) => {
    if (!TG_TOKEN || !TG_CHAT) return resolve({ ok: false, error: 'no_config' });
    try {
      const body = JSON.stringify({ chat_id: TG_CHAT, text });
      const r = https.request({ hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (x) => {
        let d = ''; x.on('data', (c) => { d += c; if (d.length > 4000) d = d.slice(0, 4000); });
        x.on('end', () => {
          let j = {}; try { j = JSON.parse(d); } catch { /* */ }
          if (x.statusCode === 200 && j.ok) return resolve({ ok: true });
          console.warn('[telegram] فشل الإرسال:', x.statusCode, j.description || '');
          resolve({ ok: false, status: x.statusCode, error: j.description || ('HTTP ' + x.statusCode) });
        });
      });
      r.on('error', (e) => { console.warn('[telegram] خطأ اتصال:', e.code || e.message); resolve({ ok: false, error: 'تعذّر الاتصال بتيليجرام' }); });
      r.setTimeout(8000, () => r.destroy()); r.end(body);
    } catch (e) { console.warn('[telegram] خطأ في تجهيز الطلب:', e.code || e.message); resolve({ ok: false, error: 'التوكن يحتوي رموزًا غير صالحة، أعد لصقه في Render' }); }
  });
}

// ---------- الصور ----------
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buf.length > 6 && buf.slice(0, 3).toString() === 'GIF') return { ext: 'gif', mime: 'image/gif' };
  if (buf.length > 5 && buf.slice(0, 4).toString() === '%PDF') return { ext: 'pdf', mime: 'application/pdf' };
  return null;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };

function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('غير موجود'); }
    const ext = path.extname(file).toLowerCase();
    const base = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

// ---------- بيانات المتجر العامة ----------
let statCache = { t: 0, v: null };
function productStats() {
  if (statCache.v && now() - statCache.t < 15000) return statCache.v;
  const v = { views: {}, sold: {}, rating: {} };
  for (const r of db.prepare("SELECT product_id p, COUNT(DISTINCT vid) c FROM events WHERE type='view' AND product_id IS NOT NULL GROUP BY product_id").all()) v.views[r.p] = r.c;
  for (const r of db.prepare("SELECT oi.product_id p, SUM(oi.qty) c FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status IN ('accepted','shipped','delivered') GROUP BY oi.product_id").all()) v.sold[r.p] = r.c;
  for (const r of db.prepare('SELECT product_id p, COUNT(*) c, AVG(rating) a FROM reviews WHERE approved=1 GROUP BY product_id').all()) v.rating[r.p] = { count: r.c, avg: Math.round(r.a * 10) / 10 };
  statCache = { t: now(), v }; return v;
}
function publicProduct(p, st) {
  let images = []; try { images = JSON.parse(p.images) || []; } catch { /* */ }
  const rt = st.rating[p.id] || { count: 0, avg: 0 };
  return {
    id: p.id, name: p.name, price: p.price, stock: p.stock, soldOut: p.stock <= 0, category_id: p.category_id,
    description: p.description, specs: p.specs, images,
    rating_avg: rt.avg, rating_count: rt.count,
  };
}
function featuredOffer() {
  const c = db.prepare('SELECT * FROM coupons WHERE featured=1 AND active=1 ORDER BY id DESC LIMIT 1').get();
  if (!c || (c.expires_at && Date.now() > c.expires_at)) return null;
  const left = c.max_uses > 0 ? c.max_uses - couponUses(c.code) : null;
  if (left !== null && left <= 0) return null;
  return { code: c.code, type: c.type, value: c.value, max: c.max_uses, left };
}
function storePayload() {
  const st = productStats();
  const s = getSettings(); const pub = {}; for (const k of PUBLIC_SETTINGS) pub[k] = s[k];
  return {
    settings: pub,
    categories: db.prepare('SELECT id,name FROM categories ORDER BY sort,id').all(),
    banners: db.prepare('SELECT id,image,title,product_id FROM banners WHERE active=1 ORDER BY sort,id').all(),
    products: db.prepare('SELECT * FROM products WHERE active=1 ORDER BY sort DESC, id DESC').all().map((p) => publicProduct(p, st)),
    offer: featuredOffer(),
  };
}
function shippingFor(subtotal, type, s) {
  const base = type === 'fast' ? num(s.fast_price) : num(s.slow_price);
  const free = subtotal >= num(s.free_min, 90) && (type === 'slow' || s.free_applies_fast === '1');
  return free ? 0 : base;
}
function orderLines(orderId) { return db.prepare('SELECT id,product_id,name,image,price,qty FROM order_items WHERE order_id=?').all(orderId); }
const returnsOf = (orderId, forAdmin) => db.prepare(forAdmin ? 'SELECT id,item_id,reason,status,iban,holder,created_at FROM return_requests WHERE order_id=? ORDER BY id' : 'SELECT id,item_id,reason,status,created_at FROM return_requests WHERE order_id=? ORDER BY id').all(orderId);
function orderPublic(o) {
  return { code: o.code, status: o.status, subtotal: o.subtotal, discount: o.discount || 0, coupon_code: o.coupon_code || '', cod_fee: o.cod_fee || 0, shipping_fee: o.shipping_fee, total: o.total, ship_type: o.ship_type,
    name: o.name, phone: o.phone, city: o.city, address: o.address, has_receipt: !!o.receipt_file, pay_method: o.pay_method, created_at: o.created_at, items: orderLines(o.id) };
}

// ---------- الطلبات (العميل) ----------
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120; }
// ---------- حسابات العملاء ----------
const CUST_DAYS = 60;
function hashPass(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function makeCustCookie(req, cid) {
  const exp = now() + CUST_DAYS * 86400e3; const v = `${cid}.${exp}`;
  return `bs_cust=${v}.${sign('c' + v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CUST_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`;
}
const clearCustCookie = (req) => `bs_cust=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
function currentCustomer(req) {
  const c = parseCookies(req).bs_cust; if (!c) return null;
  const p = c.split('.'); if (p.length !== 3) return null;
  const [cid, exp, sig] = p; if (!/^\d+$/.test(cid) || Number(exp) < now()) return null;
  const good = sign('c' + cid + '.' + exp); if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  return db.prepare('SELECT id,email FROM customers WHERE id=?').get(Number(cid)) || null;
}
// يسجّل الدخول أو ينشئ حسابًا جديدًا حسب الحالة (mode: login | register | auto)
function authCustomer(email, password, mode) {
  if (!validEmail(email)) throw new HttpError(400, 'اكتب بريدًا إلكترونيًا صحيحًا');
  password = String(password || '');
  if (ADMIN_EMAIL && email === ADMIN_EMAIL) throw new HttpError(400, 'هذا البريد غير متاح لحساب عميل');
  const row = db.prepare('SELECT * FROM customers WHERE email=?').get(email);
  if (row) {
    if (mode === 'register') throw new HttpError(409, 'هذا البريد مسجّل مسبقًا، سجّل دخولك');
    const good = Buffer.from(row.hash, 'hex'), got = Buffer.from(hashPass(password, row.salt), 'hex');
    if (!crypto.timingSafeEqual(good, got)) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
    return { id: row.id, email: row.email };
  }
  if (mode === 'login') { hashPass(password, 'x'.repeat(16)); throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة'); }
  if (password.length < 8) throw new HttpError(400, 'كلمة المرور 8 أحرف على الأقل');
  if (password.length > 100) throw new HttpError(400, 'كلمة المرور طويلة جدًا');
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO customers(email,salt,hash,created_at) VALUES (?,?,?,?)').run(email, salt, hashPass(password, salt), now());
  db.prepare('INSERT OR IGNORE INTO subscribers(email,created_at) VALUES (?,?)').run(email, now());
  return { id: Number(r.lastInsertRowid), email };
}

function createOrder(body, customerId, forcedEmail) {
  const s = getSettings();
  const c = body.customer || {};
  const name = clip(c.name, 80), city = clip(c.city, 60), address = clip(c.address, 300);
  const phone = toLatinDigits(clip(c.phone, 20)).replace(/[\s\-]/g, '');
  const email = forcedEmail || clip(c.email, 120).toLowerCase();
  let location = clip(c.location, 300); if (location && !/^https:\/\//i.test(location)) location = '';
  if (name.length < 3) throw new HttpError(400, 'اكتب الاسم الكامل');
  if (!/^(05\d{8}|\+?9665\d{8})$/.test(phone)) throw new HttpError(400, 'رقم الجوال غير صحيح');
  if (!validEmail(email)) throw new HttpError(400, 'اكتب بريدًا إلكترونيًا صحيحًا');
  if (city.length < 2) throw new HttpError(400, 'اكتب المدينة');
  if (address.length < 6) throw new HttpError(400, 'اكتب عنوان التوصيل');
  const shipType = body.shipping === 'fast' ? 'fast' : 'slow';
  const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  if (!items.length) throw new HttpError(400, 'السلة فارغة');
  return tx(() => {
    const merged = new Map();
    for (const it of items) { const id = Math.trunc(num(it.id)), q = Math.trunc(num(it.qty)); if (id > 0 && q > 0) merged.set(id, Math.min(20, (merged.get(id) || 0) + q)); }
    if (!merged.size) throw new HttpError(400, 'السلة فارغة');
    let subtotal = 0; const lines = [];
    for (const [id, qty] of merged) {
      const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
      if (!p) throw new HttpError(409, 'منتج في السلة لم يعد متوفرًا');
      if (p.stock < qty) throw new HttpError(409, p.stock <= 0 ? `نفدت الكمية: ${p.name}` : `المتوفر من ${p.name} ${p.stock} فقط`);
      let img = ''; try { img = (JSON.parse(p.images) || [])[0] || ''; } catch { /* */ }
      subtotal += p.price * qty; lines.push({ p, qty, img });
    }
    const cp = applyCoupon(body.coupon, subtotal, email); const discount = cp.discount;
    const fee = shippingFor(subtotal - discount, shipType, s);
    const cod = body.pay === 'cod';
    if (cod && !codAllowed(s, city)) throw new HttpError(400, 'الدفع عند الاستلام غير متاح في مدينتك، اختر التحويل البنكي');
    const codFee = cod ? Math.max(0, num(s.cod_fee)) : 0;
    const gift = body.gift && typeof body.gift === 'object' ? body.gift : null;
    const giftTo = gift ? clip(gift.to, 60) : '', giftMsg = gift ? clip(gift.msg, 160) : '';
    const total = subtotal - discount + fee + codFee; const t = now();
    let code; do { code = 'S99-' + (10000 + crypto.randomInt(90000)); } while (db.prepare('SELECT 1 FROM orders WHERE code=?').get(code));
    const token = crypto.randomBytes(16).toString('hex');
    const r = db.prepare(`INSERT INTO orders(code,token,name,phone,email,city,address,location,note,ship_type,shipping_fee,subtotal,total,created_at,updated_at,customer_id,discount,coupon_code,pay_method,cod_fee,gift_to,gift_msg)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, token, name, phone, email, city, address, location, clip(c.note, 300), shipType, fee, subtotal, total, t, t, customerId || null, discount, cp.code, cod ? 'cod' : '', codFee, giftTo, giftMsg);
    const oid = Number(r.lastInsertRowid);
    for (const l of lines) {
      db.prepare('INSERT INTO order_items(order_id,product_id,name,image,price,cost,qty) VALUES (?,?,?,?,?,?,?)').run(oid, l.p.id, l.p.name, l.img, l.p.price, l.p.cost, l.qty);
    }
    if (validEmail(email)) db.prepare('INSERT OR IGNORE INTO subscribers(email,created_at) VALUES (?,?)').run(email, t);
    statCache.t = 0;
    return { oid, code, token, subtotal, discount, coupon: cp.code, shipping_fee: fee, cod, cod_fee: codFee, gift: !!(giftTo || giftMsg), total, name, city, lines };
  });
}

// ---------- لوحة المدير: حسابات ----------
const COUNTED = "('accepted','shipped','delivered')";
function report(month) {
  const from = Date.parse(month + '-01T00:00:00+03:00');
  const [y, m] = month.split('-').map(Number); const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const to = Date.parse(next + '-01T00:00:00+03:00');
  const orders = db.prepare(`SELECT * FROM orders WHERE created_at>=? AND created_at<? AND status IN ${COUNTED}`).all(from, to);
  let revenue = 0, fees = 0, cogs = 0, shipCost = 0;
  for (const o of orders) {
    revenue += o.subtotal - (o.discount || 0); fees += o.shipping_fee + (o.cod_fee || 0);
    cogs += db.prepare('SELECT COALESCE(SUM(cost*qty),0) c FROM order_items WHERE order_id=?').get(o.id).c;
    shipCost += o.shipping_cost == null ? o.shipping_fee : o.shipping_cost;
  }
  const ex = db.prepare('SELECT * FROM expenses WHERE month=? ORDER BY id').all(month);
  const expenses = ex.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
  const adjust = ex.filter((e) => e.kind === 'adjust').reduce((a, e) => a + e.amount, 0);
  const cancelled = db.prepare("SELECT COUNT(*) c FROM orders WHERE created_at>=? AND created_at<? AND status='cancelled'").get(from, to).c;
  const net = revenue + fees - cogs - shipCost - expenses + adjust;
  return { month, orders: orders.length, cancelled, revenue, shipping_fees: fees, cogs, shipping_cost: shipCost, expenses, adjust, net, items: ex };
}

function dashboard() {
  const t = now(); const today = dayKey(t);
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const visitors = q("SELECT COUNT(DISTINCT vid) c FROM events WHERE day=? AND type='visit'", today).c;
  const ordersToday = q('SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE created_at>=? AND status != ?', Date.parse(today + 'T00:00:00+03:00'), 'cancelled');
  const cartsToday = q("SELECT COUNT(*) c FROM events WHERE day=? AND type='cart'", today).c;
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const d = dayKey(t - i * 86400e3); const start = Date.parse(d + 'T00:00:00+03:00');
    series.push({ day: d,
      visitors: q("SELECT COUNT(DISTINCT vid) c FROM events WHERE day=? AND type='visit'", d).c,
      orders: q('SELECT COUNT(*) c FROM orders WHERE created_at>=? AND created_at<? AND status != ?', start, start + 86400e3, 'cancelled').c });
  }
  const products = db.prepare(`SELECT p.id, p.name, p.stock, p.active,
      (SELECT COUNT(DISTINCT vid) FROM events e WHERE e.product_id=p.id AND e.type='view') views,
      (SELECT COUNT(*) FROM events e WHERE e.product_id=p.id AND e.type='cart') carts,
      (SELECT COUNT(*) FROM events e WHERE e.product_id=p.id AND e.type='cart' AND e.day=?) carts_today,
      (SELECT COUNT(DISTINCT vid) FROM events e WHERE e.product_id=p.id AND e.type='view' AND e.day=?) views_today,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=p.id AND o.status IN ${COUNTED}),0) sold
    FROM products p ORDER BY sold DESC, views DESC`).all(today, today);
  const m = monthKey(t); const prev = monthKey(Date.parse(m + '-01T00:00:00+03:00') - 86400e3);
  return {
    today: { visitors, orders: ordersToday.c, sales: ordersToday.s, carts: cartsToday }, series, products,
    low_stock: products.filter((p) => p.active && p.stock <= 3).map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    counts: poll(), month: report(m), prev_month: report(prev),
    subscribers: q('SELECT COUNT(*) c FROM subscribers').c,
  };
}
function poll() {
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  return { latest_order_id: q('SELECT COALESCE(MAX(id),0) m FROM orders').m, new_orders: q("SELECT COUNT(*) c FROM orders WHERE status='new'").c,
    receipts_waiting: q("SELECT COUNT(*) c FROM orders WHERE status='new' AND receipt_file != ''").c,
    pending_reviews: q('SELECT COUNT(*) c FROM reviews WHERE approved=0').c, sold_out: q('SELECT COUNT(*) c FROM products WHERE active=1 AND stock<=0').c };
}

function productInput(b) {
  const name = clip(b.name, 120); if (!name) throw new HttpError(400, 'اكتب اسم السبحة');
  const price = num(b.price, NaN); if (!(price >= 0)) throw new HttpError(400, 'السعر غير صحيح');
  const cost = num(b.cost, 0); if (!(cost >= 0)) throw new HttpError(400, 'سعر التكلفة غير صحيح');
  const stock = Math.trunc(num(b.stock, 0)); if (stock < 0) throw new HttpError(400, 'الكمية غير صحيحة');
  let cat = b.category_id == null || b.category_id === '' ? null : Math.trunc(num(b.category_id));
  if (cat != null && !db.prepare('SELECT 1 FROM categories WHERE id=?').get(cat)) cat = null;
  const images = (Array.isArray(b.images) ? b.images : []).filter((x) => typeof x === 'string' && /^\/uploads\/[\w.\-]+$/.test(x)).slice(0, 8);
  return { name, price, cost, stock, cat, desc: clip(b.description, 2000), specs: clip(b.specs, 2000), images: JSON.stringify(images), active: b.active === false || b.active === 0 ? 0 : 1 };
}
function imgPath(v) { v = clip(v, 200); return /^\/uploads\/[\w.\-]+$/.test(v) ? v : ''; }

// ---------- المسارات ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

// -- عامة --
route('GET', '/api/store', () => ({ body: storePayload() }));
route('GET', '/api/products/:id', ({ req, params }) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(params.id);
  if (!p) throw new HttpError(404, 'السبحة غير موجودة');
  const reviews = db.prepare('SELECT name,rating,text,created_at FROM reviews WHERE product_id=? AND approved=1 ORDER BY id DESC LIMIT 50').all(p.id);
  const st = productStats(); const prod = publicProduct(p, st);
  if (isAdmin(req)) { prod.views = st.views[p.id] || 0; prod.sold = st.sold[p.id] || 0; }
  return { body: { product: prod, reviews } };
});
route('POST', '/api/track', async ({ req }) => {
  limit(req, 'track', 600, 3600e3);
  const b = await readJson(req); const vid = clip(b.vid, 40).replace(/[^\w\-]/g, ''); if (!vid) return { body: { ok: true } };
  const type = ['visit', 'view', 'cart'].includes(b.type) ? b.type : null; if (!type) return { body: { ok: true } };
  const pid = type === 'visit' ? null : Math.trunc(num(b.product_id)) || null; const t = now(); const day = dayKey(t);
  if (type !== 'cart') {
    const dup = pid == null ? db.prepare("SELECT 1 FROM events WHERE day=? AND type='visit' AND vid=?").get(day, vid)
      : db.prepare('SELECT 1 FROM events WHERE day=? AND type=? AND vid=? AND product_id=?').get(day, type, vid, pid);
    if (dup) return { body: { ok: true } };
  }
  db.prepare('INSERT INTO events(ts,day,type,vid,product_id) VALUES (?,?,?,?,?)').run(t, day, type, vid, pid);
  if (type === 'view') statCache.t = 0;
  return { body: { ok: true } };
});
route('POST', '/api/subscribe', async ({ req }) => {
  limit(req, 'sub', 20, 3600e3);
  const b = await readJson(req); const email = clip(b.email, 120).toLowerCase();
  if (ADMIN_EMAIL && email === ADMIN_EMAIL) return { body: { admin: true } };
  if (!validEmail(email)) throw new HttpError(400, 'اكتب بريدًا إلكترونيًا صحيحًا');
  db.prepare('INSERT OR IGNORE INTO subscribers(email,created_at) VALUES (?,?)').run(email, now());
  return { body: { ok: true } };
});
route('POST', '/api/reviews', async ({ req }) => {
  limit(req, 'review', 10, 3600e3);
  const b = await readJson(req); const pid = Math.trunc(num(b.product_id)); const rating = Math.trunc(num(b.rating));
  const name = clip(b.name, 40); const text = clip(b.text, 600);
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(pid)) throw new HttpError(404, 'السبحة غير موجودة');
  if (name.length < 2) throw new HttpError(400, 'اكتب اسمك');
  if (rating < 1 || rating > 5) throw new HttpError(400, 'اختر عدد النجوم');
  db.prepare('INSERT INTO reviews(product_id,name,rating,text,approved,created_at) VALUES (?,?,?,?,0,?)').run(pid, name, rating, text, now());
  return { body: { ok: true } };
});
route('POST', '/api/orders', async ({ req }) => {
  limit(req, 'order', 12, 3600e3);
  const body = await readJson(req);
  let cust = currentCustomer(req); let headers;
  if (!cust) {
    limit(req, 'ordauth', 15, 600e3);
    const c = body.customer || {};
    cust = authCustomer(clip(c.email, 120).toLowerCase(), c.password, 'auto');
    headers = { 'Set-Cookie': makeCustCookie(req, cust.id) };
  }
  const o = createOrder(body, cust.id, cust.email);
  notify(`🔔 طلب جديد ${o.code}\nالاسم: ${o.name} (${o.city})\nالمنتجات: ${o.lines.map((l) => l.p.name + ' × ' + l.qty).join('، ')}\n${o.cod ? '💵 الدفع عند الاستلام (+' + o.cod_fee + ' ر.س)\n' : ''}${o.gift ? '🎁 طلب هدية\n' : ''}${o.discount ? 'كود الخصم: ' + o.coupon + ' (−' + o.discount + ' ر.س)\n' : ''}الإجمالي: ${o.total} ر.س`);
  return { status: 201, headers, body: { code: o.code, token: o.token, subtotal: o.subtotal, discount: o.discount, shipping_fee: o.shipping_fee, cod: o.cod, cod_fee: o.cod_fee, total: o.total, customer: { email: cust.email } } };
});
route('GET', '/api/account/me', ({ req }) => { const c = currentCustomer(req); return { body: { customer: c ? { email: c.email, unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE customer_id=? AND read=0').get(c.id).c } : null } }; });
route('POST', '/api/coupons/check', async ({ req }) => {
  limit(req, 'coupon', 30, 600e3);
  const b = await readJson(req); const s = getSettings();
  const merged = new Map();
  for (const it of Array.isArray(b.items) ? b.items.slice(0, 30) : []) { const id = Math.trunc(num(it.id)), q = Math.trunc(num(it.qty)); if (id > 0 && q > 0) merged.set(id, Math.min(20, (merged.get(id) || 0) + q)); }
  let subtotal = 0;
  for (const [id, qty] of merged) { const p = db.prepare('SELECT price FROM products WHERE id=? AND active=1').get(id); if (p) subtotal += p.price * qty; }
  if (!subtotal) throw new HttpError(400, 'السلة فارغة');
  const email = clip(b.email, 120).toLowerCase();
  const cp = applyCoupon(b.code, subtotal, validEmail(email) ? email : '');
  if (!cp.code) throw new HttpError(400, 'اكتب كود الخصم');
  const shipType = b.shipping === 'fast' ? 'fast' : 'slow';
  const fee = shippingFor(subtotal - cp.discount, shipType, s);
  return { body: { ok: true, code: cp.code, discount: cp.discount, shipping_fee: fee, total: subtotal - cp.discount + fee } };
});
route('POST', '/api/account/auth', async ({ req }) => {
  limit(req, 'acct', 15, 600e3);
  const b = await readJson(req); const email = clip(b.email, 120).toLowerCase();
  if (ADMIN_EMAIL && ADMIN_PASSWORD && email === ADMIN_EMAIL) {
    if (!safeEq(String(b.password || ''), ADMIN_PASSWORD)) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
    return { body: { admin: true }, headers: { 'Set-Cookie': `bs_admin=${makeSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${14 * 86400}${isHttps(req) ? '; Secure' : ''}` } };
  }
  const cust = authCustomer(email, b.password, b.mode === 'register' ? 'register' : 'login');
  return { body: { ok: true, customer: { email: cust.email } }, headers: { 'Set-Cookie': makeCustCookie(req, cust.id) } };
});
route('POST', '/api/account/logout', ({ req }) => ({ body: { ok: true }, headers: { 'Set-Cookie': clearCustCookie(req) } }));
function requireCustomer(req) { const c = currentCustomer(req); if (!c) throw new HttpError(401, 'سجّل دخولك أولًا'); return c; }
function myOrder(cust, code) {
  const o = db.prepare('SELECT * FROM orders WHERE code=? AND customer_id=?').get(code, cust.id);
  if (!o) throw new HttpError(404, 'الطلب غير موجود'); return o;
}
route('GET', '/api/account/orders', ({ req }) => {
  const cust = requireCustomer(req);
  const rows = db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 100').all(cust.id).map((o) => ({
    code: o.code, token: o.token, status: o.status, subtotal: o.subtotal, discount: o.discount || 0, shipping_fee: o.shipping_fee, total: o.total, created_at: o.created_at,
    has_receipt: !!o.receipt_file, cancel_request: o.cancel_request, items: orderLines(o.id), returns: returnsOf(o.id) }));
  const notes = db.prepare('SELECT id, order_code, text, read, created_at FROM notifications WHERE customer_id=? ORDER BY id DESC LIMIT 20').all(cust.id);
  db.prepare('UPDATE notifications SET read=1 WHERE customer_id=? AND read=0').run(cust.id);
  return { body: { orders: rows, notes } };
});
route('POST', '/api/account/orders/:code/cancel', async ({ req, params }) => {
  limit(req, 'ocancel', 20, 3600e3);
  const cust = requireCustomer(req); const o = myOrder(cust, params.code); const b = await readJson(req);
  const reason = clip(b.reason, 300);
  if (o.status === 'cancelled') throw new HttpError(409, 'الطلب ملغي مسبقًا');
  if (o.status !== 'new' && o.status !== 'accepted') throw new HttpError(409, 'لا يمكن إلغاء الطلب بعد الشحن، يمكنك طلب استرجاع بعد التسليم');
  if (o.status === 'new' && !o.receipt_file) {
    tx(() => { releaseStock(o.id); db.prepare("UPDATE orders SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?").run(reason, now(), o.id); });
    statCache.t = 0;
    notify(`❌ العميل ألغى الطلب ${o.code} (قبل الدفع)${reason ? '\nالسبب: ' + reason : ''}`);
    return { body: { ok: true, cancelled: true } };
  }
  if (o.cancel_request === 'pending') throw new HttpError(409, 'طلب الإلغاء قيد المراجعة');
  const iban = cleanIban(b.iban), holder = cleanHolder(b.holder);
  db.prepare("UPDATE orders SET cancel_request='pending', cancel_reason=?, refund_iban=?, refund_holder=?, updated_at=? WHERE id=?").run(reason, iban, holder, now(), o.id);
  notify(`⚠️ طلب إلغاء للطلب ${o.code} (بعد الدفع)\nالاسم: ${o.name}\nالمبلغ: ${o.total} ر.س${reason ? '\nالسبب: ' + reason : ''}`);
  return { body: { ok: true, cancelled: false } };
});
route('POST', '/api/account/orders/:code/return', async ({ req, params }) => {
  limit(req, 'oreturn', 20, 3600e3);
  const cust = requireCustomer(req); const o = myOrder(cust, params.code); const b = await readJson(req);
  if (o.status !== 'delivered') throw new HttpError(409, 'يمكن طلب الاسترجاع بعد تسليم الطلب فقط');
  if (b.ack !== true) throw new HttpError(400, 'يجب الموافقة على شروط الاسترجاع');
  const reason = clip(b.reason, 300); if (reason.length < 3) throw new HttpError(400, 'اكتب سبب الاسترجاع');
  const item = db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').get(Math.trunc(num(b.item_id)), o.id);
  if (!item) throw new HttpError(404, 'السبحة غير موجودة في الطلب');
  if (db.prepare("SELECT 1 FROM return_requests WHERE item_id=? AND status != 'rejected'").get(item.id)) throw new HttpError(409, 'تم تقديم طلب استرجاع لهذه السبحة مسبقًا');
  const iban = cleanIban(b.iban), holder = cleanHolder(b.holder);
  const t = now();
  db.prepare('INSERT INTO return_requests(order_id,item_id,reason,status,iban,holder,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(o.id, item.id, reason, 'pending', iban, holder, t, t);
  notify(`↩️ طلب استرجاع للطلب ${o.code}\nالسبحة: ${item.name} × ${item.qty}\nالاسم: ${o.name}\nالسبب: ${reason}`);
  return { status: 201, body: { ok: true } };
});
function ownOrder(code, token) {
  const o = db.prepare('SELECT * FROM orders WHERE code=?').get(code);
  if (!o || !token || !safeEq(o.token, token)) throw new HttpError(404, 'الطلب غير موجود');
  return o;
}
route('GET', '/api/orders/:code', ({ params, url }) => ({ body: { order: orderPublic(ownOrder(params.code, url.searchParams.get('token'))) } }));
route('POST', '/api/orders/:code/method', async ({ req, params, url }) => {
  limit(req, 'method', 30, 3600e3);
  const o = ownOrder(params.code, url.searchParams.get('token')); const b = await readJson(req);
  const m = b.method === 'whatsapp' ? 'whatsapp' : 'transfer';
  if (!o.pay_method) db.prepare('UPDATE orders SET pay_method=?, updated_at=? WHERE id=?').run(m, now(), o.id);
  return { body: { ok: true } };
});
route('POST', '/api/orders/:code/receipt', async ({ req, params, url }) => {
  limit(req, 'receipt', 10, 3600e3);
  const o = ownOrder(params.code, url.searchParams.get('token'));
  if (o.status === 'cancelled') throw new HttpError(409, 'هذا الطلب ملغي');
  const buf = await readBody(req, 8 * 1024 * 1024); const kind = sniff(buf);
  if (!kind) throw new HttpError(400, 'ارفع صورة أو ملف PDF');
  const file = `${o.code}-${crypto.randomBytes(6).toString('hex')}.${kind.ext}`;
  fs.writeFileSync(path.join(RECEIPT_DIR, file), buf);
  if (o.receipt_file) fs.rm(path.join(RECEIPT_DIR, path.basename(o.receipt_file)), () => {});
  db.prepare("UPDATE orders SET receipt_file=?, receipt_at=?, pay_method='transfer', updated_at=? WHERE id=?").run(file, now(), now(), o.id);
  tx(() => takeStock(o.id)); statCache.t = 0;
  notify(`🧾 وصل إيصال تحويل للطلب ${o.code}\nالمبلغ: ${o.total} ر.س\nالاسم: ${o.name}`);
  return { body: { ok: true } };
});

// -- المدير --
route('POST', '/api/admin/login', async ({ req, res }) => {
  limit(req, 'login', 8, 600e3);
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new HttpError(503, 'لم يتم ضبط حساب المدير في السيرفر');
  const b = await readJson(req);
  const okEmail = safeEq(clip(b.email, 120).toLowerCase(), ADMIN_EMAIL), okPass = safeEq(String(b.password || ''), ADMIN_PASSWORD);
  if (!(okEmail && okPass)) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
  const cookie = `bs_admin=${makeSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${14 * 86400}${isHttps(req) ? '; Secure' : ''}`;
  return { body: { ok: true }, headers: { 'Set-Cookie': cookie } };
});
route('POST', '/api/admin/logout', ({ req }) => ({ body: { ok: true }, headers: { 'Set-Cookie': `bs_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}` } }));
route('GET', '/api/admin/me', ({ req }) => ({ body: { admin: isAdmin(req), telegram: !!(TG_TOKEN && TG_CHAT) } }));
const admin = (fn) => (ctx) => { requireAdmin(ctx.req); return fn(ctx); };

route('GET', '/api/admin/coupons', admin(() => ({ body: { coupons: db.prepare('SELECT * FROM coupons ORDER BY id DESC').all().map((c) => ({ ...c, uses: couponUses(c.code) })) } })));
route('POST', '/api/admin/coupons', admin(async ({ req }) => {
  const b = await readJson(req);
  const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_\-\u0600-\u06FF]{3,20}$/.test(code)) throw new HttpError(400, 'الكود من 3 إلى 20 حرفًا أو رقمًا بدون مسافات');
  const type = b.type === 'fixed' ? 'fixed' : 'percent'; const value = num(b.value);
  if (!(value > 0)) throw new HttpError(400, 'اكتب قيمة الخصم');
  if (type === 'percent' && value > 100) throw new HttpError(400, 'النسبة لا تزيد عن 100');
  const min = Math.max(0, num(b.min_order)); const max = Math.max(0, Math.trunc(num(b.max_uses)));
  let exp = null; if (b.expires) { exp = Date.parse(String(b.expires).slice(0, 10) + 'T23:59:59+03:00'); if (!Number.isFinite(exp)) throw new HttpError(400, 'تاريخ غير صحيح'); }
  if (db.prepare('SELECT 1 FROM coupons WHERE code=?').get(code)) throw new HttpError(409, 'هذا الكود موجود مسبقًا');
  db.prepare('INSERT INTO coupons(code,type,value,min_order,max_uses,expires_at,active,created_at) VALUES (?,?,?,?,?,?,1,?)').run(code, type, value, min, max, exp, now());
  return { status: 201, body: { ok: true } };
}));
route('PUT', '/api/admin/coupons/:id', admin(async ({ req, params }) => {
  const b = await readJson(req);
  if (b.featured !== undefined) { if (b.featured) db.prepare('UPDATE coupons SET featured=0').run(); const f = db.prepare('UPDATE coupons SET featured=? WHERE id=?').run(b.featured ? 1 : 0, params.id); if (!f.changes) throw new HttpError(404, 'غير موجود'); return { body: { ok: true } }; }
  const r = db.prepare('UPDATE coupons SET active=? WHERE id=?').run(b.active ? 1 : 0, params.id);
  if (!r.changes) throw new HttpError(404, 'غير موجود'); return { body: { ok: true } };
}));
route('DELETE', '/api/admin/coupons/:id', admin(({ params }) => { db.prepare('DELETE FROM coupons WHERE id=?').run(params.id); return { body: { ok: true } }; }));
const RESET_SCOPES = {
  stats: 'الإحصائيات', profits: 'الطلبات والأرباح والمصروفات', customers: 'حسابات العملاء', subscribers: 'المشتركين', reviews: 'التقييمات',
};
route('GET', '/api/admin/export', admin(({ url }) => {
  const sc = url.searchParams.get('scope') || 'all';
  const all = sc === 'all'; const has = (k) => all || sc === k;
  const out = { app: 'sobah99', exported_at: new Date().toISOString(), scope: sc };
  if (has('profits')) {
    out.orders = db.prepare('SELECT * FROM orders ORDER BY id').all().map((o) => ({ ...o, token: undefined, items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id), returns: db.prepare('SELECT * FROM return_requests WHERE order_id=?').all(o.id) }));
    out.expenses = db.prepare('SELECT * FROM expenses ORDER BY id').all();
  }
  if (has('customers')) out.customers = db.prepare('SELECT id,email,created_at FROM customers ORDER BY id').all();
  if (has('subscribers')) out.subscribers = db.prepare('SELECT * FROM subscribers ORDER BY id').all();
  if (has('reviews')) out.reviews = db.prepare('SELECT * FROM reviews ORDER BY id').all();
  if (has('stats')) out.events_count = db.prepare('SELECT COUNT(*) c FROM events').get().c;
  if (all) out.products = db.prepare('SELECT id,name,price,cost,stock,active FROM products ORDER BY id').all();
  return { body: out, headers: { 'Content-Disposition': `attachment; filename="sobah99-${sc}.json"` } };
}));
route('POST', '/api/admin/reset', admin(async ({ req }) => {
  const b = await readJson(req); const sc = String(b.scope || '');
  if (sc !== 'all' && !RESET_SCOPES[sc]) throw new HttpError(400, 'نوع غير معروف');
  const has = (k) => sc === 'all' || sc === k;
  tx(() => {
    if (has('profits')) { for (const t of ['return_requests', 'notifications', 'order_items', 'orders', 'expenses']) db.prepare(`DELETE FROM ${t}`).run(); }
    if (has('customers')) { db.prepare('DELETE FROM notifications').run(); db.prepare('UPDATE orders SET customer_id=NULL').run(); db.prepare('DELETE FROM customers').run(); }
    if (has('subscribers')) db.prepare('DELETE FROM subscribers').run();
    if (has('reviews')) db.prepare('DELETE FROM reviews').run();
    if (has('stats')) db.prepare('DELETE FROM events').run();
  });
  if (has('profits')) { try { for (const f of fs.readdirSync(RECEIPT_DIR)) fs.rm(path.join(RECEIPT_DIR, f), () => {}); } catch { /* */ } }
  statCache.t = 0; return { body: { ok: true } };
}));
route('POST', '/api/admin/reset-stats', admin(() => { db.prepare('DELETE FROM events').run(); statCache.t = 0; return { body: { ok: true } }; }));
route('GET', '/api/admin/dashboard', admin(() => ({ body: dashboard() })));
route('GET', '/api/admin/poll', admin(() => ({ body: poll() })));

route('GET', '/api/admin/orders', admin(({ url }) => {
  const st = url.searchParams.get('status'); const q = clip(url.searchParams.get('q') || '', 40);
  let sql = 'SELECT * FROM orders WHERE 1=1'; const a = [];
  if (st && st !== 'all') { sql += ' AND status=?'; a.push(st); }
  if (q) { sql += ' AND (code LIKE ? OR name LIKE ? OR phone LIKE ?)'; a.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY id DESC LIMIT 300';
  const rows = db.prepare(sql).all(...a).map((o) => ({ ...o, token: undefined, items: orderLines(o.id), has_receipt: !!o.receipt_file, returns: returnsOf(o.id, true) }));
  return { body: { orders: rows } };
}));
route('PUT', '/api/admin/orders/:id', admin(async ({ req, params }) => {
  const b = await readJson(req);
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(params.id); if (!o) throw new HttpError(404, 'الطلب غير موجود');
    let status = o.status;
    if (b.status != null) {
      if (!['new', 'accepted', 'shipped', 'delivered', 'cancelled'].includes(b.status)) throw new HttpError(400, 'حالة غير صحيحة');
      status = b.status;
      if (status !== o.status && STATUS_NOTE[status]) notifyCustomer(o.id, STATUS_NOTE[status] + ' (' + o.code + ')');
      if (status === 'cancelled') { releaseStock(o.id); if (o.cancel_request === 'pending') db.prepare("UPDATE orders SET cancel_request='approved' WHERE id=?").run(o.id); }
      else if (status !== 'new') takeStock(o.id);
    }
    const sc = b.shipping_cost === '' || b.shipping_cost === null ? null : (b.shipping_cost === undefined ? o.shipping_cost : Math.max(0, num(b.shipping_cost)));
    db.prepare('UPDATE orders SET status=?, shipping_cost=?, admin_note=?, updated_at=? WHERE id=?').run(status, sc, b.admin_note === undefined ? db.prepare('SELECT admin_note FROM orders WHERE id=?').get(o.id).admin_note : clip(b.admin_note, 500), now(), o.id);
  });
  statCache.t = 0; return { body: { ok: true } };
}));
route('POST', '/api/admin/orders/:id/cancel-decision', admin(async ({ req, params }) => {
  const b = await readJson(req);
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(params.id); if (!o) throw new HttpError(404, 'الطلب غير موجود');
    if (o.cancel_request !== 'pending') throw new HttpError(409, 'لا يوجد طلب إلغاء معلّق');
    notifyCustomer(o.id, (b.approve ? 'تمت الموافقة على إلغاء طلبك' : 'نعتذر، تم رفض طلب الإلغاء وسيتم متابعة طلبك') + ' (' + o.code + ')');
    if (b.approve) { releaseStock(o.id); db.prepare("UPDATE orders SET status='cancelled', cancel_request='approved', updated_at=? WHERE id=?").run(now(), o.id); }
    else db.prepare("UPDATE orders SET cancel_request='rejected', updated_at=? WHERE id=?").run(now(), o.id);
  });
  statCache.t = 0; return { body: { ok: true } };
}));
route('PUT', '/api/admin/returns/:id', admin(async ({ req, params }) => {
  const b = await readJson(req);
  if (!['approved', 'rejected', 'received', 'refunded'].includes(b.status)) throw new HttpError(400, 'حالة غير صحيحة');
  const r = db.prepare('UPDATE return_requests SET status=?, updated_at=? WHERE id=?').run(b.status, now(), params.id);
  if (!r.changes) throw new HttpError(404, 'الطلب غير موجود');
  const rr = db.prepare('SELECT order_id FROM return_requests WHERE id=?').get(params.id);
  if (rr && RETURN_NOTE[b.status]) notifyCustomer(rr.order_id, RETURN_NOTE[b.status]);
  return { body: { ok: true } };
}));
route('GET', '/api/admin/receipt/:code', admin(({ req, res, params }) => {
  const o = db.prepare('SELECT receipt_file FROM orders WHERE code=?').get(params.code);
  if (!o || !o.receipt_file) throw new HttpError(404, 'لا يوجد إيصال');
  serveFile(req, res, path.join(RECEIPT_DIR, path.basename(o.receipt_file)), 'private, max-age=60'); return { handled: true };
}));

route('GET', '/api/admin/products', admin(() => ({ body: { products: db.prepare('SELECT * FROM products ORDER BY id DESC').all().map((p) => ({ ...p, images: JSON.parse(p.images || '[]') })) } })));
route('POST', '/api/admin/products', admin(async ({ req }) => {
  const i = productInput(await readJson(req));
  const r = db.prepare('INSERT INTO products(name,price,cost,stock,category_id,description,specs,images,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(i.name, i.price, i.cost, i.stock, i.cat, i.desc, i.specs, i.images, i.active, now());
  statCache.t = 0; return { status: 201, body: { id: Number(r.lastInsertRowid) } };
}));
route('PUT', '/api/admin/products/:id', admin(async ({ req, params }) => {
  const i = productInput(await readJson(req));
  const r = db.prepare('UPDATE products SET name=?,price=?,cost=?,stock=?,category_id=?,description=?,specs=?,images=?,active=? WHERE id=?').run(i.name, i.price, i.cost, i.stock, i.cat, i.desc, i.specs, i.images, i.active, params.id);
  if (!r.changes) throw new HttpError(404, 'السبحة غير موجودة'); statCache.t = 0; return { body: { ok: true } };
}));
route('POST', '/api/admin/products/bulk-price', admin(async ({ req }) => {
  const b = await readJson(req); const price = Math.round(Number(b.price) * 100) / 100;
  if (!Number.isFinite(price) || price <= 0 || price > 100000) throw new HttpError(400, 'اكتب سعر صحيح');
  const r = db.prepare('UPDATE products SET price=?').run(price);
  statCache.t = 0; return { body: { ok: true, changed: r.changes, price } };
}));
route('DELETE', '/api/admin/products/:id', admin(({ params }) => {
  db.prepare('DELETE FROM products WHERE id=?').run(params.id); db.prepare('UPDATE banners SET product_id=NULL WHERE product_id=?').run(params.id); statCache.t = 0; return { body: { ok: true } };
}));

route('GET', '/api/admin/categories', admin(() => ({ body: { categories: db.prepare('SELECT id,name,sort FROM categories ORDER BY sort,id').all() } })));
route('POST', '/api/admin/categories', admin(async ({ req }) => {
  const b = await readJson(req); const n = clip(b.name, 40); if (!n) throw new HttpError(400, 'اكتب اسم القسم');
  const r = db.prepare('INSERT INTO categories(name,sort) VALUES (?,?)').run(n, Math.trunc(num(b.sort, 99))); return { status: 201, body: { id: Number(r.lastInsertRowid) } };
}));
route('PUT', '/api/admin/categories/:id', admin(async ({ req, params }) => {
  const b = await readJson(req); const n = clip(b.name, 40); if (!n) throw new HttpError(400, 'اكتب اسم القسم');
  db.prepare('UPDATE categories SET name=?, sort=? WHERE id=?').run(n, Math.trunc(num(b.sort, 99)), params.id); return { body: { ok: true } };
}));
route('DELETE', '/api/admin/categories/:id', admin(({ params }) => {
  db.prepare('UPDATE products SET category_id=NULL WHERE category_id=?').run(params.id); db.prepare('DELETE FROM categories WHERE id=?').run(params.id); return { body: { ok: true } };
}));

route('GET', '/api/admin/banners', admin(() => ({ body: { banners: db.prepare('SELECT * FROM banners ORDER BY sort,id').all() } })));
route('POST', '/api/admin/banners', admin(async ({ req }) => {
  const b = await readJson(req); const img = imgPath(b.image); if (!img) throw new HttpError(400, 'ارفع صورة العرض');
  const r = db.prepare('INSERT INTO banners(image,title,product_id,sort,active) VALUES (?,?,?,?,?)').run(img, clip(b.title, 80), Math.trunc(num(b.product_id)) || null, Math.trunc(num(b.sort, 99)), b.active === false ? 0 : 1);
  return { status: 201, body: { id: Number(r.lastInsertRowid) } };
}));
route('PUT', '/api/admin/banners/:id', admin(async ({ req, params }) => {
  const b = await readJson(req); const img = imgPath(b.image); if (!img) throw new HttpError(400, 'ارفع صورة العرض');
  db.prepare('UPDATE banners SET image=?,title=?,product_id=?,sort=?,active=? WHERE id=?').run(img, clip(b.title, 80), Math.trunc(num(b.product_id)) || null, Math.trunc(num(b.sort, 99)), b.active === false ? 0 : 1, params.id);
  return { body: { ok: true } };
}));
route('DELETE', '/api/admin/banners/:id', admin(({ params }) => { db.prepare('DELETE FROM banners WHERE id=?').run(params.id); return { body: { ok: true } }; }));

route('GET', '/api/admin/reviews', admin(() => ({ body: { reviews: db.prepare('SELECT r.*, p.name product FROM reviews r LEFT JOIN products p ON p.id=r.product_id ORDER BY r.approved, r.id DESC LIMIT 300').all() } })));
route('PUT', '/api/admin/reviews/:id', admin(async ({ req, params }) => {
  const b = await readJson(req); db.prepare('UPDATE reviews SET approved=? WHERE id=?').run(b.approved ? 1 : 0, params.id); statCache.t = 0; return { body: { ok: true } };
}));
route('DELETE', '/api/admin/reviews/:id', admin(({ params }) => { db.prepare('DELETE FROM reviews WHERE id=?').run(params.id); statCache.t = 0; return { body: { ok: true } }; }));

route('GET', '/api/admin/subscribers', admin(() => ({ body: { subscribers: db.prepare('SELECT email,created_at FROM subscribers ORDER BY id DESC LIMIT 2000').all() } })));
route('GET', '/api/admin/subscribers.csv', admin(({ res }) => {
  const rows = db.prepare('SELECT email,created_at FROM subscribers ORDER BY id').all();
  const csv = '﻿email,date\n' + rows.map((r) => `${r.email},${dayKey(r.created_at)}`).join('\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="subscribers.csv"' }); res.end(csv); return { handled: true };
}));

route('GET', '/api/admin/report', admin(({ url }) => {
  const m = url.searchParams.get('month') || monthKey(now()); if (!/^\d{4}-\d{2}$/.test(m)) throw new HttpError(400, 'شهر غير صحيح');
  return { body: report(m) };
}));
route('POST', '/api/admin/expenses', admin(async ({ req }) => {
  const b = await readJson(req); const month = String(b.month || ''); if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'شهر غير صحيح');
  const kind = b.kind === 'adjust' ? 'adjust' : 'expense'; const label = clip(b.label, 80); const amount = num(b.amount, NaN);
  if (!label || !Number.isFinite(amount) || (kind === 'expense' && amount < 0)) throw new HttpError(400, 'اكتب الوصف والمبلغ');
  db.prepare('INSERT INTO expenses(month,kind,label,amount,created_at) VALUES (?,?,?,?,?)').run(month, kind, label, amount, now()); return { status: 201, body: { ok: true } };
}));
route('DELETE', '/api/admin/expenses/:id', admin(({ params }) => { db.prepare('DELETE FROM expenses WHERE id=?').run(params.id); return { body: { ok: true } }; }));

route('GET', '/api/admin/settings', admin(() => { const s = getSettings(); const o = {}; for (const k of PUBLIC_SETTINGS) o[k] = s[k]; return { body: { settings: o } }; }));
route('PUT', '/api/admin/settings', admin(async ({ req }) => {
  const b = await readJson(req); const up = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of PUBLIC_SETTINGS) {
    if (b[k] === undefined) continue; let v = clip(b[k], k === 'return_policy' ? 1500 : 300);
    if (['free_min', 'fast_price', 'slow_price'].includes(k)) v = String(Math.max(0, num(v)));
    if (k === 'free_applies_fast') v = b[k] ? '1' : '0';
    if (k === 'whatsapp') v = toLatinDigits(v).replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '966$1');
    if (k === 'iban') v = v.replace(/\s/g, '').toUpperCase();
    if (k === 'welcome_video') { v = v.trim(); if (v && !/^\/media\/[A-Za-z0-9_.-]+\.mp4$/.test(v)) throw new HttpError(400, 'مسار فيديو الترحيب غير صحيح'); }
    if (k === 'transfer_mobile') { v = toLatinDigits(v).replace(/[\s-]/g, '').replace(/^\+?966/, '0'); if (v && !/^05\d{8}$/.test(v)) throw new HttpError(400, 'رقم الجوال للتحويل غير صحيح (مثال: 0501234567)'); }
    if (k === 'cod_enabled') v = b[k] ? '1' : '0';
    if (k === 'cod_fee') { v = String(Math.max(0, num(v))); }
    if (k === 'tiktok') { v = v.trim(); if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v; if (v && !/^https:\/\/(www\.|vm\.|m\.)?tiktok\.com\//i.test(v.replace(/^http:/i, 'https:'))) throw new HttpError(400, 'رابط تيك توك غير صحيح'); v = v.replace(/^http:/i, 'https:'); }
    if (k === 'instagram') { v = v.trim(); if (v && /^@?[A-Za-z0-9._]{1,30}$/.test(v)) v = 'https://www.instagram.com/' + v.replace(/^@/, ''); if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v; v = v.replace(/^http:/i, 'https:'); if (v && !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+\/?(\?.*)?$/i.test(v)) throw new HttpError(400, 'رابط انستقرام غير صحيح'); if (v) v = v.replace(/\?.*$/, ''); }
    if (k === 'return_fee') { v = toLatinDigits(v).replace(/[^\d.]/g, ''); if (v && !(Number(v) >= 0)) v = ''; }
    if (k === 'qr_image' && v) v = imgPath(v) || '';
    up.run(k, v);
  }
  return { body: { ok: true } };
}));
function tgGetMe() {
  return new Promise((resolve) => {
    try {
      const r = https.request({ hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/getMe`, method: 'GET' }, (x) => {
        let d = ''; x.on('data', (c) => { d += c; if (d.length > 4000) d = d.slice(0, 4000); });
        x.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch { /* */ } resolve(j.ok ? { ok: true, username: j.result.username } : { ok: false, error: j.description || ('HTTP ' + x.statusCode) }); });
      });
      r.on('error', () => resolve({ ok: false, error: 'تعذّر الاتصال بتيليجرام' })); r.setTimeout(8000, () => r.destroy()); r.end();
    } catch { resolve({ ok: false, error: 'التوكن يحتوي رموزًا غير صالحة' }); }
  });
}
route('POST', '/api/admin/test-notify', admin(async () => {
  const configured = !!(TG_TOKEN && TG_CHAT);
  if (!configured) return { body: { ok: false, configured, error: '', detail: 'التوكن أو رقم الحساب غير مضبوط في Render (TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID).' } };
  const me = await tgGetMe();
  if (!me.ok) return { body: { ok: false, configured, error: me.error, detail: 'التوكن غير صحيح أو فيه رموز زايدة. انسخه من BotFather من جديد والصقه في Render بدون مسافات.' } };
  const r = await notify('✅ تجربة تنبيهات متجر ٩٩ للسبح');
  let detail = '';
  if (!r.ok) {
    if (/chat not found/i.test(r.error || '')) detail = `رقم الحساب غير صحيح، أو ما ضغطت Start على البوت @${me.username}. افتح هذا البوت بالذات واضغط Start، وتأكد أن TELEGRAM_CHAT_ID هو رقمك من @userinfobot (أرقام فقط).`;
    else if (/blocked|forbidden/i.test(r.error || '')) detail = `البوت @${me.username} محظور أو ما بدأت محادثته. افتحه واضغط Start.`;
  }
  return { body: { ok: r.ok, configured, error: r.error || '', bot: me.username, detail } };
}));
route('POST', '/api/admin/upload', admin(async ({ req }) => {
  const buf = await readBody(req, 8 * 1024 * 1024); const kind = sniff(buf);
  if (!kind || kind.ext === 'pdf') throw new HttpError(400, 'ارفع صورة (JPG أو PNG أو WEBP)');
  const file = crypto.randomBytes(10).toString('hex') + '.' + kind.ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf); return { status: 201, body: { url: '/uploads/' + file } };
}));

// ---------- صفحة السبحة للمشاركة (معاينة واتساب وغيره) ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sharePage(req, res, id) {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
  const base = origin(req);
  if (!p) { res.writeHead(302, { Location: '/' }); return res.end(); }
  let img = ''; try { img = (JSON.parse(p.images) || [])[0] || ''; } catch { /* */ }
  const s = getSettings(); const desc = p.description ? p.description.slice(0, 140) : `${p.price} ر.س · ${s.store_name}`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.name)} | ${esc(s.store_name)}</title><meta property="og:type" content="product"><meta property="og:title" content="${esc(p.name)} | ${esc(s.store_name)}">
<meta property="og:description" content="${esc(desc)}">${img ? `<meta property="og:image" content="${esc(base + img)}">` : `<meta property="og:image" content="${esc(base)}/img/logo-navy.jpg">`}
<meta property="og:url" content="${esc(base)}/p/${p.id}"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=/#/p/${p.id}"></head><body><a href="/#/p/${p.id}">${esc(p.name)}</a></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(html);
}

// ---------- الخادم ----------
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; media-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const persistH = require('./persist').init({ db, dataDir: DATA_DIR });
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => { if (res.statusCode < 400) persistH.touch(); });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  try {
    const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue; const m = r.re.exec(p); if (!m) continue;
        const out = await r.fn({ req, res, url, params: m.groups || {} });
        if (out && out.handled) return;
        return json(res, (out && out.status) || 200, out ? out.body : {}, (out && out.headers) || {});
      }
      throw new HttpError(404, 'غير موجود');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'غير مسموح');
    let m;
    if ((m = /^\/p\/(\d+)$/.exec(p))) return sharePage(req, res, m[1]);
    if (p.startsWith('/uploads/')) { const f = safeJoin(UPLOAD_DIR, p.slice(9)); return f ? serveFile(req, res, f, 'public, max-age=2592000, immutable') : json(res, 404, { error: 'غير موجود' }); }
    if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); return res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`); }
    if (p === '/sitemap.xml') {
      const base = origin(req); const urls = [base + '/'].concat(db.prepare('SELECT id FROM products WHERE active=1 ORDER BY id').all().map((r) => `${base}/p/${r.id}`));
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('\n') + '\n</urlset>\n');
    }
    if (p === '/' || p === '/index.html') {
      const s0 = getSettings(); const base = origin(req);
      let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replace(/__BASE__/g, esc(base)).replace(/__NAME__/g, esc(s0.store_name || '٩٩ للسبح'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (p === '/admin' || p === '/admin/') { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'), 'no-cache'); }
    if (p === '/') p = '/index.html';
    const f = safeJoin(PUBLIC_DIR, p.slice(1));
    if (!f) throw new HttpError(404, 'غير موجود');
    return serveFile(req, res, f, /\.(png|jpe?g|webp|svg|ico|mp3)$/i.test(f) ? 'public, max-age=86400' : 'no-cache');
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    console.error(e); return json(res, 500, { error: 'حدث خطأ في السيرفر' });
  }
});
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`متجر ٩٩ للسبح يعمل على المنفذ ${PORT}`);
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) console.warn('تنبيه: لم يتم ضبط ADMIN_EMAIL و ADMIN_PASSWORD، لوحة المدير معطّلة.');
  });
}
module.exports = { server, db };
