/* Open Dashboard hi-fi · 产品壳行为（P007） */
(function () {
  const THEME_KEY = 'od.theme';
  const RAIL_KEY = 'od.rail.slim';
  const THEMES = [
    { id: 'light', label: '浅色' },
    { id: 'dark-rail', label: '深色侧栏' },
    { id: 'dark', label: '深色' }
  ];

  function qs(s, el) { return (el || document).querySelector(s); }
  function qsa(s, el) { return [...(el || document).querySelectorAll(s)]; }

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

  function currentMod() {
    return document.body.dataset.mod || 'workbench';
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
        odToast(app.classList.contains('slim') ? '侧栏已收起' : '侧栏已展开');
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
        if (act === 'sqlbot') location.href = './dashboard-commercial.html#/conversation';
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

    const go = qs('#odSearchGo');
    const input = qs('#odSearchInput');
    const runSearch = () => {
      const q = (input && input.value.trim()) || '';
      if (q) sessionStorage.setItem('od.ask.draft', q);
      location.href = './dashboard-commercial.html#/conversation';
    };
    if (go) go.onclick = runSearch;
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runSearch();
      });
    }
  }

  window.odBindShell = bindChrome;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindChrome);
  else bindChrome();
})();
