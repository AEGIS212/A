require('dotenv').config();
const {
  Client, GatewayIntentBits: I, Partials: P, Events, AuditLogEvent,
  PermissionsBitField, PermissionFlagsBits, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const cfg = require('./config');
require('./settings').load();
const { save, G, cut, u } = require('./utils');
const { C, E, setup, removeAll, isResetting, log, isLogChannel } = require('./logs');
const prot = require('./protection');
const backup = require('./backup');
const shield = require('./shield');
const license = require('./license');

const client = new Client({
  intents: [
    I.Guilds, I.GuildMembers, I.GuildModeration, I.GuildMessages, I.MessageContent,
    I.GuildVoiceStates, I.GuildInvites, I.GuildWebhooks, I.GuildEmojisAndStickers,
  ],
  partials: [P.Message, P.Channel, P.GuildMember, P.User],
});
prot.init(client);
license.guard(client); // أي سيرفر غير مفعّل ما يوصله أي حدث (إلا التفعيل)

// ================= الأوامر =================
const commands = [
  { name: 'setup', description: 'إنشاء/إصلاح رومات اللوقات', default_member_permissions: String(PermissionFlagsBits.Administrator) },
  {
    name: 'logs', description: 'حذف أو إنشاء رومات السجلات (حذف للأونر فقط)',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      { type: 3, name: 'action', description: 'العملية', required: true, choices: [{ name: 'create', value: 'create' }, { name: 'delete', value: 'delete' }] },
      { type: 5, name: 'confirm', description: 'تأكيد الحذف (لازم true مع delete)', required: false },
    ],
  },
  {
    name: 'lockdown', description: 'قفل/فتح السيرفر ضد الريد',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [{ type: 3, name: 'mode', description: 'on / off', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }],
  },
  {
    name: 'whitelist', description: 'إدارة القائمة البيضاء (للأونر فقط)',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      { type: 3, name: 'action', description: 'العملية', required: true, choices: [{ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }] },
      { type: 6, name: 'user', description: 'العضو', required: false },
    ],
  },
  { name: 'ban', description: 'باند عضو', default_member_permissions: String(PermissionFlagsBits.BanMembers),
    options: [{ type: 6, name: 'user', description: 'العضو', required: true }, { type: 3, name: 'reason', description: 'السبب' }] },
  { name: 'kick', description: 'كيك عضو', default_member_permissions: String(PermissionFlagsBits.KickMembers),
    options: [{ type: 6, name: 'user', description: 'العضو', required: true }, { type: 3, name: 'reason', description: 'السبب' }] },
  { name: 'timeout', description: 'تايم أوت', default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [{ type: 6, name: 'user', description: 'العضو', required: true }, { type: 4, name: 'minutes', description: 'الدقائق', required: true, min_value: 1, max_value: 40320 }, { type: 3, name: 'reason', description: 'السبب' }] },
  { name: 'warn', description: 'تحذير عضو', default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [{ type: 6, name: 'user', description: 'العضو', required: true }, { type: 3, name: 'reason', description: 'السبب' }] },
  { name: 'warnings', description: 'عرض تحذيرات عضو', default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
    options: [{ type: 6, name: 'user', description: 'العضو', required: true }] },
  { name: 'clear', description: 'مسح رسائل', default_member_permissions: String(PermissionFlagsBits.ManageMessages),
    options: [{ type: 4, name: 'count', description: 'العدد', required: true, min_value: 1, max_value: 100 }] },
  { name: 'panic', description: 'وضع الطوارئ: قفل كل الرومات والدخول', default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [{ type: 3, name: 'mode', description: 'on / off', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
  { name: 'backup', description: 'نسخ/استرجاع الرومات والرتب', default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [{ type: 3, name: 'action', description: 'العملية', required: true, choices: [{ name: 'create', value: 'create' }, { name: 'restore', value: 'restore' }] }] },
  {
    name: 'ticket', description: 'فتح أو إغلاق تكت دعم',
    options: [
      { type: 3, name: 'action', description: 'العملية', required: true, choices: [{ name: 'open', value: 'open' }, { name: 'close', value: 'close' }] },
      { type: 3, name: 'subject', description: 'موضوع التكت (مع الفتح)', required: false, max_length: 100 },
    ],
  },
  { name: 'verify-panel', description: 'نشر لوحة التحقق (زر تحقق)', default_member_permissions: String(PermissionFlagsBits.Administrator) },
];

// أمر التفعيل: يظهر لوحده للسيرفرات غير المفعّلة، وبعد التفعيل تنسجل كل الأوامر
const activateCmd = {
  name: 'activate', description: 'تفعيل البوت برمز التفعيل (للأونر)',
  default_member_permissions: String(PermissionFlagsBits.Administrator),
  options: [{ type: 3, name: 'key', description: 'رمز التفعيل', required: true }],
};
async function syncCommands(g) {
  await g.commands.set(license.isActive(g.id) ? commands : [activateCmd]).catch(() => {});
}
// يُستدعى بعد أي تفعيل (من ديسكورد أو الداش بورد): يجهّز السيرفر كامل
async function activateGuild(g) {
  await setup(g).catch(() => {});
  await cacheInvites(g);
  await syncCommands(g);
  await backup.snapshot(g, true).catch(() => {});
}

async function modCommand(i) {
  const g = i.guild, me = g.members.me, name = i.commandName;
  const reply = (c) => i.reply({ content: c, flags: MessageFlags.Ephemeral });
  const need = {
    ban: PermissionFlagsBits.BanMembers, kick: PermissionFlagsBits.KickMembers,
    timeout: PermissionFlagsBits.ModerateMembers, warn: PermissionFlagsBits.ModerateMembers,
    warnings: PermissionFlagsBits.ModerateMembers, clear: PermissionFlagsBits.ManageMessages,
  };
  if (!i.memberPermissions.has(need[name])) return reply('❌ ما عندك صلاحية.');

  if (name === 'clear') {
    const r = await i.channel.bulkDelete(i.options.getInteger('count'), true).catch(() => null);
    if (r) log(g, 'moderation', E('🧹 مسح رسائل', C.orange, null, [['المشرف', u(i.user)], ['العدد', String(r.size), true], ['الروم', `<#${i.channelId}>`, true]]));
    return reply(r ? `✅ تم مسح ${r.size}` : '❌ فشل');
  }

  const user = i.options.getUser('user');
  const reason = i.options.getString('reason') ?? 'بدون سبب';
  if (name === 'warnings') {
    const w = G(g.id).warns[user.id] ?? [];
    return reply(w.length ? w.map((x, n) => `${n + 1}. ${x.reason} — <@${x.by}> <t:${Math.floor(x.t / 1000)}:R>`).join('\n') : 'ما عنده تحذيرات.');
  }
  if (user.id === i.user.id || user.id === client.user.id || user.id === g.ownerId) return reply('❌ ما يصير.');

  const member = await g.members.fetch(user.id).catch(() => null);
  if (member) {
    if (i.user.id !== g.ownerId && member.roles.highest.position >= i.member.roles.highest.position) return reply('❌ رتبته تساويك أو أعلى.');
    if (member.roles.highest.position >= me.roles.highest.position) return reply('❌ رتبته أعلى من البوت.');
  } else if (name !== 'ban') return reply('❌ العضو مب بالسيرفر.');

  let done = '', extra = '';
  try {
    if (name === 'ban') { await g.members.ban(user.id, { reason: `${i.user.tag}: ${reason}` }); done = '🔨 باند'; }
    if (name === 'kick') { await member.kick(`${i.user.tag}: ${reason}`); done = '👢 كيك'; }
    if (name === 'timeout') { await member.timeout(i.options.getInteger('minutes') * 60000, `${i.user.tag}: ${reason}`); done = '⏳ تايم أوت'; }
    if (name === 'warn') {
      const w = (G(g.id).warns[user.id] ||= []);
      w.push({ by: i.user.id, reason, t: Date.now() });
      save();
      done = `⚠️ تحذير (${w.length})`;
      if (w.length >= cfg.warns.kickAt) { await member.kick('Too many warns'); extra = ' + كيك تلقائي'; }
      else if (w.length >= cfg.warns.timeoutAt) { await member.timeout(cfg.warns.timeoutMs, 'Too many warns'); extra = ' + تايم أوت تلقائي'; }
    }
  } catch (e) { return reply('❌ فشل: ' + e.message); }

  log(g, 'moderation', E(`${done}${extra}`, C.orange, null, [['العضو', u(user)], ['المشرف', u(i.user)], ['السبب', reason]]));
  return reply(`✅ ${done}${extra}`);
}

client.on(Events.InteractionCreate, async (i) => {
  if (i.isButton() && i.guild && i.customId === shield.VERIFY_BTN) return shield.onVerifyButton(i).catch(console.error);
  if (!i.isChatInputCommand() || !i.guild) return;
  const isOwner = i.user.id === i.guild.ownerId;
  const trusted = isOwner || G(i.guild.id).whitelist.includes(i.user.id);
  if (i.commandName === 'activate') {
    if (!isOwner) return i.reply({ content: '❌ التفعيل للأونر فقط.', flags: MessageFlags.Ephemeral });
    const r = license.redeem(i.guild.id, i.options.getString('key'), i.user.id);
    if (!r.ok) return i.reply({ content: r.msg, flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await activateGuild(i.guild);
    return i.editReply(`${r.msg}\nتم تجهيز السيرفر وتسجيل الأوامر.`);
  }
  if (i.commandName === 'setup') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await setup(i.guild).catch((e) => i.editReply('فشل: ' + e.message));
    return i.editReply('✅ تم تجهيز رومات اللوقات.');
  }
  if (i.commandName === 'logs') {
    const action = i.options.getString('action');
    if (action === 'delete') {
      if (!isOwner) return i.reply({ content: '❌ حذف السجلات للأونر فقط.', flags: MessageFlags.Ephemeral });
      if (i.options.getBoolean('confirm') !== true)
        return i.reply({ content: '⚠️ الحذف ما له رجعة (رسائل السجلات تنحذف من ديسكورد). أعد الأمر مع `confirm: true`.', flags: MessageFlags.Ephemeral });
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const n = await removeAll(i.guild).catch((e) => { i.editReply('فشل: ' + e.message); return null; });
      if (n === null) return;
      return i.editReply(`🗑️ تم حذف ${n} روم/تصنيف من السجلات. استخدم \`/logs action:create\` لإنشائها من جديد.`);
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await setup(i.guild).catch((e) => i.editReply('فشل: ' + e.message));
    return i.editReply('✅ تم إنشاء رومات السجلات.');
  }
  if (i.commandName === 'ticket') return shield.onTicketCommand(i).catch(console.error);
  if (['ban', 'kick', 'timeout', 'warn', 'warnings', 'clear'].includes(i.commandName)) return modCommand(i);
  if (!trusted) return i.reply({ content: '❌ للأونر أو القائمة البيضاء فقط.', flags: MessageFlags.Ephemeral });
  if (i.commandName === 'verify-panel') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await shield.postVerifyPanel(i.guild);
    return i.editReply('✅ تم نشر لوحة التحقق.');
  }
  if (i.commandName === 'panic') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await prot.panic(i.guild, i.options.getString('mode') === 'on');
    return i.editReply('✅ تم.');
  }
  if (i.commandName === 'backup') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (i.options.getString('action') === 'create') { await backup.snapshot(i.guild, true); return i.editReply('✅ تم أخذ نسخة.'); }
    const r = await backup.restoreAll(i.guild);
    return i.editReply(`✅ تم استرجاع ${r.roles} رتبة و ${r.channels} روم (الموجود ما ينكرر).`);
  }
  if (i.commandName === 'lockdown') {
    prot.lockdown(i.guild, i.options.getString('mode') === 'on');
    return i.reply({ content: '✅ تم.', flags: MessageFlags.Ephemeral });
  }
  if (i.commandName === 'whitelist') {
    if (!isOwner) return i.reply({ content: '❌ للأونر فقط.', flags: MessageFlags.Ephemeral });
    const wl = G(i.guild.id).whitelist, a = i.options.getString('action'), us = i.options.getUser('user');
    if (a === 'list') return i.reply({ content: wl.length ? wl.map((x) => `<@${x}>`).join('\n') : 'فاضية.', flags: MessageFlags.Ephemeral });
    if (!us) return i.reply({ content: 'حدد العضو.', flags: MessageFlags.Ephemeral });
    if (a === 'add' && !wl.includes(us.id)) wl.push(us.id);
    if (a === 'remove') G(i.guild.id).whitelist = wl.filter((x) => x !== us.id);
    save();
    return i.reply({ content: '✅ تم.', flags: MessageFlags.Ephemeral });
  }
});

// ================= جاهزية =================
const invCache = new Map();
async function cacheInvites(g) {
  try {
    const inv = await g.invites.fetch();
    invCache.set(g.id, new Map(inv.map((x) => [x.code, x.uses])));
  } catch {}
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag}`);
  for (const g of client.guilds.cache.values()) {
    if (!license.isActive(g.id)) { await syncCommands(g); continue; } // غير مفعّل: بس أمر /activate
    await setup(g).catch((e) => console.log('setup fail', g.name, e.message));
    await cacheInvites(g);
    await syncCommands(g);
    await backup.snapshot(g, true).catch(() => {});
    if (!g.members.me.permissions.has(PermissionFlagsBits.Administrator)) {
      const o = await g.fetchOwner().catch(() => null);
      o?.send(`⚠️ البوت في **${g.name}** بدون صلاحية Administrator، الحماية بتكون ناقصة.`).catch(() => {});
    }
  }
  setInterval(() => client.guilds.cache.forEach((g) => license.isActive(g.id) && backup.snapshot(g).catch(() => {})), cfg.backup.intervalMs);
  shield.rearm(client);
  require('./dashboard').start(client, { activateGuild });
});
client.on(Events.GuildCreate, async (g) => {
  if (!license.isActive(g.id)) {
    await syncCommands(g);
    const o = await g.fetchOwner().catch(() => null);
    o?.send(`🔒 تم إضافة البوت إلى **${g.name}**، لكنه غير مفعّل. استخدم \`/activate\` مع رمز التفعيل داخل السيرفر.`).catch(() => {});
    return;
  }
  await activateGuild(g);
});

