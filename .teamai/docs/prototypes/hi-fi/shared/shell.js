/* Open Dashboard hi-fi · 产品壳（P007）
   菜单 / 顶栏 / 主题 的唯一来源。各模块 html 只放内容区，由本文件注入壳。 */
(function () {
  const THEME_KEY = 'od.theme';
  const BRAND_KEY = 'od.brand';
  const RAIL_KEY = 'od.rail.slim';
  const THEMES = [
    { id: 'light', label: '浅色' },
    { id: 'dark-rail', label: '深色侧栏' },
    { id: 'dark', label: '深色' }
  ];
  const BRANDS = [
    { id: 'indigo', label: 'Indigo' },
    { id: 'feishu', label: '飞书蓝' },
    { id: 'tabler', label: 'Tabler' },
    { id: 'teal', label: '青绿' }
  ];

  const ICO = {
    wb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
    src: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/></svg>',
    market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16l-1 13H5L4 7z"/><path d="M8 7a4 4 0 0 1 8 0"/><path d="M8 12h8M8 16h5"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    rpt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>',
    kb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5h6a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H5z"/><path d="M19 5h-6a3 3 0 0 0-3 3v12a3 3 0 0 1 3-3h6z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    slim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h16"/></svg>'
  };

  const GROUPS = [
    { id: 'use', label: '用户使用端' },
    { id: 'manage', label: '管理端' }
  ];

  const PAGES = {
    workbench: { href: './workbench.html', label: '工作台', group: 'use', icon: 'wb' },
    conversation: { href: './conversation.html', label: '对话分析', group: 'use', icon: 'chat', beta: true },
    dataMarket: { href: './data-market.html', label: '数据广场', group: 'use', icon: 'market' },
    dashboard: { href: './dashboard.html', label: '仪表盘', group: 'use', icon: 'dash' },
    report: { href: './report.html', label: '报告', group: 'use', icon: 'rpt' },
    datasource: { href: './datasource.html', label: '数据源', group: 'manage', icon: 'src' },
    dataset: { href: './dataset.html', label: '数据集', group: 'manage', icon: 'set' },
    knowledge: { href: './knowledge.html', label: '知识库', group: 'manage', icon: 'kb' },
    admin: { href: './workspace-admin.html', label: '成员权限', group: 'manage', icon: 'users' }
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
    qsa('#odThemePop [data-od-theme]').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.odTheme === t ? 'true' : 'false');
    });
  }

  function currentBrand() {
    const b = document.documentElement.dataset.odBrand;
    if (BRANDS.some((x) => x.id === b)) return b;
    return 'indigo';
  }

  function applyBrand(id) {
    const b = BRANDS.some((x) => x.id === id) ? id : 'indigo';
    document.documentElement.dataset.odBrand = b;
    try { localStorage.setItem(BRAND_KEY, b); } catch (_) { /* ignore */ }
    qsa('iframe').forEach((frame) => {
      try {
        if (frame.contentDocument) frame.contentDocument.documentElement.dataset.odBrand = b;
      } catch (_) { /* ignore */ }
    });
    qsa('#odThemePop [data-od-brand]').forEach((el) => {
      el.setAttribute('aria-checked', el.dataset.odBrand === b ? 'true' : 'false');
    });
  }

  try {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    applyBrand(localStorage.getItem(BRAND_KEY) || 'indigo');
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
    <a class="od-brand" href="./workbench.html"><img class="od-brand-mark" src="./shared/ip/od-ip-B1-otter-lower-left.png" width="36" height="36" alt="" /><span>DataQ</span></a>
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

  function isManageSurface() {
    return PAGES[currentMod()]?.group === 'manage';
  }

  function topHTML() {
    /* 资源页 / 工作台顶栏都不放问数；问数只在工作台页内和对话流。编辑器 Phase / SQLBot 由 is-editor 显示。 */
    const workspace = isManageSurface()
      ? `<div class="od-workspace-wrap">
          <button class="od-workspace" type="button" id="odWorkspaceBtn">
            <span class="od-ws-dot"></span>
            <span><b>零售经营项目组</b><small>超级管理员 · 治理工作区</small></span>
          </button>
          <div class="od-pop od-workspace-pop" id="odWorkspacePop">
            <div class="who"><b>治理工作区</b><span>工作区只出现在管理端；超级管理员可切换全部工作区</span></div>
            <button class="ws-opt on" type="button" data-ws-name="零售经营项目组" data-ws-role="超级管理员"><span>零售经营项目组</span><em>超级管理员</em></button>
            <button class="ws-opt" type="button" data-ws-name="华东门店项目组" data-ws-role="工作区管理员"><span>华东门店项目组</span><em>工作区管理员</em></button>
            <a class="ws-manage" href="./workspace-admin.html">管理工作区与权限</a>
          </div>
        </div>`
      : '';
    const accountScope = isManageSurface() ? '管理端 · 超级管理员' : '用户使用端';
    const plazaScope = currentMod() === 'dataMarket'
      ? `<nav class="od-plaza-scope" aria-label="资产分区">
          <button type="button" data-scope="mine">我的</button>
          <button class="on" type="button" data-scope="org">企业</button>
        </nav>`
      : '<div class="od-plaza-scope"></div>';
    return `<header class="od-top">
      <div class="od-top-start"></div>
      ${plazaScope}
      <div class="od-top-actions">
        ${workspace}
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
            赵演示
          </button>
          <div class="od-pop" id="odAccountPop">
            <div class="who"><b>赵演示</b><span>${accountScope}</span></div>
            <a href="./account-settings.html">账号设置</a>
            <a href="./account-settings.html#password">修改密码</a>
            <button type="button" data-od-act="switch">切换账号</button>
            <button type="button" data-od-act="logout">退出登录</button>
            <div class="hint">userId: user-demo · 由登录态注入</div>
          </div>
        </div>
      </div>
    </header>`;
  }

  function authDialogHTML() {
    return `<div class="od-auth-mask" id="odLogoutMask" aria-hidden="true">
      <div class="od-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="odLogoutTitle">
        <h3 id="odLogoutTitle">退出登录</h3>
        <p>退出后会清空当前浏览器会话，重新进入平台需要再次登录。已保存的对话、看板和个人记忆不会删除。</p>
        <div class="od-auth-actions">
          <button class="od-pop-cancel" type="button" data-od-act="logout-cancel">取消</button>
          <button class="od-pop-danger" type="button" data-od-act="logout-confirm">确认退出</button>
        </div>
      </div>
    </div>`;
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
    if (!qs('#odLogoutMask', document)) {
      document.body.insertAdjacentHTML('beforeend', authDialogHTML());
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
        <span class="od-pop-label">外观</span>
        ${THEMES.map((th) => `<button type="button" data-od-theme="${th.id}">${th.label}</button>`).join('')}
        <span class="od-pop-label">品牌色</span>
        ${BRANDS.map((br) => `<button type="button" data-od-brand="${br.id}"><i class="od-brand-dot" aria-hidden="true"></i>${br.label}</button>`).join('')}
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
    qsa('[data-od-brand]', pop).forEach((b) => {
      b.onclick = () => {
        applyBrand(b.dataset.odBrand);
        pop.classList.remove('open');
        const lab = BRANDS.find((x) => x.id === b.dataset.odBrand);
        odToast('品牌色 · ' + (lab ? lab.label : ''));
      };
    });
    applyTheme(currentTheme());
    applyBrand(currentBrand());
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
      slim.onclick = (e) => {
        e.stopPropagation();
        app.classList.toggle('slim');
        try { localStorage.setItem(RAIL_KEY, app.classList.contains('slim') ? 'true' : 'false'); } catch (_) { /* ignore */ }
        syncSlimState();
      };
      window.odSyncRailSlim = syncSlimState;
    }

    const acc = qs('#odAccountBtn');
    const pop = qs('#odAccountPop');
    const wsBtn = qs('#odWorkspaceBtn');
    const wsPop = qs('#odWorkspacePop');
    if (acc && pop) {
      acc.setAttribute('aria-haspopup', 'menu');
      acc.setAttribute('aria-expanded', 'false');
      acc.onclick = (e) => {
        e.stopPropagation();
        const tp = qs('#odThemePop');
        if (tp) tp.classList.remove('open');
        if (wsPop) wsPop.classList.remove('open');
        pop.classList.toggle('open');
        acc.setAttribute('aria-expanded', pop.classList.contains('open') ? 'true' : 'false');
      };
      pop.onclick = (e) => e.stopPropagation();
    }
    if (wsBtn && wsPop) {
      wsBtn.setAttribute('aria-haspopup', 'menu');
      wsBtn.setAttribute('aria-expanded', 'false');
      wsBtn.onclick = (e) => {
        e.stopPropagation();
        const tp = qs('#odThemePop');
        if (tp) tp.classList.remove('open');
        if (pop) pop.classList.remove('open');
        wsPop.classList.toggle('open');
        wsBtn.setAttribute('aria-expanded', wsPop.classList.contains('open') ? 'true' : 'false');
      };
      wsPop.onclick = (e) => e.stopPropagation();
      qsa('.ws-opt', wsPop).forEach((b) => {
        b.onclick = () => {
          qsa('.ws-opt', wsPop).forEach((x) => x.classList.toggle('on', x === b));
          const label = qs('#odWorkspaceBtn b');
          const sub = qs('#odWorkspaceBtn small');
          if (label) label.textContent = b.dataset.wsName || '当前工作区';
          if (sub) sub.textContent = (b.dataset.wsRole || '管理员') + ' · 治理工作区';
          wsPop.classList.remove('open');
          wsBtn.setAttribute('aria-expanded', 'false');
          odToast('已切换治理工作区 · ' + (b.dataset.wsName || '当前工作区'));
        };
      });
    }

    document.addEventListener('click', () => {
      if (pop) {
        pop.classList.remove('open');
        if (acc) acc.setAttribute('aria-expanded', 'false');
      }
      if (wsPop) {
        wsPop.classList.remove('open');
        if (wsBtn) wsBtn.setAttribute('aria-expanded', 'false');
      }
      const tp = qs('#odThemePop');
      if (tp) tp.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (pop) pop.classList.remove('open');
      if (acc) acc.setAttribute('aria-expanded', 'false');
      if (wsPop) wsPop.classList.remove('open');
      if (wsBtn) wsBtn.setAttribute('aria-expanded', 'false');
      const tp = qs('#odThemePop');
      if (tp) tp.classList.remove('open');
    });

    qsa('[data-od-act]').forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.odAct;
        if (act === 'sqlbot') location.href = odHref('conversation');
        else if (act === 'help') odToast('帮助手册 · 演示');
        else if (act === 'switch') location.href = './login.html?switch=1';
        else if (act === 'logout') {
          const mask = qs('#odLogoutMask');
          if (mask) {
            mask.classList.add('open');
            mask.setAttribute('aria-hidden', 'false');
          }
        }
        else if (act === 'logout-cancel') {
          const mask = qs('#odLogoutMask');
          if (mask) {
            mask.classList.remove('open');
            mask.setAttribute('aria-hidden', 'true');
          }
        }
        else if (act === 'logout-confirm') location.href = './login.html?logged_out=1';
        if (pop) pop.classList.remove('open');
      };
    });

    bindTheme();
  }

  /** 渲染前把壳层操作暂存回 .od-top，避免 #app.innerHTML 冲掉节点 */
  function parkEditorChrome() {
    const top = qs('.od-top');
    const actions = qs('.od-top-actions');
    if (top && actions && actions.parentElement !== top) top.appendChild(actions);
    const host = qs('#editorShellHost');
    if (host) host.remove();
  }

  /** 编辑态：把壳层右侧操作迁入编辑器顶条，离开编辑态再迁回 .od-top */
  function syncEditorChrome() {
    const app = qs('#odApp');
    const top = qs('.od-top');
    const actions = qs('.od-top-actions');
    if (!app || !top || !actions) return;

    const editing = app.classList.contains('is-editor');
    let host = qs('#editorShellHost');

    if (editing) {
      const bar = qs('#app > .bar');
      if (!bar) return;
      if (!host) {
        host = document.createElement('div');
        host.id = 'editorShellHost';
        host.className = 'bar-shell-host';
        bar.appendChild(host);
      } else if (host.parentElement !== bar) {
        bar.appendChild(host);
      }
      if (actions.parentElement !== host) host.appendChild(actions);
    } else {
      if (actions.parentElement !== top) top.appendChild(actions);
      if (host) host.remove();
    }
    if (typeof window.odSyncRailSlim === 'function') window.odSyncRailSlim();
  }

  function boot() {
    mountShell();
    bindChrome();
  }

  window.odBindShell = boot;
  window.odMountShell = mountShell;
  window.odParkEditorChrome = parkEditorChrome;
  window.odSyncEditorChrome = syncEditorChrome;
  if (qs('#odApp')) boot();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
