const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { G, save, u } = require('./utils');
const L = require('./logs');
const prot = require('./protection');
const backup = require('./backup');
const settings = require('./settings');
const shield = require('./shield');
const { stats } = require('./utils');
const license = require('./license');

// ترتيب الصلاحيات في الداش بورد
const RANK = { viewer: 1, mod: 2, admin: 3, owner: 4 };
const ROLE_NAMES = ['admin', 'mod', 'viewer'];

function readTail(file, bytes = 1500000) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    let t = buf.toString('utf8');
    if (st.size > len) t = t.slice(t.indexOf('\n') + 1);
    return t.split('\n').filter(Boolean);
  } catch { return []; }
}

// صلاحية المستخدم على سيرفر: المالك > الرتبة المعينة > الوايت ليست (تُعامل كأدمن للتوافق)
function levelOf(g, id) {
  if (g.ownerId === id) return 'owner';
  const d = G(g.id);
  if (d.dashRoles?.[id]) return d.dashRoles[id];
  if (d.whitelist.includes(id)) return 'admin';
  return null;
}

// الإجراءات الحساسة: غير المالك يطلب، والمالك يوافق (قاعدة الشخصين)
const SENSITIVE = new Set(['lockdown_off', 'panic_off', 'backup_restore']);

async function runAction(g, t) {
  if (t === 'lockdown_on') prot.lockdown(g, true);
  else if (t === 'lockdown_off') prot.lockdown(g, false);
  else if (t === 'panic_on') await prot.panic(g, true);
  else if (t === 'panic_off') await prot.panic(g, false);
  else if (t === 'backup_create') await backup.snapshot(g, true);
  else if (t === 'backup_restore') { const r = await backup.restoreAll(g); return `استرجاع ${r.roles} رتبة و ${r.channels} روم`; }
  else if (t === 'setup') await L.setup(g);
  else if (t === 'logs_clear') { const n = await L.clearLogs(g); return `تم مسح ${n} رسالة من السجلات`; }
  else throw new Error('bad');
  return 'تم';
}