// ================= الرسائل =================
client.on(Events.MessageCreate, async (m) => {
  if (!m.guild || m.author?.bot && m.author.id === client.user.id) return;
  if (isLogChannel(m.channel)) return;
  // صيد الروابط الاحتيالية أول شي؛ لو تعامل مع الرسالة نوقف
  if (await shield.onMessage(m).catch((e) => { console.error(e); return false; })) return;
  prot.onMessage(m).catch(console.error);
  if (cfg.logAllChat) {
    const att = [...m.attachments.values()].map((a) => a.url).join('\n');
    log(m.guild, 'chat', E('💬 رسالة', C.gray, `${u(m.author)} في <#${m.channelId}>\n${cut(m.content, 3500)}`, [
      att ? ['مرفقات', att] : [], [],
    ].filter((f) => f.length)));
  }
});

client.on(Events.MessageDelete, (m) => {
  if (!m.guild || isLogChannel(m.channel) || m.author?.id === client.user.id) return;
  const att = [...(m.attachments?.values() ?? [])].map((a) => a.url).join('\n');
  log(m.guild, 'messages', E('🗑️ حذف رسالة', C.red, null, [
    ['الكاتب', m.author ? u(m.author) : 'غير معروف (رسالة قديمة)'],
    ['الروم', `<#${m.channelId}>`, true],
    ['المحتوى', m.partial ? 'غير متوفر (غير مخزنة)' : (m.content || '—')],
    att ? ['مرفقات', att] : [],
  ].filter((f) => f.length)));
});

