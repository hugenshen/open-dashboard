/* Open Dashboard hi-fi · 产品壳（P007）
   菜单 / 顶栏 / 主题 的唯一来源。各模块 html 只放内容区，由本文件注入壳。 */
(function () {
  const THEME_KEY = 'od.theme';
  const RAIL_KEY = 'od.rail.slim';
  const THEMES = [
    { id: 'light', label: '浅色' },
    { id: 'dark-rail', label: '深色侧栏' },
    { id: 'dark', label: '深色' }
  ];

  const ICO = {
    wb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
    src: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    rpt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>',
    slim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h16"/></svg>'
  };

  const GROUPS = [
    { id: 'start', label: '开始' },
    { id: 'resource', label: '资源' }
  ];

  const PAGES = {
    workbench: { href: './workbench.html', label: '工作台', group: 'start', icon: 'wb' },
    conversation: { href: './conversation.html', label: '对话', group: 'start', icon: 'chat', beta: true },
    datasource: { href: './datasource.html', label: '数据源', group: 'resource', icon: 'src' },
    dataset: { href: './dataset.html', label: '数据集', group: 'resource', icon: 'set' },
    dashboard: { href: './dashboard.html', label: '仪表盘', group: 'resource', icon: 'dash' },
    report: { href: './report.html', label: '报告', group: 'resource', icon: 'rpt' }
  };

  function qs(s, el) { return (el || document).querySelector(s); }
  function qsa(s, el) { return [...(el || document).querySelectorAll(s)]; }

  function currentMod() {
    return document.body.dataset.mod || 'workbench';
  }

  function odHref(mod, hash) {
    const p = PAGES[mod];
    if (!p) return './workbench.html';
    if (hash == null || hash === '') return p.href;
    const h = String(hash).replace(/^#\/?/, '');
    return h ? p.href + '#/' + h : p.href;
  }

  window.OD_PAGES = PAGES;
  window.odHref = odHref;

  function currentTheme() {
    const t = document.documentElement.dataset.odTheme;
    if (t === 'dark-rail' || t === 'dark') return t;
    return 'light';
  }

  function applyTheme(id) {
    const t = THEMES.some((x) => x.id === id) ? id : 'light';
    document.documentElement.dataset.odTheme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* ignore */ }
    qsa('iframe').forEach((frame) => {
      try {
        if (frame.contentDocument) frame.contentDocument.documentElement.dataset.odTheme = t;
      } catch (_) { /* cross-origin frames keep their own theme */ }
    });
    qsa('[data-od-theme]').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.odTheme === t ? 'true' : 'false');
    });
  }

  try {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  } catch (_) {
    applyTheme('light');
  }

  window.odToast = function (msg) {
    let t = qs('#odToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'odToast';
      t.className = 'od-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 1600);
  };

  function railItem(id, spec, on) {
    const beta = spec.beta ? '<span class="od-beta">内测</span>' : '';
    return `<a class="od-rail-item${on ? ' on' : ''}" data-mod="${id}" href="${spec.href}">
        ${ICO[spec.icon] || ''}
        <span class="od-rail-txt">${spec.label}</span>${beta}
      </a>`;
  }

  function railHTML(mod) {
    const chunks = [];
    GROUPS.forEach((g) => {
      chunks.push(`<div class="od-rail-label">${g.label}</div>`);
      Object.keys(PAGES).forEach((id) => {
        const spec = PAGES[id];
        if (spec.group !== g.id) return;
        chunks.push(railItem(id, spec, id === mod));
      });
    });
    return `<aside class="od-rail" id="odRail">
    <a class="od-brand" href="./workbench.html"><i>OD</i><span>Open Dashboard</span></a>
    <nav class="od-rail-nav" id="modNav" aria-label="产品模块">
      ${chunks.join('\n      ')}
    </nav>
    <div class="od-rail-foot">
      <button class="od-rail-item" type="button" id="odRailSlim" title="收起侧栏">
        ${ICO.slim}
        <span class="od-rail-txt">收起侧栏</span>
      </button>
    </div>
  </aside>`;
  }

  function topHTML() {
    /* 资源页 / 工作台顶栏都不放问数；问数只在工作台页内和对话流。编辑器 Phase / SQLBot 由 is-editor 显示。 */
    return `<header class="od-top">
      <div class="od-top-actions">
        <div class="od-phase tabs" id="phaseTabs">
          <button class="on" type="button" data-phase="a">Phase A</button>
          <button type="button" data-phase="b">Phase B</button>
          <button type="button" data-phase="c">Phase C</button>
        </div>
        <button class="od-ghost" type="button" data-od-act="sqlbot">SQLBot</button>
        <button class="od-ghost" type="button" data-od-act="help">帮助</button>
        <div style="position:relative">
          <button class="od-account" type="button" id="odAccountBtn">
            <span class="od-avatar">演</span>
            演示账号
          </button>
          <div class="od-pop" id="odAccountPop">
            <div class="who"><b>演示账号</b><span>租户 · Open Dashboard 内测</span></div>
            <button type="button" data-od-act="switch">切换账号</button>
            <button type="button" data-od-act="settings">通用设置</button>
            <button type="button" data-od-act="logout">退出登录</button>
            <div class="hint">高保演示 · 不接真实 IAM</div>
          </div>
        </div>
      </div>
    </header>`;
  }

  function mountShell() {
    const app = qs('#odApp');
    if (!app) return;

    const mod = currentMod();
    if (!qs('.od-rail', app)) {
      app.insertAdjacentHTML('afterbegin', railHTML(mod));
    }

    let col = qs('.od-col', app);
    if (!col) {
      col = document.createElement('div');
      col.className = 'od-col';
      app.appendChild(col);
    }
    if (!qs('.od-top', col)) {
      col.insertAdjacentHTML('afterbegin', topHTML());
    }
    if (!qs('#app', col) && !qs('.od-page', col)) {
      const stage = document.createElement('div');
      stage.className = 'app';
      stage.id = 'app';
      col.appendChild(stage);
    }
  }

  function bindTheme() {
    const actions = qs('.od-top-actions');
    if (!actions || qs('#odThemeBtn')) return;

    const wrap = document.createElement('div');
    wrap.className = 'od-theme-wrap';
    wrap.innerHTML = `
      <button class="od-icon-btn" type="button" id="odThemeBtn" title="外观">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
        </svg>
      </button>
      <div class="od-pop" id="odThemePop">
        ${THEMES.map((th) => `<button type="button" data-od-theme="${th.id}">${th.label}</button>`).join('')}
      </div>`;
    const help = actions.querySelector('[data-od-act="help"]');
    if (help) actions.insertBefore(wrap, help.nextSibling);
    else actions.insertBefore(wrap, actions.firstChild);

    const btn = qs('#odThemeBtn');
    const pop = qs('#odThemePop');
    btn.onclick = (e) => {
      e.stopPropagation();
      const acc = qs('#odAccountPop');
      if (acc) acc.classList.remove('open');
      pop.classList.toggle('open');
    };
    pop.onclick = (e) => e.stopPropagation();
    qsa('[data-od-theme]', pop).forEach((b) => {
      b.onclick = () => {
        applyTheme(b.dataset.odTheme);
        pop.classList.remove('open');
        const lab = THEMES.find((x) => x.id === b.dataset.odTheme);
        odToast('已切换 · ' + (lab ? lab.label : ''));
      };
    });
    applyTheme(currentTheme());
  }

  function bindChrome() {
    const app = qs('#odApp');
    if (!app) return;

    qsa('.od-rail-item[data-mod]').forEach((b) => {
      b.classList.toggle('on', b.dataset.mod === currentMod());
      const label = qs('.od-rail-txt', b);
      if (label) b.title = label.textContent.trim();
    });

    const slim = qs('#odRailSlim');
    if (slim) {
      try { app.classList.toggle('slim', localStorage.getItem(RAIL_KEY) === 'true'); } catch (_) { /* ignore */ }
      const syncSlimState = () => {
        const isSlim = app.classList.contains('slim');
        slim.setAttribute('aria-expanded', isSlim ? 'false' : 'true');
        slim.title = isSlim ? '展开侧栏' : '收起侧栏';
        const label = qs('.od-rail-txt', slim);
        if (label) label.textContent = isSlim ? '展开侧栏' : '收起侧栏';
      };
      syncSlimState();
      slim.onclick = () => {
        app.classList.toggle('slim');
        try { localStorage.setItem(RAIL_KEY, app.classList.contains('slim') ? 'true' : 'false'); } catch (_) { /* ignore */ }
        syncSlimState();
      };
    }

    const acc = qs('#odAccountBtn');
    const pop = qs('#odAccountPop');
    if (acc && pop) {
      acc.setAttribute('aria-haspopup', 'menu');
      acc.setAttribute('aria-expanded', 'false');
      acc.onclick = (e) => {
        e.stopPropagation();
        const tp = qs('#odThemePop');
        if (tp) tp.classList.remove('open');
        pop.classList.toggle('open');
        acc.setAttribute('aria-expanded', pop.classList.contains('open') ? 'true' : 'false');
      };
      pop.onclick = (e) => e.stopPropagation();
    }

    document.addEventListener('click', () => {
      if (pop) {
        pop.classList.remove('open');
        if (acc) acc.setAttribute('aria-expanded', 'false');
      }
      const tp = qs('#odThemePop');
      if (tp) tp.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (pop) pop.classList.remove('open');
      if (acc) acc.setAttribute('aria-expanded', 'false');
      const tp = qs('#odThemePop');
      if (tp) tp.classList.remove('open');
    });

    qsa('[data-od-act]').forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.odAct;
        if (act === 'sqlbot') location.href = odHref('conversation');
        else if (act === 'help') odToast('帮助手册 · 演示');
        else if (act === 'settings') {
          const tp = qs('#odThemePop');
          const tb = qs('#odThemeBtn');
          if (tb && tp) {
            if (pop) pop.classList.remove('open');
            tp.classList.add('open');
          } else odToast('通用设置 · 演示');
        }
        else if (act === 'switch') odToast('已切换到演示账号 · 演');
        else if (act === 'logout') odToast('退出登录 · 演示');
        if (pop) pop.classList.remove('open');
      };
    });

    bindTheme();
  }

  function boot() {
    mountShell();
    bindChrome();
  }

  window.odBindShell = boot;
  window.odMountShell = mountShell;
  if (qs('#odApp')) boot();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
