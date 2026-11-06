// إعدادات قابلة للتعديل من الداش بورد، تنحفظ بملف settings.json
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const FILE = path.join(__dirname, 'settings.json');

const S = [];
const add = (group, p, label, type, o = {}) => S.push({ group, path: p, label, type, ...o });
const SEC = { scale: 1000 }, MIN = { scale: 60000 };

add('عام', 'punishment', 'العقوبة على المخرب', 'enum', { values: ['ban', 'kick', 'strip'] });
add('السجلات', 'logAllChat', 'تسجيل كل رسائل الشات', 'bool');
for (const [k, label] of Object.entries({
  messages: 'سجل الرسائل', members: 'سجل الأعضاء', voice: 'سجل الصوت', channels: 'سجل الرومات',
  roles: 'سجل الرتب', server: 'سجل السيرفر', moderation: 'سجل الإدارة', invites: 'سجل الدعوات',
})) add('السجلات', `logs.${k}`, label, 'bool');
add('عام', 'deleteWebhooks', 'حذف الويب هوك غير المصرح', 'bool');

const NUKE = {
  ChannelDelete: 'حذف رومات', ChannelCreate: 'إنشاء رومات', RoleDelete: 'حذف رتب', RoleCreate: 'إنشاء رتب',
  MemberBanAdd: 'باند', MemberKick: 'كيك', MemberPrune: 'برون', WebhookCreate: 'ويب هوك', EmojiDelete: 'حذف إيموجي',
};
for (const k of Object.keys(cfg.nuke)) {
  add('Anti-Nuke', `nuke.${k}.limit`, `${NUKE[k] ?? k} — العدد`, 'int', { min: 1, max: 50 });
  add('Anti-Nuke', `nuke.${k}.window`, `${NUKE[k] ?? k} — المدة (ثانية)`, 'int', { min: 1, max: 600, ...SEC });
}

add('Anti-Raid', 'raid.limit', 'عدد الداخلين اللي يفعل القفل', 'int', { min: 2, max: 100 });
add('Anti-Raid', 'raid.window', 'خلال (ثانية)', 'int', { min: 1, max: 300, ...SEC });
add('Anti-Raid', 'raid.lockdownMs', 'مدة القفل (دقيقة)', 'int', { min: 1, max: 1440, ...MIN });
add('Anti-Raid', 'raid.minAccountAgeDays', 'أقل عمر حساب (يوم، 0 للتعطيل)', 'int', { min: 0, max: 365 });

add('Anti-Spam', 'spam.window', 'نافذة الفحص (ثانية)', 'int', { min: 1, max: 60, ...SEC });
add('Anti-Spam', 'spam.maxMessages', 'أقصى رسائل', 'int', { min: 2, max: 50 });
add('Anti-Spam', 'spam.maxDuplicates', 'أقصى رسائل مكررة', 'int', { min: 2, max: 20 });
add('Anti-Spam', 'spam.maxMentions', 'أقصى منشن بالرسالة', 'int', { min: 2, max: 50 });
add('Anti-Spam', 'spam.blockInvites', 'منع روابط الدعوات', 'bool');
add('Anti-Spam', 'spam.timeoutMs', 'مدة التايم أوت (دقيقة)', 'int', { min: 1, max: 40320, ...MIN });

add('فلاتر الشات', 'filters.badWords', 'كلمات ممنوعة (كل كلمة بسطر)', 'list');
add('فلاتر الشات', 'filters.maxCapsRatio', 'نسبة الكابس (0.1 - 1)', 'float', { min: 0.1, max: 1 });
add('فلاتر الشات', 'filters.minCapsLength', 'أقل طول لفحص الكابس', 'int', { min: 5, max: 200 });
add('فلاتر الشات', 'filters.maxEmojis', 'أقصى إيموجي', 'int', { min: 3, max: 100 });
add('فلاتر الشات', 'filters.blockLinks', 'منع كل الروابط', 'bool');
add('فلاتر الشات', 'filters.linkWhitelist', 'روابط مسموحة (كل دومين بسطر)', 'list');

add('النسخ والتحذيرات', 'backup.restoreOnDelete', 'استرجاع تلقائي للمحذوف', 'bool');
add('النسخ والتحذيرات', 'warns.timeoutAt', 'تايم أوت عند عدد تحذيرات', 'int', { min: 1, max: 50 });
add('النسخ والتحذيرات', 'warns.kickAt', 'كيك عند عدد تحذيرات', 'int', { min: 1, max: 50 });
add('النسخ والتحذيرات', 'warns.timeoutMs', 'مدة تايم أوت التحذيرات (دقيقة)', 'int', { min: 1, max: 40320, ...MIN });

add('Shield', 'shield.phishing.enabled', 'كشف الروابط الاحتيالية', 'bool');
add('Shield', 'shield.phishing.banOnHigh', 'باند للرابط العالي الخطورة (وإلا تايم أوت)', 'bool');
add('Shield', 'shield.token.ban', 'باند لكاتب التوكن (وإلا تايم أوت)', 'bool');
add('Shield', 'shield.verify.enabled', 'نظام التحقق (طرد غير الموثق)', 'bool');
add('Shield', 'shield.verify.timeoutMs', 'مهلة التحقق (دقيقة)', 'int', { min: 1, max: 1440, ...MIN });
add('Shield', 'shield.tickets.enabled', 'نظام التكتات', 'bool');
add('Shield', 'shield.tickets.maxOpen', 'أقصى تكتات مفتوحة للعضو', 'int', { min: 1, max: 10 });

const get = (p) => p.split('.').reduce((o, k) => o?.[k], cfg);
const set = (p, v) => {
  const ks = p.split('.'), last = ks.pop();
  ks.reduce((o, k) => o[k], cfg)[last] = v;
};

function validate(d, v) {
  switch (d.type) {
    case 'bool': return typeof v === 'boolean' ? { v } : { e: 'قيمة غير صحيحة' };
    case 'enum': return d.values.includes(v) ? { v } : { e: 'خيار غير صحيح' };
    case 'int': case 'float': {
      const n = Number(v), sc = d.scale || 1;
      if (!Number.isFinite(n)) return { e: 'رقم غير صحيح' };
      if (n / sc < d.min || n / sc > d.max) return { e: `لازم بين ${d.min} و ${d.max}` };
      return { v: d.type === 'int' ? Math.round(n) : n };
    }
    case 'list':
      if (!Array.isArray(v) || v.length > 200) return { e: 'قائمة غير صحيحة' };
      return { v: v.map((x) => String(x).trim().slice(0, 100)).filter(Boolean) };
  }
  return { e: 'نوع مجهول' };
}

function apply(changes) {
  const errors = [], ok = {};
  for (const [p, raw] of Object.entries(changes || {})) {
    const d = S.find((x) => x.path === p);
    if (!d) { errors.push(`${p}: غير موجود`); continue; }
    const r = validate(d, raw);
    if (r.e) errors.push(`${d.label}: ${r.e}`); else ok[p] = r.v;
  }
  if (errors.length) return { errors };
  for (const [p, v] of Object.entries(ok)) set(p, v);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  fs.writeFileSync(FILE, JSON.stringify({ ...saved, ...ok }, null, 2));
  return { changed: Object.keys(ok) };
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [p, raw] of Object.entries(saved)) {
      const d = S.find((x) => x.path === p), r = d && validate(d, raw);
      if (r && !r.e) set(p, r.v);
    }
  } catch {}
}

const describe = () => ({ schema: S, values: Object.fromEntries(S.map((d) => [d.path, get(d.path)])) });

module.exports = { apply, load, describe };