client.on(Events.MessageBulkDelete, (msgs, ch) => {
  if (!ch.guild || isLogChannel(ch)) return;
  const txt = [...msgs.values()].reverse().map((m) =>
    `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag ?? '?'} (${m.author?.id ?? '?'}): ${m.content ?? ''}`).join('\n');
  log(ch.guild, 'messages', E('🧹 حذف جماعي', C.red, `تم حذف **${msgs.size}** رسالة في ${ch}`),
    [new AttachmentBuilder(Buffer.from(txt || 'empty'), { name: 'bulk-delete.txt' })]);
});

client.on(Events.MessageUpdate, async (o, n) => {
  if (!n.guild || n.author?.bot || isLogChannel(n.channel)) return;
  if (o.content === n.content) return;
  // التعديل ما يخلي التوكن يفوت
  if (await shield.onToken(n).catch(() => false)) return;
  log(n.guild, 'messages', E('✏️ تعديل رسالة', C.yellow, `[الذهاب للرسالة](${n.url})`, [
    ['الكاتب', u(n.author)], ['الروم', `<#${n.channelId}>`, true],
    ['قبل', o.partial ? 'غير متوفر' : o.content],
    ['بعد', n.content],
  ]));
});

// ================= الأعضاء =================
client.on(Events.GuildMemberAdd, async (m) => {
  let used = 'غير معروف';
  try {
    const old = invCache.get(m.guild.id) ?? new Map();
    const now = await m.guild.invites.fetch();
    const inv = now.find((x) => x.uses > (old.get(x.code) ?? 0));
    invCache.set(m.guild.id, new Map(now.map((x) => [x.code, x.uses])));
    if (inv) used = `\`${inv.code}\` بواسطة ${inv.inviter ? u(inv.inviter) : '؟'}`;
  } catch {}
  const age = Math.floor((Date.now() - m.user.createdTimestamp) / 864e5);
  log(m.guild, 'members', E('📥 دخول عضو', C.green, u(m.user), [
    ['عمر الحساب', `${age} يوم (<t:${Math.floor(m.user.createdTimestamp / 1000)}:R>)`],
    ['الدعوة', used],
    ['بوت؟', m.user.bot ? 'نعم' : 'لا', true],
  ]));
  prot.onJoin(m).catch(console.error);
  shield.onJoin(m).catch(console.error);
});

