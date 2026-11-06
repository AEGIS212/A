// طبقة الدرع: صيد الروابط، التحقق، التكتات (مع نسخة محادثة لكل تكت)
const {
  ChannelType, PermissionFlagsBits: P, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { G, save, u } = require('./utils');
const { C, E, log } = require('./logs');
const prot = require('./protection');
const { analyze } = require('./phishing');

const TDIR = path.join(__dirname, 'tickets');
fs.mkdirSync(TDIR, { recursive: true });
const VERIFY_BTN = 'shield_verify';
const ARCHIVE_MAX = 500;

// ================= توكنات ديسكورد =================
const TOKEN_SRC = /[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}/;
const hasToken = (s) => TOKEN_SRC.test(String(s ?? ''));
const maskToken = (s) => String(s ?? '').replace(new RegExp(TOKEN_SRC.source, 'g'), '[توكن محذوف]');

// أي رسالة فيها توكن تنحذف فوراً (يشمل تعديل الرسالة)، ويتباند الكاتب إذا مفعّل
async function onToken(m) {
  if (!m.guild || m.author?.bot || !hasToken(m.content)) return false;
  await m.delete().catch(() => {});
  let action = 'حذف الرسالة';
  if (cfg.shield.token.ban && m.author.id !== m.guild.ownerId && m.author.id !== m.client.user.id) {
    await m.guild.members.ban(m.author.id, { reason: 'Shield: discord token posted', deleteMessageSeconds: 86400 }).catch(() => {});
    action += ' + باند';
  } else {
    await m.member?.timeout(cfg.spam.timeoutMs, 'Shield: token').catch(() => {});
    action += ' + تايم أوت';
  }
  log(m.guild, 'protection', E('🔑 توكن منشور', C.red, `${u(m.author)} في <#${m.channelId}>`, [
    ['الإجراء', action], ['المحتوى (مخفي)', maskToken(m.content)],
  ]));
  return true;
}

// ================= صيد الروابط الاحتيالية =================
// يرجع true لو الرسالة تعاملت معها (عشان ما تكمل الفحوصات الثانية)
async function onMessage(m) {
  if (await onToken(m)) return true;
  const pc = cfg.shield.phishing;
  if (!pc.enabled || !m.guild || m.author.bot || !m.member) return false;
  if (prot.isSafe(m.guild, m.author.id) || m.member.permissions.has(P.ManageMessages)) return false;

  const a = analyze(m.content, pc);
  if (!a.level) return false;

  await m.delete().catch(() => {});
  // تصعيد: ثاني رابط احتيالي من نفس العضو = باند مباشرة حتى لو الخطورة متوسطة
  const g = G(m.guild.id);
  g.strikes ||= {};
  g.strikes[m.author.id] = (g.strikes[m.author.id] || 0) + 1;
  save();
  const repeat = g.strikes[m.author.id] >= 2;
  if (repeat) a.reasons.push(`تكرار (${g.strikes[m.author.id]} مرات)`);

  let action = 'حذف الرسالة';
  if (a.level === 'high' || repeat) {
    if (pc.banOnHigh) {
      await m.guild.members.ban(m.author.id, { reason: 'Shield: phishing link', deleteMessageSeconds: 86400 }).catch(() => {});
      action += ' + باند';
    } else {
      await m.member.timeout(cfg.spam.timeoutMs, 'Shield: phishing link').catch(() => {});
      action += ' + تايم أوت';
    }
  } else {
    await m.channel.send(`<@${m.author.id}> ⚠️ رابط مشبوه انحذف.`)
      .then((w) => setTimeout(() => w.delete().catch(() => {}), 5000)).catch(() => {});
    action += ' + تنبيه';
  }

  log(m.guild, 'protection', E(`🎣 صيد رابط احتيالي (${a.level === 'high' ? 'عالي' : 'متوسط'})`, C.red,
    `${u(m.author)} في <#${m.channelId}>`, [
      ['الأسباب', a.reasons.join(' ; ')],
      ['الإجراء', action],
      ['المحتوى', m.content],
    ]));
  return true;
}

// ================= التحقق =================
// المهلة محفوظة بـ data.json (G().verifyPending) ومعاد تشغيلها عند كل تشغيل للبوت
const timers = new Map();
const pkey = (gid, uid) => `${gid}:${uid}`;

async function expire(guild, uid) {
  const g = G(guild.id);
  delete g.verifyPending[uid];
  save();
  timers.delete(pkey(guild.id, uid));
  const m = await guild.members.fetch(uid).catch(() => null);
  if (!m) return;
  if (g.verifiedRole && m.roles.cache.has(g.verifiedRole)) return;
  await m.kick('Shield: لم يتحقق في المهلة').catch(() => {});
  log(guild, 'members', E('⏰ طرد لعدم التحقق', C.orange, u(m.user)));
}

function arm(guild, uid, deadline) {
  const k = pkey(guild.id, uid);
  clearTimeout(timers.get(k));
  timers.set(k, setTimeout(() => expire(guild, uid).catch(() => {}), Math.max(0, deadline - Date.now())));
}

function rearm(client) {
  for (const guild of client.guilds.cache.values()) {
    const g = G(guild.id);
    g.verifyPending ||= {};
    for (const [uid, deadline] of Object.entries(g.verifyPending)) arm(guild, uid, deadline);
  }
}

async function ensureVerifiedRole(guild) {
  const g = G(guild.id);
  let role = g.verifiedRole && guild.roles.cache.get(g.verifiedRole);
  if (!role) {
    role = await guild.roles.create({ name: '✅ موثق', reason: 'Shield: verify role' });
    g.verifiedRole = role.id;
    save();
  }
  return role;
}

async function postVerifyPanel(guild) {
  await ensureVerifiedRole(guild);
  const g = G(guild.id);
  let ch = guild.channels.cache.get(g.verifyChannel);
  if (!ch) {
    // خارج كاتيجوري اللوقات عشان الأعضاء يشوفونه
    ch = await guild.channels.create({
      name: '✅・التحقق', type: ChannelType.GuildText,
      permissionOverwrites: [{ id: guild.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] }],
    });
    g.verifyChannel = ch.id;
    save();
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(VERIFY_BTN).setLabel('✅ تحقق').setStyle(ButtonStyle.Success),
  );
  await ch.send({ embeds: [E('🔐 التحقق', C.green, 'اضغط الزر عشان نتأكد إنك إنسان ويفتح لك السيرفر.')], components: [row] });
  return ch;
}

