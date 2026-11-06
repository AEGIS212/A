const fs = require('fs');
const path = require('path');
const { G } = require('./utils');

const DIR = path.join(__dirname, 'backups');
fs.mkdirSync(DIR, { recursive: true });
const FILE = (id) => path.join(DIR, id + '.json');

const idMap = new Map();   // الايدي القديم -> الجديد بعد الاسترجاع
const frozen = new Map();  // نوقف النسخ وقت الهجوم عشان ما نحفظ وضع مخرب

const freeze = (gid, ms = 15 * 60000) => frozen.set(gid, Date.now() + ms);
const isFrozen = (gid) => (frozen.get(gid) ?? 0) > Date.now();
const load = (gid) => { try { return JSON.parse(fs.readFileSync(FILE(gid), 'utf8')); } catch { return null; } };

async function snapshot(guild, force = false) {
  if (!force && isFrozen(guild.id)) return false;
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => {});
  const gd = G(guild.id);
  const logIds = new Set([gd.category, ...Object.values(gd.channels)]);

  const roles = guild.roles.cache.filter((r) => !r.managed && r.id !== guild.id).map((r) => ({
    id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
    permissions: r.permissions.bitfield.toString(), position: r.position,
    members: r.members.map((m) => m.id),
  }));

  const channels = guild.channels.cache
    .filter((c) => !logIds.has(c.id) && !logIds.has(c.parentId))
    .map((c) => ({
      id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition,
      topic: c.topic ?? null, nsfw: c.nsfw ?? false, userLimit: c.userLimit ?? 0,
      rateLimitPerUser: c.rateLimitPerUser ?? 0,
      overwrites: (c.permissionOverwrites?.cache ?? new Map()).map((o) => ({
        id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString(),
      })),
    }));

  if (fs.existsSync(FILE(guild.id))) fs.copyFileSync(FILE(guild.id), FILE(guild.id) + '.prev');
  fs.writeFileSync(FILE(guild.id), JSON.stringify({ t: Date.now(), roles, channels }));
  require('./utils').stats.backups++;
  return true;
}

async function restoreRole(guild, oldId) {
  const snap = load(guild.id);
  const r = snap?.roles.find((x) => x.id === oldId);
  const mapped = idMap.get(oldId);
  if (!r || guild.roles.cache.has(oldId) || (mapped && guild.roles.cache.has(mapped))) return null;

  const role = await guild.roles.create({
    name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
    permissions: BigInt(r.permissions), reason: 'Protection: restore',
  });
  idMap.set(oldId, role.id);
  role.setPosition(r.position).catch(() => {});

  for (const mid of r.members.slice(0, 500)) {
    const m = guild.members.cache.get(mid) ?? (await guild.members.fetch(mid).catch(() => null));
    await m?.roles.add(role).catch(() => {});
  }
  for (const c of snap.channels) {
    const o = c.overwrites.find((x) => x.id === oldId);
    const ch = guild.channels.cache.get(idMap.get(c.id) ?? c.id);
    if (!o || !ch) continue;
    await ch.permissionOverwrites.set([
      ...ch.permissionOverwrites.cache.values(),
      { id: role.id, type: 0, allow: BigInt(o.allow), deny: BigInt(o.deny) },
    ]).catch(() => {});
  }
  return role;
}

async function restoreChannel(guild, oldId) {
  const snap = load(guild.id);
  const c = snap?.channels.find((x) => x.id === oldId);
  const mapped = idMap.get(oldId);
  if (!c || guild.channels.cache.has(oldId) || (mapped && guild.channels.cache.has(mapped))) return null;

  const overwrites = c.overwrites
    .map((o) => ({ ...o, id: idMap.get(o.id) ?? o.id }))
    .filter((o) => o.type !== 0 || o.id === guild.id || guild.roles.cache.has(o.id))
    .map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));

  const parentId = idMap.get(c.parentId) ?? c.parentId;
  const base = {
    name: c.name, type: c.type,
    parent: parentId && guild.channels.cache.has(parentId) ? parentId : null,
    reason: 'Protection: restore',
  };
  if (c.type === 0 || c.type === 5) Object.assign(base, { topic: c.topic ?? undefined, nsfw: c.nsfw, rateLimitPerUser: c.rateLimitPerUser });
  if (c.type === 2 || c.type === 13) Object.assign(base, { userLimit: c.userLimit });

  let ch;
  try { ch = await guild.channels.create({ ...base, permissionOverwrites: overwrites }); }
  catch { ch = await guild.channels.create(base).catch(() => null); }
  if (!ch) return null;

  idMap.set(oldId, ch.id);
  ch.setPosition(c.position).catch(() => {});
  if (c.type === 4) {
    for (const k of snap.channels.filter((x) => x.parentId === oldId)) {
      await guild.channels.cache.get(k.id)?.setParent(ch.id).catch(() => {});
    }
  }
  return ch;
}

async function restoreAll(guild) {
  const snap = load(guild.id);
  if (!snap) return { roles: 0, channels: 0 };
  let roles = 0, channels = 0;
  for (const r of snap.roles) if (await restoreRole(guild, r.id).catch(() => null)) roles++;
  const ordered = [...snap.channels].sort((a, b) => (a.type === 4 ? 0 : 1) - (b.type === 4 ? 0 : 1));
  for (const c of ordered) if (await restoreChannel(guild, c.id).catch(() => null)) channels++;
  return { roles, channels };
}

module.exports = { snapshot, restoreRole, restoreChannel, restoreAll, freeze };