client.on(Events.GuildMemberRemove, (m) => {
  log(m.guild, 'members', E('📤 خروج عضو', C.red, u(m.user), [
    ['انضم', m.joinedTimestamp ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : 'غير معروف'],
    ['الرتب', m.roles?.cache.filter((r) => r.id !== m.guild.id).map((r) => r.name).join(', ')],
  ]));
});

client.on(Events.GuildMemberUpdate, (o, n) => {
  if (o.nickname !== n.nickname)
    log(n.guild, 'members', E('📝 تغيير نك نيم', C.yellow, u(n.user), [['قبل', o.nickname], ['بعد', n.nickname]]));
  if (!o.premiumSince && n.premiumSince)
    log(n.guild, 'members', E('💎 بوست', C.blue, u(n.user)));
  if (o.avatar !== n.avatar)
    log(n.guild, 'members', E('🖼️ تغيير صورة السيرفر', C.yellow, u(n.user)));
});

client.on(Events.UserUpdate, (o, n) => {
  const changes = [];
  if (o.username !== n.username) changes.push(['اليوزر', `${o.username} → ${n.username}`]);
  if (o.globalName !== n.globalName) changes.push(['الاسم', `${o.globalName} → ${n.globalName}`]);
  if (o.avatar !== n.avatar) changes.push(['الصورة', 'تغيرت']);
  if (!changes.length) return;
  for (const g of client.guilds.cache.values())
    if (g.members.cache.has(n.id)) log(g, 'members', E('👤 تغيير حساب', C.yellow, u(n), changes));
});

