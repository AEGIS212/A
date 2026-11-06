// نظام التفعيل: رمز لكل سيرفر. الرموز تنولد من سطر الأوامر (أنت فقط)، وتنحفظ مشفرة (SHA-256)
// الاستخدام:
//   node license.js gen [days]     → يطلع رمز جديد (بدون days = دائم)
//   node license.js list           → كل الرموز وحالتها
//   node license.js revoke <guildId> → يلغي تفعيل سيرفر
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { G, save } = require('./utils');

const FILE = path.join(__dirname, 'licenses.json');
const DAY = 864e5;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون 0/O/1/I عشان ما يلتبس

const readDb = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const writeDb = (db) => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
const hashOf = (key) => crypto.createHash('sha256').update(String(key).trim().toUpperCase()).digest('hex');

function genKey() {
  const b = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += ALPHA[b[i] % ALPHA.length]; // 256 % 32 = 0 فما في انحياز
  return 'GRD-' + s.match(/.{4}/g).join('-');
}

function createKey(days = null) {
  const key = genKey();
  const h = hashOf(key);
  const db = readDb();
  db[h] = { id: h.slice(0, 8), days: days || null, createdAt: Date.now(), guildId: null, redeemedBy: null, redeemedAt: null };
  writeDb(db);
  return { key, id: h.slice(0, 8), days: days || null };
}

function isActive(guildId) {
  const l = G(guildId).license;
  if (!l) return false;
  return !l.expiresAt || l.expiresAt > Date.now();
}

function status(guildId) {
  const l = G(guildId).license;
  return { active: isActive(guildId), expiresAt: l?.expiresAt ?? null, id: l?.id ?? null };
}

// يفعّل السيرفر برمز. لو الرمز مستخدم أو السيرفر مفعّل (ولسه ما انتهى) يرفض
function redeem(guildId, key, userId) {
  const db = readDb();
  const entry = db[hashOf(key)];
  if (!entry) return { ok: false, msg: '❌ الرمز غلط.' };
  if (entry.guildId) return { ok: false, msg: '❌ هذا الرمز مستخدم من قبل.' };
  const cur = G(guildId).license;
  if (cur && isActive(guildId)) return { ok: false, msg: '❌ السيرفر مفعّل من قبل.' };

  const now = Date.now();
  const expiresAt = entry.days ? now + entry.days * DAY : null;
  entry.guildId = guildId;
  entry.redeemedBy = userId;
  entry.redeemedAt = now;
  writeDb(db);

  G(guildId).license = { id: entry.id, expiresAt, at: now };
  save();
  return { ok: true, expiresAt, msg: expiresAt ? `✅ تم التفعيل لغاية <t:${Math.floor(expiresAt / 1000)}:D>` : '✅ تم التفعيل (دائم).' };
}

function revoke(guildId) {
  const d = G(guildId);
  const had = !!d.license;
  delete d.license;
  save();
  return had;
}

function list() {
  return Object.values(readDb()).map((e) => ({ ...e }));
}

// أي حدث مرتبط بسيرفر غير مفعّل ما يوصل للمعالج. يسمح فقط بـ ready و GuildCreate وأمر /activate
function guildOf(args) {
  for (const a of args) {
    if (!a || typeof a !== 'object') continue;
    if (a.guild?.id) return a.guild.id;
    if (a.guildId) return a.guildId;
    if (a.ownerId && a.id) return a.id; // كائن السيرفر نفسه
  }
  return null;
}

function guard(client) {
  const { Events } = require('discord.js'); // محمّلة هنا عشان سطر الأوامر ما يحتاجها
  const on = client.on.bind(client);
  client.on = (event, fn) => on(event, (...args) => {
    if (event === Events.ClientReady || event === Events.GuildCreate) return fn(...args);
    const gid = guildOf(args);
    if (!gid || isActive(gid)) return fn(...args);
    const i = args[0];
    if (event === Events.InteractionCreate && i?.isChatInputCommand?.()) {
      if (i.commandName === 'activate') return fn(...args);
      return i.reply({ content: '🔒 البوت غير مفعّل لهذا السيرفر. الأونر يستخدم `/activate` مع الرمز.', flags: 64 }).catch(() => {});
    }
    // باقي الأحداث تنتجاهل
  });
}

module.exports = { createKey, redeem, revoke, isActive, status, list, guard };

// ---- سطر الأوامر ----
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'gen') {
    const days = arg ? Number(arg) : null;
    if (arg && (!Number.isInteger(days) || days <= 0)) { console.log('المدة لازم رقم أيام صحيح.'); process.exit(1); }
    const r = createKey(days);
    console.log(`🔑 الرمز: ${r.key}\nالمدة: ${r.days ? r.days + ' يوم' : 'دائم'}\nأعطه للأونر يكتبه بـ /activate`);
  } else if (cmd === 'list') {
    for (const e of list()) console.log(`${e.id}  ${e.days ? e.days + 'd' : 'دائم'}  ${e.guildId ? 'مستخدم: ' + e.guildId : 'غير مستخدم'}`);
  } else if (cmd === 'revoke' && arg) {
    console.log(revoke(arg) ? 'تم الإلغاء.' : 'السيرفر ما كان مفعّل.');
  } else {
    console.log('الاستخدام: node license.js gen [days] | list | revoke <guildId>');
  }
}
