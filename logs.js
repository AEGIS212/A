const { EmbedBuilder, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { save, G, cut, stats } = require('./utils');

const LOGDIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOGDIR, { recursive: true });
const MIRROR = process.env.LOG_MIRROR_DIR ? path.resolve(process.env.LOG_MIRROR_DIR) : null;

const C = { red: 0xED4245, green: 0x57F287, yellow: 0xFEE75C, blue: 0x5865F2, orange: 0xE67E22, gray: 0x95A5A6 };

function E(title, color, desc, fields = []) {
  const e = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
  if (desc) e.setDescription(cut(desc, 4000));
  for (const [n, v, inline] of fields) if (v !== undefined && v !== null) e.addFields({ name: n, value: cut(v), inline: !!inline });
  return e;
}

// قفل لكل سيرفر: يمنع إنشاء نفس الرومات مرتين لو صار setup بنفس الوقت (ready + /setup + حذف روم)
const locks = new Map();
const withLock = (gid, fn) => {
  const prev = locks.get(gid) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(gid, next);
  return next;
};

// رومات قيد الحذف اليدوي: نوقف الإصلاح التلقائي عشان ما ينشئها من جديد
const resetting = new Set();
const isResetting = (gid) => resetting.has(gid);

async function setupInner(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const g = G(guild.id);
  // ندور بالايدي المحفوظ أول، وبعدين بالاسم (عشان ما ينعمل تصنيف مكرر لو الايدي ضاع)
  let cat = guild.channels.cache.get(g.category)
    ?? guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === cfg.logCategoryName);
  let changed = false;
  if (!cat) {
    cat = await guild.channels.create({
      name: cfg.logCategoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ManageChannels] },
      ],
    });
  }
  if (g.category !== cat.id) { g.category = cat.id; changed = true; }

  for (const [key, name] of Object.entries(cfg.channels)) {
    let ch = guild.channels.cache.get(g.channels[key])
      ?? guild.channels.cache.find((c) => c.parentId === cat.id && c.name === name);
    if (ch) {
      if (ch.parentId !== cat.id) await ch.setParent(cat.id, { lockPermissions: true }).catch(() => {});
    } else {
      ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: cat.id });
    }
    if (g.channels[key] !== ch.id) { g.channels[key] = ch.id; changed = true; }
  }
  // ترتيب الرومات حسب ترتيب config.js
  let pos = 0;
  for (const key of Object.keys(cfg.channels)) {
    const ch = guild.channels.cache.get(g.channels[key]);
    if (ch && ch.parentId === cat.id) await ch.setPosition(pos++).catch(() => {});
  }
  if (changed) save();
}

function setup(guild) {
  return withLock(guild.id, () => setupInner(guild));
}

// حذف كل رومات السجلات (وكل التصنيفات اللي اسمها اسم السجلات، عشان نشيل المكرر القديم)
// ملاحظة: الرسائل تنحذف من ديسكورد، بس ملفات logs/ المحلية تبقى
async function removeAll(guild) {
  return withLock(guild.id, async () => {
    resetting.add(guild.id);
    try {
      const g = G(guild.id);
      const cats = guild.channels.cache.filter((c) =>
        c.type === ChannelType.GuildCategory && (c.id === g.category || c.name === cfg.logCategoryName));
      const catIds = new Set(cats.map((c) => c.id));
      const storedIds = new Set(Object.values(g.channels));
      const chans = guild.channels.cache.filter((c) =>
        c.type !== ChannelType.GuildCategory && (catIds.has(c.parentId) || storedIds.has(c.id)));

      let removed = 0;
      for (const ch of chans.values()) {
        if (await ch.delete('Logs reset').then(() => true, () => false)) removed++;
      }
      for (const cat of cats.values()) {
        if (await cat.delete('Logs reset').then(() => true, () => false)) removed++;
      }
      g.category = null;
      g.channels = {};
      save();
      return removed;
    } finally {
      resetting.delete(guild.id);
    }
  });
}

// مسح رسائل كل رومات السجلات + تفريغ الملف المحلي (النسخة الخارجية ما تنمسح)
async function clearLogs(guild) {
  const d = G(guild.id);
  let removed = 0;
  for (const id of Object.values(d.channels)) {
    const ch = guild.channels.cache.get(id);
    if (!ch) continue;
    for (let page = 0; page < 500; page++) {
      const batch = await ch.messages.fetch({ limit: 100 }).catch(() => null);
      if (!batch?.size) break;
      const r = await ch.bulkDelete(batch, true).catch(() => null);
      if (!r || r.size === 0) break; // الرسائل الأقدم من 14 يوم ما تنحذف جماعياً
      removed += r.size;
    }
  }
  fs.writeFileSync(path.join(LOGDIR, guild.id + '.log'), '');
  return removed;
}

function toFile(guild, key, embed) {
  const d = embed.data;
  const line = `[${new Date().toISOString()}] [${key}] ${d.title ?? ''} | ${d.description ?? ''} | ` +
    (d.fields ?? []).map((f) => `${f.name}: ${f.value}`).join(' ; ');
  const row = line.replace(/\n/g, ' ⏎ ') + '\n';
  fs.appendFile(path.join(LOGDIR, guild.id + '.log'), row, () => {});
  // نسخة خارجية (مثلاً مجلد على قرص ثاني أو مزامنة) عشان ما تضيع الأدلة لو انحذف شي من الجهاز
  if (MIRROR) {
    fs.mkdirSync(MIRROR, { recursive: true });
    fs.appendFile(path.join(MIRROR, guild.id + '.log'), row, () => {});
  }
}

function log(guild, key, embed, files) {
  if (key !== 'protection' && cfg.logs?.[key] === false) return;
  stats.ops++;
  toFile(guild, key, embed);
  const id = G(guild.id).channels[key];
  const ch = id && guild.channels.cache.get(id);
  if (!ch) return;
  ch.send({ embeds: [embed], files }).catch(() => {});
}

const isLogChannel = (ch) => !!ch && ch.parentId && ch.parentId === G(ch.guild.id).category;

module.exports = { C, E, setup, removeAll, isResetting, log, isLogChannel, clearLogs };