// ================= الصوت =================
client.on(Events.VoiceStateUpdate, (o, n) => {
  const m = n.member; if (!m) return;
  let t = null;
  if (!o.channelId && n.channelId) t = `🟢 دخل ${n.channel}`;
  else if (o.channelId && !n.channelId) t = `🔴 خرج من ${o.channel}`;
  else if (o.channelId !== n.channelId) t = `🔄 انتقل من ${o.channel} إلى ${n.channel}`;
  else if (o.serverMute !== n.serverMute) t = n.serverMute ? '🔇 ميوت سيرفر' : '🔊 فك ميوت سيرفر';
  else if (o.serverDeaf !== n.serverDeaf) t = n.serverDeaf ? '🔕 ديفن سيرفر' : '🔔 فك ديفن سيرفر';
  else if (o.streaming !== n.streaming) t = n.streaming ? '📺 بدأ بث' : '📺 أوقف البث';
  else if (o.selfVideo !== n.selfVideo) t = n.selfVideo ? '📷 فتح كاميرا' : '📷 قفل كاميرا';
  if (t) log(n.guild, 'voice', E('🔊 الصوت', C.blue, `${u(m.user)}\n${t}`));
});

// ================= الثريدات والدعوات =================
client.on(Events.ThreadCreate, (t) => t.guild && log(t.guild, 'channels', E('🧵 إنشاء ثريد', C.green, `${t} (\`${t.id}\`)`)));
client.on(Events.ThreadDelete, (t) => t.guild && log(t.guild, 'channels', E('🧵 حذف ثريد', C.red, `${t.name} (\`${t.id}\`)`)));
client.on(Events.InviteCreate, (i) => { const c = invCache.get(i.guild.id); c?.set(i.code, i.uses ?? 0); });
client.on(Events.InviteDelete, (i) => invCache.get(i.guild.id)?.delete(i.code));

