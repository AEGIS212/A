const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'data.json');

let data = {};
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

const save = () => fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
// عدادات عامة للصفحة الرئيسية (نسخ محفوظة + عمليات حماية)
const stats = (data.__stats ||= { backups: 0, ops: 0 });
setInterval(save, 60000).unref();
const G = (id) => {
  const g = (data[id] ||= {});
  g.channels ||= {}; g.whitelist ||= []; g.warns ||= {}; g.panic ||= [];
  g.tickets ||= {}; g.ticketArchive ||= []; g.verifyPending ||= {}; g.strikes ||= {};
  return g;
};
const cut = (s, n = 1000) => {
  s = String(s ?? '');
  if (!s.length) return '—';
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
};
const u = (user) =>
  user ? `<@${user.id}> (\`${user.tag ?? user.username}\` | \`${user.id}\`)` : 'غير معروف';

module.exports = { data, save, G, cut, u, stats };
