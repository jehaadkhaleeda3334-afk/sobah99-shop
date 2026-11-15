'use strict';
// نقطة التشغيل: استعادة البيانات من النسخة الاحتياطية (إن وُجدت) ثم تشغيل الخادم.
const path = require('node:path');
const persist = require('./persist');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
persist.restore(DATA_DIR).then(() => {
  const { server } = require('./server.js');
  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, () => console.log(`متجر ٩٩ للسبح يعمل على المنفذ ${PORT}`));
});
