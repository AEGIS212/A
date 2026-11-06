(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = (s) => s.replace(/ ⏎ /g, '<br>').replace(/ ; /g, '<br>');
  const app = $('#app');

  const LV = { owner: 'مالك', admin: 'أدمن', mod: 'مشرف', viewer: 'مشاهد' };
  const RL = { admin: 'أدمن', mod: 'مشرف', viewer: 'مشاهد' };
  // معايير الأمان السبعة (تنحسب من الإعدادات)
  const SEC = [
    ['shield.phishing.enabled', 'كشف الروابط الاحتيالية'],
    ['shield.token.ban', 'حماية التوكنات'],
    ['deleteWebhooks', 'حذف الويب هوك غير المصرح'],
    ['spam.blockInvites', 'منع روابط الدعوات'],
    ['backup.restoreOnDelete', 'استرجاع المحذوف تلقائياً'],
    ['shield.verify.enabled', 'نظام التحقق'],
    ['shield.tickets.enabled', 'نظام التكتات'],
  ];
  const AUDIT_KEYS = ['', 'chat', 'messages', 'members', 'voice', 'channels', 'roles', 'server', 'moderation', 'invites', 'protection'];
  const JUMP = [
    ['security', 'الأمان'], ['stats', 'الإحصائيات'], ['audit', 'السجلات'], ['protect', 'الحماية'],
    ['backup', 'النسخ'], ['roles', 'الرتب'], ['warns', 'التحذيرات'], ['tickets', 'التكتات'],
    ['bots', 'البوتات'], ['control', 'الطوارئ'],
  ];
  const SECTIONS = ['hero', 'license', 'security', 'stats', 'audit', 'protect', 'backup', 'roles', 'warns', 'tickets', 'bots', 'control'];

  let csrf = '', gid = null, guilds = [], cur = null, timer = null, me = null;

  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function api(p, o = {}) {
    const r = await fetch('/api' + p, {
      method: o.method || 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf': csrf },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); throw new Error('auth'); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'خطأ'), { data: j });
    return j;
  }
  const post = (p, body) => api(p, { method: 'POST', body });

  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'الآن';
    return m < 60 ? `قبل ${m} د` : `قبل ${Math.round(m / 60)} س`;
  };
  const head = (t, extra = '') => `<div class="sh-row"><h2 class="sh">${t}</h2>${extra}</div>`;
  const empty = (t) => `<div class="card muted">${t}</div>`;
  const logList = (items) => items.map((i) => `<div class="log"><div class="lh"><span class="tag">${esc(i.key)}</span><b>${esc(i.title)}</b><time>${new Date(i.t).toLocaleString('en-GB')}</time></div>
    <div>${br(esc(i.desc))}</div><small>${br(esc(i.fields))}</small></div>`).join('');

  function showLogin() {
    app.innerHTML = `<div class="card login"><div class="logo big">🛡️</div><h1>Guardian</h1>
      <p class="muted">سجل دخولك بحساب ديسكورد.<br>الدخول للأونر والقائمة البيضاء فقط.</p>
      <a class="btn" href="/login">تسجيل الدخول بديسكورد</a></div>`;
  }

  async function init() {
    try { const d = await api('/me'); csrf = d.csrf; guilds = d.guilds; me = d.user; } catch { return showLogin(); }
    if (!guilds.length) { app.innerHTML = `<div class="card">ما عندك صلاحية بأي سيرفر فيه البوت.<br><a href="/logout">خروج</a></div>`; return; }
    shell();
    window.addEventListener('hashchange', route);
    route();
  }

  // التوجيه: #/ = الرئيسية، #/g/<id> = إدارة سيرفر
  function route() {
    clearInterval(timer);
    const m = location.hash.match(/^#\/g\/(\d+)/);
    if (m && guilds.find((g) => g.id === m[1])) {
      gid = m[1];
      localStorage.setItem('gid', gid);
      return guildView();
    }
    return home();
  }

  async function home() {
    $('#main').innerHTML = '<div class="card skel">جاري التحميل...</div>';
    const d = await api('/home');
    const av = (g) => (g.icon ? `<img src="${esc(g.icon)}" alt="">` : `<span>${esc((g.name || '?').trim().charAt(0))}</span>`);
    $('#main').innerHTML = `
      <section class="welcome">
        <span class="pill purple">لوحة التحكم المركزية</span>
        <h1>أهلاً بك في <span class="grad">Guardian</span></h1>
        <p class="muted">تحكم بحماية وإدارة سيرفراتك من مكان واحد بأحدث تقنيات الأمان الفورية.</p>
      </section>
      <div class="stats3">
        ${[['🖥️', 'السيرفرات المحمية', d.stats.servers], ['💾', 'النسخ الاحتياطية', d.stats.backups], ['🛡️', 'عمليات الحماية', d.stats.operations]]
          .map(([i, l, v]) => `<div class="big-stat"><span class="ico">${i}</span><div><small>${l}</small><b>${Number(v).toLocaleString('en-GB')}</b></div></div>`).join('')}
      </div>
      ${head('🛡️ السيرفرات المتصلة', `<span class="pill purple">${d.connected.length} سيرفر</span>`)}
      <div class="cards">${d.connected.map((g) => `<div class="scard"><div class="av">${av(g)}</div><b>${esc(g.name)}</b>
        <span class="muted">${g.members} عضو</span><span class="pill ${g.active ? 'green' : 'red'}">${g.active ? 'مفعّل' : 'غير مفعّل'}</span>
        <a class="btn wide" href="#/g/${esc(g.id)}">⚙️ إدارة السيرفر</a></div>`).join('') || empty('ما فيه سيرفرات متصلة.')}</div>
      ${head('＋ سيرفرات يمكنك إضافة البوت إليها', `<span class="pill">${d.addable.length} سيرفر</span>`)}
      <div class="cards">${d.addable.map((g) => `<div class="scard dashed"><div class="av">${av(g)}</div><b>${esc(g.name)}</b>
        <a class="btn wide ghost-btn" href="${esc(g.invite)}" target="_blank" rel="noopener">＋ إضافة البوت</a></div>`).join('') || empty('ما فيه سيرفرات جديدة. إذا أضفت سيرفر للتو، سجّل دخول من جديد.')}</div>`;
  }

  function guildView() {
    cur = guilds.find((g) => g.id === gid);
    $('#main').innerHTML = `<a class="back" href="#/">→ الرئيسية</a>
      <nav class="jump">${JUMP.map(([id, l]) => `<a class="jl" data-j="${id}">${l}</a>`).join('')}</nav>
      ${SECTIONS.map((id) => `<section id="s-${id}" class="sec"></section>`).join('')}`;
    $$('#main .jl').forEach((b) => (b.onclick = () => $('#s-' + b.dataset.j)?.scrollIntoView({ behavior: 'smooth' })));
    load();
  }

  function shell() {
    app.innerHTML = `
      <header class="top">
        <a class="brand" href="#/"><span class="logo">🛡️</span><span>Guardian</span></a>
        <div class="top-r">
          <a class="ghost" href="#/">🏠 الرئيسية</a>
          <span class="u">${esc(me?.username || '')}</span>
          <a class="ghost" href="/logout">تسجيل الخروج</a>
        </div>
      </header>
      <div id="main"></div>`;
  }

  async function section(id, fn) {
    try { await fn(); } catch (e) {
      if (e.message !== 'auth') $('#s-' + id).innerHTML = `<div class="card bad">خطأ: ${esc(e.message)}</div>`;
    }
  }

  // تحميل كل الأقسام. السيرفر غير المفعّل: بس التفعيل
  async function load() {
    clearInterval(timer);
    cur = guilds.find((g) => g.id === gid);
    $$('#main .sec').forEach((s) => (s.innerHTML = ''));
    await section('license', renderLicense);
    if (!cur.active) {
      renderHero({ name: cur.name, roles: '—', channels: '—', role: cur.role });
      return;
    }
    await section('hero', async () => {
      const ov = await api(`/g/${gid}/overview`);
      renderHero(ov);
      renderStats(ov);
      renderBackup(ov);
    });
    await Promise.all([
      section('security', renderSettings),
      section('audit', renderAudit),
      section('roles', renderRoles),
      section('warns', renderWarns),
      section('tickets', renderTickets),
      section('bots', renderBots),
      section('control', renderControl),
    ]);
  }

  // ---------- الهيرو والإحصائيات ----------
  function renderHero(d) {
    const g = cur;
    $('#s-hero').innerHTML = `<div class="hero">
      <div class="avatar">${esc((d.name || '?').trim().charAt(0) || '?')}</div>
      <div class="hero-t">
        <h1>${esc(d.name)}</h1>
        <p class="muted">${esc(d.roles)} رتبة | ${esc(d.channels)} قناة · دورك: ${esc(LV[d.role] || d.role)}</p>
      </div>
      <div class="pills">
        <span class="pill ${g.active ? 'green' : 'red'}">${g.active ? 'البوت مفعّل' : 'البوت غير مفعّل'}</span>
        ${d.locked ? '<span class="pill red">🔒 لوك داون</span>' : ''}
        ${d.panic ? '<span class="pill red">🚨 وضع الطوارئ</span>' : ''}
      </div>
    </div>`;
  }

  function renderStats(d) {
    const up = `${Math.floor(d.uptime / 3600)}س ${Math.floor((d.uptime % 3600) / 60)}د`;
    const items = [
      ['👥', 'الأعضاء', d.members], ['📁', 'الرومات', d.channels], ['🎭', 'الرتب', d.roles], ['✅', 'الوايت ليست', d.whitelist],
      ['🔒', 'لوك داون', d.locked ? 'مفعّل' : 'لا'], ['🚨', 'الطوارئ', d.panic ? 'مفعّل' : 'لا'],
      ['💾', 'آخر نسخة', d.lastBackup ? ago(d.lastBackup) : 'لا يوجد'], ['📡', 'البنق', d.ping + 'ms'], ['⏱️', 'التشغيل', up],
    ];
    $('#s-stats').innerHTML = `<div class="grid">${items.map(([i, l, v]) => `<div class="stat"><small>${i} ${l}</small><b>${esc(v)}</b></div>`).join('')}</div>`;
  }

  // ---------- التفعيل ----------
  async function renderLicense() {
    const d = await api(`/g/${gid}/license`);
    const exp = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString('en-GB') : 'دائم';
    $('#s-license').innerHTML = `<div class="card lic ${d.active ? '' : 'warn'}">
      <div>
        <h2>${d.active ? '✅ البوت مفعّل لهذا السيرفر' : '🔒 البوت غير مفعّل لهذا السيرفر'}</h2>
        <p class="muted">${d.active ? 'ينتهي التفعيل: ' + esc(exp) : 'أدخل رمز التفعيل اللي عطاك إياه المطور.'}</p>
      </div>
      ${d.canEdit
        ? `<div class="bar"><input id="lk" dir="ltr" placeholder="GRD-XXXX-XXXX-XXXX-XXXX"><button class="btn" id="lb">تفعيل</button></div>`
        : '<p class="muted">التفعيل للأونر فقط.</p>'}
    </div>`;
    const b = $('#lb');
    if (b) b.onclick = async () => {
      try {
        const r = await post(`/g/${gid}/license`, { key: $('#lk').value.trim() });
        toast(r.msg);
        setTimeout(() => location.reload(), 800);
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---------- الأمان والإعدادات ----------
  function renderSecurity(values) {
    const on = SEC.filter(([p]) => values[p]).length;
    const pct = Math.round((on / SEC.length) * 100);
    const C = 2 * Math.PI * 44;
    const lvl = on >= 6 ? ['قوي', 'green'] : on >= 4 ? ['متوسط', 'amber'] : ['ضعيف · يحتاج تدعيم فوري', 'red'];
    $('#s-security').innerHTML = `<div class="sec-card">
      <div class="sec-l">
        <div class="sec-title">
          <span>🛡️</span>
          <h2>مستوى أمان ${lvl[0]}</h2>
          <span class="pill ${lvl[1]}">${on} / ${SEC.length} مكتمل</span>
        </div>
        <p>سيرفرك يفتقر لطبقات الحماية الأساسية، مما يجعله عرضة للتخريب أو دخول الحسابات الوهمية.</p>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <details class="checks">
          <summary>معايير الفحص الأمني ${on}/${SEC.length}</summary>
          <ul>${SEC.map(([p, l]) => `<li class="${values[p] ? 'ok' : 'no'}">${values[p] ? '✓' : '✗'} ${l}</li>`).join('')}</ul>
        </details>
      </div>
      <div class="ring-w">
        <svg class="ring" viewBox="0 0 100 100">
          <circle class="trk" cx="50" cy="50" r="44"></circle>
          <circle class="val" cx="50" cy="50" r="44" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"></circle>
        </svg>
        <div class="ring-n">${pct}%</div>
      </div>
    </div>`;
  }

  const field = (s, v) => {
    const p = `data-p="${esc(s.path)}"`;
    if (s.type === 'list') return `<div class="field block"><span>${esc(s.label)}</span><textarea ${p}>${esc((v || []).join('\n'))}</textarea></div>`;
    let inp;
    if (s.type === 'bool') inp = `<input type="checkbox" class="sw-cb" ${p} ${v ? 'checked' : ''}>`;
    else if (s.type === 'enum') inp = `<select ${p}>${s.values.map((x) => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
    else inp = `<input type="number" step="${s.type === 'float' ? '0.05' : '1'}" min="${s.min}" max="${s.max}" ${p} value="${v / (s.scale || 1)}">`;
    return `<div class="field"><span>${esc(s.label)}</span>${inp}</div>`;
  };

  function read(el, s) {
    if (s.type === 'bool') return el.checked;
    if (s.type === 'list') return el.value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (s.type === 'enum') return el.value;
    const n = Number(el.value);
    return s.type === 'int' ? Math.round(n * (s.scale || 1)) : n;
  }

  async function renderSettings() {
    const d = await api(`/g/${gid}/settings`);
    renderSecurity(d.values);
    const groups = {};
    d.schema.forEach((s) => (groups[s.group] ??= []).push(s));
    $('#s-protect').innerHTML = head('الحماية والإعدادات') + `<p class="muted">التعديلات تنطبق فوراً على كل السيرفرات.</p>` +
      Object.entries(groups).map(([g, list]) => `<details class="card grp" ${g === 'عام' ? 'open' : ''}><summary>${esc(g)}</summary>${list.map((s) => field(s, d.values[s.path])).join('')}</details>`).join('') +
      `<div class="savebar"><button class="btn" id="save">💾 حفظ التغييرات</button></div>`;
    $('#save').onclick = async () => {
      const ch = {};
      $$('#s-protect [data-p]').forEach((el) => {
        const s = d.schema.find((x) => x.path === el.dataset.p);
        const nv = read(el, s);
        if (JSON.stringify(nv) !== JSON.stringify(d.values[s.path])) ch[s.path] = nv;
      });
      if (!Object.keys(ch).length) return toast('ما غيرت شي');
      try {
        await post(`/g/${gid}/settings`, { changes: ch });
        toast('✅ تم الحفظ');
        await section('security', renderSettings);
      } catch (e) { toast((e.data?.errors || [e.message]).join(' | '), true); }
    };
  }

  // ---------- السجلات ----------
  async function renderAudit() {
    $('#s-audit').innerHTML = head('سجل العمليات (Audit Log)') + `
      <div class="toolbar">
        <select id="lk">${AUDIT_KEYS.map((k) => `<option value="${k}">${k || 'الكل'}</option>`).join('')}</select>
        <input id="lq" placeholder="بحث: اسم، ايدي، كلمة">
        <label class="chk"><input type="checkbox" id="la"> تلقائي</label>
        <button class="btn ghost-btn" id="lr">تحديث</button>
      </div>
      <div id="ll"></div>`;
    const loadLogs = async () => {
      const q = new URLSearchParams({ key: $('#lk').value, q: $('#lq').value, limit: 200 });
      const d = await api(`/g/${gid}/logs?${q}`);
      $('#ll').innerHTML = logList(d.items) || empty('ما فيه نتائج.');
    };
    $('#lr').onclick = () => loadLogs().catch((e) => toast(e.message, true));
    $('#lk').onchange = () => loadLogs().catch(() => {});
    $('#lq').onkeydown = (e) => { if (e.key === 'Enter') loadLogs().catch(() => {}); };
    $('#la').onchange = (e) => {
      clearInterval(timer);
      if (e.target.checked) timer = setInterval(() => loadLogs().catch(() => {}), 5000);
    };
    await loadLogs();
  }

  // ---------- النسخ الاحتياطي ----------
  function renderBackup(ov) {
    const last = ov?.lastBackup;
    $('#s-backup').innerHTML = head('النسخ الاحتياطي') + `
      <div class="card row2">
        <div>
          <b>النسخ الاحتياطي التلقائي</b> <span class="pill green">نشط تلقائياً</span>
          <p class="muted">يحفظ البوت الرتب والقنوات والصلاحيات في الخلفية بصورة دورية.</p>
        </div>
        <div class="muted">آخر نسخة: ${last ? ago(last) : 'لا توجد نسخ حالياً'}</div>
      </div>
      <div class="btns">
        <button class="btn" data-a="backup_create">＋ نسخة احتياطية الآن</button>
        <button class="btn danger" data-a="backup_restore">♻️ استرجاع المحذوف</button>
      </div>`;
    $$('#s-backup [data-a]').forEach((b) => (b.onclick = () => runAction(b.dataset.a)));
  }

  // ---------- الرتب والوايت ليست ----------
  async function renderRoles() {
    const d = await api(`/g/${gid}/whitelist`);
    $('#s-roles').innerHTML = head('الرتب والوايت ليست') +
      `<div class="item"><span><b>الأونر:</b> ${esc(d.owner.name)} <code>${esc(d.owner.id)}</code></span><span class="pill amber">مالك</span></div>` +
      (d.list.map((x) => `<div class="item"><span>${esc(x.name)} <code>${esc(x.id)}</code></span>
        ${d.canEdit
          ? `<span class="bar"><select data-role="${esc(x.id)}">${['admin', 'mod', 'viewer'].map((r) => `<option value="${r}" ${r === x.role ? 'selected' : ''}>${RL[r]}</option>`).join('')}</select>
             <button class="btn danger" data-rm="${esc(x.id)}">إزالة</button></span>`
          : `<span class="pill">${esc(RL[x.role] || x.role)}</span>`}
      </div>`).join('') || empty('القائمة فاضية.')) +
      (d.canEdit
        ? `<div class="bar" style="margin-top:12px"><input id="wid" inputmode="numeric" placeholder="ايدي العضو"><button class="btn" id="wadd">إضافة</button></div>`
        : '<p class="muted">التعديل للأونر فقط.</p>');

    const run = async (action, id) => {
      try { await post(`/g/${gid}/whitelist`, { action, id }); await section('roles', renderRoles); }
      catch (e) { toast(e.message, true); }
    };
    $('#wadd')?.addEventListener('click', () => run('add', $('#wid').value.trim()));
    $$('#s-roles [data-rm]').forEach((b) => (b.onclick = () => confirm('إزالة؟') && run('remove', b.dataset.rm)));
    $$('#s-roles [data-role]').forEach((s) => (s.onchange = async () => {
      try { await post(`/g/${gid}/roles`, { id: s.dataset.role, role: s.value }); toast('✅ تم تغيير الرتبة'); }
      catch (e) { toast(e.message, true); }
    }));
  }

  // ---------- التحذيرات ----------
  async function renderWarns() {
    const d = await api(`/g/${gid}/warns`);
    $('#s-warns').innerHTML = head('التحذيرات') +
      (d.list.map((x) => `<div class="item"><div><b>${esc(x.name)}</b> <code>${esc(x.id)}</code> <span class="pill amber">${x.warns.length}</span>
        <div class="muted" style="font-size:13px">${x.warns.map((w, i) => `${i + 1}. ${esc(w.reason)} — ${new Date(w.t).toLocaleString('en-GB')}`).join('<br>')}</div></div>
        <button class="btn danger" data-c="${esc(x.id)}">مسح</button></div>`).join('') || empty('ما فيه تحذيرات.'));
    $$('#s-warns [data-c]').forEach((b) => (b.onclick = async () => {
      if (!confirm('مسح كل تحذيراته؟')) return;
      try { await post(`/g/${gid}/warns/clear`, { userId: b.dataset.c }); await section('warns', renderWarns); }
      catch (e) { toast(e.message, true); }
    }));
  }

  // ---------- التكتات ----------
  async function renderTickets() {
    const d = await api(`/g/${gid}/tickets`);
    const row = (t, closed) => `<div class="item"><div><b>${esc(t.subject)}</b>
      <div class="muted" style="font-size:13px">${esc(t.owner || '')} · ${new Date(closed ? t.closed : t.t || t.opened).toLocaleString('en-GB')}</div></div>
      ${closed ? `<button class="btn ghost-btn" data-tr="${esc(t.id)}">📄 النسخة</button>` : ''}</div>`;
    $('#s-tickets').innerHTML = head(`التكتات`) +
      `<p class="muted">🟢 مفتوحة (${d.open.length})</p>` + (d.open.map((t) => row(t, false)).join('') || empty('ما فيه تكتات مفتوحة.')) +
      `<p class="muted">📁 الأرشيف (آخر ${d.archive.length})</p>` + (d.archive.map((t) => row(t, true)).join('') || empty('الأرشيف فاضي.')) +
      `<pre id="tr" class="card" style="white-space:pre-wrap;display:none"></pre>`;
    $$('#s-tickets [data-tr]').forEach((b) => (b.onclick = async () => {
      const r = await fetch(`/api/g/${gid}/transcript/${b.dataset.tr}`, { credentials: 'same-origin' });
      const pre = $('#tr');
      pre.style.display = 'block';
      pre.textContent = r.ok ? await r.text() : 'ما لقيت النسخة.';
    }));
  }

  // ---------- البوتات ----------
  async function renderBots() {
    const d = await api(`/g/${gid}/bots`);
    const act = (id, a, label, cls) => `<button class="btn ${cls}" data-b="${esc(id)}" data-a="${a}">${label}</button>`;
    $('#s-bots').innerHTML = head('البوتات') +
      `<p class="muted">⏳ طلبات بانتظار الموافقة (${d.pending.length})</p>` +
      (d.pending.map((p) => `<div class="item"><span>البوت <code>${esc(p.id)}</code> — أضافه <code>${esc(p.by)}</code></span>
        ${d.canEdit ? act(p.id, 'approve', '✅ موافقة', 'ok') + ' ' + act(p.id, 'deny', 'رفض', 'danger') : ''}</div>`).join('') || empty('ما فيه طلبات.')) +
      `<p class="muted">✅ بوتات معتمدة (${d.allowed.length})</p>` +
      (d.allowed.map((id) => `<div class="item"><span><code>${esc(id)}</code></span>${d.canEdit ? act(id, 'revoke', 'سحب الموافقة', 'danger') : ''}</div>`).join('') || empty('ما فيه بوتات معتمدة.')) +
      (d.canEdit ? '' : '<p class="muted">الموافقة للأونر فقط.</p>');
    $$('#s-bots [data-b]').forEach((b) => (b.onclick = async () => {
      if (!confirm('متأكد؟')) return;
      try { await post(`/g/${gid}/bots`, { action: b.dataset.a, id: b.dataset.b }); await section('bots', renderBots); }
      catch (e) { toast(e.message, true); }
    }));
  }

  // ---------- الطوارئ والتحكم ----------
  async function renderControl() {
    const B = [
      ['lockdown_on', '🔒 تفعيل لوك داون', ''], ['lockdown_off', '🔓 فك اللوك داون', 'ok'],
      ['panic_on', '🚨 وضع الطوارئ', 'danger'], ['panic_off', '✅ إنهاء الطوارئ', 'ok'],
      ['setup', '🛠️ إصلاح رومات اللوقات', ''], ['logs_clear', '🧹 مسح السجلات (المالك)', 'danger'],
    ];
    $('#s-control').innerHTML = head('الطوارئ والتحكم') +
      `<div class="ctl">${B.map(([a, l, c]) => `<button class="btn ${c}" data-a="${a}">${l}</button>`).join('')}</div>
       <p class="muted">كل إجراء ينسجل بروم الإدارة مع اسمك. الإجراءات الحساسة (فك الطوارئ، واللوك داون، والاسترجاع) تحتاج موافقة المالك.</p>
       <h3 class="sh" style="font-size:17px;margin-top:20px">🛂 طلبات بانتظار الموافقة</h3><div id="apv"></div>`;
    $$('#s-control [data-a]').forEach((b) => (b.onclick = () => runAction(b.dataset.a)));
    await renderApprovals();
  }

  async function renderApprovals() {
    const el = $('#apv');
    if (!el) return;
    const d = await api(`/g/${gid}/approvals`);
    const names = { lockdown_off: 'فك اللوك داون', panic_off: 'إنهاء الطوارئ', backup_restore: 'استرجاع المحذوف' };
    el.innerHTML = d.list.map((a) => `<div class="item"><span>${esc(names[a.type] || a.type)} — طلبه ${esc(a.byName)}</span>
        ${d.canEdit ? `<span class="bar"><button class="btn ok" data-ap="${esc(a.id)}" data-d="approve">✅ موافقة</button><button class="btn danger" data-ap="${esc(a.id)}" data-d="deny">رفض</button></span>` : ''}</div>`).join('')
      || empty('ما فيه طلبات.');
    $$('[data-ap]', el).forEach((b) => (b.onclick = async () => {
      if (!confirm('متأكد؟')) return;
      try { const r = await post(`/g/${gid}/approvals`, { id: b.dataset.ap, decision: b.dataset.d }); toast('✅ ' + (r.msg || 'تم')); }
      catch (e) { toast('❌ ' + e.message, true); }
      await renderApprovals();
    }));
  }

  // تنفيذ إجراء ثم تحديث الأجزاء المتأثرة
  async function runAction(type) {
    if (!confirm('متأكد؟')) return;
    try {
      const r = await post(`/g/${gid}/action`, { type });
      toast(r.pending ? '⏳ ' + r.msg : '✅ ' + (r.msg || 'تم'));
    } catch (e) { toast('❌ ' + e.message, true); }
    try {
      const ov = await api(`/g/${gid}/overview`);
      renderHero(ov);
      renderStats(ov);
      renderBackup(ov);
      await renderApprovals();
    } catch { /* الصلاحية أو الاتصال، ما يوقف الواجهة */ }
  }

  init();
})();