async function onJoin(member) {
  const vc = cfg.shield.verify;
  if (!vc.enabled || member.user.bot || prot.isSafe(member.guild, member.id)) return;
  const g = G(member.guild.id);
  g.verifyPending ||= {};
  g.verifyPending[member.id] = Date.now() + vc.timeoutMs;
  save();
  arm(member.guild, member.id, g.verifyPending[member.id]);
}

async function onVerifyButton(i) {
  const role = await ensureVerifiedRole(i.guild);
  await i.member.roles.add(role, 'Shield: verified').catch(() => {});
  const g = G(i.guild.id);
  delete g.verifyPending?.[i.user.id];
  clearTimeout(timers.get(pkey(i.guild.id, i.user.id)));
  timers.delete(pkey(i.guild.id, i.user.id));
  save();
  return i.reply({ content: '✅ تم التحقق. أهلاً فيك!', flags: MessageFlags.Ephemeral });
}

// ================= التكتات =================
async function ticketCategory(guild) {
  const g = G(guild.id);
  let cat = guild.channels.cache.get(g.ticketCategory);
  if (!cat) {
    cat = await guild.channels.create({ name: cfg.shield.tickets.category, type: ChannelType.GuildCategory });
    g.ticketCategory = cat.id;
    save();
  }
  return cat;
}

