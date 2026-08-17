/* Open Dashboard hi-fi · 产品壳行为（P007） */
(function () {
  const MODS = [
    { id: 'workbench', label: '工作台', href: './workbench.html', icon: 'wb' },
    { id: 'conversation', label: '对话', href: './dashboard-commercial.html#/conversation', icon: 'chat', beta: true },
    { id: 'datasource', label: '数据源', href: './dashboard-commercial.html#/datasource', icon: 'src' },
    { id: 'dataset', label: '数据集', href: './dashboard-commercial.html#/dataset', icon: 'set' },
    { id: 'dashboard', label: '仪表盘', href: './dashboard-commercial.html#/dashboard', icon: 'dash' },
    { id: 'report', label: '报告', href: './dashboard-commercial.html#/report', icon: 'rpt' }
  ];

  const ICO = {
    wb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
    src: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    rpt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>'
  };

  function qs(s, el) { return (el || document).querySelector(s); }
  function qsa(s, el) { return [...(el || document).querySelectorAll(s)]; }

  window.odToast = function (msg) {
    let t = qs('#odToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'odToast';
      t.className = 'od-toast';
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

  function bindChrome() {
    const app = qs('#odApp');
    if (!app) return;

    qsa('.od-rail-item[data-mod]').forEach((b) => {
      b.classList.toggle('on', b.dataset.mod === currentMod());
    });

    const slim = qs('#odRailSlim');
    if (slim) {
      slim.onclick = () => {
        app.classList.toggle('slim');
        odToast(app.classList.contains('slim') ? '侧栏已收起' : '侧栏已展开');
      };
    }

    const acc = qs('#odAccountBtn');
    const pop = qs('#odAccountPop');
    if (acc && pop) {
      acc.onclick = (e) => {
        e.stopPropagation();
        pop.classList.toggle('open');
      };
      document.addEventListener('click', () => pop.classList.remove('open'));
      pop.onclick = (e) => e.stopPropagation();
    }

    qsa('[data-od-act]').forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.odAct;
        if (act === 'sqlbot') location.href = './dashboard-commercial.html#/conversation';
        else if (act === 'help') odToast('帮助手册 · 演示');
        else if (act === 'settings') odToast('通用设置 · 演示（主题 / 语言）');
        else if (act === 'switch') odToast('已切换到演示账号 · 演');
        else if (act === 'logout') odToast('退出登录 · 演示');
        if (pop) pop.classList.remove('open');
      };
    });

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
