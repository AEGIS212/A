const { AuditLogEvent, ChannelType, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const cfg = require('./config');
const { G, save } = require('./utils');
const { C, E, log } = require('./logs');
const backup = require('./backup');

let client;
const DANGER = new PermissionsBitField(cfg.dangerousPerms).bitfield;
const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

// ---------- أدوات ----------
const hits = new Map();
function hit(key, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length;
}

function isSafe(guild, id) {
  return id === guild.ownerId || id === client.user.id || G(guild.id).whitelist.includes(id);
}

async function alert(guild, title, desc, fields) {
  const emb = E(title, C.red, desc, fields);
  log(guild, 'protection', emb);
  const owner = await guild.fetchOwner().catch(() => null);
  owner?.send({ embeds: [emb] }).catch(() => {});
}

async function punish(guild, userId, reason) {
  if (isSafe(guild, userId)) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  let result = [];
  try {
    if (member) {
      const roles = member.roles.cache.filter((r) => r.id !== guild.id && r.editable);
      await member.roles.remove(roles, `Protection: ${reason}`);
      result.push('سحب الرتب');
    }
  } catch {}
  try {
    if (cfg.punishment === 'ban') { await guild.members.ban(userId, { reason: `Protection: ${reason}` }); result.push('باند'); }
    else if (cfg.punishment === 'kick' && member) { await member.kick(`Protection: ${reason}`); result.push('كيك'); }
  } catch {}
  await alert(guild, '🚨 تم رصد تخريب', `<@${userId}> (\`${userId}\`)`, [
    ['السبب', reason], ['الإجراء', result.join(' + ') || 'فشل (الصلاحيات؟)'],
  ]);
}

// ---------- تنبيه على أفعال خطيرة من الموثوقين (الوايت ليست، مو المالك) ----------
const WATCHED = new Set([
  AuditLogEvent.ChannelDelete, AuditLogEvent.RoleDelete, AuditLogEvent.RoleUpdate,
  AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberKick, AuditLogEvent.BotAdd,
  AuditLogEvent.WebhookCreate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.MemberRoleUpdate,
]);

async function watchTrusted(entry, guild) {
  const ex = entry.executor;
  if (!ex || ex.id === guild.ownerId || ex.id === client.user.id) return;
  if (!G(guild.id).whitelist.includes(ex.id) || !WATCHED.has(entry.action)) return;
  await alert(guild, '👁️ فعل خطير من موثوق', `<@${ex.id}> سوّى فعل حساس.`, [
    ['الفعل', AuditLogEvent[entry.action] ?? String(entry.action)],
    ['الهدف', entry.targetId ? `\`${entry.targetId}\`` : '—'],
    ['تنبيه', 'البوت ما وقفه لأنه موثوق. راجع الفعل وإذا كان غلط، أزله من الوايت ليست.'],
  ]);
}

// ---------- Anti-Nuke (من الأوديت لوق) ----------
async function onAudit(entry, guild) {
  const ex = entry.executor;
  await watchTrusted(entry, guild).catch(() => {});
  if (!ex || isSafe(guild, ex.id)) return;
  const name = AuditLogEvent[entry.action];

  const rule = cfg.nuke[name];
  if (rule) {
    const n = hit(`${guild.id}:${ex.id}:${name}`, rule.window);
    if (n >= rule.limit) await punish(guild, ex.id, `${name} ×${n}`);
  }

  // استرجاع فوري للرومات والرتب المحذوفة
  if (cfg.backup.restoreOnDelete && (entry.action === AuditLogEvent.ChannelDelete || entry.action === AuditLogEvent.RoleDelete)) {
    backup.freeze(guild.id);
    if (entry.action === AuditLogEvent.ChannelDelete) backup.restoreChannel(guild, entry.targetId).catch(() => {});
    else backup.restoreRole(guild, entry.targetId).catch(() => {});
  }

  // حذف روم اللوقات = عقوبة فورية
  const gd = G(guild.id);
  if (entry.action === AuditLogEvent.ChannelDelete && (entry.targetId === gd.category || Object.values(gd.channels).includes(entry.targetId))) {
    await punish(guild, ex.id, 'حذف روم اللوقات');
  }

  // حذف الويب هوك
  if (cfg.deleteWebhooks && entry.action === AuditLogEvent.WebhookCreate) {
    const hooks = await guild.fetchWebhooks().catch(() => null);
    await hooks?.get(entry.targetId)?.delete('Protection: unauthorized webhook').catch(() => {});
    log(guild, 'protection', E('🪝 حذف ويب هوك', C.orange, `أنشأه ${ex.tag ?? ex.username} (\`${ex.id}\`)`));
  }

  // بوت غير مصرح: ينطرد وينحفظ كطلب، والمالك يوافق من الداش بورد
  if (entry.action === AuditLogEvent.BotAdd && !(gd.allowedBots || []).includes(entry.targetId)) {
    await guild.members.kick(entry.targetId, 'Shield: bot needs approval').catch(() => {});
    gd.botRequests ||= {};
    gd.botRequests[entry.targetId] = { by: ex.id, t: Date.now() };
    save();
    const owner = await guild.fetchOwner().catch(() => null);
    const emb = E('🤖 طلب إضافة بوت', C.orange, `أضاف <@${ex.id}> البوت \`${entry.targetId}\` وانطرد لحين موافقتك.`,
      [['الإجراء', 'وافق من الداش بورد ← 🤖 البوتات']]);
    log(guild, 'protection', emb);
    owner?.send({ embeds: [emb] }).catch(() => {});
  }

  // إعطاء رتبة خطيرة
  if (entry.action === AuditLogEvent.MemberRoleUpdate) {
    const added = entry.changes.find((c) => c.key === '$add')?.new ?? [];
    for (const r of added) {
      const role = guild.roles.cache.get(r.id);
      if (role && (role.permissions.bitfield & DANGER) !== 0n) {
        const m = await guild.members.fetch(entry.targetId).catch(() => null);
        await m?.roles.remove(role, 'Protection: dangerous role').catch(() => {});
        await punish(guild, ex.id, `إعطاء رتبة خطيرة (${role.name})`);
      }
    }
  }

  // فتح صلاحيات خطيرة لـ @everyone على روم (overwrite) → رجّعها وعاقب
  if (entry.action === AuditLogEvent.ChannelOverwriteCreate || entry.action === AuditLogEvent.ChannelOverwriteUpdate) {
    const ch = guild.channels.cache.get(entry.targetId);
    const ow = ch?.permissionOverwrites?.cache.get(entry.extra?.id);
    if (ow && entry.extra?.id === guild.id && (ow.allow.bitfield & DANGER) !== 0n) {
      const allowChange = entry.changes.find((c) => c.key === 'allow');
      const oldAllow = BigInt(allowChange?.old ?? 0);
      await ch.permissionOverwrites.set(
        [...ch.permissionOverwrites.cache.values()].map((o) => (o.id === guild.id
          ? { id: guild.id, type: 0, allow: oldAllow, deny: o.deny.bitfield }
          : { id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
        'Protection: revert',
      ).catch(() => {});
      await punish(guild, ex.id, `فتح صلاحيات خطيرة لـ @everyone في ${ch.name}`);
    }
  }

  // رفع صلاحيات رتبة
  if (entry.action === AuditLogEvent.RoleUpdate) {
    const ch = entry.changes.find((c) => c.key === 'permissions');
    if (ch) {
      const ob = BigInt(ch.old ?? 0), nb = BigInt(ch.new ?? 0);
      if ((nb & ~ob & DANGER) !== 0n) {
        await guild.roles.cache.get(entry.targetId)?.setPermissions(ob, 'Protection: revert').catch(() => {});
        await punish(guild, ex.id, 'رفع صلاحيات خطيرة لرتبة');
      }
    }
  }
}

// ---------- حذف الرسائل ----------
// bulkDelete يفشل مع رسالة وحدة، ويتجاهل الرسائل الأقدم من 14 يوم، فنكمل بالحذف الفردي
async function purge(guild, byCh) {
  for (const [chId, ids] of Object.entries(byCh)) {
    const ch = guild.channels.cache.get(chId);
    if (!ch) continue;
    let done = new Set();
    if (ids.length >= 2) {
      const r = await ch.bulkDelete(ids, true).catch(() => null);
      if (r) done = new Set(r.keys());
    }
    for (const id of ids) {
      if (done.has(id)) continue;
      const m = ch.messages.cache.get(id) ?? (await ch.messages.fetch(id).catch(() => null));
      await m?.delete().catch(() => {});
    }
  }
}

// ---------- Anti-Spam ----------
const store = new Map();
async function onMessage(msg) {
  if (!msg.guild || msg.author.bot || !msg.member) return;
  const g = msg.guild, s = cfg.spam;
  if (isSafe(g, msg.author.id) || msg.member.permissions.has(P.ManageMessages)) return;

  const key = `${g.id}:${msg.author.id}`, now = Date.now();
  const arr = (store.get(key) || []).filter((m) => now - m.t < s.window);
  arr.push({ t: now, id: msg.id, ch: msg.channelId, c: msg.content });
  store.set(key, arr);

  let reason = null, single = false;
  if (s.blockInvites && INVITE.test(msg.content)) { reason = 'نشر رابط دعوة'; single = true; }
  else if (msg.mentions.users.size + msg.mentions.roles.size >= s.maxMentions) { reason = 'منشن جماعي'; single = true; }
  else if (arr.length >= s.maxMessages) reason = 'سبام رسائل';
  else if (msg.content && arr.filter((m) => m.c === msg.content).length >= s.maxDuplicates) reason = 'رسائل مكررة';
  if (!reason) {
    const f = cfg.filters, c = msg.content ?? '';
    const letters = c.replace(/[^A-Za-z]/g, '').length;
    let soft = null;
    if (f.badWords.length && f.badWords.some((w) => c.toLowerCase().includes(w.toLowerCase()))) soft = 'كلمة ممنوعة';
    else if (c.length >= f.minCapsLength && letters > 0 && c.replace(/[^A-Z]/g, '').length / letters > f.maxCapsRatio) soft = 'كتابة كابس';
    else if ((c.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) || []).length >= f.maxEmojis) soft = 'إيموجي كثير';
    else if (f.blockLinks && /https?:\/\/\S+/i.test(c) && !f.linkWhitelist.some((d) => c.includes(d))) soft = 'رابط ممنوع';
    if (!soft) return;
    await msg.delete().catch(() => {});
    msg.channel.send(`<@${msg.author.id}> ❌ ${soft}`).then((m) => setTimeout(() => m.delete().catch(() => {}), 4000)).catch(() => {});
    log(g, 'protection', E('🧽 فلتر الشات', C.yellow, `<@${msg.author.id}> (\`${msg.author.id}\`)`, [
      ['السبب', soft], ['المحتوى', c],
    ]));
    return;
  }

  store.delete(key);
  const list = single ? [{ id: msg.id, ch: msg.channelId }] : arr;
  const byCh = {};
  list.forEach((m) => (byCh[m.ch] ||= []).push(m.id));
  await purge(g, byCh);
  await msg.member.timeout(s.timeoutMs, `Protection: ${reason}`).catch(() => {});
  log(g, 'protection', E('🧹 حماية الشات', C.orange, `<@${msg.author.id}> (\`${msg.author.id}\`)`, [
    ['السبب', reason], ['الروم', `<#${msg.channelId}>`], ['الإجراء', 'حذف الرسائل + تايم أوت'],
  ]));
}

// ---------- Anti-Raid ----------
const locks = new Map();
const joins = new Map();

function lockdown(guild, on, ms = cfg.raid.lockdownMs) {
  clearTimeout(locks.get(guild.id));
  if (on) {
    locks.set(guild.id, setTimeout(() => {
      locks.delete(guild.id);
      log(guild, 'protection', E('🔓 انتهى القفل', C.green, 'رجع الدخول طبيعي.'));
    }, ms));
    alert(guild, '🔒 قفل السيرفر (Anti-Raid)', `كل من يدخل بيتطرد لمدة ${Math.round(ms / 60000)} دقيقة.`);
  } else {
    locks.delete(guild.id);
    log(guild, 'protection', E('🔓 تم فك القفل', C.green, 'تم يدوياً.'));
  }
}

async function onJoin(member) {
  const g = member.guild, r = cfg.raid;
  if (member.user.bot || isSafe(g, member.id)) return;

  if (locks.has(g.id)) {
    await member.kick('Anti-Raid lockdown').catch(() => {});
    return log(g, 'protection', E('🚪 طرد (قفل)', C.orange, `<@${member.id}> (\`${member.id}\`)`));
  }

  const age = (Date.now() - member.user.createdTimestamp) / 864e5;
  if (r.minAccountAgeDays > 0 && age < r.minAccountAgeDays) {
    await member.kick('Account too new').catch(() => {});
    return log(g, 'protection', E('🚪 طرد حساب جديد', C.orange, `<@${member.id}> (\`${member.id}\`)`, [
      ['عمر الحساب', `${age.toFixed(1)} يوم`],
    ]));
  }

  const now = Date.now();
  const list = (joins.get(g.id) || []).filter((j) => now - j.t < r.window);
  list.push({ t: now, id: member.id });
  joins.set(g.id, list);

  if (list.length >= r.limit) {
    lockdown(g, true);
    for (const j of list) await g.members.kick(j.id, 'Anti-Raid').catch(() => {});
    joins.delete(g.id);
  }
}

// ---------- وضع الطوارئ ----------
async function panic(guild, on) {
  const g = G(guild.id);
  if (on) {
    g.panic = [];
    for (const ch of guild.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) continue;
      const ow = ch.permissionOverwrites.cache.get(guild.id);
      if (ow?.deny.has(P.SendMessages)) continue;
      const prev = ow?.allow.has(P.SendMessages) ? true : null;
      await ch.permissionOverwrites.edit(guild.id, { SendMessages: false }, { reason: 'Panic mode' })
        .then(() => g.panic.push({ id: ch.id, prev })).catch(() => {});
    }
    lockdown(guild, true, 30 * 60000);
    log(guild, 'protection', E('🚨 وضع الطوارئ', C.red, `تم قفل **${g.panic.length}** روم وإيقاف الدخول.`));
  } else {
    for (const { id, prev } of g.panic) {
      await guild.channels.cache.get(id)?.permissionOverwrites.edit(guild.id, { SendMessages: prev }, { reason: 'Panic off' }).catch(() => {});
    }
    g.panic = [];
    lockdown(guild, false);
    log(guild, 'protection', E('✅ انتهى وضع الطوارئ', C.green));
  }
  save();
}

module.exports = { init: (c) => (client = c), onAudit, onMessage, onJoin, lockdown, panic, isSafe, purge, punish, isLocked: (gid) => locks.has(gid) };
