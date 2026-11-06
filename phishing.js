// كشف الروابط الاحتيالية (Phishing) — دالة نقية بدون discord.js عشان تنختبر لوحدها.

const BAIT = /(free\s*nitro|nitro\s*gift|claim\s*(your|now|reward)|airdrop|steam\s*gift|verify\s*(your\s*)?account|مجان[يا]?\s*(نيترو|نايترو)|استلم\s*(هديتك|جايزتك)|تحقق\s*من\s*حسابك)/i;

// أسماء خدمات معروفة كثير ينتحلها الصيادين (بنطابقها على الاسم الأساسي للدومين)
const BRANDS = ['discord', 'nitro', 'steam', 'roblox', 'binance', 'metamask', 'paypal'];

const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
};
const matchesDomain = (host, dom) => host === dom || host.endsWith('.' + dom);
const labelOf = (host) => host.split('.').slice(0, -1).join('.') || host;

// يرجع { score, level: null|'medium'|'high', reasons: [] }
function analyze(content, cfg) {
  const text = String(content ?? '');
  const reasons = [];
  let score = 0;

  const urls = text.match(/https?:\/\/[^\s<>]+/gi) ?? [];
  const hosts = urls.map(hostOf).filter(Boolean);

  for (const h of hosts) {
    if (cfg.shorteners.some((d) => matchesDomain(h, d))) { score += 2; reasons.push(`رابط مختصر (${h})`); }
    if (h.includes('xn--')) { score += 3; reasons.push(`دومين بحروف مزيفة (${h})`); }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) { score += 3; reasons.push('رابط IP مباشر'); }

    const tld = h.split('.').pop();
    if (cfg.suspiciousTlds.includes(tld)) { score += 2; reasons.push(`امتداد مشبوه (.${tld})`); }

    const official = cfg.officialDomains.some((d) => matchesDomain(h, d));
    const label = labelOf(h);
    if (!official && BRANDS.some((b) => label.includes(b))) {
      score += 3; reasons.push(`دومين يقلد خدمة معروفة (${h})`);
    }
  }

  if (hosts.length && BAIT.test(text)) { score += 2; reasons.push('كلام طُعم مع رابط'); }
  if (hosts.length && /@(everyone|here)/.test(text)) { score += 2; reasons.push('@everyone مع رابط'); }

  const level = score >= 5 ? 'high' : score >= 3 ? 'medium' : null;
  return { score, level, reasons };
}

module.exports = { analyze };
