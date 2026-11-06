const { PermissionFlagsBits: P } = require('discord.js');

module.exports = {
  logCategoryName: '📜・السجلات',

  // اسم كل روم لوق (يتم إنشاؤها تلقائياً)
  channels: {
    chat: '💬・الشات',
    messages: '📝・الرسائل',
    members: '👥・الأعضاء',
    voice: '🔊・الصوت',
    channels: '📁・الرومات',
    roles: '🎭・الرتب',
    server: '⚙️・السيرفر',
    moderation: '🔨・الإدارة',
    invites: '🔗・الدعوات',
    protection: '🛡️・الحماية',
    tickets: '🎫・سجل-التذاكر',
  },

  logAllChat: false, // تسجيل كل رسالة تنكتب في روم الشات (يسبب ضوضاء، مطفي افتراضياً)

  // أي فئات سجل تنكتب (الحماية دايماً تنكتب)
  logs: {
    chat: false, messages: true, members: true, voice: true, channels: true,
    roles: true, server: true, moderation: true, invites: true,
  },

  // العقوبة على اللي يخرب: 'ban' | 'kick' | 'strip' (سحب كل رتبه فقط)
  punishment: 'ban',

  // الصلاحيات الخطيرة (أي رتبة تنعطى وحدة منها من غير مصرح تنسحب)
  dangerousPerms: [
    P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels,
    P.BanMembers, P.KickMembers, P.ManageWebhooks, P.MentionEveryone,
  ],

  // Anti-Nuke: كم مرة يسوي الفعل خلال المدة (ms) قبل العقوبة
  nuke: {
    ChannelDelete: { limit: 2, window: 15000 },
    ChannelCreate: { limit: 4, window: 15000 },
    RoleDelete:    { limit: 2, window: 15000 },
    RoleCreate:    { limit: 4, window: 15000 },
    MemberBanAdd:  { limit: 3, window: 15000 },
    MemberKick:    { limit: 3, window: 15000 },
    MemberPrune:   { limit: 1, window: 60000 },
    WebhookCreate: { limit: 2, window: 15000 },
    EmojiDelete:   { limit: 3, window: 15000 },
  },

  // Anti-Raid
  raid: {
    limit: 6,                 // عدد الداخلين
    window: 10000,            // خلال كم ms
    lockdownMs: 10 * 60000,   // مدة القفل
    minAccountAgeDays: 3,     // أقل عمر حساب (0 للتعطيل)
  },

  // Anti-Spam
  spam: {
    window: 5000,
    maxMessages: 6,
    maxDuplicates: 3,
    maxMentions: 5,
    blockInvites: true,
    timeoutMs: 10 * 60000,
  },

  // حذف أي ويب هوك ينشئه شخص مو بالقائمة البيضاء
  deleteWebhooks: true,

  // فلاتر الشات (حذف + تنبيه)
  filters: {
    badWords: [],            // ['كلمة1', 'كلمة2']
    maxCapsRatio: 0.7,
    minCapsLength: 15,
    blockLinks: false,
    linkWhitelist: ['tenor.com', 'giphy.com', 'youtube.com', 'youtu.be'],
    maxEmojis: 12,
  },

  // النسخ الاحتياطي والاسترجاع التلقائي
  backup: { intervalMs: 10 * 60000, restoreOnDelete: true },

  // نظام التحذيرات
  warns: { timeoutAt: 3, timeoutMs: 60 * 60000, kickAt: 5 },

  // طبقة الدرع: كشف الصيد + التحقق + التكتات
  shield: {
    phishing: {
      enabled: true,
      banOnHigh: true,              // العالي = باند، المتوسط = حذف + تنبيه فقط
      shorteners: ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'ow.ly'],
      suspiciousTlds: ['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'click', 'loan'],
      officialDomains: [
        'discord.com', 'discord.gg', 'discordapp.com', 'discord.media',
        'steamcommunity.com', 'steampowered.com', 'roblox.com', 'binance.com', 'paypal.com',
        'youtube.com', 'youtu.be', 'tenor.com', 'giphy.com',
      ],
    },
    token: { ban: true },            // الرسالة اللي فيها توكن تنحذف، وكاتبها ينباند (وإلا تايم أوت)
    verify: { enabled: false, timeoutMs: 30 * 60000 }, // يطرد الداخل اللي ما ضغط زر التحقق
    tickets: { enabled: true, maxOpen: 3, category: '🎫・التذاكر' },
  },
};