// يجيب كل الرسائل من الروم (بحد أقصى 5000) ويرجعها نص مرتب
async function transcript(channel) {
  const all = [];
  let before;
  for (let page = 0; page < 50; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.reverse().map((m) => {
    const att = [...m.attachments.values()].map((a) => a.url).join(' ');
    return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag ?? '?'} (${m.author?.id ?? '?'}): ${m.content ?? ''}` +
      (att ? ` [مرفقات: ${att}]` : '');
  }).join('\n');
}

async function openTicket(i, subject) {
  const tc = cfg.shield.tickets;
  if (!tc.enabled) return i.reply({ content: '❌ نظام التكتات معطل.', flags: MessageFlags.Ephemeral });
  const g = G(i.guild.id);
  const mine = Object.values(g.tickets).filter((t) => t.owner === i.user.id).length;
  if (mine >= tc.maxOpen) return i.reply({ content: `❌ عندك ${mine} تكت مفتوح. سكّر وحدة قبل.`, flags: MessageFlags.Ephemeral });

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const cat = await ticketCategory(i.guild);
  const staff = i.guild.roles.cache
    .filter((r) => r.id !== i.guild.id && !r.managed && r.permissions.has(P.ManageMessages))
    .map((r) => r.id);
  const base = (i.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';

  const ch = await i.guild.channels.create({
    name: `ticket-${base}-${i.user.id.slice(-4)}`,
    type: ChannelType.GuildText,
    parent: cat.id,
    permissionOverwrites: [
      { id: i.guild.id, deny: [P.ViewChannel] },
      { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
      { id: i.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ReadMessageHistory, P.ManageMessages] },
      ...staff.map((id) => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })),
    ],
  });

  g.tickets[ch.id] = { owner: i.user.id, subject: subject || 'بدون موضوع', t: Date.now() };
  save();
  await ch.send({
    content: `<@${i.user.id}>`,
    embeds: [E('🎫 تكت جديد', C.blue, `**الموضوع:** ${subject || 'بدون موضوع'}\nاكتب مشكلتك بالتفصيل، والمشرفين بيردون عليك.\nللإغلاق: \`/ticket close\``)],
  });
  log(i.guild, 'tickets', E('🎫 فتح تكت', C.blue, u(i.user), [['الروم', `<#${ch.id}>`, true], ['الموضوع', subject || 'بدون موضوع']]));
  return i.editReply(`✅ تم فتح التكت: <#${ch.id}>`);
}

async function closeTicket(i) {
  const g = G(i.guild.id);
  const t = g.tickets[i.channelId];
  if (!t) return i.reply({ content: '❌ هذا الروم مو تكت.', flags: MessageFlags.Ephemeral });
  const isStaff = i.memberPermissions.has(P.ManageMessages);
  if (!isStaff && i.user.id !== t.owner) return i.reply({ content: '❌ بس صاحب التكت أو المشرفين.', flags: MessageFlags.Ephemeral });

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const text = (await transcript(i.channel)) || 'empty';

  // نسخة دائمة من المحادثة
  const dir = path.join(TDIR, i.guild.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${i.channelId}.txt`), text);

  const rec = { id: i.channelId, owner: t.owner, subject: t.subject, opened: t.t, closed: Date.now(), by: i.user.id };
  g.ticketArchive.push(rec);
  if (g.ticketArchive.length > ARCHIVE_MAX) g.ticketArchive.splice(0, g.ticketArchive.length - ARCHIVE_MAX);
  delete g.tickets[i.channelId];
  save();

  log(i.guild, 'tickets', E('🎫 إغلاق تكت (نسخة محفوظة)', C.gray, `${i.channel.name}`, [
    ['صاحب التكت', `<@${t.owner}>`], ['أغلقه', u(i.user)], ['الموضوع', t.subject],
  ]), [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${i.channel.name}.txt` })]);

  await i.editReply('✅ تم حفظ نسخة المحادثة وبيتسكر التكت.');
  setTimeout(() => i.channel.delete('Ticket closed').catch(() => {}), 3000);
}

async function onTicketCommand(i) {
  const action = i.options.getString('action');
  if (action === 'open') return openTicket(i, i.options.getString('subject'));
  if (action === 'close') return closeTicket(i);
  return i.reply({ content: '❌ عملية غير معروفة.', flags: MessageFlags.Ephemeral });
}

// للداش بورد
function ticketsOf(guild) {
  const g = G(guild.id);
  return {
    open: Object.entries(g.tickets).map(([id, t]) => ({ id, ...t })),
    archive: g.ticketArchive.slice(-100).reverse(),
  };
}

// ================= طلبات البوتات (موافقة من الداش بورد) =================
// الطلب ينحفظ في protection.js عند الإضافة، وهنا بس قرار المالك
function botDecision(guild, botId, action) {
  const g = G(guild.id);
  g.allowedBots ||= [];
  delete g.botRequests?.[botId];
  if (action === 'approve' && !g.allowedBots.includes(botId)) g.allowedBots.push(botId);
  if (action === 'revoke') g.allowedBots = g.allowedBots.filter((x) => x !== botId);
  save();
}
function botsOf(guild) {
  const g = G(guild.id);
  return { pending: Object.entries(g.botRequests || {}).map(([id, r]) => ({ id, ...r })), allowed: g.allowedBots || [] };
}

module.exports = {
  onMessage, onToken, onJoin, onVerifyButton, postVerifyPanel, ensureVerifiedRole, rearm,
  onTicketCommand, ticketsOf, VERIFY_BTN,
  botDecision, botsOf,
};
