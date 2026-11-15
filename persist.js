'use strict';
// حفظ البيانات خارج الاستضافة المجانية: نسخة احتياطية تلقائية إلى مستودع GitHub خاص، واستعادة عند التشغيل.
// يعمل فقط إذا ضُبط BACKUP_GITHUB_TOKEN و BACKUP_REPO (مثل owner/repo). بدونهما يتجاهل كل شيء.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const TOKEN = process.env.BACKUP_GITHUB_TOKEN || '';
const REPO = process.env.BACKUP_REPO || '';
const enabled = !!(TOKEN && /^[\w.-]+\/[\w.-]+$/.test(REPO));

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: 'api.github.com', path: urlPath, method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN, 'User-Agent': 'sobah99-shop-backup',
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
      }
    }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8'); let j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* ignore */ }
        resolve({ status: res.statusCode, body: j });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const contentsUrl = (rel) => `/repos/${REPO}/contents/${rel.split('/').map(encodeURIComponent).join('/')}`;

// ---------- استعادة (قبل تشغيل الخادم) ----------
async function restore(dataDir) {
  if (!enabled) return;
  const dbFile = path.join(dataDir, 'store.db');
  if (fs.existsSync(dbFile)) return; // بيانات موجودة، لا نكتب فوقها
  try {
    const list = await api('GET', `/repos/${REPO}/contents/backup`);
    if (list.status === 404) { console.log('[backup] لا توجد نسخة سابقة، بداية جديدة'); return; }
    if (list.status !== 200) throw new Error('GitHub ' + list.status);
    fs.mkdirSync(dataDir, { recursive: true });
    let n = 0;
    const walk = async (items, rel) => {
      for (const it of items) {
        const sub = rel ? rel + '/' + it.name : it.name;
        if (it.type === 'dir') {
          const r = await api('GET', `/repos/${REPO}/contents/backup/${sub.split('/').map(encodeURIComponent).join('/')}`);
          if (r.status === 200) await walk(r.body, sub);
        } else if (it.type === 'file') {
          const r = await api('GET', `/repos/${REPO}/git/blobs/${it.sha}`);
          if (r.status !== 200) throw new Error('blob ' + r.status);
          const dest = path.join(dataDir, sub);
          if (!dest.startsWith(path.resolve(dataDir) + path.sep)) continue;
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, Buffer.from(r.body.content, 'base64')); n++;
        }
      }
    };
    await walk(list.body, '');
    console.log(`[backup] تمت استعادة ${n} ملف`);
  } catch (e) {
    // لا نشغّل الخادم على قاعدة فارغة ثم نكتب فوق النسخة الجيدة
    console.error('[backup] فشلت الاستعادة:', e.message); process.exit(1);
  }
}

// ---------- نسخ احتياطي (أثناء التشغيل) ----------
let ctx = null, timer = null, running = false, again = false;
const shas = new Map(); // مسار -> sha آخر ملف مرفوع
const done = new Set(); // ملفات ثابتة (صور/إيصالات) رُفعت
let lastDbHash = '';

async function putFile(rel, buf) {
  const url = contentsUrl('backup/' + rel);
  let sha = shas.get(rel);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!sha) { const g = await api('GET', url); if (g.status === 200 && g.body && g.body.sha) sha = g.body.sha; }
    const r = await api('PUT', url, { message: 'backup ' + rel, content: buf.toString('base64'), ...(sha ? { sha } : {}) });
    if (r.status === 200 || r.status === 201) { shas.set(rel, r.body.content.sha); return; }
    if (r.status === 409 || r.status === 422) { sha = null; shas.delete(rel); continue; }
    throw new Error(`${rel}: GitHub ${r.status}`);
  }
  throw new Error(rel + ': فشل بعد عدة محاولات');
}

async function runBackup() {
  if (running) { again = true; return; }
  running = true;
  try {
    const snap = path.join(ctx.dataDir, 'snapshot.tmp');
    try { fs.rmSync(snap, { force: true }); } catch (e) { /* ignore */ }
    ctx.db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(snap); fs.rmSync(snap, { force: true });
    // ملفات الصور والإيصالات أولاً، ثم القاعدة
    for (const sub of ['uploads', 'receipts']) {
      const dir = path.join(ctx.dataDir, sub);
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        const rel = sub + '/' + f; if (done.has(rel)) continue;
        await putFile(rel, fs.readFileSync(path.join(dir, f))); done.add(rel);
      }
    }
    const h = require('node:crypto').createHash('sha1').update(buf).digest('hex');
    if (h !== lastDbHash) { await putFile('store.db', buf); lastDbHash = h; }
    console.log('[backup] تم الحفظ');
  } catch (e) {
    console.error('[backup] فشل:', e.message); again = true;
  } finally {
    running = false;
    if (again) { again = false; schedule(60000); }
  }
}
function schedule(ms) { if (timer) return; timer = setTimeout(() => { timer = null; runBackup(); }, ms); }

function init(opts) {
  if (!enabled) { console.log('[backup] غير مفعّل (لم يُضبط BACKUP_GITHUB_TOKEN/BACKUP_REPO)'); return { touch() {} }; }
  ctx = opts;
  // نعتبر كل ما في المجلد محفوظًا بعد الاستعادة؛ نرفع الجديد فقط عند أول تغيير
  schedule(15000);
  const touch = () => schedule(5000);
  process.on('SIGTERM', async () => { try { await runBackup(); } catch (e) { /* ignore */ } process.exit(0); });
  return { touch };
}
module.exports = { enabled, restore, init };