function start(client, hooks = {}) {
  const secret = process.env.CLIENT_SECRET;
  if (!secret) return console.log('ℹ️ الداش بورد معطل (ما فيه CLIENT_SECRET بملف .env)');

  const clientId = process.env.CLIENT_ID || client.user.id;
  const PORT = Number(process.env.PORT) || 3000;
  const BASE = (process.env.DASH_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const SECURE = BASE.startsWith('https');
  const REDIRECT = BASE + '/callback';

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https://cdn.discordapp.com data:",
    });
    next();
  });

  // ---------- جلسات ----------
  const sessions = new Map();
  const TTL = 7 * 864e5;
  setInterval(() => { const n = Date.now(); for (const [k, s] of sessions) if (s.exp < n) sessions.delete(k); }, 36e5).unref();
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? null : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(Boolean));
  const setCookie = (res, n, v, age) =>
    res.append('Set-Cookie', `${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${SECURE ? '; Secure' : ''}`);

  // ---------- تسجيل الدخول ----------
  app.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', state, 600);
    res.redirect('https://discord.com/oauth2/authorize?' + new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify guilds', state,
    }));
  });

  app.get('/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state || state !== cookies(req).oauth_state) throw new Error('state');
      const tr = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: String(code), redirect_uri: REDIRECT }),
      });
      const tok = await tr.json();
      if (!tok.access_token) throw new Error('token');
      const me = await (await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
      if (!me.id) throw new Error('user');
      const sid = crypto.randomBytes(32).toString('hex');
      const gl = await (await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json().catch(() => []);
      const guildsList = Array.isArray(gl) ? gl.map((x) => ({ id: x.id, name: x.name, icon: x.icon, perms: x.permissions })) : [];
      sessions.set(sid, { user: { id: me.id, username: me.global_name || me.username }, guildsList, csrf: crypto.randomBytes(16).toString('hex'), exp: Date.now() + TTL });
      setCookie(res, 'sid', sid, TTL / 1000);
      res.redirect('/');
    } catch { res.status(400).send('فشل تسجيل الدخول، ارجع جرب مرة ثانية.'); }
  });

  app.get('/logout', (req, res) => {
    sessions.delete(cookies(req).sid);
    setCookie(res, 'sid', '', 0);
    res.redirect('/');
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // ---------- API ----------
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const sid = cookies(req).sid, s = sid && sessions.get(sid);
    if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'auth' });
    if (req.method !== 'GET' && req.headers['x-csrf'] !== s.csrf) return res.status(403).json({ error: 'csrf' });
    req.s = s;
    next();
  });

  api.get('/me', (req, res) => {
    const uid = req.s.user.id;
    res.json({
      user: req.s.user, csrf: req.s.csrf,
      guilds: client.guilds.cache.filter((g) => levelOf(g, uid)).map((g) => ({ id: g.id, name: g.name, owner: g.ownerId === uid, role: levelOf(g, uid), active: license.isActive(g.id) })),
    });
  });

  // الصفحة الرئيسية: إحصائيات + السيرفرات المتصلة + السيرفرات اللي تقدر تضيف البوت لها
  api.get('/home', (req, res) => {
    const uid = req.s.user.id;
    const connected = client.guilds.cache.filter((g) => levelOf(g, uid)).map((g) => ({
      id: g.id, name: g.name, members: g.memberCount, active: license.isActive(g.id),
      icon: g.iconURL({ size: 128 }),
    }));
    const addable = (req.s.guildsList || [])
      .filter((x) => (BigInt(x.perms || 0) & 0x28n) && !client.guilds.cache.has(x.id)) // Administrator أو Manage Server
      .map((x) => ({
        id: x.id, name: x.name,
        icon: x.icon ? `https://cdn.discordapp.com/icons/${x.id}/${x.icon}.png?size=128` : null,
        invite: 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
          client_id: client.user.id, scope: 'bot applications.commands', permissions: '8', guild_id: x.id, disable_guild_select: 'true',
        }),
      }));
    res.json({
      stats: { servers: client.guilds.cache.size, backups: stats.backups, operations: stats.ops },
      connected, addable,
    });
  });

  api.use('/g/:gid', (req, res, next) => {
    const g = client.guilds.cache.get(req.params.gid);
    const level = g && levelOf(g, req.s.user.id);
    if (!level) return res.status(403).json({ error: 'forbidden' });
    req.g = g;
    req.level = level;
    req.isOwner = level === 'owner';
    // السيرفر غير المفعّل: بس صفحة التفعيل تشتغل
    if (!license.isActive(g.id) && req.path !== '/license') return res.status(402).json({ error: 'البوت غير مفعّل لهذا السيرفر' });
    next();
  });

  // حارس الصلاحية: يرفض لو الرتبة أقل من المطلوب
  const need = (lvl) => (req, res, next) =>
    RANK[req.level] >= RANK[lvl] ? next() : res.status(403).json({ error: 'ما عندك صلاحية لهذا' });
  const ownerOnly = need('owner');

  const audit = (req, text) =>
    L.log(req.g, 'moderation', L.E('🖥️ داش بورد', L.C.blue, `${u(req.s.user)}\n${text}`));

  api.get('/g/:gid/overview', need('viewer'), (req, res) => {
    const g = req.g;
    let last = null;
    try { last = fs.statSync(path.join(__dirname, 'backups', g.id + '.json')).mtimeMs; } catch {}
    res.json({
      name: g.name, members: g.memberCount, channels: g.channels.cache.size, roles: g.roles.cache.size,
      locked: prot.isLocked(g.id), panic: G(g.id).panic.length > 0, lastBackup: last,
      whitelist: G(g.id).whitelist.length, ping: client.ws.ping, uptime: process.uptime(), role: req.level,
    });
  });

  api.get('/g/:gid/logs', need('viewer'), (req, res) => {
    const key = String(req.query.key || ''), q = String(req.query.q || '').toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const lines = readTail(path.join(__dirname, 'logs', req.g.id + '.log'));
    const items = [];
    for (let i = lines.length - 1; i >= 0 && items.length < limit; i--) {
      const m = /^\[([^\]]+)\] \[(\w+)\] (.*)$/.exec(lines[i]);
      if (!m || (key && m[2] !== key) || (q && !lines[i].toLowerCase().includes(q))) continue;
      const p = m[3].split(' | ');
      items.push({ t: m[1], key: m[2], title: p[0], desc: p[1] ?? '', fields: p.slice(2).join(' | ') });
    }
    res.json({ items });
  });

  api.get('/g/:gid/settings', need('viewer'), (req, res) => res.json(settings.describe()));
  api.post('/g/:gid/settings', need('admin'), (req, res) => {
    const r = settings.apply(req.body?.changes);
    if (r.errors) return res.status(400).json(r);
    audit(req, `تعديل إعدادات الحماية:\n${r.changed.map((x) => `\`${x}\``).join(', ')}`);
    res.json({ ok: true });
  });

  const name = (id) => client.users.fetch(id).then((x) => x.globalName || x.username).catch(() => '؟');

  api.get('/g/:gid/whitelist', need('viewer'), async (req, res) => {
    const g = req.g, d = G(g.id);
    res.json({
      canEdit: req.isOwner,
      owner: { id: g.ownerId, name: await name(g.ownerId) },
      list: await Promise.all(d.whitelist.map(async (id) => ({ id, name: await name(id), role: d.dashRoles?.[id] || 'admin' }))),
    });
  });
  api.post('/g/:gid/whitelist', ownerOnly, async (req, res) => {
    const { action, id } = req.body || {};
    if (!/^\d{17,20}$/.test(String(id))) return res.status(400).json({ error: 'ايدي غير صحيح' });
    const d = G(req.g.id);
    if (action === 'add') {
      if (!(await client.users.fetch(id).catch(() => null))) return res.status(400).json({ error: 'المستخدم غير موجود' });
      if (!d.whitelist.includes(id)) d.whitelist.push(id);
    } else if (action === 'remove') {
      d.whitelist = d.whitelist.filter((x) => x !== id);
      if (d.dashRoles) delete d.dashRoles[id];
    } else return res.status(400).json({ error: 'bad' });
    save();
    audit(req, `وايت ليست ${action === 'add' ? 'إضافة' : 'إزالة'}: <@${id}>`);
    res.json({ ok: true });
  });

  // رتب الداش بورد: أدمن / مشرف / مشاهد (المالك بس يعيّن)
  api.post('/g/:gid/roles', ownerOnly, (req, res) => {
    const { id, role } = req.body || {};
    if (!/^\d{17,20}$/.test(String(id))) return res.status(400).json({ error: 'ايدي غير صحيح' });
    if (role !== 'none' && !ROLE_NAMES.includes(role)) return res.status(400).json({ error: 'رتبة غير صحيحة' });
    const d = G(req.g.id);
    if (id === req.g.ownerId) return res.status(400).json({ error: 'رتبة المالك ثابتة' });
    if (role === 'none' || !d.whitelist.includes(id)) {
      if (d.dashRoles) delete d.dashRoles[id];
    } else {
      d.dashRoles ||= {};
      d.dashRoles[id] = role;
    }
    save();
    audit(req, `تغيير رتبة داش بورد <@${id}> إلى \`${role}\``);
    res.json({ ok: true });
  });

  api.get('/g/:gid/license', need('viewer'), (req, res) => {
    res.json({ canEdit: req.isOwner, ...license.status(req.g.id) });
  });
  api.post('/g/:gid/license', ownerOnly, async (req, res) => {
    const r = license.redeem(req.g.id, String(req.body?.key || ''), req.s.user.id);
    if (!r.ok) return res.status(400).json({ error: r.msg });
    audit(req, `تفعيل البوت برمز`);
    if (hooks.activateGuild) await hooks.activateGuild(req.g).catch(() => {});
    res.json({ ok: true, msg: r.msg, expiresAt: r.expiresAt });
  });

  api.get('/g/:gid/tickets', need('viewer'), (req, res) => res.json(shield.ticketsOf(req.g)));

  api.get('/g/:gid/bots', need('viewer'), (req, res) => res.json({ canEdit: req.isOwner, ...shield.botsOf(req.g) }));
  api.post('/g/:gid/bots', ownerOnly, (req, res) => {
    const { action, id } = req.body || {};
    if (!/^\d{17,20}$/.test(String(id))) return res.status(400).json({ error: 'ايدي غير صحيح' });
    if (!['approve', 'deny', 'revoke'].includes(action)) return res.status(400).json({ error: 'bad' });
    shield.botDecision(req.g, String(id), action);
    audit(req, `البوتات: ${action} \`${id}\``);
    res.json({ ok: true });
  });

  api.get('/g/:gid/transcript/:cid', need('viewer'), (req, res) => {
    const cid = String(req.params.cid);
    if (!/^\d{5,25}$/.test(cid)) return res.status(400).json({ error: 'bad id' });
    const f = path.join(__dirname, 'tickets', req.g.id, cid + '.txt');
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'not found' });
    res.type('text/plain; charset=utf-8').send(fs.readFileSync(f, 'utf8'));
  });

  api.get('/g/:gid/warns', need('viewer'), async (req, res) => {
    const w = G(req.g.id).warns;
    res.json({
      list: await Promise.all(Object.entries(w).filter(([, a]) => a.length).map(async ([id, a]) => ({
        id, name: await name(id), warns: a,
      }))),
    });
  });
  api.post('/g/:gid/warns/clear', need('mod'), (req, res) => {
    const id = String(req.body?.userId || '');
    delete G(req.g.id).warns[id];
    save();
    audit(req, `مسح تحذيرات <@${id}>`);
    res.json({ ok: true });
  });

  api.post('/g/:gid/action', async (req, res) => {
    const t = req.body?.type, g = req.g;
    try {
      if (t === 'logs_clear' && !req.isOwner) return res.status(403).json({ error: 'مسح السجلات للمالك فقط' });
      if (RANK[req.level] < RANK.admin) return res.status(403).json({ error: 'ما عندك صلاحية لهذا' });
      if (SENSITIVE.has(t) && !req.isOwner) {
        const d = G(g.id);
        d.approvals ||= {};
        const id = crypto.randomBytes(6).toString('hex');
        d.approvals[id] = { type: t, by: req.s.user.id, byName: req.s.user.username, t: Date.now() };
        save();
        audit(req, `طلب موافقة على \`${t}\``);
        return res.status(202).json({ pending: true, msg: 'الطلب بانتظار موافقة المالك' });
      }
      const msg = await runAction(g, t);
      audit(req, `إجراء: \`${t}\``);
      res.json({ ok: true, msg });
    } catch (e) { res.status(e.message === 'bad' ? 400 : 500).json({ error: e.message }); }
  });

  api.get('/g/:gid/approvals', need('viewer'), (req, res) => {
    const list = Object.entries(G(req.g.id).approvals || {}).map(([id, a]) => ({ id, ...a }));
    res.json({ canEdit: req.isOwner, list });
  });

  api.post('/g/:gid/approvals', ownerOnly, async (req, res) => {
    const { id, decision } = req.body || {};
    const d = G(req.g.id), a = d.approvals?.[String(id)];
    if (!a) return res.status(404).json({ error: 'الطلب ما لقيناه' });
    delete d.approvals[String(id)];
    save();
    if (decision !== 'approve') {
      audit(req, `رفض طلب \`${a.type}\` من ${a.byName}`);
      return res.json({ ok: true, msg: 'تم الرفض' });
    }
    try {
      const msg = await runAction(req.g, a.type);
      audit(req, `وافق على طلب \`${a.type}\` من ${a.byName}`);
      res.json({ ok: true, msg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.use('/api', api);
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`🖥️ الداش بورد: ${BASE}`))
    .on('error', (e) => console.log('dashboard error:', e.message));
}

module.exports = { start };