// ================= الأوديت لوق (مين سوى إيش) =================
const TITLES = {
  ChannelCreate: '📁 إنشاء روم', ChannelDelete: '📁 حذف روم', ChannelUpdate: '📁 تعديل روم',
  ChannelOverwriteCreate: '🔐 إضافة صلاحيات روم', ChannelOverwriteUpdate: '🔐 تعديل صلاحيات روم', ChannelOverwriteDelete: '🔐 حذف صلاحيات روم',
  RoleCreate: '🎭 إنشاء رتبة', RoleDelete: '🎭 حذف رتبة', RoleUpdate: '🎭 تعديل رتبة',
  MemberBanAdd: '🔨 باند', MemberBanRemove: '♻️ فك باند', MemberKick: '👢 كيك', MemberPrune: '🧹 برون',
  MemberUpdate: '👤 تعديل عضو (تايم أوت/ميوت/نك)', MemberRoleUpdate: '🎭 تغيير رتب عضو',
  MemberMove: '🔄 نقل عضو صوتياً', MemberDisconnect: '🔌 فصل عضو صوتياً',
  MessageDelete: '🗑️ مشرف حذف رسالة', MessageBulkDelete: '🧹 مشرف حذف جماعي', MessagePin: '📌 تثبيت', MessageUnpin: '📌 إلغاء تثبيت',
  GuildUpdate: '⚙️ تعديل السيرفر', BotAdd: '🤖 إضافة بوت',
  WebhookCreate: '🪝 إنشاء ويب هوك', WebhookUpdate: '🪝 تعديل ويب هوك', WebhookDelete: '🪝 حذف ويب هوك',
  EmojiCreate: '😀 إنشاء إيموجي', EmojiDelete: '😀 حذف إيموجي', EmojiUpdate: '😀 تعديل إيموجي',
  StickerCreate: '🏷️ إنشاء ستكر', StickerDelete: '🏷️ حذف ستكر', StickerUpdate: '🏷️ تعديل ستكر',
  InviteCreate: '🔗 إنشاء دعوة', InviteDelete: '🔗 حذف دعوة', InviteUpdate: '🔗 تعديل دعوة',
};
const RED = /Delete|Ban(Add)?$|Kick|Prune|Disconnect/;

function fmtChange(c) {
  try {
    if (['permissions', 'allow', 'deny'].includes(c.key)) {
      const ob = BigInt(c.old ?? 0), nb = BigInt(c.new ?? 0);
      const add = new PermissionsBitField(nb & ~ob).toArray(), rem = new PermissionsBitField(ob & ~nb).toArray();
      return `**${c.key}**: ${add.length ? '➕ ' + add.join(', ') : ''} ${rem.length ? '➖ ' + rem.join(', ') : ''}`;
    }
    if (c.key === '$add' || c.key === '$remove')
      return `**${c.key === '$add' ? '➕ رتب' : '➖ رتب'}**: ${(c.new ?? []).map((r) => r.name).join(', ')}`;
    const f = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—'));
    return `**${c.key}**: ${cut(f(c.old), 150)} → ${cut(f(c.new), 150)}`;
  } catch { return null; }
}

client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  prot.onAudit(entry, guild).catch(console.error);
  const name = AuditLogEvent[entry.action] ?? String(entry.action);
  if (entry.executor?.id === client.user.id) return;

  let key = 'server';
  if (/^(Channel|Thread|StageInstance)/.test(name)) key = 'channels';
  else if (/^Role/.test(name)) key = 'roles';
  else if (/^(Member|Message)/.test(name)) key = 'moderation';
  else if (/^Invite/.test(name)) key = 'invites';

  const t = entry.target;
  const target = !t ? `\`${entry.targetId}\``
    : t.tag || t.username ? u(t)
    : t.name ? `${t.name} (\`${entry.targetId}\`)` : `\`${entry.targetId}\``;
  const changes = (entry.changes ?? []).map(fmtChange).filter(Boolean).join('\n');
  const extra = entry.extra?.channel ? `<#${entry.extra.channel.id}>` : entry.extra?.count ? `${entry.extra.count}` : null;

  log(guild, key, E(TITLES[name] ?? `📋 ${name}`, RED.test(name) ? C.red : C.orange, null, [
    ['الفاعل', entry.executor ? u(entry.executor) : 'غير معروف'],
    ['الهدف', target],
    entry.reason ? ['السبب', entry.reason] : [],
    extra ? ['تفاصيل', extra, true] : [],
    changes ? ['التغييرات', changes] : [],
  ].filter((f) => f.length)));
});

// إصلاح تلقائي لو أحد حذف روم اللوقات
client.on(Events.ChannelDelete, (ch) => {
  if (!ch.guild || isResetting(ch.guild.id)) return;
  const g = G(ch.guild.id);
  if (ch.id === g.category || Object.values(g.channels).includes(ch.id))
    setTimeout(() => setup(ch.guild).catch(() => {}), 1500);
});

// Ghost Ping
client.on(Events.MessageDelete, (m) => {
  if (!m.guild || m.partial || !m.author || m.author.bot || isLogChannel(m.channel)) return;
  if (!(m.mentions.users.size || m.mentions.roles.size || m.mentions.everyone)) return;
  log(m.guild, 'messages', E('👻 Ghost Ping', C.orange, null, [
    ['الكاتب', u(m.author)], ['الروم', `<#${m.channelId}>`, true], ['المحتوى', m.content],
  ]));
});

process.on('unhandledRejection', (e) => console.error('unhandled:', e));
client.login(process.env.TOKEN);
