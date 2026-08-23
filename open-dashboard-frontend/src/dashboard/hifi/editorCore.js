/* extracted hi-fi editor core — product mount API */
import * as echarts from 'echarts';
import { humanizeFieldName } from '../../utils/fieldLabel';

let __productOpts = null;
let __origMarkDirty = null;
let __origRender = null;
let __origSyncRoute = null;

/** 产品挂载时避免命中 Vue 根 #app；高保原型仍用默认 id */
function elById(id) {
  const map = __productOpts && __productOpts.rootIds;
  if (map && map[id]) {
    return document.getElementById(map[id]) || document.getElementById(id);
  }
  return document.getElementById(id);
}

export function mountHiFiDashboard(options) {
  __productOpts = options || {};
  // force product editor mode
  state.phase = 'c';
  state.module = 'dashboard';
  state.screen = (__productOpts.mode === 'preview' || __productOpts.mode === 'share')
    ? 'preview'
    : 'editor';
  state.previewFrom = __productOpts.previewFrom === 'editor' ? 'editor' : 'list';
  state.shareViewer = __productOpts.mode === 'share';
  state.mobile = false;
  state.editSurface = 'pc';
  if (__productOpts.datasets) {
    // replace demo catalog with product datasets (preview rows only; charts use chartQuery)
    Object.keys(DATASETS).forEach((k) => { delete DATASETS[k]; });
    Object.keys(__productOpts.datasets).forEach((k) => { DATASETS[k] = __productOpts.datasets[k]; });
    const preferred = __productOpts.preferredDatasetId;
    state.datasetId = (preferred && DATASETS[preferred] ? preferred : Object.keys(DATASETS)[0]) || '';
  }
  const dash = __productOpts.dash;
  if (!dash) throw new Error('mountHiFiDashboard: dash required');
  state.dashboards = [dash];
  state.dashId = dash.id;
  state.dash = dash;
  state.selectedId = dash.components?.find((c) => c.type === 'chart')?.id || dash.components?.[0]?.id || null;
  // Conversation split: canvas first — collapse chrome until user opens it.
  state.leftCollapsed = Boolean(__productOpts.embedded);
  state.inspCollapsed = Boolean(__productOpts.embedded);
  state.inspUserToggled = false;
  // Embedded: don't pre-select a chart (avoids empty/wide inspector flash).
  if (__productOpts.embedded) state.selectedId = null;
  state.bindCollapsed = false;
  state.opsCollapsed = false;
  state.undo = [];
  state.linkageHits = [];
  state.drillStack = [];

  if (!__origMarkDirty) {
    __origMarkDirty = markDirty;
    markDirty = function patchedMarkDirty() {
      __origMarkDirty();
      if (__productOpts.onDirty) __productOpts.onDirty(clone(state.dash));
    };
  }
  if (!__origSyncRoute) {
    __origSyncRoute = syncRoute;
    syncRoute = function() {};
    applyRouteFromHash = function() {};
    syncModNav = function() {};
  }
  if (!__origRender) {
    __origRender = render;
    render = function patchedRender() {
      __origRender();
      wireProductChrome();
    };
  }
  render();
  return {
    getDash: () => clone(state.dash),
    setDash(d) {
      state.dash = d;
      state.dashboards = [d];
      state.dashId = d.id;
      render();
    },
    rerender: () => render(),
    destroy() {
      disposeCharts();
      if (__boardResizeObs) {
        try { __boardResizeObs.disconnect(); } catch (_) {}
        __boardResizeObs = null;
      }
      __lastBoardInnerW = 0;
      const app = elById('app');
      if (app) app.innerHTML = '';
      if (state._chartQueryCache) state._chartQueryCache = {};
      __productOpts = null;
    }
  };
}

function wireProductChrome() {
  const opts = __productOpts || {};
  const root = elById('app');
  const toList = (root && root.querySelector('#toList')) || document.getElementById('toList');
  if (toList && opts.onBack) toList.onclick = () => opts.onBack();
  // 产品预览：#back 走 Vue 路由，避免 leavePreview 在 /preview 内切到 hi-fi 列表屏
  const back = (root && root.querySelector('#back')) || document.getElementById('back');
  if (back && opts.onBack && (opts.mode === 'preview' || opts.mode === 'share')) {
    back.onclick = () => opts.onBack();
  }
  const btnPreview = (root && root.querySelector('#btnPreview')) || document.getElementById('btnPreview');
  if (btnPreview && opts.onPreview) {
    // 对齐高保：预览已发布版；草稿须先发布
    btnPreview.onclick = () => {
      const d = state.dash;
      if (!d) return;
      if (d.status === 'draft') {
        toast('当前是草稿，请先点「发布」后再预览已发布版', 'warn');
        return;
      }
      opts.onPreview(clone(d));
    };
  }
  const btnPub = (root && root.querySelector('#btnPub')) || document.getElementById('btnPub');
  if (btnPub) {
    btnPub.onclick = () => openPublishModal();
  }
  // hide hi-fi global topbar if present
  document.querySelectorAll('.hifi-dash-root .topbar').forEach((el) => { el.style.display = 'none'; });
}


const COL = 12, COL_MOBILE = 6, ROW_H = 52, GAP = 16, EXTRA_ROWS = 2;
const ROW_H_MOBILE = 48, GAP_MOBILE = 8, EXTRA_ROWS_MOBILE = 1;
const MOBILE_DEVICE_GROUPS = [
  { id: 'ios', label: 'iOS' },
  { id: 'android', label: 'Android' },
  { id: 'pad', label: 'Pad' }
];
const MOBILE_DEVICE_ALIASES = {
  android360: 'android_360',
  iphone375: 'iphone_se',
  iphone390: 'iphone_14',
  iphone430: 'iphone_14_pm'
};
const MOBILE_DEVICES = {
  // iOS 手机
  iphone_se: { group: 'ios', kind: 'phone', label: 'iPhone SE', short: 'SE', width: 375 },
  iphone_14: { group: 'ios', kind: 'phone', label: 'iPhone 14 / 15', short: '390', width: 390 },
  iphone_16_pro: { group: 'ios', kind: 'phone', label: 'iPhone 16 Pro', short: '402', width: 402 },
  iphone_14_pm: { group: 'ios', kind: 'phone', label: 'iPhone 14/15 Pro Max', short: '430', width: 430 },
  // Android 手机
  android_360: { group: 'android', kind: 'phone', label: 'Android 通用 360', short: '360', width: 360 },
  huawei_p60: { group: 'android', kind: 'phone', label: '华为 P60', short: '华为', width: 396 },
  xiaomi_14: { group: 'android', kind: 'phone', label: '小米 14', short: '小米', width: 392 },
  oppo_find_x7: { group: 'android', kind: 'phone', label: 'OPPO Find X7', short: 'OPPO', width: 400 },
  vivo_x100: { group: 'android', kind: 'phone', label: 'vivo X100', short: 'vivo', width: 396 },
  samsung_s24: { group: 'android', kind: 'phone', label: 'Galaxy S24', short: 'S24', width: 360 },
  pixel_8: { group: 'android', kind: 'phone', label: 'Pixel 8', short: 'Pixel', width: 412 },
  // Pad（含中兴）
  ipad_mini: { group: 'pad', kind: 'pad', label: 'iPad mini', short: 'mini', width: 744 },
  ipad_11: { group: 'pad', kind: 'pad', label: 'iPad 11"', short: 'iPad', width: 820 },
  ipad_pro_11: { group: 'pad', kind: 'pad', label: 'iPad Pro 11"', short: 'Pro', width: 834 },
  android_tab_10: { group: 'pad', kind: 'pad', label: 'Android 平板 10"', short: '10"', width: 800 },
  huawei_matepad: { group: 'pad', kind: 'pad', label: '华为 MatePad 11', short: 'Mate', width: 820 },
  zte_nubia_pad_pro: { group: 'pad', kind: 'pad', label: '中兴 nubia Pad Pro', short: 'nubia', width: 820 },
  zte_pad: { group: 'pad', kind: 'pad', label: '中兴 ZTE Pad', short: '中兴', width: 800 }
};

function resolveMobileDeviceId(id) {
  const mapped = MOBILE_DEVICE_ALIASES[id] || id;
  return MOBILE_DEVICES[mapped] ? mapped : 'iphone_14';
}
function mobileDeviceMeta(id) {
  return MOBILE_DEVICES[resolveMobileDeviceId(id)];
}
function devicesInGroup(group) {
  return Object.entries(MOBILE_DEVICES).filter(([, d]) => d.group === group);
}
function mobileDeviceOptionsHtml(selected, group) {
  const cur = resolveMobileDeviceId(selected);
  const g = group || mobileDeviceMeta(cur).group;
  return devicesInGroup(g).map(([id, d]) =>
    `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(d.label)} · ${d.width}</option>`
  ).join('');
}
function mobileDeviceOptgroupsHtml(selected) {
  const cur = resolveMobileDeviceId(selected);
  return MOBILE_DEVICE_GROUPS.map(g =>
    `<optgroup label="${esc(g.label)}">${devicesInGroup(g.id).map(([id, d]) =>
      `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(d.label)} · ${d.width}</option>`
    ).join('')}</optgroup>`
  ).join('');
}
function setMobileDevice(nextId, { undo = true } = {}) {
  const next = resolveMobileDeviceId(nextId);
  const m = ensureMobile(state.dash);
  if (m.device === next) return false;
  if (undo && state.screen === 'editor') pushUndo();
  m.device = next;
  markDirty();
  return true;
}

function phoneShellHtml(mob, { mode = 'edit', id = 'phoneShell' } = {}) {
  const device = resolveMobileDeviceId(mob.device);
  const meta = MOBILE_DEVICES[device];
  const bg = mob.bg || '#f0f2f5';
  const modeLabel = mode === 'preview' ? '预览' : '移动编辑';
  const cats = MOBILE_DEVICE_GROUPS.map(g =>
    `<button type="button" data-dev-cat="${g.id}" class="${meta.group === g.id ? 'on' : ''}">${esc(g.label)}</button>`
  ).join('');
  return `<div class="mobile-phone ${meta.kind === 'pad' ? 'is-pad' : 'is-phone'}" id="${id}" style="--phone-w:${meta.width}px;background:${esc(bg)}">
    <div class="phone-top">
      <div class="phone-notch-deco" aria-hidden="true"></div>
      <div class="phone-device-bar" id="phoneDeviceSwitch">
        <div class="phone-dev-cats">${cats}</div>
        <select class="phone-dev-select" id="phoneDevSelect" title="选择机型">${mobileDeviceOptionsHtml(device, meta.group)}</select>
      </div>
      <div class="phone-mode-tag">${modeLabel} · ${esc(meta.label)} · ${meta.width}</div>
    </div>
    <div class="phone-body">
      <div class="board" id="board" style="background:${esc(bg)}"></div>
    </div>
    <div class="phone-home"><i></i></div>
  </div>`;
}

function wirePhoneDeviceSwitch(root) {
  const box = root?.querySelector('#phoneDeviceSwitch') || document.getElementById('phoneDeviceSwitch');
  if (!box) return;
  const sel = box.querySelector('#phoneDevSelect');
  const groupDefault = { ios: 'iphone_14', android: 'android_360', pad: 'zte_nubia_pad_pro' };
  box.querySelectorAll('[data-dev-cat]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const group = b.dataset.devCat;
      const list = devicesInGroup(group);
      if (!list.length) return;
      const cur = resolveMobileDeviceId(ensureMobile(state.dash).device);
      const keep = list.some(([id]) => id === cur);
      const next = keep ? cur : resolveMobileDeviceId(groupDefault[group] || list[0][0]);
      if (setMobileDevice(next)) render();
      else {
        box.querySelectorAll('[data-dev-cat]').forEach(x => x.classList.toggle('on', x.dataset.devCat === group));
        if (sel) sel.innerHTML = mobileDeviceOptionsHtml(next, group);
      }
    };
  });
  if (sel) {
    sel.onchange = e => {
      e.stopPropagation();
      if (setMobileDevice(e.target.value)) render();
    };
  }
}

function ensureMobile(dash) {
  if (!dash) return { enabled: false, device: 'iphone_14', bg: '#f0f2f5', components: [] };
  if (!dash.mobile) dash.mobile = { enabled: false, device: 'iphone_14', bg: '#f0f2f5', components: [] };
  if (!Array.isArray(dash.mobile.components)) dash.mobile.components = [];
  dash.mobile.device = resolveMobileDeviceId(dash.mobile.device || 'iphone_14');
  if (!dash.mobile.bg) dash.mobile.bg = '#f0f2f5';
  return dash.mobile;
}

function isMobileEdit() {
  return state.screen === 'editor' && state.editSurface === 'mobile';
}

/** Editor mobile surface, or preview using dedicated mobile layout components */
function useMobileLayout() {
  if (!state.dash) return false;
  if (state.screen === 'editor') return state.editSurface === 'mobile';
  if (state.screen === 'preview' && state.mobile) {
    const m = ensureMobile(state.dash);
    return !!(m.enabled && m.components.length);
  }
  return false;
}

/** 预览态只读（不可拖拽/选中/改布局） */
function isPreviewReadonly() {
  return state.screen === 'preview';
}

/** 预览「手机预览」：窄屏机框（有无专属移动布局都进手机壳） */
function isNarrowPreview() {
  return state.screen === 'preview' && !!state.mobile;
}

/**
 * 无专属移动布局时：把 PC 组件竖排铺满窄屏，避免多列挤扁。
 * 不写回 dash，仅影响预览渲染。
 */
function stackForNarrowPreview(comps) {
  const cols = gridCols();
  const sorted = [...comps].sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
  let y = 0;
  return sorted.map((c) => {
    let h = c.h || 2;
    if (c.type === 'chart') {
      const t = state.dash.charts[c.chartId]?.chartType;
      if (isTableType(t)) h = Math.max(h, 6);
      else if (t === 'kpi') h = Math.max(2, Math.min(h, 3));
      else if (t === 'pie') h = Math.max(h, 5);
      else h = Math.max(h, 5);
    } else if (c.type === 'text' || c.type === 'slicer' || c.type === 'query') {
      h = Math.max(1, Math.min(h, 2));
    }
    const next = { ...c, x: 0, y, w: cols, h };
    y += h;
    return next;
  });
}

/** 画布实际使用的组件列表（预览窄屏可能做竖排适配） */
function boardComps() {
  const comps = tabComps();
  if (isNarrowPreview() && !useMobileLayout()) return stackForNarrowPreview(comps);
  return comps;
}

/** 移动编辑 / 手机预览共用窄屏栅格度量 */
function isMobileMetrics() {
  return useMobileLayout() || isNarrowPreview();
}

function gridCols() {
  return isMobileMetrics() ? COL_MOBILE : COL;
}
function rowH() { return isMobileMetrics() ? ROW_H_MOBILE : ROW_H; }
function gapSize() { return isMobileMetrics() ? GAP_MOBILE : GAP; }
function extraRows() {
  // 预览/分享按内容收紧高度；编辑态仅留少量落点空间
  if (isPreviewReadonly()) return 0;
  return isMobileMetrics() ? EXTRA_ROWS_MOBILE : EXTRA_ROWS;
}

/** 按机型宽高比缩放手机框，居中放入舞台，避免下方留出大块空灰 */
function fitMobilePhone() {
  const wrap = document.getElementById('cwrap') || document.querySelector('.canvas-wrap');
  const phone = document.getElementById('phoneShell') || document.querySelector('.mobile-phone');
  if (!wrap || !phone || !isMobileMetrics()) return;
  const meta = mobileDeviceMeta(ensureMobile(state.dash).device);
  const baseW = meta.width || 390;
  // 手机约 19.5:9；平板约 4:3（竖屏）
  const aspect = meta.kind === 'pad' ? 4 / 3 : 19.5 / 9;
  const maxW = Math.max(220, wrap.clientWidth - 40);
  const maxH = Math.max(280, wrap.clientHeight - 24);
  let w = meta.kind === 'pad'
    ? Math.min(maxW, baseW)
    : Math.min(maxW, Math.round(baseW * 1.04));
  let h = Math.round(w * aspect);
  if (h > maxH) {
    h = maxH;
    w = Math.round(h / aspect);
  }
  if (w > maxW) {
    w = maxW;
    h = Math.round(w * aspect);
  }
  phone.style.width = `${w}px`;
  phone.style.height = `${h}px`;
  phone.style.maxHeight = `${maxH}px`;
  phone.style.flex = '0 0 auto';
}

/** column width derived from board client width so canvas fills middle pane */
function colW(board) {
  const pad = isMobileMetrics() ? boardPad() : 12;
  const cols = gridCols();
  const g = gapSize();
  const mobile = isMobileMetrics();
  const w = board?.clientWidth || (mobile ? 360 : 900);
  const inner = Math.max(mobile ? 240 : 480, w - pad);
  return (inner - (cols - 1) * g) / cols;
}

function hydrateMobileComp(mc) {
  const pc = state.dash?.components?.find(c => c.id === mc.refId);
  if (!pc) return null;
  return {
    ...pc,
    id: mc.id,
    refId: mc.refId,
    x: mc.x, y: mc.y, w: mc.w, h: mc.h, z: mc.z ?? 1,
    styleSync: mc.styleSync !== false,
    mobileStyle: mc.style || null,
    _mobile: true
  };
}

function resolveCompStyle(comp) {
  const ch = comp?.type === 'chart' ? state.dash.charts[comp.chartId] : null;
  if (!ch) return defaultChartStyle();
  const base = { ...styleDefaultsFor(ch.chartType), ...(ch.style || {}) };
  if (comp._mobile && comp.styleSync === false && comp.mobileStyle) {
    return { ...base, ...comp.mobileStyle };
  }
  return base;
}

function mobileDefaultSize(pc) {
  if (pc.type === 'slicer') return { w: 6, h: 1 };
  if (pc.type === 'text') return { w: 6, h: 1 };
  const t = state.dash.charts[pc.chartId]?.chartType;
  if (t === 'kpi') return { w: 3, h: 3 };
  if (isTableType(t)) return { w: 6, h: 5 };
  if (t === 'pie') return { w: 6, h: 4 };
  return { w: 6, h: 4 };
}

function findMobileFreeSlot(w, h) {
  const items = ensureMobile(state.dash).components;
  const maxY = Math.max(contentRows(items), 0) + EXTRA_ROWS_MOBILE;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= COL_MOBILE - w; x++) {
      const trial = { x, y, w, h };
      if (!items.some(o => collide(trial, o))) return { x, y };
    }
  }
  return { x: 0, y: contentRows(items) };
}

function addToMobileLayout(pcId) {
  const m = ensureMobile(state.dash);
  if (m.components.some(c => c.refId === pcId)) return null;
  const pc = state.dash.components.find(c => c.id === pcId);
  if (!pc) return null;
  const size = mobileDefaultSize(pc);
  const slot = findMobileFreeSlot(size.w, size.h);
  const mc = {
    id: uid('m'),
    refId: pcId,
    x: slot.x, y: slot.y, w: size.w, h: size.h,
    z: m.components.length + 1,
    styleSync: true,
    style: null
  };
  m.components.push(mc);
  m.enabled = true;
  return mc;
}

function removeFromMobileLayout(pcIdOrMobileId) {
  const m = ensureMobile(state.dash);
  m.components = m.components.filter(c => c.id !== pcIdOrMobileId && c.refId !== pcIdOrMobileId);
}

function clearMobileLayout() {
  const m = ensureMobile(state.dash);
  m.components = [];
  m.enabled = false;
}

function reflowMobileBoard() {
  const m = ensureMobile(state.dash);
  const kpis = [];
  const tops = [];
  const charts = [];
  m.components.forEach(c => {
    const pc = state.dash.components.find(p => p.id === c.refId);
    const t = pc?.type === 'chart' ? state.dash.charts[pc.chartId]?.chartType : pc?.type;
    if (t === 'kpi') kpis.push(c);
    else if (pc && (pc.type === 'slicer' || pc.type === 'text')) tops.push(c);
    else charts.push(c);
  });
  let y = 0;
  tops.sort((a, b) => a.y - b.y || a.z - b.z).forEach(c => {
    c.x = 0; c.w = COL_MOBILE; c.h = Math.max(c.h || 1, 1); c.y = y; y += c.h;
  });
  kpis.forEach((c, i) => {
    c.w = 3; c.h = 3; c.x = (i % 2) * 3; c.y = y + Math.floor(i / 2) * 3;
  });
  y += Math.ceil(kpis.length / 2) * 3;
  charts.sort((a, b) => a.y - b.y || a.z - b.z).forEach(c => {
    c.x = 0; c.w = COL_MOBILE; c.y = y; y += c.h;
  });
}

function importAllToMobile() {
  const m = ensureMobile(state.dash);
  const tab = state.dash.activeTab;
  state.dash.components
    .filter(c => (c.tabId || 'tab_main') === tab)
    .forEach(pc => { if (!m.components.some(c => c.refId === pc.id)) addToMobileLayout(pc.id); });
  reflowMobileBoard();
  m.enabled = true;
}

/** Bump legacy mobile KPI h=2 → h=3 and reflow so numbers are not clipped. */
function ensureMobileKpiRoom() {
  const m = ensureMobile(state.dash);
  const short = m.components.some(c => {
    const pc = state.dash.components.find(p => p.id === c.refId);
    return pc?.type === 'chart' && state.dash.charts[pc.chartId]?.chartType === 'kpi' && (c.h || 0) < 3;
  });
  if (short) reflowMobileBoard();
  if (m.bg === '#f5f6f7' || m.bg === '#d8dce3') m.bg = '#f0f2f5';
}

/** Delete selection: mobile surface only removes board entry; PC deletes component (+ chart). */
function deleteSelectedComp(comp) {
  if (!comp) return;
  if (isMobileEdit() || comp._mobile) {
    removeFromMobileLayout(comp.id);
    const m = ensureMobile(state.dash);
    if (!m.components.length) m.enabled = false;
    state.selectedId = null;
    return;
  }
  state.dash.components = state.dash.components.filter(c => c.id !== comp.id);
  if (comp.chartId) delete state.dash.charts[comp.chartId];
  removeFromMobileLayout(comp.id);
  state.selectedId = null;
}

function styleWriteBag(comp, ch) {
  if (comp?._mobile && isMobileEdit() && comp.styleSync === false && ch) {
    const m = ensureMobile(state.dash).components.find(c => c.id === comp.id);
    if (!m) return ensureStyle(ch);
    if (!m.style) m.style = {};
    return m.style;
  }
  return ch ? ensureStyle(ch) : null;
}

// Product: numeric string ids for PG BIGINT columns
const uid = (_p='id') => String(Date.now()) + String(Math.floor(Math.random() * 900 + 100));
const clone = v => JSON.parse(JSON.stringify(v));

const SALES_RAW = [
  { region:'华东', product:'A', channel:'线上', amount:120, qty:30, date:'2026-07-01' },
  { region:'华东', product:'B', channel:'线下', amount:80, qty:20, date:'2026-07-02' },
  { region:'华东', product:'C', channel:'线上', amount:55, qty:12, date:'2026-07-07' },
  { region:'华北', product:'A', channel:'线上', amount:60, qty:15, date:'2026-07-03' },
  { region:'华北', product:'B', channel:'线下', amount:40, qty:10, date:'2026-07-04' },
  { region:'华北', product:'D', channel:'线上', amount:70, qty:18, date:'2026-07-08' },
  { region:'华南', product:'A', channel:'线上', amount:90, qty:22, date:'2026-07-05' },
  { region:'华南', product:'B', channel:'线下', amount:110, qty:28, date:'2026-07-06' },
  { region:'华南', product:'E', channel:'线下', amount:45, qty:9, date:'2026-07-09' },
  { region:'华东', product:'F', channel:'线上', amount:95, qty:24, date:'2026-07-10' },
  { region:'华北', product:'G', channel:'线下', amount:35, qty:8, date:'2026-07-11' },
  { region:'华南', product:'H', channel:'线上', amount:66, qty:14, date:'2026-07-12' }
];
const CITY_MAP = { 华东: ['上海', '杭州'], 华北: ['北京', '天津'], 华南: ['广州', '深圳'] };
const SALES_PEOPLE = ['张三', '李四', '王五', '赵六'];
const SALES_ROWS = SALES_RAW.map((r, i) => {
  const cities = CITY_MAP[r.region] || ['未知'];
  const cost = Math.round(r.amount * 0.62);
  return {
    ...r,
    year: '2026',
    month: r.date.slice(5, 7) + '月',
    week: 'W' + (Math.ceil(+r.date.slice(8, 10) / 7)),
    city: cities[i % cities.length],
    category: r.product <= 'D' ? '硬件' : '配件',
    brand: ['A', 'B', 'C'].includes(r.product) ? '自有品牌' : '第三方',
    salesman: SALES_PEOPLE[i % SALES_PEOPLE.length],
    customer_level: ['A类', 'B类', 'C类'][i % 3],
    warehouse: r.region === '华东' ? '华东仓' : (r.region === '华北' ? '华北仓' : '华南仓'),
    pay_type: r.channel === '线上' ? '支付宝' : 'POS',
    dept: r.channel === '线上' ? '电商事业部' : '零售事业部',
    sku: 'SKU-' + r.product,
    cost,
    profit: r.amount - cost,
    discount: [0, 5, 8, 12][i % 4],
    unit_price: +(r.amount / Math.max(1, r.qty)).toFixed(1),
    order_cnt: 1
  };
});

const DATASETS = {
  ds_sales: {
    id: 'ds_sales', name: '销售明细',
    fields: [
      { name:'region', label:'区域', group:'dim' },
      { name:'city', label:'城市', group:'dim' },
      { name:'product', label:'产品', group:'dim' },
      { name:'sku', label:'SKU', group:'dim' },
      { name:'category', label:'品类', group:'dim' },
      { name:'brand', label:'品牌', group:'dim' },
      { name:'channel', label:'渠道', group:'dim' },
      { name:'dept', label:'事业部', group:'dim' },
      { name:'salesman', label:'销售员', group:'dim' },
      { name:'customer_level', label:'客户等级', group:'dim' },
      { name:'warehouse', label:'仓库', group:'dim' },
      { name:'pay_type', label:'支付方式', group:'dim' },
      { name:'year', label:'年', group:'dim' },
      { name:'month', label:'月', group:'dim' },
      { name:'week', label:'周', group:'dim' },
      { name:'date', label:'日期', group:'dim' },
      { name:'amount', label:'销售额', group:'quota' },
      { name:'qty', label:'销量', group:'quota' },
      { name:'cost', label:'成本', group:'quota' },
      { name:'profit', label:'利润', group:'quota' },
      { name:'discount', label:'折扣%', group:'quota' },
      { name:'unit_price', label:'单价', group:'quota' },
      { name:'order_cnt', label:'订单数', group:'quota' }
    ],
    rows: SALES_ROWS
  },
  ds_ops: {
    id: 'ds_ops', name: '运营日报',
    datasourceId: 'src_pg_bi',
    folder: '运营增长',
    desc: 'App / H5 流量与停留',
    fields: [
      { name:'day', label:'日期', group:'dim' },
      { name:'module', label:'模块', group:'dim' },
      { name:'platform', label:'端', group:'dim' },
      { name:'channel', label:'来源', group:'dim' },
      { name:'uv', label:'UV', group:'quota' },
      { name:'pv', label:'PV', group:'quota' },
      { name:'bounce', label:'跳出率', group:'quota' },
      { name:'duration', label:'停留秒', group:'quota' }
    ],
    rows: [
      { day:'周一', module:'首页', platform:'App', channel:'自然', uv:1200, pv:3400, bounce:0.32, duration:48, date:'2026-07-01' },
      { day:'周一', module:'详情', platform:'H5', channel:'投放', uv:800, pv:2100, bounce:0.41, duration:36, date:'2026-07-01' },
      { day:'周一', module:'搜索', platform:'App', channel:'分享', uv:420, pv:980, bounce:0.25, duration:55, date:'2026-07-01' },
      { day:'周二', module:'首页', platform:'App', channel:'自然', uv:1400, pv:3900, bounce:0.28, duration:52, date:'2026-07-02' },
      { day:'周二', module:'详情', platform:'H5', channel:'投放', uv:900, pv:2400, bounce:0.39, duration:40, date:'2026-07-02' },
      { day:'周二', module:'结算', platform:'App', channel:'自然', uv:510, pv:1200, bounce:0.18, duration:68, date:'2026-07-02' },
      { day:'周三', module:'首页', platform:'App', channel:'自然', uv:1320, pv:3600, bounce:0.30, duration:50, date:'2026-07-03' },
      { day:'周三', module:'结算', platform:'App', channel:'投放', uv:620, pv:1500, bounce:0.22, duration:70, date:'2026-07-03' },
      { day:'周三', module:'详情', platform:'H5', channel:'分享', uv:760, pv:1900, bounce:0.36, duration:38, date:'2026-07-03' },
      { day:'周四', module:'首页', platform:'H5', channel:'分享', uv:980, pv:2600, bounce:0.35, duration:42, date:'2026-07-04' },
      { day:'周四', module:'搜索', platform:'App', channel:'投放', uv:540, pv:1300, bounce:0.27, duration:50, date:'2026-07-04' },
      { day:'周五', module:'详情', platform:'App', channel:'自然', uv:1100, pv:3000, bounce:0.31, duration:45, date:'2026-07-05' },
      { day:'周五', module:'首页', platform:'App', channel:'投放', uv:1500, pv:4100, bounce:0.29, duration:53, date:'2026-07-05' },
      { day:'周六', module:'首页', platform:'H5', channel:'自然', uv:1680, pv:4500, bounce:0.34, duration:40, date:'2026-07-06' },
      { day:'周六', module:'结算', platform:'App', channel:'分享', uv:720, pv:1680, bounce:0.20, duration:72, date:'2026-07-06' },
      { day:'周日', module:'首页', platform:'App', channel:'自然', uv:1550, pv:4200, bounce:0.33, duration:46, date:'2026-07-07' },
      { day:'周日', module:'详情', platform:'H5', channel:'投放', uv:990, pv:2500, bounce:0.38, duration:37, date:'2026-07-07' }
    ]
  },
  ds_inv: {
    id: 'ds_inv', name: '库存快照',
    datasourceId: 'src_mysql_erp',
    folder: '财务库存',
    desc: '仓 × SKU 库存与周转',
    fields: [
      { name:'warehouse', label:'仓库', group:'dim' },
      { name:'sku', label:'SKU', group:'dim' },
      { name:'category', label:'品类', group:'dim' },
      { name:'status', label:'状态', group:'dim' },
      { name:'stock', label:'库存量', group:'quota' },
      { name:'turnover', label:'周转天数', group:'quota' },
      { name:'value', label:'库存金额', group:'quota' }
    ],
    rows: [
      { warehouse:'华东仓', sku:'SKU-A', category:'硬件', status:'正常', stock:1200, turnover:18, value:360000 },
      { warehouse:'华东仓', sku:'SKU-B', category:'硬件', status:'积压', stock:800, turnover:45, value:160000 },
      { warehouse:'华北仓', sku:'SKU-A', category:'硬件', status:'正常', stock:600, turnover:22, value:180000 },
      { warehouse:'华北仓', sku:'SKU-C', category:'配件', status:'缺货', stock:40, turnover:6, value:8000 },
      { warehouse:'华南仓', sku:'SKU-D', category:'配件', status:'正常', stock:900, turnover:15, value:90000 },
      { warehouse:'华南仓', sku:'SKU-E', category:'配件', status:'积压', stock:500, turnover:52, value:45000 }
    ]
  },
  ds_fin: {
    id: 'ds_fin', name: '财务科目月报',
    datasourceId: 'src_mysql_erp',
    folder: '财务库存',
    desc: '科目 × 月 收支',
    fields: [
      { name:'month', label:'月份', group:'dim' },
      { name:'subject', label:'科目', group:'dim' },
      { name:'dept', label:'部门', group:'dim' },
      { name:'income', label:'收入', group:'quota' },
      { name:'expense', label:'支出', group:'quota' },
      { name:'profit', label:'利润', group:'quota' }
    ],
    rows: [
      { month:'4月', subject:'商品销售', dept:'电商', income:760000, expense:480000, profit:280000 },
      { month:'4月', subject:'服务费', dept:'零售', income:110000, expense:38000, profit:72000 },
      { month:'4月', subject:'广告投放', dept:'市场', income:0, expense:90000, profit:-90000 },
      { month:'5月', subject:'商品销售', dept:'电商', income:820000, expense:510000, profit:310000 },
      { month:'5月', subject:'服务费', dept:'零售', income:120000, expense:40000, profit:80000 },
      { month:'5月', subject:'广告投放', dept:'市场', income:0, expense:95000, profit:-95000 },
      { month:'6月', subject:'商品销售', dept:'电商', income:910000, expense:560000, profit:350000 },
      { month:'6月', subject:'服务费', dept:'零售', income:135000, expense:42000, profit:93000 },
      { month:'6月', subject:'人力成本', dept:'中台', income:0, expense:180000, profit:-180000 },
      { month:'7月', subject:'商品销售', dept:'电商', income:980000, expense:590000, profit:390000 },
      { month:'7月', subject:'服务费', dept:'零售', income:148000, expense:45000, profit:103000 },
      { month:'7月', subject:'人力成本', dept:'中台', income:0, expense:185000, profit:-185000 }
    ]
  },
  ds_crm: {
    id: 'ds_crm', name: '客户分层',
    datasourceId: 'src_api_crm',
    folder: '销售分析',
    desc: '客户等级与复购',
    fields: [
      { name:'level', label:'客户等级', group:'dim' },
      { name:'region', label:'区域', group:'dim' },
      { name:'industry', label:'行业', group:'dim' },
      { name:'customers', label:'客户数', group:'quota' },
      { name:'gmv', label:'贡献GMV', group:'quota' },
      { name:'repurchase', label:'复购率', group:'quota' }
    ],
    rows: [
      { level:'A类', region:'华东', industry:'制造', customers:120, gmv:480000, repurchase:0.62 },
      { level:'A类', region:'华北', industry:'零售', customers:80, gmv:310000, repurchase:0.58 },
      { level:'B类', region:'华东', industry:'制造', customers:260, gmv:390000, repurchase:0.41 },
      { level:'B类', region:'华南', industry:'服务', customers:200, gmv:280000, repurchase:0.38 },
      { level:'C类', region:'华北', industry:'零售', customers:450, gmv:180000, repurchase:0.22 },
      { level:'C类', region:'华南', industry:'服务', customers:380, gmv:150000, repurchase:0.19 }
    ]
  }
};

DATASETS.ds_sales.datasourceId = 'src_mysql_erp';
DATASETS.ds_sales.folder = '销售分析';
DATASETS.ds_sales.desc = '订单明细宽表（演示）';

const DATASOURCES = [
  {
    id: 'src_mysql_erp', name: 'ERP 业务库', type: 'mysql', host: '10.0.1.12', port: 3306,
    database: 'erp_prod', status: 'ok', lastCheck: '2026-07-29 10:12', owner: '张三',
    tables: 48, usedBy: ['ds_sales', 'ds_inv', 'ds_fin'], desc: '订单 / 库存 / 财务主库'
  },
  {
    id: 'src_pg_bi', name: 'BI 数仓', type: 'postgresql', host: 'bi-pg.internal', port: 5432,
    database: 'dwh', status: 'ok', lastCheck: '2026-07-29 09:40', owner: '李四',
    tables: 126, usedBy: ['ds_ops'], desc: '日聚合宽表与流量主题'
  },
  {
    id: 'src_api_crm', name: 'CRM OpenAPI', type: 'api', host: 'https://crm.example.com/v1', port: null,
    database: '-', status: 'warn', lastCheck: '2026-07-28 22:05', owner: '王五',
    tables: 6, usedBy: ['ds_crm'], desc: '客户主数据 REST · Token 将过期'
  },
  {
    id: 'src_excel_promo', name: '促销活动表', type: 'excel', host: '本地上传', port: null,
    database: 'promo_2026Q3.xlsx', status: 'ok', lastCheck: '2026-07-27 16:20', owner: '赵六',
    tables: 2, usedBy: [], desc: '活动预算与核销明细'
  },
  {
    id: 'src_click_log', name: '行为日志 ClickHouse', type: 'clickhouse', host: 'ch-01.internal', port: 8123,
    database: 'events', status: 'err', lastCheck: '2026-07-29 08:01', owner: '钱七',
    tables: 12, usedBy: [], desc: '连接超时 · 待运维恢复'
  }
];

/** 各数据源下的物理表 + 字段（数据集拖拉拽用） */
const SCHEMA_BY_SRC = {
  src_mysql_erp: [
    {
      name: 'fact_order', label: '订单事实',
      fields: [
        { name: 'order_id', label: '订单号', group: 'dim' },
        { name: 'region', label: '区域', group: 'dim' },
        { name: 'city', label: '城市', group: 'dim' },
        { name: 'product', label: '产品', group: 'dim' },
        { name: 'channel', label: '渠道', group: 'dim' },
        { name: 'salesman', label: '销售员', group: 'dim' },
        { name: 'order_date', label: '下单日', group: 'dim' },
        { name: 'amount', label: '销售额', group: 'quota' },
        { name: 'qty', label: '销量', group: 'quota' },
        { name: 'profit', label: '利润', group: 'quota' }
      ],
      rows: SALES_ROWS.map((r, i) => ({ order_id: 'O' + (1000 + i), region: r.region, city: r.city, product: r.product, channel: r.channel, salesman: r.salesman, order_date: r.date, amount: r.amount, qty: r.qty, profit: r.profit }))
    },
    {
      name: 'dim_product', label: '产品维表',
      fields: [
        { name: 'sku', label: 'SKU', group: 'dim' },
        { name: 'product', label: '产品名', group: 'dim' },
        { name: 'category', label: '品类', group: 'dim' },
        { name: 'brand', label: '品牌', group: 'dim' },
        { name: 'list_price', label: '挂牌价', group: 'quota' }
      ],
      rows: [
        { sku: 'SKU-A', product: 'A', category: '硬件', brand: '自有品牌', list_price: 399 },
        { sku: 'SKU-B', product: 'B', category: '硬件', brand: '自有品牌', list_price: 299 },
        { sku: 'SKU-C', product: 'C', category: '硬件', brand: '自有品牌', list_price: 199 },
        { sku: 'SKU-E', product: 'E', category: '配件', brand: '第三方', list_price: 89 },
        { sku: 'SKU-F', product: 'F', category: '配件', brand: '第三方', list_price: 129 }
      ]
    },
    {
      name: 'fact_inventory', label: '库存快照',
      fields: [
        { name: 'warehouse', label: '仓库', group: 'dim' },
        { name: 'sku', label: 'SKU', group: 'dim' },
        { name: 'category', label: '品类', group: 'dim' },
        { name: 'status', label: '状态', group: 'dim' },
        { name: 'stock', label: '库存量', group: 'quota' },
        { name: 'turnover', label: '周转天数', group: 'quota' },
        { name: 'value', label: '库存金额', group: 'quota' }
      ],
      rows: DATASETS.ds_inv.rows
    },
    {
      name: 'fact_finance', label: '财务科目',
      fields: [
        { name: 'month', label: '月份', group: 'dim' },
        { name: 'subject', label: '科目', group: 'dim' },
        { name: 'dept', label: '部门', group: 'dim' },
        { name: 'income', label: '收入', group: 'quota' },
        { name: 'expense', label: '支出', group: 'quota' },
        { name: 'profit', label: '利润', group: 'quota' }
      ],
      rows: DATASETS.ds_fin.rows
    }
  ],
  src_pg_bi: [
    {
      name: 'ods_traffic_day', label: '日流量宽表',
      fields: [
        { name: 'day', label: '星期', group: 'dim' },
        { name: 'module', label: '模块', group: 'dim' },
        { name: 'platform', label: '端', group: 'dim' },
        { name: 'channel', label: '来源', group: 'dim' },
        { name: 'uv', label: 'UV', group: 'quota' },
        { name: 'pv', label: 'PV', group: 'quota' },
        { name: 'bounce', label: '跳出率', group: 'quota' },
        { name: 'duration', label: '停留秒', group: 'quota' }
      ],
      rows: DATASETS.ds_ops.rows
    },
    {
      name: 'dim_channel', label: '来源维表',
      fields: [
        { name: 'channel', label: '来源', group: 'dim' },
        { name: 'channel_type', label: '来源类型', group: 'dim' },
        { name: 'cost', label: '投放成本', group: 'quota' }
      ],
      rows: [
        { channel: '自然', channel_type: '免费', cost: 0 },
        { channel: '投放', channel_type: '付费', cost: 28000 },
        { channel: '分享', channel_type: '裂变', cost: 1200 }
      ]
    }
  ],
  src_api_crm: [
    {
      name: 'customer_tier', label: '客户分层',
      fields: [
        { name: 'level', label: '客户等级', group: 'dim' },
        { name: 'region', label: '区域', group: 'dim' },
        { name: 'industry', label: '行业', group: 'dim' },
        { name: 'customers', label: '客户数', group: 'quota' },
        { name: 'gmv', label: '贡献GMV', group: 'quota' },
        { name: 'repurchase', label: '复购率', group: 'quota' }
      ],
      rows: DATASETS.ds_crm.rows
    },
    {
      name: 'customer_touch', label: '触达记录',
      fields: [
        { name: 'touch_type', label: '触达方式', group: 'dim' },
        { name: 'level', label: '客户等级', group: 'dim' },
        { name: 'touches', label: '触达次数', group: 'quota' },
        { name: 'convert', label: '转化数', group: 'quota' }
      ],
      rows: [
        { touch_type: '电话', level: 'A类', touches: 320, convert: 48 },
        { touch_type: '企微', level: 'A类', touches: 510, convert: 90 },
        { touch_type: '邮件', level: 'B类', touches: 880, convert: 62 },
        { touch_type: '企微', level: 'B类', touches: 640, convert: 55 },
        { touch_type: '短信', level: 'C类', touches: 1200, convert: 36 }
      ]
    }
  ],
  src_excel_promo: [
    {
      name: 'promo_budget', label: '活动预算',
      fields: [
        { name: 'campaign', label: '活动', group: 'dim' },
        { name: 'channel', label: '渠道', group: 'dim' },
        { name: 'budget', label: '预算', group: 'quota' },
        { name: 'spent', label: '已花', group: 'quota' },
        { name: 'roi', label: 'ROI', group: 'quota' }
      ],
      rows: [
        { campaign: '618主会场', channel: '线上', budget: 200000, spent: 168000, roi: 3.2 },
        { campaign: '新人礼', channel: '线上', budget: 50000, spent: 42000, roi: 2.1 },
        { campaign: '门店满减', channel: '线下', budget: 80000, spent: 61000, roi: 1.8 }
      ]
    }
  ],
  src_click_log: [
    {
      name: 'evt_page_view', label: '浏览事件',
      fields: [
        { name: 'page', label: '页面', group: 'dim' },
        { name: 'device', label: '设备', group: 'dim' },
        { name: 'pv', label: 'PV', group: 'quota' },
        { name: 'users', label: '用户数', group: 'quota' }
      ],
      rows: [
        { page: 'home', device: 'iOS', pv: 12000, users: 4200 },
        { page: 'detail', device: 'Android', pv: 8600, users: 3100 }
      ]
    }
  ]
};

function tablesOfSrc(srcId) {
  return SCHEMA_BY_SRC[srcId] || [];
}

function findSchemaTable(srcId, tableName) {
  return tablesOfSrc(srcId).find(t => t.name === tableName) || null;
}

/**
 * 图表编码能力：need=必填槽；slots.max=可绑字段数；guide=配置区说明
 * 维度多选 → 拼合分类轴；指标多选 → 多系列 / 多度量列
 */
const CHART_META = {
  bar: {
    label:'柱状图', need:['category','value'], group:'比较', icon:'bar',
    guide: '对比各类别数值。多维度拼合为组合标签，多指标生成多系列柱；堆叠维可拆色堆叠。',
    slots: {
      category: { max: 3, tip: '分类轴，多维拼合标签 · 点 ▾ 设排序/别名' },
      value: { max: 5, tip: '每个指标一条系列 · 点 ▾ 设聚合/格式' },
      color: { max: 1, tip: '堆叠/拆色维（可选）' }
    }
  },
  hbar: {
    label:'条形图', need:['category','value'], group:'比较', icon:'hbar',
    guide: '横向对比排序类数据。能力同柱状图：维度拼合轴，多指标多系列，可堆叠。',
    slots: {
      category: { max: 3, tip: '分类轴，多维拼合标签 · 点 ▾ 设排序/别名' },
      value: { max: 5, tip: '每个指标一条系列 · 点 ▾ 设聚合/格式' },
      color: { max: 1, tip: '堆叠/拆色维（可选）' }
    }
  },
  line: {
    label:'折线图', need:['category','value'], group:'趋势', icon:'line',
    guide: '看趋势变化，维度宜少（常为时间）。多指标画多条折线便于对照。',
    slots: {
      category: { max: 2, tip: '横轴，建议时间或有序维 · 点 ▾ 设排序/别名' },
      value: { max: 5, tip: '每条折线一个指标 · 点 ▾ 设聚合/格式' },
      color: { max: 1, tip: '拆分系列维（可选）' }
    }
  },
  area: {
    label:'面积图', need:['category','value'], group:'趋势', icon:'area',
    guide: '趋势 + 量级对比。维度不宜过多，以免面积堆叠难读。',
    slots: {
      category: { max: 2, tip: '横轴，建议时间或有序维 · 点 ▾ 设排序/别名' },
      value: { max: 5, tip: '每条面积一个指标 · 点 ▾ 设聚合/格式' },
      color: { max: 1, tip: '拆分系列维（可选）' }
    }
  },
  pie: {
    label:'饼图', need:['category','value'], group:'分布', icon:'pie',
    guide: '看占比结构：仅支持 1 个维度 + 1 个指标，扇区过多时可读性差。',
    slots: {
      category: { max: 1, tip: '扇区分类，仅 1 个 · 点 ▾ 设排序/别名' },
      value: { max: 1, tip: '占比度量，仅 1 个 · 点 ▾ 设聚合/格式' }
    }
  },
  kpi: {
    label:'指标卡', need:['value'], group:'指标', icon:'kpi',
    guide: '展示单一汇总结果。只需 1 个指标；维度请用页面筛选或切片器控制范围。',
    slots: {
      value: { max: 1, tip: '汇总指标，仅 1 个 · 点 ▾ 设聚合/格式' }
    }
  },
  table: {
    label:'明细表', need:[], group:'表格', icon:'table',
    guide: '展示过滤后的原始行。维度与指标分槽绑定（对齐 DataEase）；明细表不聚合。',
    slots: {
      category: { max: 0, tip: '维度列，可多选拖拽排序' },
      value: { max: 0, tip: '指标列，展示原值、不聚合' }
    }
  },
  grouptable: {
    label:'汇总表', need:['category','value'], group:'表格', icon:'grouptable',
    guide: '按维度分组聚合。多维度生成多分组列，多指标生成多度量列；点 ▾ 设字段级聚合。',
    slots: {
      category: { max: 5, tip: '分组列，可多选 · 点 ▾ 设排序/别名' },
      value: { max: 5, tip: '度量列，可多选 · 点 ▾ 设聚合/格式' },
      color: { max: 1, tip: '可选二级分组' }
    }
  },
  pivot: {
    label:'透视表', need:['category','colDim','value'], group:'表格', icon:'pivot',
    guide: '默认商务蓝交叉表。行维 × 列维交叉汇总；拖入维度/指标即可，多指标时可选多层列头。',
    slots: {
      category: { max: 3, tip: '行维 · 点 ▾ 设排序/别名' },
      colDim: { max: 3, tip: '列维 · 点 ▾ 设排序/别名' },
      value: { max: 3, tip: '交叉度量 · 点 ▾ 设聚合/格式' }
    }
  }
};

const CHART_PRESETS = {
  ranking: {
    label: '指标排行', chartType: 'grouptable', group: '表格', icon: 'grouptable',
    guide: '按维度汇总指标，适合制作紧凑的排行与对比列表。',
    style: { pageSize: 5, stripe: true }
  },
  numbercard: {
    label: '数值卡', chartType: 'kpi', group: '指标', icon: 'kpi',
    guide: '突出展示单一汇总数值，不显示同比或环比说明。',
    style: { showCompare: false, valueAlign: 'center', valueSize: 30 }
  },
  donut: {
    label: '环形图', chartType: 'pie', group: '分布', icon: 'donut',
    guide: '用环形结构展示分类占比，适合少量类别的组成分析。',
    style: { pieInner: 55, pieOuter: 72 }
  }
};

function isTableType(t) {
  return t === 'table' || t === 'grouptable' || t === 'pivot';
}

function chartIcon(kind) {
  const c = '#3370ff', c2 = '#8fb3ff';
  const icons = {
    bar: `<svg viewBox="0 0 52 32" fill="none"><rect x="6" y="14" width="8" height="14" rx="2" fill="${c2}"/><rect x="18" y="6" width="8" height="22" rx="2" fill="${c}"/><rect x="30" y="10" width="8" height="18" rx="2" fill="${c2}"/><rect x="42" y="16" width="6" height="12" rx="2" fill="${c}"/></svg>`,
    hbar: `<svg viewBox="0 0 52 32" fill="none"><rect x="4" y="5" width="28" height="5" rx="2" fill="${c}"/><rect x="4" y="14" width="40" height="5" rx="2" fill="${c2}"/><rect x="4" y="23" width="22" height="5" rx="2" fill="${c}"/></svg>`,
    line: `<svg viewBox="0 0 52 32" fill="none"><path d="M4 24 L16 18 L28 22 L40 8 L48 12" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="18" r="2.5" fill="${c}"/><circle cx="40" cy="8" r="2.5" fill="${c}"/></svg>`,
    area: `<svg viewBox="0 0 52 32" fill="none"><path d="M4 26 L4 20 L16 12 L28 16 L40 6 L48 10 L48 26 Z" fill="${c2}" opacity=".55"/><path d="M4 20 L16 12 L28 16 L40 6 L48 10" stroke="${c}" stroke-width="2" stroke-linejoin="round"/></svg>`,
    pie: `<svg viewBox="0 0 52 32" fill="none"><circle cx="26" cy="16" r="12" fill="${c2}"/><path d="M26 16 L26 4 A12 12 0 0 1 37 22 Z" fill="${c}"/></svg>`,
    donut: `<svg viewBox="0 0 52 32" fill="none"><circle cx="26" cy="16" r="11" stroke="${c2}" stroke-width="6"/><path d="M26 5a11 11 0 0 1 10 15.5" stroke="${c}" stroke-width="6" stroke-linecap="round"/></svg>`,
    kpi: `<svg viewBox="0 0 52 32" fill="none"><rect x="6" y="6" width="40" height="20" rx="4" fill="#e8f0ff"/><text x="26" y="20" text-anchor="middle" fill="${c}" font-size="12" font-weight="700" font-family="sans-serif">1.2k</text></svg>`,
    table: `<svg viewBox="0 0 52 32" fill="none"><rect x="6" y="5" width="40" height="22" rx="3" stroke="${c}" stroke-width="1.5" fill="#fff"/><path d="M6 12h40M6 19h40M19 5v22M33 5v22" stroke="${c2}" stroke-width="1.2"/></svg>`,
    grouptable: `<svg viewBox="0 0 52 32" fill="none"><rect x="6" y="5" width="40" height="22" rx="3" stroke="${c}" stroke-width="1.5" fill="#fff"/><path d="M6 12h40M6 20h40" stroke="${c2}" stroke-width="1.2"/><rect x="6" y="5" width="40" height="7" fill="${c2}" opacity=".35"/><path d="M14 20v7M28 20v7" stroke="${c}" stroke-width="1.2"/></svg>`,
    pivot: `<svg viewBox="0 0 52 32" fill="none"><rect x="6" y="5" width="40" height="22" rx="3" stroke="${c}" stroke-width="1.5" fill="#fff"/><rect x="6" y="5" width="12" height="22" fill="#e8f0ff"/><rect x="6" y="5" width="40" height="7" fill="${c2}" opacity=".45"/><path d="M18 12v15M30 12v15M42 12v15M6 19h40" stroke="${c2}" stroke-width="1"/><text x="11" y="22" fill="${c}" font-size="7" font-family="sans-serif" font-weight="700">Σ</text></svg>`,
    slicer: `<svg viewBox="0 0 52 32" fill="none"><rect x="6" y="10" width="14" height="12" rx="6" fill="${c}"/><rect x="24" y="10" width="14" height="12" rx="6" fill="${c2}"/><rect x="42" y="10" width="6" height="12" rx="3" fill="#d6e4ff"/></svg>`,
    text: `<svg viewBox="0 0 52 32" fill="none"><path d="M14 8h24M26 8v16" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><path d="M12 24h28" stroke="${c2}" stroke-width="2" stroke-linecap="round"/></svg>`,
    query: `<svg viewBox="0 0 52 32" fill="none"><rect x="5" y="8" width="18" height="16" rx="3" stroke="${c}" stroke-width="1.5" fill="#fff"/><rect x="27" y="8" width="20" height="7" rx="2" fill="${c2}"/><rect x="27" y="18" width="14" height="6" rx="2" fill="#d6e4ff"/><circle cx="12" cy="16" r="2.5" fill="${c}"/></svg>`
  };
  return icons[kind] || icons.bar;
}

function defaultChartStyle() {
  return {
    // 卡片 / 背景（DataEase §1 背景 + §11 边框）
    bg: '#ffffff',
    borderColor: '#e5e6eb',
    borderWidth: 1,
    cardRadius: 10,
    cardPadding: 8,
    showTitle: true,
    titleColor: '#1f2329',
    titleBg: '#fafbfc',
    titleSize: 12,
    titleAlign: 'left',
    titleBold: true,
    bodyColor: '#646a73',
    // 图例（§7）
    showLegend: true,
    legendPos: 'top',
    legendFontSize: 11,
    // 标签（§4）
    showLabel: false,
    labelSize: 10,
    labelColor: '#1f2329',
    labelName: true,
    labelValue: true,
    labelPercent: false,
    labelMode: 'adaptive', // adaptive | all
    showStackTotal: false,
    // 提示（§5 / §10）
    showTooltip: true,
    tooltipFontSize: 12,
    tooltipCarousel: false,
    tooltipStay: 2,
    tooltipInterval: 3,
    // 坐标轴
    showXAxis: true,
    xAxisPos: 'bottom', // top | bottom
    showXAxisName: false,
    xAxisName: '',
    xAxisNameColor: '#1f2329',
    xAxisNameSize: 12,
    showXAxisLine: true,
    xAxisLineColor: '#c9cdd4',
    xAxisLineWidth: 1,
    xAxisLineType: 'solid',
    showXSplitLine: false,
    xSplitLineColor: '#eff0f1',
    showXAxisLabel: true,
    xAxisLabelColor: '#646a73',
    xAxisLabelSize: 11,
    xAxisLabelRotate: 0,
    showYAxis: true,
    yAxisPos: 'left', // left | right
    showYAxisName: false,
    yAxisName: '',
    yAxisNameColor: '#1f2329',
    yAxisNameSize: 12,
    showYAxisLine: true,
    yAxisLineColor: '#c9cdd4',
    yAxisLineWidth: 1,
    yAxisLineType: 'solid',
    showYSplitLine: true,
    ySplitLineColor: '#eff0f1',
    showYAxisLabel: true,
    yAxisLabelColor: '#646a73',
    yAxisLabelSize: 11,
    axisUnit: 'none', // none | k | wan | yi
    // 系列形态
    smooth: true,
    barRadius: 2,
    barWidth: 0,
    barGap: '30%',
    stackMode: 'group',
    lineWidth: 2,
    showSymbol: true,
    symbolSize: 6,
    areaOpacity: 0.35,
    seriesColors: [],
    // 饼图
    pieInner: 35,
    pieOuter: 65,
    pieRose: false,
    piePadAngle: 0,
    // 空值 / 条件样式
    emptyValue: '-',
    condEnabled: false,
    condField: '',
    condOp: 'gt',
    condValue: '',
    condBg: '#fff1f0',
    condColor: '#cf1322',
    // 表格
    pageSize: 5,
    pageMode: 'page',
    scrollRows: 3,
    scrollInterval: 2,
    showHeader: true,
    stripe: true,
    headerBg: '#f5f6f7',
    headerColor: '#1f2329',
    headerBold: true,
    headerSize: 12,
    tableFontSize: 12,
    cellBg: '#ffffff',
    cellColor: '#1f2329',
    cellAlign: 'left',
    cellVAlign: 'middle',
    cellBold: false,
    cellItalic: false,
    rowHeight: 36,
    stripeBg: '#fafbfc',
    totalBg: '#f0f4ff',
    totalColor: '#1f2329',
    colWidthMode: 'adaptive', // adaptive | fixed | custom
    colWidthPx: 120,
    colWidths: {}, // { field: number } 自定义列宽百分比
    colWidthEditField: '',
    freezeLeft: 0,
    freezeTop: 0,
    showIndex: false,
    autoWrap: false,
    mergeCells: false,
    showHBorder: true,
    showVBorder: true,
    showTableBorder: true,
    showTableTooltip: true,
    scrollbarColor: '#c9cdd4',
    tableOpacity: 100,
    rowHeadBg: '#ffffff',
    rowHeadColor: '#1f2329',
    rowHeadBold: true,
    cornerBg: '#eef2ff',
    cornerColor: '#1f2329',
    pivotMultiHead: true,
    pivotLayout: 'flat',
    pivotMeasurePos: 'col',
    showRowTotal: true,
    showColTotal: true,
    // 指标卡
    valueColor: '#1f2329',
    valueSize: 28,
    valueAlign: 'left',
    valuePrefix: '',
    valueSuffix: '',
    showCompare: true,
    kpiSubtitle: ''
  };
}

/** 透视表默认：商务蓝表头/行头 + 年月 meta，拖维/指标即可接近业绩达成表 */
function defaultPivotStyle() {
  return {
    ...defaultChartStyle(),
    titleBg: '#ffffff',
    titleColor: '#1f2329',
    titleSize: 14,
    titleBold: true,
    headerBg: '#eef4ff',
    headerColor: '#1f2329',
    headerBold: true,
    rowHeadBg: '#f7f8fa',
    rowHeadColor: '#1f2329',
    rowHeadBold: true,
    cornerBg: '#e8f0ff',
    cornerColor: '#1f2329',
    cellAlign: 'center',
    stripe: false,
    pivotMultiHead: true,
    showRowTotal: false,
    showColTotal: false,
    pivotMeta: true,
    pivotMetaLabel: '当前年月',
    pivotMetaValue: ''
  };
}

function styleDefaultsFor(chartType) {
  return chartType === 'pivot' ? defaultPivotStyle() : defaultChartStyle();
}

function ensureStyle(ch) {
  const base = styleDefaultsFor(ch.chartType);
  if (!ch.style) ch.style = { ...base };
  else ch.style = { ...base, ...ch.style };
  // 旧字段迁移 → 横/纵轴分区
  const st = ch.style;
  if (st.showAxisName && !st.showXAxisName && !st.showYAxisName) {
    st.showXAxisName = true;
    st.showYAxisName = true;
  }
  if (st.showSplitLine === false && st.showYSplitLine === undefined) st.showYSplitLine = false;
  if (st.showAxisLine === false) {
    if (st.showXAxisLine === undefined) st.showXAxisLine = false;
    if (st.showYAxisLine === undefined) st.showYAxisLine = false;
  }
  if (st.showAxisLabel === false) {
    if (st.showXAxisLabel === undefined) st.showXAxisLabel = false;
    if (st.showYAxisLabel === undefined) st.showYAxisLabel = false;
  }
  if (st.axisLabelSize && !st.xAxisLabelSize) st.xAxisLabelSize = st.axisLabelSize;
  if (st.axisLabelSize && !st.yAxisLabelSize) st.yAxisLabelSize = st.axisLabelSize;
  if (!st.colWidths || typeof st.colWidths !== 'object') st.colWidths = {};
  return st;
}

function defaultPivotMetaValue() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 高级分析默认（DataEase：联动/跳转/钻取/辅助线/TopN/告警） */
function defaultSenior() {
  return {
    resultLimit: 0,       // 0=全部
    topN: 0,              // 饼图 TopN，0=关闭
    auxEnabled: false,
    auxValue: 0,
    auxLabel: '辅助线',
    drillEnabled: true,
    clickAction: 'auto'   // auto | linkage | drill | jump
  };
}

function ensureSenior(ch) {
  if (!ch.senior) ch.senior = defaultSenior();
  else ch.senior = { ...defaultSenior(), ...ch.senior };
  return ch.senior;
}

/** 样式面板能力说明（按组件） */
function styleCaps(type) {
  const map = {
    bar: ['背景', '配色', '图例', '标签', '提示', '坐标轴', '柱形', '堆叠'],
    hbar: ['背景', '配色', '图例', '标签', '提示', '坐标轴', '条形', '堆叠'],
    line: ['背景', '配色', '图例', '标签', '提示', '坐标轴', '折线', '拐点'],
    area: ['背景', '配色', '图例', '标签', '提示', '坐标轴', '面积透明度'],
    pie: ['背景', '配色', '图例', '标签内容', '提示', '饼环'],
    kpi: ['背景', '数值', '对比区', '副标题'],
    table: ['基础样式', '表头', '单元格', '冻结', '分页', '条件样式'],
    grouptable: ['基础样式', '表头', '单元格', '冻结', '合计', '分页', '条件样式'],
    pivot: ['基础样式', '列头', '行头', '角头', '单元格', '合计', '展示', '条件样式'],
    slicer: ['背景', '文字', '圆角'],
    text: ['背景', '文字', '字号', '对齐'],
    query: ['背景', '圆角', '内容分布']
  };
  return map[type] || ['卡片'];
}

/** 高级面板能力说明（按组件） */
function seniorCaps(type) {
  const map = {
    bar: ['联动', '跳转', '下钻', '辅助线', '结果条数', '快速计算'],
    hbar: ['联动', '跳转', '下钻', '辅助线', '结果条数', '快速计算'],
    line: ['联动', '跳转', '下钻', '辅助线', '结果条数', '快速计算'],
    area: ['联动', '跳转', '下钻', '辅助线', '结果条数', '快速计算'],
    pie: ['联动', '跳转', 'TopN', '快速计算'],
    kpi: ['阈值告警', '快速计算'],
    table: ['跳转'],
    grouptable: ['联动', '跳转', '结果条数'],
    pivot: ['跳转'],
    slicer: ['筛选作用域'],
    text: ['无分析项']
  };
  return map[type] || [];
}

const THEMES = {
  default: { brand:'#3370ff', series:['#3370ff','#00b578','#ff8800','#f54a45'] },
  ocean:   { brand:'#0ea5e9', series:['#0ea5e9','#14b8a6','#6366f1','#f59e0b'] },
  forest:  { brand:'#059669', series:['#059669','#84cc16','#0d9488','#ca8a04'] },
  rose:    { brand:'#e11d48', series:['#e11d48','#f97316','#a855f7','#64748b'] },
  mono:    { brand:'#334155', series:['#334155','#64748b','#94a3b8','#cbd5e1'] }
};

const state = {
  module: 'workbench', // workbench | datasource | dataset | dashboard | report
  screen: 'list',      // list | editor | preview（仪表盘）；报告用 list | editor
  phase: 'a',
  mobile: false,
  shareViewer: false,  // 公开分享访客：无管理工具栏
  editSurface: 'pc', // pc | mobile（编辑器画布）
  leftTab: 'comp',
  rightTab: 'data',
  leftCollapsed: false,
  inspCollapsed: false,
  bindCollapsed: false,
  opsCollapsed: false,
  selectedId: null,
  clipboard: null,
  filter: { region: '', channel: '', dateFrom: '', dateTo: '' },
  /** field -> { targetChartIds: null | string[] }；null = 同页所有含该字段的图 */
  filterMeta: {},
  linkageHits: [],
  drillStack: [],
  shares: [],
  undo: [],
  dash: null,
  dashboards: [],
  dashId: null,
  reports: [],
  reportId: null,
  reportSelectedBlockId: null,
  rptMenu: 'base',
  rptShowToc: false,
  rptDirty: false,
  rptZoom: 1,
  rptLayout: 'page',
  rptSavedAt: '',
  rptRightTab: 'data',
  rptInspCollapsed: false,
  _rptChartProxy: null,
  folderFilter: 'all',
  search: '',
  srcId: 'src_mysql_erp',
  datasetId: 'ds_sales',
  dsWizardStep: 1,
  srcTypeFilter: 'all',
  dsTab: 'fields', // fields | preview | lineage
  previewFrom: 'list', // list | editor — 预览返回去向
  chartInst: {},
  layout: { push: true, compactOnDrop: false, showGrid: true },
  /** 字段已改但尚未点「更新数据」的图表 id */
  pendingPaint: new Set()
};

function toast(msg, type='') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  const toastHost = elById('toasts');
  if (toastHost) toastHost.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/** 编码/校验类提示：居中弹窗，避免右下角 toast 挡住「更新数据」 */
function alertDialog(msg, title = '提示') {
  showModal(`
    <div class="alert-dialog">
      <h3>${esc(title)}</h3>
      <p class="alert-dialog-body">${esc(msg)}</p>
      <div class="actions">
        <button type="button" class="btn primary" id="alertOk">知道了</button>
      </div>
    </div>
  `, { alert: true });
  const ok = document.getElementById('alertOk');
  if (ok) ok.onclick = () => hideModal();
}

function emptyDash(name='未命名仪表盘', id) {
  return {
    id: id || uid('dash'), name, status: 'draft', contentId: '1', version: 1,
    theme: 'default',
    components: [],
    charts: {},
    linkages: [],
    jumps: [],
    alerts: [],
    tabs: [{ id: 'tab_main', name: '概览' }],
    activeTab: 'tab_main',
    share: null,
    mobile: { enabled: false, device: 'iphone_14', bg: '#f0f2f5', components: [] }
  };
}

function defaultEncode(kind) {
  const base = { agg: 'SUM', format: 'thousand', calc: 'none', fieldCfg: {} };
  if (kind === 'kpi') return { ...base, value: 'amount', calc: 'yoy' };
  if (kind === 'table') {
    const fields = (DATASETS[defaultDatasetId()] || Object.values(DATASETS)[0])?.fields || [];
    const dims = fields.filter(f => f.group !== 'quota').map(f => f.name);
    const quotas = fields.filter(f => f.group === 'quota').map(f => f.name);
    return {
      ...base,
      category: dims.length ? dims : ['region', 'product', 'channel', 'salesman'],
      value: quotas.length ? quotas : ['amount', 'qty'],
      format: 'raw'
    };
  }
  if (kind === 'pivot') return { ...base, category: 'region', colDim: 'product', value: 'amount' };
  if (kind === 'grouptable') return { ...base, category: 'channel', value: 'amount' };
  if (kind === 'pie') return { ...base, category: 'channel', value: 'amount' };
  if (kind === 'line' || kind === 'area') return { ...base, category: 'product', value: 'amount' };
  if (kind === 'hbar') return { ...base, category: 'region', value: 'qty', format: 'raw' };
  return { ...base, category: 'region', value: 'amount' };
}

/** 新建图表：不预填数据集与编码槽，由用户自选 */
function emptyEncode(kind) {
  const base = { agg: 'SUM', format: kind === 'table' ? 'raw' : 'thousand', calc: 'none', fieldCfg: {} };
  if (kind === 'kpi') return { ...base, calc: 'none' };
  return { ...base };
}

/** 切换图表类型：继承维度/指标/筛选，按新类型槽位上限裁剪 */
function adaptEncodeForChartType(prev, nextType) {
  const base = emptyEncode(nextType);
  const src = prev || {};
  const next = {
    ...base,
    agg: src.agg || base.agg,
    format: src.format || base.format,
    calc: src.calc || base.calc,
    fieldCfg: src.fieldCfg && typeof src.fieldCfg === 'object' ? { ...src.fieldCfg } : {},
    filters: Array.isArray(src.filters) ? src.filters.map((f) => ({ ...f })) : []
  };
  const meta = CHART_META[nextType] || CHART_META.bar;
  for (const slot of ['category', 'value', 'colDim', 'color', 'columns']) {
    const fields = encodeFields(src, slot);
    if (!fields.length) continue;
    if (!meta.slots?.[slot]) {
      // 新类型暂无此槽：原样保留，便于切回时恢复
      setEncodeFields(next, slot, fields);
      continue;
    }
    setEncodeFields(next, slot, fields.slice(0, slotMax(nextType, slot)));
  }
  if (nextType === 'table') {
    migrateTableEncode({ chartType: 'table', datasetId: src.datasetId, encode: next, fieldRoles: src.fieldRoles });
  }
  return next;
}

function mkChart(type, title, encodeExtra = {}, styleExtra = {}, datasetId) {
  const dsId = datasetId || defaultDatasetId();
  const id = uid('chart');
  return {
    id,
    chart: {
      id, title, chartType: type, datasetId,
      encode: { ...defaultEncode(type), ...encodeExtra },
      style: { ...styleDefaultsFor(type), ...styleExtra }
    }
  };
}

function packDash(d, meta = {}) {
  return {
    ...d,
    folder: meta.folder || '未分组',
    desc: meta.desc || '',
    updateBy: meta.updateBy || '当前用户',
    updateTime: meta.updateTime || '2026-07-29 18:20',
    datasetIds: [...new Set(Object.values(d.charts || {}).map(c => c.datasetId).filter(Boolean))]
  };
}

/** items: {type:'chart', ref, x,y,w,h} | {type:'slicer'|'text', props, x,y,w,h} */
function assembleDash(d, items) {
  d.charts = {};
  d.components = items.map((it, i) => {
    const base = { id: uid('w'), tabId: it.tabId || 'tab_main', x: it.x, y: it.y, w: it.w, h: it.h, z: i + 1 };
    if (it.type === 'chart') {
      d.charts[it.ref.id] = it.ref.chart;
      return { ...base, type: 'chart', chartId: it.ref.id };
    }
    return { ...base, type: it.type, props: it.props || {} };
  });
}

function seedSalesMobile(d) {
  const byTitle = {};
  Object.values(d.charts).forEach(ch => {
    byTitle[ch.title] = d.components.find(c => c.chartId === ch.id);
  });
  const slicer = d.components.find(c => c.type === 'slicer');
  const m = ensureMobile(d);
  m.enabled = true;
  m.device = 'iphone_14';
  m.bg = '#f0f2f5';
  m.components = [];
  let y = 0;
  if (slicer) {
    m.components.push({ id: uid('m'), refId: slicer.id, x: 0, y: 0, w: 6, h: 1, z: 1, styleSync: true, style: null });
    y = 1;
  }
  const kpis = ['本月 GMV', '本月销量', '利润', '订单数'].map(t => byTitle[t]).filter(Boolean);
  kpis.forEach((pc, i) => {
    m.components.push({
      id: uid('m'), refId: pc.id,
      x: (i % 2) * 3, y: y + Math.floor(i / 2) * 3, w: 3, h: 3,
      z: m.components.length + 1, styleSync: true, style: null
    });
  });
  y += Math.ceil(Math.max(kpis.length, 1) / 2) * 3;
  ['区域销售额', '渠道占比'].map(t => byTitle[t]).filter(Boolean).forEach(pc => {
    m.components.push({
      id: uid('m'), refId: pc.id, x: 0, y, w: 6, h: 4,
      z: m.components.length + 1, styleSync: true, style: null
    });
    y += 4;
  });
}

function demoDash() {
  const d = emptyDash('销售周报', 'dash_sales');
  d.theme = 'default';
  const kpi = mkChart('kpi', '本月 GMV', { value: 'amount', calc: 'yoy' }, { valueColor: '#1f2329', valueSize: 28 });
  const kpi2 = mkChart('kpi', '本月销量', { value: 'qty', format: 'raw', calc: 'mom' }, { valueColor: '#059669', valueSize: 28 });
  const kpi3 = mkChart('kpi', '利润', { value: 'profit', calc: 'yoy' }, { valueColor: '#0ea5e9', valueSize: 28 });
  const kpi4 = mkChart('kpi', '订单数', { value: 'order_cnt', format: 'raw' }, { valueColor: '#7c3aed', valueSize: 28 });
  const bar = mkChart('bar', '区域销售额', {}, { showLabel: true });
  const line = mkChart('line', '产品销售趋势', { category: 'product', value: 'amount' }, { smooth: true });
  const hbar = mkChart('hbar', '销售员业绩', { category: 'salesman', value: 'amount' }, { showLabel: true });
  const pie = mkChart('pie', '渠道占比', { category: 'channel', value: 'amount' });
  const area = mkChart('area', '品牌贡献', { category: 'brand', value: 'amount' });
  const group = mkChart('grouptable', '事业部汇总', { category: 'dept', value: 'amount' }, { pageSize: 10 });
  const detail = mkChart('table', '销售明细', { value: 'amount', format: 'raw' }, { pageSize: 6 });
  const pivot = mkChart('pivot', '区域 × 产品', { category: 'region', colDim: 'product', value: ['amount', 'qty'] }, {
    showRowTotal: true, showColTotal: true,
    headerBg: '#1677ff', headerColor: '#ffffff', headerBold: true,
    rowHeadBg: '#1677ff', rowHeadColor: '#ffffff', rowHeadBold: true,
    cornerBg: '#0958d9', cornerColor: '#ffffff',
    cellAlign: 'center', stripe: false, pivotMultiHead: true,
    titleBg: '#1677ff', titleColor: '#ffffff', titleBold: true
  });
  assembleDash(d, [
    { type: 'slicer', x: 0, y: 0, w: 12, h: 1, props: { field: 'region', label: '区域切片' } },
    { type: 'chart', ref: kpi, x: 0, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi2, x: 3, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi3, x: 6, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi4, x: 9, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: bar, x: 0, y: 3, w: 6, h: 5 },
    { type: 'chart', ref: line, x: 6, y: 3, w: 6, h: 5 },
    { type: 'chart', ref: hbar, x: 0, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: pie, x: 4, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: area, x: 8, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: group, x: 0, y: 12, w: 6, h: 4 },
    { type: 'chart', ref: detail, x: 6, y: 12, w: 6, h: 4 },
    { type: 'chart', ref: pivot, x: 0, y: 16, w: 12, h: 5 }
  ]);
  d.linkages = [
    { id: 'l_sales_1', sourceChartId: bar.id, sourceField: 'region', targetChartId: detail.id, targetField: 'region', enabled: true },
    { id: 'l_sales_2', sourceChartId: bar.id, sourceField: 'region', targetChartId: pivot.id, targetField: 'region', enabled: true }
  ];
  d.jumps = [{ id: 'j_sales', sourceChartId: bar.id, triggerField: 'region', targetType: 'url', target: 'https://example.com/detail?region={value}' }];
  d.alerts = [{ id: 'a_sales', chartId: kpi.id, metricField: 'amount', operator: 'lt', threshold: 300, enabled: true }];
  seedSalesMobile(d);
  d.status = 'publishedWithDraft';
  return packDash(d, { folder: '销售分析', desc: 'GMV 全景 · 销售员/品牌/透视 · 切片联动 · 移动端', updateBy: '张三', updateTime: '2026-07-29 18:20' });
}

function demoOpsDash() {
  const d = emptyDash('运营日报', 'dash_ops');
  d.theme = 'ocean';
  const kpi1 = mkChart('kpi', '周 UV', { value: 'uv', format: 'raw', calc: 'mom' }, { valueColor: '#0284c7' }, 'ds_ops');
  const kpi2 = mkChart('kpi', '周 PV', { value: 'pv', format: 'raw' }, { valueColor: '#7c3aed' }, 'ds_ops');
  const kpi3 = mkChart('kpi', '均停留秒', { value: 'duration', agg: 'AVG', format: 'fixed1' }, { valueColor: '#0d9488' }, 'ds_ops');
  const kpi4 = mkChart('kpi', '跳出率', { value: 'bounce', agg: 'AVG', format: 'percent', calc: 'mom' }, { valueColor: '#ea580c' }, 'ds_ops');
  const area = mkChart('area', '每日 UV 走势', { category: 'day', value: 'uv', format: 'raw' }, { smooth: true }, 'ds_ops');
  const line = mkChart('line', '每日 PV 走势', { category: 'day', value: 'pv', format: 'raw' }, { smooth: true }, 'ds_ops');
  const hbar = mkChart('hbar', '端 UV 对比', { category: 'platform', value: 'uv', format: 'raw' }, { showLabel: true }, 'ds_ops');
  const pie = mkChart('pie', '来源结构', { category: 'channel', value: 'uv', format: 'raw' }, {}, 'ds_ops');
  const bar = mkChart('bar', '模块流量', { category: 'module', value: 'pv', format: 'raw' }, { showLabel: true }, 'ds_ops');
  const group = mkChart('grouptable', '模块 × 来源', { category: 'module', value: 'uv', format: 'raw' }, { pageSize: 8 }, 'ds_ops');
  const detail = mkChart('table', '流量明细', { value: 'uv', format: 'raw' }, { pageSize: 7 }, 'ds_ops');
  assembleDash(d, [
    { type: 'text', x: 0, y: 0, w: 12, h: 1, props: { content: '运营日报 · 关注端 / 模块 / 来源漏斗，周末流量波动需盯投放', fontSize: 14, color: '#0c4a6e' } },
    { type: 'chart', ref: kpi1, x: 0, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi2, x: 3, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi3, x: 6, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi4, x: 9, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: area, x: 0, y: 3, w: 8, h: 5 },
    { type: 'chart', ref: pie, x: 8, y: 3, w: 4, h: 5 },
    { type: 'chart', ref: line, x: 0, y: 8, w: 6, h: 4 },
    { type: 'chart', ref: hbar, x: 6, y: 8, w: 6, h: 4 },
    { type: 'chart', ref: bar, x: 0, y: 12, w: 5, h: 4 },
    { type: 'chart', ref: group, x: 5, y: 12, w: 7, h: 4 },
    { type: 'chart', ref: detail, x: 0, y: 16, w: 12, h: 4 }
  ]);
  d.status = 'published';
  return packDash(d, { folder: '运营增长', desc: '海洋主题 · 日走势 + 端对比 + 模块漏斗', updateBy: '李四', updateTime: '2026-07-29 09:10' });
}

function demoRegionDash() {
  const d = emptyDash('区域销售看板', 'dash_region');
  d.theme = 'forest';
  const kpi1 = mkChart('kpi', '华东 GMV', { value: 'amount', calc: 'yoy' }, { valueColor: '#047857' });
  const kpi2 = mkChart('kpi', '城市覆盖', { value: 'order_cnt', format: 'raw' }, { valueColor: '#0f766e' });
  const kpi3 = mkChart('kpi', '客单价', { value: 'unit_price', agg: 'AVG', format: 'fixed2' }, { valueColor: '#15803d' });
  const bar = mkChart('bar', '城市销售额', { category: 'city', value: 'amount' }, { showLabel: true });
  const hbar = mkChart('hbar', '区域销量排行', { category: 'region', value: 'qty', format: 'raw' }, { showLabel: true });
  const pie = mkChart('pie', '客户等级', { category: 'customer_level', value: 'amount' });
  const line = mkChart('line', '仓库出货额', { category: 'warehouse', value: 'amount' }, { smooth: false });
  const pivot = mkChart('pivot', '区域 × 渠道', { category: 'region', colDim: 'channel', value: 'amount' }, { showRowTotal: true, showColTotal: true });
  const group = mkChart('grouptable', '销售员汇总', { category: 'salesman', value: 'amount' }, { pageSize: 8 });
  const detail = mkChart('table', '区域明细', { value: 'amount', format: 'raw' }, { pageSize: 6 });
  assembleDash(d, [
    { type: 'slicer', x: 0, y: 0, w: 12, h: 1, props: { field: 'region', label: '聚焦区域' } },
    { type: 'chart', ref: kpi1, x: 0, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi2, x: 4, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi3, x: 8, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: bar, x: 0, y: 3, w: 7, h: 5 },
    { type: 'chart', ref: pie, x: 7, y: 3, w: 5, h: 5 },
    { type: 'chart', ref: hbar, x: 0, y: 8, w: 6, h: 4 },
    { type: 'chart', ref: line, x: 6, y: 8, w: 6, h: 4 },
    { type: 'chart', ref: pivot, x: 0, y: 12, w: 12, h: 5 },
    { type: 'chart', ref: group, x: 0, y: 17, w: 6, h: 4 },
    { type: 'chart', ref: detail, x: 6, y: 17, w: 6, h: 4 }
  ]);
  d.linkages = [{ id: 'l_region', sourceChartId: bar.id, sourceField: 'city', targetChartId: detail.id, targetField: 'city', enabled: true }];
  d.status = 'published';
  return packDash(d, { folder: '销售分析', desc: '森林主题 · 城市/客户等级/仓配视角', updateBy: '张三', updateTime: '2026-07-28 15:40' });
}

function demoInvDash() {
  const d = emptyDash('库存周转', 'dash_inv');
  d.theme = 'mono';
  const kpi1 = mkChart('kpi', '库存金额', { value: 'value', calc: 'none' }, { valueColor: '#b45309' }, 'ds_inv');
  const kpi2 = mkChart('kpi', '总库存量', { value: 'stock', format: 'raw' }, { valueColor: '#334155' }, 'ds_inv');
  const kpi3 = mkChart('kpi', '均周转天', { value: 'turnover', agg: 'AVG', format: 'fixed1' }, { valueColor: '#dc2626' }, 'ds_inv');
  const bar = mkChart('bar', '仓库库存金额', { category: 'warehouse', value: 'value' }, { showLabel: true }, 'ds_inv');
  const hbar = mkChart('hbar', 'SKU 周转天数', { category: 'sku', value: 'turnover', format: 'raw' }, { showLabel: true }, 'ds_inv');
  const pie = mkChart('pie', '库存状态', { category: 'status', value: 'stock', format: 'raw' }, {}, 'ds_inv');
  const area = mkChart('area', '品类库存金额', { category: 'category', value: 'value' }, {}, 'ds_inv');
  const pivot = mkChart('pivot', '仓 × 品类库存', { category: 'warehouse', colDim: 'category', value: 'stock', format: 'raw' }, { showRowTotal: true }, 'ds_inv');
  const group = mkChart('grouptable', '状态汇总', { category: 'status', value: 'value' }, {}, 'ds_inv');
  const detail = mkChart('table', '库存明细', { value: 'stock', format: 'raw' }, { pageSize: 8 }, 'ds_inv');
  assembleDash(d, [
    { type: 'text', x: 0, y: 0, w: 12, h: 1, props: { content: '⚠ 积压 SKU 周转 > 45 天需清仓；缺货行优先补货', fontSize: 13, color: '#9a3412', bg: '#fff7ed' } },
    { type: 'chart', ref: kpi1, x: 0, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi2, x: 4, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi3, x: 8, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: bar, x: 0, y: 3, w: 6, h: 5 },
    { type: 'chart', ref: hbar, x: 6, y: 3, w: 6, h: 5 },
    { type: 'chart', ref: pie, x: 0, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: area, x: 4, y: 8, w: 8, h: 4 },
    { type: 'chart', ref: pivot, x: 0, y: 12, w: 12, h: 5 },
    { type: 'chart', ref: group, x: 0, y: 17, w: 5, h: 4 },
    { type: 'chart', ref: detail, x: 5, y: 17, w: 7, h: 4 }
  ]);
  d.alerts = [{ id: 'a_inv', chartId: kpi3.id, metricField: 'turnover', operator: 'gt', threshold: 30, enabled: true }];
  d.status = 'published';
  return packDash(d, { folder: '财务库存', desc: 'Mono 主题 · 周转预警 + 仓品类透视', updateBy: '赵六', updateTime: '2026-07-29 11:05' });
}

function demoFinDash() {
  const d = emptyDash('财务月报', 'dash_fin');
  d.theme = 'default';
  const kpi1 = mkChart('kpi', '累计收入', { value: 'income', calc: 'mom' }, { valueColor: '#059669' }, 'ds_fin');
  const kpi2 = mkChart('kpi', '累计支出', { value: 'expense', calc: 'mom' }, { valueColor: '#dc2626' }, 'ds_fin');
  const kpi3 = mkChart('kpi', '累计利润', { value: 'profit', calc: 'yoy' }, { valueColor: '#2563eb' }, 'ds_fin');
  const lineIn = mkChart('line', '月度收入', { category: 'month', value: 'income' }, { smooth: true, showLabel: false }, 'ds_fin');
  const lineEx = mkChart('area', '月度支出', { category: 'month', value: 'expense' }, { smooth: true }, 'ds_fin');
  const bar = mkChart('bar', '科目支出结构', { category: 'subject', value: 'expense' }, { showLabel: true }, 'ds_fin');
  const hbar = mkChart('hbar', '部门利润', { category: 'dept', value: 'profit' }, { showLabel: true }, 'ds_fin');
  const pie = mkChart('pie', '科目收入占比', { category: 'subject', value: 'income' }, {}, 'ds_fin');
  const pivot = mkChart('pivot', '月 × 部门利润', { category: 'month', colDim: 'dept', value: 'profit' }, { showRowTotal: true, showColTotal: true }, 'ds_fin');
  const group = mkChart('grouptable', '科目汇总', { category: 'subject', value: 'expense' }, {}, 'ds_fin');
  const detail = mkChart('table', '科目明细', { value: 'profit', format: 'raw' }, { pageSize: 8 }, 'ds_fin');
  assembleDash(d, [
    { type: 'text', x: 0, y: 0, w: 12, h: 1, props: { content: '财务月报（草稿）· 收入 / 支出 / 利润三线对照，发布前请财务确认', fontSize: 13, color: '#1e3a5f' } },
    { type: 'chart', ref: kpi1, x: 0, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi2, x: 4, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi3, x: 8, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: lineIn, x: 0, y: 3, w: 6, h: 4 },
    { type: 'chart', ref: lineEx, x: 6, y: 3, w: 6, h: 4 },
    { type: 'chart', ref: bar, x: 0, y: 7, w: 5, h: 4 },
    { type: 'chart', ref: hbar, x: 5, y: 7, w: 4, h: 4 },
    { type: 'chart', ref: pie, x: 9, y: 7, w: 3, h: 4 },
    { type: 'chart', ref: pivot, x: 0, y: 11, w: 12, h: 5 },
    { type: 'chart', ref: group, x: 0, y: 16, w: 5, h: 4 },
    { type: 'chart', ref: detail, x: 5, y: 16, w: 7, h: 4 }
  ]);
  d.status = 'draft';
  return packDash(d, { folder: '财务库存', desc: '收支双线 · 科目/部门透视 · 草稿未发布', updateBy: '钱七', updateTime: '2026-07-29 17:50' });
}

function demoCrmDash() {
  const d = emptyDash('客户分层分析', 'dash_crm');
  d.theme = 'rose';
  const kpi1 = mkChart('kpi', '客户总数', { value: 'customers', format: 'raw' }, { valueColor: '#be123c' }, 'ds_crm');
  const kpi2 = mkChart('kpi', '贡献 GMV', { value: 'gmv', calc: 'yoy' }, { valueColor: '#e11d48' }, 'ds_crm');
  const kpi3 = mkChart('kpi', '均复购率', { value: 'repurchase', agg: 'AVG', format: 'percent' }, { valueColor: '#c026d3' }, 'ds_crm');
  const bar = mkChart('bar', '等级贡献 GMV', { category: 'level', value: 'gmv' }, { showLabel: true }, 'ds_crm');
  const hbar = mkChart('hbar', '区域客户数', { category: 'region', value: 'customers', format: 'raw' }, { showLabel: true }, 'ds_crm');
  const pie = mkChart('pie', '行业分布', { category: 'industry', value: 'customers', format: 'raw' }, {}, 'ds_crm');
  const area = mkChart('area', '等级复购', { category: 'level', value: 'repurchase', format: 'raw', agg: 'AVG' }, {}, 'ds_crm');
  const pivot = mkChart('pivot', '等级 × 区域 GMV', { category: 'level', colDim: 'region', value: 'gmv' }, { showRowTotal: true }, 'ds_crm');
  const group = mkChart('grouptable', '行业汇总', { category: 'industry', value: 'gmv' }, {}, 'ds_crm');
  const detail = mkChart('table', '分层明细', { value: 'gmv', format: 'raw' }, { pageSize: 8 }, 'ds_crm');
  assembleDash(d, [
    { type: 'text', x: 0, y: 0, w: 12, h: 1, props: { content: 'CRM 分层 · A 类高复购优先保有，C 类看触达转化', fontSize: 13, color: '#9f1239' } },
    { type: 'chart', ref: kpi1, x: 0, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi2, x: 4, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: kpi3, x: 8, y: 1, w: 4, h: 2 },
    { type: 'chart', ref: bar, x: 0, y: 3, w: 7, h: 5 },
    { type: 'chart', ref: pie, x: 7, y: 3, w: 5, h: 5 },
    { type: 'chart', ref: hbar, x: 0, y: 8, w: 6, h: 4 },
    { type: 'chart', ref: area, x: 6, y: 8, w: 6, h: 4 },
    { type: 'chart', ref: pivot, x: 0, y: 12, w: 12, h: 5 },
    { type: 'chart', ref: group, x: 0, y: 17, w: 5, h: 4 },
    { type: 'chart', ref: detail, x: 5, y: 17, w: 7, h: 4 }
  ]);
  d.status = 'published';
  d.share = { token: 'sh_crm_demo', url: '/share/sh_crm_demo', expireAt: null };
  return packDash(d, { folder: '销售分析', desc: '玫瑰主题 · 等级/区域/行业三维分层', updateBy: '王五', updateTime: '2026-07-27 14:22' });
}

function demoPromoDash() {
  const d = emptyDash('促销活动监控', 'dash_promo');
  d.theme = 'ocean';
  const kpi1 = mkChart('kpi', '活动 GMV', { value: 'amount', calc: 'mom' }, { valueColor: '#0369a1' });
  const kpi2 = mkChart('kpi', '活动销量', { value: 'qty', format: 'raw', calc: 'mom' }, { valueColor: '#0e7490' });
  const kpi3 = mkChart('kpi', '平均折扣%', { value: 'discount', agg: 'AVG', format: 'fixed1' }, { valueColor: '#c2410c' });
  const kpi4 = mkChart('kpi', '订单数', { value: 'order_cnt', format: 'raw' }, { valueColor: '#7c3aed' });
  const area = mkChart('area', '产品促销额', { category: 'product', value: 'amount' }, { smooth: true });
  const bar = mkChart('bar', '渠道成交', { category: 'channel', value: 'amount' }, { showLabel: true });
  const pie = mkChart('pie', '支付方式', { category: 'pay_type', value: 'amount' });
  const hbar = mkChart('hbar', '销售员冲刺', { category: 'salesman', value: 'qty', format: 'raw' }, { showLabel: true });
  const line = mkChart('line', '品类走势', { category: 'category', value: 'amount' }, { smooth: true });
  const group = mkChart('grouptable', '支付汇总', { category: 'pay_type', value: 'amount' }, {});
  const pivot = mkChart('pivot', '渠道 × 品类', { category: 'channel', colDim: 'category', value: 'amount' }, { showColTotal: true });
  const detail = mkChart('table', '活动订单', { value: 'amount', format: 'raw' }, { pageSize: 6 });
  assembleDash(d, [
    { type: 'slicer', x: 0, y: 0, w: 12, h: 1, props: { field: 'channel', label: '活动渠道' } },
    { type: 'chart', ref: kpi1, x: 0, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi2, x: 3, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi3, x: 6, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: kpi4, x: 9, y: 1, w: 3, h: 2 },
    { type: 'chart', ref: area, x: 0, y: 3, w: 8, h: 5 },
    { type: 'chart', ref: pie, x: 8, y: 3, w: 4, h: 5 },
    { type: 'chart', ref: bar, x: 0, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: hbar, x: 4, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: line, x: 8, y: 8, w: 4, h: 4 },
    { type: 'chart', ref: pivot, x: 0, y: 12, w: 8, h: 5 },
    { type: 'chart', ref: group, x: 8, y: 12, w: 4, h: 5 },
    { type: 'chart', ref: detail, x: 0, y: 17, w: 12, h: 4 }
  ]);
  d.linkages = [{ id: 'l_promo', sourceChartId: bar.id, sourceField: 'channel', targetChartId: detail.id, targetField: 'channel', enabled: true }];
  d.status = 'publishedWithDraft';
  return packDash(d, { folder: '运营增长', desc: '大促监控 · 折扣/支付/冲刺榜 · 有未发布改动', updateBy: '李四', updateTime: '2026-07-29 16:05' });
}

function buildCatalog() {
  return [demoDash(), demoOpsDash(), demoRegionDash(), demoInvDash(), demoFinDash(), demoCrmDash(), demoPromoDash()];
}

state.dashboards = buildCatalog();
state.dashId = state.dashboards[0].id;
state.dash = state.dashboards[0];
state.selectedId = state.dash.components.find(c => c.type === 'chart')?.id || null;

function findDashChartByTitle(dashId, title) {
  const d = state.dashboards.find(x => x.id === dashId);
  if (!d) return null;
  return Object.values(d.charts || {}).find(c => c.title === title) || null;
}

function buildReports() {
  const cityBar = findDashChartByTitle('dash_region', '城市销售额');
  const regionPie = findDashChartByTitle('dash_region', '客户等级');
  return [
    {
      id: 'rpt_sales_week',
      name: '区域销售周报',
      status: 'draft',
      folder: '经营分析',
      desc: '引用区域销售看板图表 + 报告内新建图 · 实时取数演示',
      updateBy: '张三',
      updateTime: '2026-08-03 18:20',
      contentId: '1',
      blocks: [
        { type: 'heading', level: 1, text: '区域销售周报' },
        { type: 'paragraph', text: '本报告演示 Umo 风格排版。请到顶栏「工具」：引用仪表盘时先选看板再勾选图表（可多选，非整盘）；或新建图表（仅报告）。取数实时。' },
        { type: 'heading', level: 2, text: '一、引用看板图表' },
        {
          type: 'reportChart',
          id: 'rc_ref_city',
          source: 'dashboard',
          dashboardId: 'dash_region',
          chartId: cityBar?.id || '',
          chartTitle: '城市销售额',
          title: '城市销售额（引用）',
          height: 280
        },
        {
          type: 'reportChart',
          id: 'rc_ref_pie',
          source: 'dashboard',
          dashboardId: 'dash_region',
          chartId: regionPie?.id || '',
          chartTitle: '客户等级',
          title: '客户等级（引用）',
          height: 260
        },
        { type: 'heading', level: 2, text: '二、报告内新建图表' },
        {
          type: 'reportChart',
          id: 'rc_inline_region',
          source: 'inline',
          datasetId: 'ds_sales',
          chartType: 'bar',
          encode: { category: 'region', value: 'amount', agg: 'SUM' },
          title: '区域 GMV（仅报告）',
          height: 280
        },
        { type: 'paragraph', text: '使用工具栏「工具 → 引用仪表盘图表 / 新建图表」继续添加块。保存只持久化块配置，不含查询结果行。' }
      ]
    },
    {
      id: 'rpt_ops_month',
      name: '运营月度简报',
      status: 'published',
      folder: '经营分析',
      desc: '空白骨架 · 可自行插入图表',
      updateBy: '李四',
      updateTime: '2026-07-30 10:00',
      contentId: '3',
      blocks: [
        { type: 'heading', level: 1, text: '运营月度简报' },
        { type: 'paragraph', text: '在「开始」设置标题/正文，在「工具」引用仪表盘图表或新建图表。' }
      ]
    }
  ];
}

state.reports = buildReports();
state.reportId = state.reports[0].id;

function currentDash() {
  return state.dashboards.find(d => d.id === state.dashId) || state.dashboards[0];
}

function currentReport() {
  return state.reports.find(r => r.id === state.reportId) || state.reports[0];
}

function selectReport(id) {
  if (!state.reports.some(r => r.id === id)) return;
  state.reportId = id;
  state.reportSelectedBlockId = null;
}

function selectDash(id) {
  const d = state.dashboards.find(x => x.id === id);
  if (!d) return;
  state.dashId = d.id;
  state.dash = d;
  state.selectedId = d.components.find(c => c.type === 'chart')?.id || null;
  state.undo = [];
  state.linkageHits = [];
  state.drillStack = [];
}

/** URL hash 路由：#/workbench | #/datasource/:id | #/dataset/:id | #/dashboard/:screen/:dashId | #/report/:screen/:reportId */
const ROUTE_MODS = new Set(['workbench', 'datasource', 'dataset', 'dashboard', 'report']);
let _applyingRoute = false;

function buildRouteHash() {
  const mod = ROUTE_MODS.has(state.module) ? state.module : 'workbench';
  if (mod === 'workbench') return '#/workbench';
  if (mod === 'datasource') return '#/datasource/' + encodeURIComponent(state.srcId || '');
  if (mod === 'dataset') {
    const tab = state.dsTab && state.dsTab !== 'fields' ? '/' + encodeURIComponent(state.dsTab) : '';
    return '#/dataset/' + encodeURIComponent(state.datasetId || '') + tab;
  }
  if (mod === 'report') {
    const screen = ['list', 'editor'].includes(state.screen) ? state.screen : 'list';
    const id = state.reportId || '';
    return '#/report/' + screen + (id ? '/' + encodeURIComponent(id) : '');
  }
  // dashboard
  const screen = ['list', 'editor', 'preview'].includes(state.screen) ? state.screen : 'list';
  const id = state.dashId || state.dash?.id || '';
  return '#/dashboard/' + screen + (id ? '/' + encodeURIComponent(id) : '');
}

function syncRoute() {
  if (_applyingRoute) return;
  const next = buildRouteHash().replace(/\/+$/, '') || '#/workbench';
  // 去掉末尾空段：#/datasource/ → #/datasource
  const clean = next.replace(/\/$/, '') || '#/workbench';
  if (location.hash === clean) return;
  history.replaceState(null, '', clean);
}

function applyRouteFromHash() {
  _applyingRoute = true;
  try {
    const raw = (location.hash || '').replace(/^#\/?/, '').trim();
    if (!raw) {
      state.module = 'workbench';
      state.screen = 'list';
      return;
    }
    const parts = raw.split('/').map(p => decodeURIComponent(p || '')).filter(Boolean);
    const mod = ROUTE_MODS.has(parts[0]) ? parts[0] : 'workbench';
    state.module = mod;
    if (mod === 'workbench') {
      state.screen = 'list';
      return;
    }
    if (mod === 'datasource') {
      state.screen = 'list';
      if (parts[1] && DATASOURCES.some(s => s.id === parts[1])) state.srcId = parts[1];
      return;
    }
    if (mod === 'dataset') {
      state.screen = 'list';
      if (parts[1] && DATASETS[parts[1]]) state.datasetId = parts[1];
      if (parts[2] && ['fields', 'preview', 'lineage'].includes(parts[2])) state.dsTab = parts[2];
      return;
    }
    if (mod === 'report') {
      const screen = ['list', 'editor'].includes(parts[1]) ? parts[1] : 'list';
      const reportId = parts[2] || '';
      if (parts[1] && !['list', 'editor'].includes(parts[1])) {
        if (state.reports.some(r => r.id === parts[1])) {
          selectReport(parts[1]);
          state.screen = 'list';
          return;
        }
      }
      if (reportId && state.reports.some(r => r.id === reportId)) selectReport(reportId);
      state.screen = screen;
      return;
    }
    // dashboard
    const screen = ['list', 'editor', 'preview'].includes(parts[1]) ? parts[1] : 'list';
    const dashId = parts[2] || (['list', 'editor', 'preview'].includes(parts[1]) ? '' : parts[1]);
    // support #/dashboard/:dashId as list selection
    if (parts[1] && !['list', 'editor', 'preview'].includes(parts[1])) {
      if (state.dashboards.some(d => d.id === parts[1])) {
        selectDash(parts[1]);
        state.screen = 'list';
        return;
      }
    }
    if (dashId && state.dashboards.some(d => d.id === dashId)) selectDash(dashId);
    state.screen = screen;
    if (screen === 'preview' && state.dash?.status === 'draft') state.screen = 'list';
  } finally {
    _applyingRoute = false;
  }
}

function gotoModule(mod) {
  state.module = ROUTE_MODS.has(mod) ? mod : 'workbench';
  state.screen = 'list';
  render();
}

function snap(n, size) { return Math.round(n / (size + gapSize())); }
function px(x, y, w, h, cw) {
  const c = cw || 72;
  const g = gapSize();
  const rh = rowH();
  return {
    left: x * (c + g),
    top: y * (rh + g),
    width: w * c + (w - 1) * g,
    height: h * rh + (h - 1) * g
  };
}
function contentRows(comps) {
  if (!comps.length) return 2;
  return comps.reduce((m, c) => Math.max(m, c.y + c.h), 0);
}
function boardPad() { return isMobileMetrics() ? 20 : 0; /* padding ×2 */ }

function tabComps(tabId) {
  const tab = tabId || state.dash.activeTab;
  if (useMobileLayout()) {
    return ensureMobile(state.dash).components
      .map(hydrateMobileComp)
      .filter(Boolean)
      .filter(c => (c.tabId || 'tab_main') === tab);
  }
  return state.dash.components.filter(c => (c.tabId || 'tab_main') === tab);
}

function collide(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function minWH(comp) {
  if (useMobileLayout()) {
    if (comp.type === 'slicer' || comp.type === 'text' || comp.type === 'query') return { w: 2, h: 1 };
    const t = state.dash.charts[comp.chartId]?.chartType;
    if (t === 'kpi') return { w: 2, h: 2 };
    return { w: 3, h: 2 };
  }
  if (comp.type === 'slicer') return { w: 3, h: 1 };
  if (comp.type === 'query') return { w: 4, h: 1 };
  if (comp.type === 'text') return { w: 2, h: 1 };
  const t = state.dash.charts[comp.chartId]?.chartType;
  if (t === 'kpi') return { w: 2, h: 2 }; // 允许压到 2，演示默认用更舒展尺寸
  if (isTableType(t)) return { w: 4, h: 3 };
  if (t === 'pie') return { w: 3, h: 3 };
  return { w: 3, h: 2 };
}

function defaultSize(kind) {
  if (kind === 'slicer') return { w: 12, h: 1 };
  if (kind === 'query') return { w: 12, h: 1 };
  if (kind === 'text') return { w: 6, h: 1 };
  if (kind === 'kpi') return { w: 3, h: 2 }; // 指标条场景：宽 3、高 2 横排更稳
  if (kind === 'pivot') return { w: 12, h: 5 };
  if (kind === 'grouptable') return { w: 6, h: 4 };
  if (kind === 'table') return { w: 6, h: 4 };
  if (kind === 'pie') return { w: 4, h: 4 };
  return { w: 6, h: 4 };
}

function findFreeSlot(w, h, tabId) {
  const items = tabComps(tabId);
  const cols = gridCols();
  const maxY = Math.max(contentRows(items), 0) + extraRows();
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const trial = { x, y, w, h };
      if (!items.some(o => collide(trial, o))) return { x, y };
    }
  }
  return { x: 0, y: contentRows(items) };
}

/** Push colliding widgets down, cascade until stable */
function pushLayout(layout, moverId) {
  const items = layout.map(c => ({ ...c }));
  const mover = items.find(i => i.id === moverId);
  if (!mover) return items;
  let guard = 0;
  while (guard++ < 80) {
    let changed = false;
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (!collide(a, b)) continue;
        // keep mover preferred; push the other down
        if (a.id === moverId) { b.y = a.y + a.h; changed = true; }
        else if (b.id === moverId) { a.y = b.y + b.h; changed = true; }
        else { b.y = a.y + a.h; changed = true; }
      }
    }
    if (!changed) break;
  }
  return items;
}

/** Fill vertical gaps (Feishu-like compact) */
function compactLayout(layout) {
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const item of sorted) {
    let y = 0;
    const trial = { ...item };
    while (placed.some(p => collide({ ...trial, y }, p))) y++;
    trial.y = y;
    placed.push(trial);
  }
  return placed;
}

function commitLayout(items) {
  const map = Object.fromEntries(items.map(i => [i.id, i]));
  if (useMobileLayout()) {
    ensureMobile(state.dash).components.forEach(c => {
      const n = map[c.id];
      if (n) { c.x = n.x; c.y = n.y; c.w = n.w; c.h = n.h; if (n.z != null) c.z = n.z; }
    });
    return;
  }
  state.dash.components.forEach(c => {
    const n = map[c.id];
    if (n) { c.x = n.x; c.y = n.y; c.w = n.w; c.h = n.h; }
  });
}

function paintPositions(board, items, cw, animateIds, opts = {}) {
  const resizeCharts = opts.resizeCharts !== false;
  const fitHeight = opts.fitHeight !== false;
  items.forEach(c => {
    const el = board.querySelector(`[data-wid="${c.id}"]`);
    if (!el) return;
    if (animateIds && animateIds.has(c.id)) el.classList.add('pushed');
    else el.classList.remove('pushed');
    const box = px(c.x, c.y, c.w, c.h, cw);
    const left = box.left + 'px';
    const top = box.top + 'px';
    const width = box.width + 'px';
    const height = box.height + 'px';
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== top) el.style.top = top;
    if (el.style.width !== width) el.style.width = width;
    if (el.style.height !== height) el.style.height = height;
    if (resizeCharts) {
      const ch = state.dash.charts[c.chartId];
      if (ch && state.chartInst[ch.id]) {
        try { state.chartInst[ch.id].resize(); } catch (_) {}
      }
    }
  });
  if (fitHeight) fitBoardHeight(board, items);
}

/** 合并高频 mousemove 到每帧一次，拖拽更跟手；mouseup 前会 flush 最后一帧 */
function createPointerTracker(onFrame) {
  let pending = null;
  let raf = 0;
  let lastKey = '';
  const move = (ev) => {
    pending = ev;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      onFrame(e, (key) => {
        if (key === lastKey) return false;
        lastKey = key;
        return true;
      });
    });
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (pending) {
      const e = pending;
      pending = null;
      onFrame(e, () => true);
    }
    onFrame(null, () => true, true);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function showPlaceholder(board, x, y, w, h, cw) {
  let ph = board.querySelector('.grid-ph');
  if (!ph) {
    ph = document.createElement('div');
    ph.className = 'grid-ph';
    board.appendChild(ph);
  }
  const box = px(x, y, w, h, cw);
  ph.style.left = box.left + 'px';
  ph.style.top = box.top + 'px';
  ph.style.width = box.width + 'px';
  ph.style.height = box.height + 'px';
  ph.classList.add('show');
  return ph;
}

function hidePlaceholder(board) {
  board?.querySelector('.grid-ph')?.classList.remove('show');
}

function cellFromPoint(board, clientX, clientY, w, h) {
  const rect = board.getBoundingClientRect();
  const pad = isMobileMetrics() ? 16 : 0;
  const cw = colW(board);
  const lx = clientX - rect.left - pad;
  const ly = clientY - rect.top - pad;
  const g = gapSize(), rh = rowH();
  let x = Math.max(0, Math.min(gridCols() - w, Math.round(lx / (cw + g))));
  let y = Math.max(0, Math.round(ly / (rh + g)));
  return { x, y };
}

function handlesHtml(id) {
  return ['n','s','e','w','ne','nw','se','sw'].map(m =>
    `<div class="handle ${m}" data-resize="${m}" data-wid="${id}"></div>`
  ).join('');
}

function pushUndo() {
  state.undo.push(clone(state.dash));
  if (state.undo.length > 30) state.undo.shift();
}
function undo() {
  const prev = state.undo.pop();
  if (!prev) { toast('没有可撤销操作', 'warn'); return; }
  state.dash = prev;
  render();
  toast('已撤销');
}

function markDirty() {
  if (state.dash.status === 'published') state.dash.status = 'publishedWithDraft';
  state.dash.contentId = String(+state.dash.contentId + 1);
}

function ds(id) { return DATASETS[id]; }
function defaultDatasetId() {
  const pref = __productOpts && __productOpts.preferredDatasetId;
  if (pref && DATASETS[pref]) return pref;
  const keys = Object.keys(DATASETS);
  return keys[0] || '';
}
function dsOrFirst(id) {
  return DATASETS[id] || Object.values(DATASETS)[0];
}
function isProductLive() {
  return !!(__productOpts && typeof __productOpts.queryChart === 'function');
}
function currentChartQueryFilters() {
  const out = [];
  const filter = state.filter || {};
  for (const [k, v] of Object.entries(filter)) {
    if (!v || k.startsWith('_') || k === 'dateFrom' || k === 'dateTo') continue;
    out.push({ componentId: 'query', field: k, operator: 'eq', value: v });
  }
  if (filter.dateFrom || filter.dateTo) {
    out.push({
      componentId: 'query',
      field: filter._dateField || 'date',
      operator: 'between',
      value: [filter.dateFrom || '', filter.dateTo || '']
    });
  }
  return out;
}
function fieldMeta(dsId, name) { return ds(dsId)?.fields.find(f => f.name === name); }

/** 分析层角色：可覆盖物理类型（永洪式 维度⇄指标） */
function fieldRole(ch, fOrName) {
  const name = typeof fOrName === 'string' ? fOrName : fOrName?.name;
  const f = typeof fOrName === 'string' ? fieldMeta(ch.datasetId, name) : fOrName;
  if (!f) return 'dim';
  return ch.fieldRoles?.[name] || f.group;
}

function isFieldConverted(ch, f) {
  return !!(ch.fieldRoles?.[f.name] && ch.fieldRoles[f.name] !== f.group);
}

function fieldsByRole(ch, role) {
  return (ds(ch.datasetId)?.fields || []).filter(f => fieldRole(ch, f) === role);
}

function toggleFieldRole(ch, fieldName) {
  const f = fieldMeta(ch.datasetId, fieldName);
  if (!f) return;
  const wasBound = isFieldBound(ch, fieldName);
  ch.fieldRoles = ch.fieldRoles || {};
  const cur = fieldRole(ch, f);
  const next = cur === 'dim' ? 'quota' : 'dim';
  if (next === f.group) delete ch.fieldRoles[fieldName];
  else ch.fieldRoles[fieldName] = next;
  // 若编码槽角色冲突则清空该槽
  const enc = ch.encode || {};
  ['category', 'colDim', 'color', 'value', 'columns'].forEach(slot => {
    const list = encodeFields(enc, slot);
    if (!list.includes(fieldName)) return;
    if (slot === 'columns') return;
    const need = slot === 'value' ? 'quota' : 'dim';
    if (fieldRole(ch, f) !== need) {
      setEncodeFields(enc, slot, list.filter(n => n !== fieldName));
    }
  });
  if (ch.chartType === 'table' && wasBound) {
    const dims = encodeFields(enc, 'category').filter(n => n !== fieldName);
    const quotas = encodeFields(enc, 'value').filter(n => n !== fieldName);
    if (next === 'quota') quotas.push(fieldName);
    else dims.push(fieldName);
    setEncodeFields(enc, 'category', dims);
    setEncodeFields(enc, 'value', quotas);
    syncTableColumnsEncode(ch);
  }
  // 维度转指标时默认 COUNT 更合理
  if (next === 'quota' && f.group === 'dim') ch.encode.agg = 'COUNT';
  if (next === 'dim' && f.group === 'quota' && ch.encode.agg === 'COUNT') ch.encode.agg = 'SUM';
}

function fieldKind(f, role) {
  const t = String(f?.dataType || '').toUpperCase();
  if (/DATE|TIME|TIMESTAMP/.test(t)) return 'time';
  if (role === 'quota' || /INT|DEC|NUM|FLOAT|DOUBLE|MONEY|REAL|BIGINT/.test(t)) return 'num';
  return 'text';
}

function fieldKindGlyph(kind) {
  if (kind === 'time') return '日';
  if (kind === 'num') return '#';
  return 'Abc';
}

function isFieldBound(ch, fieldName) {
  const enc = ch.encode || {};
  return ['category', 'colDim', 'color', 'value', 'columns'].some(slot =>
    encodeFields(enc, slot).includes(fieldName)
  );
}

function fieldChipHtml(ch, f) {
  const role = fieldRole(ch, f);
  const conv = isFieldConverted(ch, f);
  const to = role === 'dim' ? '指标' : '维度';
  const bound = isFieldBound(ch, f.name);
  const kind = fieldKind(f, role);
  const title = `${f.label}（${f.name}）${conv ? ' · 已转换' : ''} · 单击选中，拖入槽位；⇄ 转为${to}`;
  return `<span class="fchip ${role}${conv ? ' converted' : ''}${bound ? ' bound' : ''}" draggable="true" data-f="${esc(f.name)}" data-g="${role}" data-label="${esc(f.label)}" title="${esc(title)}">
    <i class="ftype kind-${kind}">${fieldKindGlyph(kind)}</i>
    <span class="flab">${esc(f.label)}</span>
    ${conv ? '<i class="ftag">转</i>' : ''}
    ${bound ? '<i class="fbound">已绑</i>' : ''}
    <button type="button" class="fconv" data-conv="${esc(f.name)}" title="转换为${to}">⇄</button>
  </span>`;
}

function fieldBankHtml(ch) {
  const dims = fieldsByRole(ch, 'dim');
  const quos = fieldsByRole(ch, 'quota');
  const tip = '单击选中，拖到数据绑定槽位；Ctrl 多选，双击添加';
  return `<div class="field-bank" id="fieldBank">
    <div class="fb-search">
      <input id="fsearch" type="search" placeholder="搜索字段…" title="${esc(tip)}" autocomplete="off" />
    </div>
    <p class="fb-hint">${esc(tip)}</p>
    <div class="fb-groups">
      <div class="fb-group fb-group-dim" data-bank="dim">
        <button type="button" class="fb-group-hd" data-toggle-bank="dim">
          <span class="caret">▾</span>维度 <span class="cnt" id="dimCnt">${dims.length}</span>
        </button>
        <div class="chip-bank" id="dims" data-empty="无匹配维度">${dims.map(f => fieldChipHtml(ch, f)).join('')}</div>
      </div>
      <div class="fb-group fb-group-quota" data-bank="quota">
        <button type="button" class="fb-group-hd" data-toggle-bank="quota">
          <span class="caret">▾</span>指标 <span class="cnt" id="quoCnt">${quos.length}</span>
        </button>
        <div class="chip-bank" id="quos" data-empty="无匹配指标">${quos.map(f => fieldChipHtml(ch, f)).join('')}</div>
      </div>
    </div>
  </div>`;
}

function filterAppliesToChart(fieldKey, chart) {
  const meta = state.filterMeta?.[fieldKey];
  const targets = meta?.targetChartIds;
  if (!targets || !targets.length) return true;
  return targets.includes(chart.id);
}

function resolveFilterField(fieldKey, chart) {
  const meta = state.filterMeta?.[fieldKey];
  const mapped = meta?.fieldByChart?.[chart.id];
  return mapped || fieldKey;
}

const CHART_FILTER_OPS = [
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'empty', label: '为空' },
  { value: 'not_empty', label: '不为空' }
];

function ensureChartFilters(ch) {
  if (!ch.encode) ch.encode = emptyEncode(ch.chartType || 'bar');
  if (!Array.isArray(ch.encode.filters)) ch.encode.filters = [];
  ch.encode.filters = ch.encode.filters.map(f => ({
    id: f.id || uid('cf'),
    field: f.field || '',
    op: f.op || 'eq',
    value: f.value == null ? '' : String(f.value)
  }));
  return ch.encode.filters;
}

function chartFilterNeedsValue(op) {
  return op !== 'empty' && op !== 'not_empty';
}

function matchChartFilter(row, filter) {
  if (!filter?.field) return true;
  const raw = row[filter.field];
  const empty = raw == null || String(raw).trim() === '';
  const op = filter.op || 'eq';
  if (op === 'empty') return empty;
  if (op === 'not_empty') return !empty;
  const left = String(raw ?? '');
  const right = String(filter.value ?? '');
  if (op === 'eq') return left === right;
  if (op === 'ne') return left !== right;
  if (op === 'contains') return left.includes(right);
  const ln = Number(raw);
  const rn = Number(filter.value);
  const bothNum = Number.isFinite(ln) && Number.isFinite(rn) && String(filter.value).trim() !== '';
  if (bothNum) {
    if (op === 'gt') return ln > rn;
    if (op === 'gte') return ln >= rn;
    if (op === 'lt') return ln < rn;
    if (op === 'lte') return ln <= rn;
  }
  if (op === 'gt') return left > right;
  if (op === 'gte') return left >= right;
  if (op === 'lt') return left < right;
  if (op === 'lte') return left <= right;
  return true;
}

function applyChartFilters(rows, chart) {
  const filters = ensureChartFilters(chart).filter(f => f.field && (!chartFilterNeedsValue(f.op) || String(f.value ?? '') !== ''));
  if (!filters.length) return rows;
  return rows.filter(r => filters.every(f => matchChartFilter(r, f)));
}

function chartFiltersSummary(ch) {
  const filters = ensureChartFilters(ch).filter(f => f.field);
  if (!filters.length) return '未设置过滤条件';
  return filters.map(f => {
    const lab = fieldLabelOf(ch.datasetId, f.field) || f.field;
    const opLab = CHART_FILTER_OPS.find(o => o.value === f.op)?.label || f.op;
    if (!chartFilterNeedsValue(f.op)) return `${lab} ${opLab}`;
    return `${lab} ${opLab} ${f.value || '—'}`;
  }).join('；');
}

function filteredRows(chart) {
  const d = ds(chart.datasetId);
  if (!d) return [];
  let rows = d.rows.slice();
  for (const [k, v] of Object.entries(state.filter)) {
    if (!v || k === 'dateFrom' || k === 'dateTo' || k === '_dateField') continue;
    if (!filterAppliesToChart(k, chart)) continue;
    const ff = resolveFilterField(k, chart);
    if (rows[0] && ff in rows[0]) rows = rows.filter(r => String(r[ff]) === String(v));
  }
  const dateFieldKey = state.filter._dateField || 'date';
  if (state.filter.dateFrom || state.filter.dateTo) {
    if (filterAppliesToChart(dateFieldKey, chart) || filterAppliesToChart('_date', chart)) {
      const ff = resolveFilterField(dateFieldKey, chart) || dateFieldKey;
      if (state.filter.dateFrom) {
        rows = rows.filter(r => {
          const dv = r[ff] ?? r.date;
          return !dv || String(dv) >= state.filter.dateFrom;
        });
      }
      if (state.filter.dateTo) {
        rows = rows.filter(r => {
          const dv = r[ff] ?? r.date;
          return !dv || String(dv) <= state.filter.dateTo;
        });
      }
    }
  }
  for (const hit of state.linkageHits) {
    if (hit.targetChartId === chart.id) rows = rows.filter(r => String(r[hit.targetField]) === String(hit.value));
  }
  // drill: treat last drill as extra eq filter on category path
  if (state.drillStack.length && encodeFields(chart.encode, 'category').length) {
    const last = state.drillStack[state.drillStack.length - 1];
    if (last.chartId === chart.id) {
      rows = rows.filter(r => String(r[last.field]) === String(last.value));
    }
  }
  rows = applyChartFilters(rows, chart);
  return rows;
}

function pageChartOptions() {
  return tabComps()
    .filter(c => c.type === 'chart' && c.chartId)
    .map(c => {
      const ch = state.dash.charts[c.chartId];
      const datasetId = ch?.datasetId || '';
      const d = ds(datasetId);
      const dimFields = (d?.fields || [])
        .filter(f => (f.group || 'dim') !== 'quota')
        .map(f => ({ name: f.name, label: f.label || f.name }));
      return {
        chartId: ch?.id || c.chartId,
        title: ch?.title || '未命名图表',
        datasetId,
        datasetName: d?.name || datasetId || '未绑定数据集',
        chartType: ch?.chartType || '',
        dimFields
      };
    })
    .filter(c => c.chartId);
}

function chartHasField(chartId, field) {
  if (!field) return false;
  const ch = state.dash.charts[chartId];
  if (!ch) return false;
  const d = ds(ch.datasetId);
  return !!(d?.fields || []).some(f => f.name === field) || !!(d?.rows?.[0] && field in d.rows[0]);
}

function normalizeQueryItem(it) {
  if (!it.id) it.id = uid('qf');
  if (it.scope !== 'custom') it.scope = 'all';
  if (!Array.isArray(it.targetChartIds)) it.targetChartIds = [];
  if (!it.fieldMap || typeof it.fieldMap !== 'object') it.fieldMap = {};
  return it;
}

function effectiveTargets(it, charts) {
  if (it.scope === 'custom') return [...(it.targetChartIds || [])];
  return charts.filter(c => chartHasField(c.chartId, it.field)).map(c => c.chartId);
}

function setFilterMetaForItem(it) {
  if (!state.filterMeta) state.filterMeta = {};
  const targets = it.scope === 'custom' ? [...(it.targetChartIds || [])] : null;
  const fieldByChart = { ...(it.fieldMap || {}) };
  const meta = { targetChartIds: targets, fieldByChart };
  if (it.kind === 'dateRange') {
    const key = it.field || 'date';
    state.filterMeta[key] = meta;
    state.filterMeta._date = meta;
  } else if (it.field) {
    state.filterMeta[it.field] = meta;
  }
}

function reduceAgg(nums, agg='SUM') {
  if (agg === 'COUNT') return nums.length;
  if (!nums.length) return 0;
  if (agg === 'AVG') return nums.reduce((a,b)=>a+b,0) / nums.length;
  if (agg === 'MAX') return Math.max(...nums);
  if (agg === 'MIN') return Math.min(...nums);
  return nums.reduce((a,b)=>a+b,0);
}

/** Normalize encode slot to field list (compat: string | string[]) */
function encodeFields(encode, slot) {
  const v = encode?.[slot];
  if (v == null || v === '') return [];
  return (Array.isArray(v) ? v : [v]).map(x => String(x)).filter(Boolean);
}

function encodePrimary(encode, slot) {
  return encodeFields(encode, slot)[0] || null;
}

function setEncodeFields(encode, slot, list) {
  const next = (list || []).map(String).filter(Boolean);
  if (!next.length) delete encode[slot];
  else encode[slot] = next.length === 1 ? next[0] : next;
}

function fieldLabelOf(datasetId, name) {
  return fieldMeta(datasetId, name)?.label || name;
}

/** 字段级配置（DataEase 风格：点 pill ▾） */
function ensureFieldCfg(ch) {
  if (!ch.encode) ch.encode = {};
  if (!ch.encode.fieldCfg || typeof ch.encode.fieldCfg !== 'object') ch.encode.fieldCfg = {};
  return ch.encode.fieldCfg;
}

function fieldCfgOf(ch, name) {
  const bag = ensureFieldCfg(ch);
  if (!bag[name]) bag[name] = {};
  return bag[name];
}

function fieldAggOf(ch, name) {
  return fieldCfgOf(ch, name).agg || ch.encode?.agg || 'SUM';
}

function fieldFormatOf(ch, name) {
  return fieldCfgOf(ch, name).format || ch.encode?.format || 'raw';
}

function fieldSortOf(ch, name) {
  return fieldCfgOf(ch, name).sort || 'none';
}

function displayFieldLabel(ch, name) {
  const alias = fieldCfgOf(ch, name).alias;
  if (alias && String(alias).trim()) return cleanFieldLabel(String(alias).trim());
  const lab = fieldLabelOf(ch.datasetId, name);
  if (lab && /[\u4e00-\u9fff]/.test(String(lab))) return cleanFieldLabel(lab);
  return humanizeFieldName(name);
}

/** Strip dataset annotation noise: "商户入账,单位分" → "商户入账" */
function cleanFieldLabel(raw) {
  let s = String(raw || '').replace(/，/g, ',').trim();
  const comma = s.indexOf(',');
  if (comma > 0) {
    const head = s.slice(0, comma).trim();
    if (head) s = head;
  }
  const colon = s.indexOf(':');
  if (colon > 1) {
    const head = s.slice(0, colon).trim();
    if (head && /[\u4e00-\u9fff]/.test(head)) s = head;
  }
  return s.replace(/[，,]?\s*单位\s*[:：]?\s*分\s*$/g, '').trim() || String(raw || '');
}

/** 明细表列：维度槽 + 指标槽；兼容旧 encode.columns */
function tableColumnsOf(ch) {
  const dims = encodeFields(ch.encode, 'category');
  const quotas = encodeFields(ch.encode, 'value');
  if (dims.length || quotas.length) return [...dims, ...quotas];
  return encodeFields(ch.encode, 'columns');
}

function syncTableColumnsEncode(ch) {
  if (ch.chartType !== 'table' || !ch.encode) return;
  const cols = [...encodeFields(ch.encode, 'category'), ...encodeFields(ch.encode, 'value')];
  setEncodeFields(ch.encode, 'columns', cols);
}

/** 旧明细表把所有列塞进 columns；按字段角色拆到维度/指标槽（DataEase 汇总表分栏） */
function migrateTableEncode(ch) {
  if (!ch || ch.chartType !== 'table' || !ch.encode) return;
  const dims = encodeFields(ch.encode, 'category');
  const quotas = encodeFields(ch.encode, 'value');
  const cols = encodeFields(ch.encode, 'columns');
  if (cols.length && !dims.length && !quotas.length) {
    const nextDims = [];
    const nextQuotas = [];
    for (const name of cols) {
      if (fieldRole(ch, name) === 'quota') nextQuotas.push(name);
      else nextDims.push(name);
    }
    setEncodeFields(ch.encode, 'category', nextDims);
    setEncodeFields(ch.encode, 'value', nextQuotas);
  }
  syncTableColumnsEncode(ch);
}

function fillTableColumnsFromDataset(ch, force = false) {
  if (ch.chartType !== 'table') return;
  if (!force && tableColumnsOf(ch).length) return;
  const fields = ds(ch.datasetId)?.fields || [];
  const dims = fields.filter(f => fieldRole(ch, f) !== 'quota').map(f => f.name);
  const quotas = fields.filter(f => fieldRole(ch, f) === 'quota').map(f => f.name);
  setEncodeFields(ch.encode, 'category', dims);
  setEncodeFields(ch.encode, 'value', quotas);
  syncTableColumnsEncode(ch);
}

function sortSeriesPack(ch, pack) {
  const cat = encodePrimary(ch.encode, 'category');
  const sort = cat ? fieldSortOf(ch, cat) : 'none';
  if (!pack?.categories?.length || sort === 'none') return pack;
  const idx = pack.categories.map((_, i) => i);
  const val0 = pack.series[0]?.data || [];
  if (sort === 'asc' || sort === 'desc') {
    idx.sort((a, b) => {
      const va = +val0[a] || 0, vb = +val0[b] || 0;
      return sort === 'asc' ? va - vb : vb - va;
    });
  } else if (sort === 'alpha' || sort === 'alpha_desc') {
    idx.sort((a, b) => {
      const cmp = String(pack.categories[a]).localeCompare(String(pack.categories[b]), 'zh');
      return sort === 'alpha_desc' ? -cmp : cmp;
    });
  }
  return {
    categories: idx.map(i => pack.categories[i]),
    series: pack.series.map(s => ({ ...s, data: idx.map(i => s.data[i]) }))
  };
}

function sortPieData(ch, data) {
  const cat = encodePrimary(ch.encode, 'category');
  const sort = cat ? fieldSortOf(ch, cat) : 'none';
  if (!data?.length || sort === 'none') return data;
  const arr = [...data];
  if (sort === 'asc') arr.sort((a, b) => a.value - b.value);
  else if (sort === 'desc') arr.sort((a, b) => b.value - a.value);
  else if (sort === 'alpha') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  else if (sort === 'alpha_desc') arr.sort((a, b) => String(b.name).localeCompare(String(a.name), 'zh'));
  return arr;
}

/** 按拆色维拆系列（柱/条/线堆叠或分组） */
function aggregateByColor(rows, catFields, colorField, valueField, agg) {
  if (!colorField || !valueField) return { categories: [], series: [] };
  const cats = encodeFields({ category: catFields }, 'category');
  const order = [];
  const seen = new Set();
  const colorOrder = [];
  const colorSeen = new Set();
  for (const r of rows) {
    const k = dimKey(r, cats);
    if (!seen.has(k)) { seen.add(k); order.push(k); }
    const c = String(r[colorField] ?? '空');
    if (!colorSeen.has(c)) { colorSeen.add(c); colorOrder.push(c); }
  }
  const series = colorOrder.map(cName => {
    const bucket = new Map(order.map(k => [k, []]));
    for (const r of rows) {
      if (String(r[colorField] ?? '空') !== cName) continue;
      const k = dimKey(r, cats);
      if (bucket.has(k)) bucket.get(k).push(+r[valueField] || 0);
    }
    return {
      field: colorField,
      name: cName,
      data: order.map(k => reduceAgg(bucket.get(k) || [], agg))
    };
  });
  return { categories: order, series };
}

function pieLabelFormatter(st, tipVal) {
  const showName = st.labelName !== false;
  const showVal = st.labelValue !== false;
  const showPct = !!st.labelPercent;
  return (p) => {
    const parts = [];
    if (showName) parts.push(p.name);
    if (showVal) parts.push(tipVal(p.value));
    if (showPct) parts.push(`${p.percent}%`);
    return parts.join('\n') || tipVal(p.value);
  };
}

function dimKey(row, fields) {
  if (!fields?.length) return '合计';
  return fields.map(f => String(row[f] ?? 'null')).join(' · ');
}

function dimLabels(datasetId, fields) {
  return (fields || []).map(f => fieldLabelOf(datasetId, f)).join(' · ');
}

/** Max fields per encode slot. `max: 0` = unlimited (DataEase 明细表). */
function slotMax(chartType, slot) {
  const n = CHART_META[chartType]?.slots?.[slot]?.max;
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (typeof n === 'number') return n;
  return 1;
}

function slotTip(chartType, slot) {
  return CHART_META[chartType]?.slots?.[slot]?.tip || '';
}

function encodeGuideHtml(ch) {
  const meta = CHART_META[ch.chartType];
  if (!meta) return '';
  const caps = Object.entries(meta.slots || {}).map(([slot, cfg]) => {
    const lab = slotLabel(ch.chartType, slot);
    const cap = cfg.max === 0 ? '不限' : (cfg.max > 1 ? `≤${cfg.max}` : '×1');
    return `<span>${esc(lab)} ${cap}</span>`;
  }).join('');
  if (!caps) return '';
  return `<div class="encode-guide encode-guide--caps" title="${esc(meta.guide || '')}">
    <div class="eg-caps">${caps}</div>
  </div>`;
}

function aggregate(rows, cat, val, agg='SUM') {
  const cats = encodeFields({ category: cat }, 'category');
  const vals = encodeFields({ value: val }, 'value');
  const valueField = vals[0];
  if (!valueField) return [];
  if (!cats.length) {
    return [{ name: '合计', value: reduceAgg(rows.map(r => +r[valueField] || 0), agg) }];
  }
  const m = new Map();
  for (const r of rows) {
    const k = dimKey(r, cats);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(+r[valueField] || 0);
  }
  return [...m.entries()].map(([name, nums]) => ({ name, value: reduceAgg(nums, agg) }));
}

/** Multi-metric series aligned to shared category axis */
function aggregateSeries(rows, cat, vals, agg='SUM', datasetId, ch) {
  const cats = encodeFields({ category: cat }, 'category');
  const measures = encodeFields({ value: vals }, 'value');
  if (!measures.length) return { categories: [], series: [] };
  const order = [];
  const seen = new Set();
  if (!cats.length) {
    order.push('合计');
  } else {
    for (const r of rows) {
      const k = dimKey(r, cats);
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    }
  }
  const series = measures.map(field => {
    const useAgg = ch ? fieldAggOf(ch, field) : agg;
    const bucket = new Map(order.map(k => [k, []]));
    if (!cats.length) {
      bucket.set('合计', rows.map(r => +r[field] || 0));
    } else {
      for (const r of rows) {
        const k = dimKey(r, cats);
        if (bucket.has(k)) bucket.get(k).push(+r[field] || 0);
      }
    }
    return {
      field,
      name: ch ? displayFieldLabel(ch, field) : fieldLabelOf(datasetId, field),
      data: order.map(k => reduceAgg(bucket.get(k) || [], useAgg))
    };
  });
  return { categories: order, series };
}

/** Multi-dim × multi-metric flat rows for grouptable */
function aggregateTable(rows, cat, vals, agg='SUM') {
  const cats = encodeFields({ category: cat }, 'category');
  const measures = encodeFields({ value: vals }, 'value');
  if (!measures.length) return [];
  const m = new Map();
  for (const r of rows) {
    const k = dimKey(r, cats);
    if (!m.has(k)) {
      m.set(k, {
        key: k,
        dims: cats.map(f => r[f]),
        nums: Object.fromEntries(measures.map(f => [f, []]))
      });
    }
    const b = m.get(k);
    measures.forEach(f => b.nums[f].push(+r[f] || 0));
  }
  return [...m.values()].map(b => ({
    key: b.key,
    dims: b.dims,
    values: Object.fromEntries(measures.map(f => [f, reduceAgg(b.nums[f], agg)]))
  }));
}

/** Crosstab: rows × cols → value(s); supports multi dim / multi measure */
function pivotAggregate(rows, rowField, colField, val, agg='SUM', datasetId) {
  const rowFields = encodeFields({ category: rowField }, 'category');
  const colFields = encodeFields({ colDim: colField }, 'colDim');
  const valFields = encodeFields({ value: val }, 'value');
  const cell = new Map();
  const rowSet = new Set(), colSet = new Set();
  for (const r of rows) {
    const row = dimKey(r, rowFields);
    const colBase = dimKey(r, colFields);
    rowSet.add(row);
    for (const vf of valFields) {
      const col = valFields.length > 1
        ? `${colBase} · ${fieldLabelOf(datasetId, vf)}`
        : colBase;
      colSet.add(col);
      const key = row + '\t' + col;
      if (!cell.has(key)) cell.set(key, []);
      cell.get(key).push(+r[vf] || 0);
    }
  }
  const rowKeys = [...rowSet];
  const colKeys = [...colSet];
  const matrix = rowKeys.map(row => {
    const vals = colKeys.map(col => reduceAgg(cell.get(row + '\t' + col) || [], agg));
    return { row, vals, total: vals.reduce((a, b) => a + b, 0) };
  });
  const colTotals = colKeys.map((_, ci) => matrix.reduce((s, r) => s + r.vals[ci], 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  return { rowKeys, colKeys, matrix, colTotals, grand, rowFields, colFields, valFields };
}

function formatVal(v, fmt) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (fmt === 'percent') return (n * 100).toFixed(1) + '%';
  if (fmt === 'percent2') return (n * 100).toFixed(2) + '%';
  if (fmt === 'thousand') {
    return n.toLocaleString('zh-CN', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 });
  }
  if (fmt === 'fixed2') return n.toFixed(2);
  if (fmt === 'fixed1') return n.toFixed(1);
  if (fmt === 'integer' || fmt === 'int') {
    return Math.round(n).toLocaleString('zh-CN');
  }
  // raw / 默认：整数不带小数；比率类保留 2 位；其它最多 2 位
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toLocaleString('zh-CN');
  }
  if (Math.abs(n) > 0 && Math.abs(n) < 1) return n.toFixed(2);
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

/** 轴单位换算展示（DataEase 纵轴单位） */
function formatAxisVal(v, unit, fmt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return formatEmpty(v, '-');
  if (unit === 'k') return formatVal(n / 1000, fmt || 'fixed1') + '千';
  if (unit === 'wan') return formatVal(n / 10000, fmt || 'fixed1') + '万';
  if (unit === 'yi') return formatVal(n / 1e8, fmt || 'fixed2') + '亿';
  return formatVal(n, fmt);
}

/** Apply chart.style.formatter (e.g. 分→元) then axisUnit / suffix. */
function measureDisplayVal(v, st, fmt, sampleForAuto) {
  let n = Number(v);
  if (!Number.isFinite(n)) return formatEmpty(v, '-');
  const f = st?.formatter;
  if (f && typeof f === 'object' && f.unit != null && Number.isFinite(Number(f.unit))) {
    n = n * Number(f.unit);
  }
  let axis = st?.axisUnit || 'none';
  if ((axis === 'none' || !axis) && f?.unit != null) {
    const probe = Number.isFinite(Number(sampleForAuto)) ? Number(sampleForAuto) * Number(f.unit) : n;
    if (Math.abs(probe) >= 1e8) axis = 'yi';
    else if (Math.abs(probe) >= 1e4) axis = 'wan';
  }
  let text = formatAxisVal(n, axis, fmt);
  if (axis === 'none' || axis === '' || axis == null) {
    const suf = st?.valueSuffix != null && st.valueSuffix !== ''
      ? st.valueSuffix
      : (f && f.suffix ? f.suffix : '');
    if (suf && !String(text).endsWith(String(suf))) text = `${text}${suf}`;
  }
  return text;
}

function formatEmpty(v, placeholder) {
  if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) {
    return placeholder == null ? '-' : String(placeholder);
  }
  return null; // 非空
}

function displayCellValue(ch, st, field, raw) {
  const empty = formatEmpty(raw, st.emptyValue ?? '-');
  if (empty != null) return empty;
  const num = fieldMeta(ch.datasetId, field)?.group === 'quota';
  if (num) return formatVal(raw, fieldFormatOf(ch, field));
  return String(raw);
}

function matchCondStyle(st, field, raw) {
  if (!st.condEnabled || !st.condField || st.condField !== field) return null;
  const op = st.condOp || 'gt';
  const target = st.condValue;
  const num = Number(raw);
  const tNum = Number(target);
  let hit = false;
  if (op === 'empty') hit = raw == null || raw === '';
  else if (op === 'not_empty') hit = !(raw == null || raw === '');
  else if (op === 'contains') hit = String(raw ?? '').includes(String(target ?? ''));
  else if (Number.isFinite(num) && Number.isFinite(tNum)) {
    if (op === 'gt') hit = num > tNum;
    else if (op === 'gte') hit = num >= tNum;
    else if (op === 'lt') hit = num < tNum;
    else if (op === 'lte') hit = num <= tNum;
    else if (op === 'eq') hit = num === tNum;
    else if (op === 'ne') hit = num !== tNum;
  } else if (op === 'eq') hit = String(raw) === String(target);
  else if (op === 'ne') hit = String(raw) !== String(target);
  if (!hit) return null;
  return {
    background: st.condBg || '#fff1f0',
    color: st.condColor || '#cf1322'
  };
}

function resolveSeriesColors(st, theme) {
  const base = (theme?.series || []).slice();
  const override = Array.isArray(st.seriesColors) ? st.seriesColors.filter(Boolean) : [];
  if (!override.length) return base;
  const out = base.slice();
  override.forEach((c, i) => { if (c) out[i] = c; });
  return out;
}

function slotLabel(chartType, slot) {
  if (slot === 'colDim') return '列维度';
  if (slot === 'category') return chartType === 'pivot' ? '行维度' : (chartType === 'table' ? '维度' : '维度');
  if (slot === 'value') return chartType === 'table' ? '指标' : '指标';
  if (slot === 'color') return chartType === 'grouptable' ? '二级分组' : '堆叠/拆色';
  if (slot === 'columns') return '表格列';
  return slot;
}

function missingBind(chart) {
  const meta = CHART_META[chart.chartType] || CHART_META.bar;
  const miss = [];
  if (!chart.datasetId) miss.push({ key:'dataset', label:'选择数据集' });
  if (chart.chartType === 'table') {
    if (!tableColumnsOf(chart).length) miss.push({ key: 'category', label: '绑定维度或指标' });
    return miss;
  }
  for (const slot of meta.need) {
    if (!encodeFields(chart.encode, slot).length) {
      miss.push({ key: slot, label: '绑定' + slotLabel(chart.chartType, slot) });
    }
  }
  return miss;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- render shell ---------- */
function syncModNav() {
  document.querySelectorAll('#modNav button').forEach(b => {
    b.classList.toggle('on', b.dataset.mod === state.module);
  });
}

function render() {
  disposeCharts();
  const app = elById('app');
  if (!app) return;
  app.classList.toggle('mobile-frame', false);
  syncModNav();
  document.querySelectorAll('#phaseTabs button').forEach(b => b.classList.toggle('on', b.dataset.phase === state.phase));

  if (state.module === 'workbench') renderWorkbench(app);
  else if (state.module === 'datasource') renderDatasource(app);
  else if (state.module === 'dataset') renderDataset(app);
  else if (state.module === 'report') {
    if (state.screen === 'editor') renderReportEditor(app);
    else renderReportList(app);
  }
  else if (state.screen === 'list') renderList(app);
  else if (state.screen === 'preview') renderPreview(app);
  else renderEditor(app);

  syncRoute();
}

function statusSrc(st) {
  if (st === 'ok') return '<span class="pill-soft ok">连通</span>';
  if (st === 'warn') return '<span class="pill-soft warn">告警</span>';
  return '<span class="pill-soft err">异常</span>';
}

function statusLabel(st) {
  return st === 'ok' ? '连通' : st === 'warn' ? '告警' : '异常';
}

const SRC_TYPE_META = {
  mysql: {
    label: 'MySQL', short: 'MY', color: '#fff', bg: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
    ink: '#1d4ed8', soft: '#dbeafe',
    svg: '<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="3" stroke="#fff" stroke-width="1.6"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" stroke="#fff" stroke-width="1.6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" stroke="#fff" stroke-width="1.6"/></svg>'
  },
  postgresql: {
    label: 'PostgreSQL', short: 'PG', color: '#fff', bg: 'linear-gradient(135deg,#38bdf8,#0369a1)',
    ink: '#0369a1', soft: '#e0f2fe',
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 15c-2 0-3.5-1.8-3-4 .4-1.8 2-3 4-3h1" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 5c2.5-1 6-.5 7.5 2.5S19 14 16 15.5c-1.5.8-3 .5-4-.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="9.5" cy="10" r="1" fill="#fff"/><circle cx="15" cy="9" r="1" fill="#fff"/></svg>'
  },
  clickhouse: {
    label: 'ClickHouse', short: 'CH', color: '#fff', bg: 'linear-gradient(135deg,#fbbf24,#d97706)',
    ink: '#b45309', soft: '#fef3c7',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="6" height="6" rx="1.2" fill="#fff"/><rect x="14" y="4" width="6" height="6" rx="1.2" fill="#fff" opacity=".75"/><rect x="4" y="14" width="6" height="6" rx="1.2" fill="#fff" opacity=".75"/><rect x="14" y="14" width="6" height="6" rx="1.2" fill="#fff"/></svg>'
  },
  api: {
    label: 'API', short: 'API', color: '#fff', bg: 'linear-gradient(135deg,#a78bfa,#7c3aed)',
    ink: '#6d28d9', soft: '#ede9fe',
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 12h8M10 8l-4 4 4 4M14 8l4 4-4 4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  excel: {
    label: 'Excel', short: 'XLS', color: '#fff', bg: 'linear-gradient(135deg,#4ade80,#15803d)',
    ink: '#15803d', soft: '#dcfce7',
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="#fff" stroke-width="1.6"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'
  }
};

function srcMeta(type) {
  return SRC_TYPE_META[type] || {
    label: type || 'Other', short: '?', color: '#fff',
    bg: 'linear-gradient(135deg,#94a3b8,#475569)', ink: '#334155', soft: '#f1f5f9',
    svg: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="#fff" stroke-width="1.6"/></svg>'
  };
}

function typeBadgeHtml(type, size = 36) {
  const m = srcMeta(type);
  return `<div class="type-badge" style="width:${size}px;height:${size}px;background:${m.bg};color:${m.color}" title="${esc(m.label)}">${m.svg}</div>`;
}

function heroIconHtml(type) {
  const m = srcMeta(type);
  return `<div class="hero-icon" style="background:${m.bg}">${m.svg}</div>`;
}

function sparkHtml(rows, dim, quota) {
  const map = new Map();
  rows.forEach(r => map.set(r[dim], (map.get(r[dim]) || 0) + (+r[quota] || 0)));
  const bars = [...map.entries()];
  const max = Math.max(...bars.map(b => b[1]), 1);
  return `<div class="spark">${bars.map(([, v]) => `<i style="height:${Math.max(8, Math.round(v / max * 100))}%"></i>`).join('')}</div>`;
}

function renderWorkbench(app) {
  const pubs = state.dashboards.filter(d => d.status !== 'draft').length;
  const dirty = state.dashboards.filter(d => d.status === 'publishedWithDraft').length;
  const srcOk = DATASOURCES.filter(s => s.status === 'ok').length;
  const recent = [...state.dashboards].sort((a, b) => (b.updateTime || '').localeCompare(a.updateTime || '')).slice(0, 5);
  app.innerHTML = `
    <div class="manage">
      <div class="bar">
        <strong style="font-size:14px">工作台</strong>
        <span class="crumb">概览数据链路与最近资产</span>
        <div class="spacer"></div>
        <button class="btn" id="wbRefresh">刷新状态</button>
        <button class="btn primary" id="wbNewDash">+ 新建仪表盘</button>
      </div>
      <div class="detail" style="flex:1;overflow:auto">
        <div class="stat-row">
          <div class="stat-card"><div class="k">数据源</div><div class="v">${DATASOURCES.length}</div><div class="s">${srcOk} 连通 · ${DATASOURCES.length - srcOk} 待处理</div></div>
          <div class="stat-card"><div class="k">数据集</div><div class="v">${Object.keys(DATASETS).length}</div><div class="s">覆盖销售 / 运营 / 库存 / 财务 / CRM</div></div>
          <div class="stat-card"><div class="k">仪表盘</div><div class="v">${state.dashboards.length}</div><div class="s">${pubs} 已发布 · ${dirty} 有未发布改动</div></div>
          <div class="stat-card"><div class="k">在线报告</div><div class="v">${state.reports.length}</div><div class="s">引用看板图 / 报告内新建图</div></div>
        </div>
        <div class="panel-card">
          <h3>推荐链路（点一步跳转）</h3>
          <div class="pipe">
            <div class="pipe-step" data-go="datasource"><div class="n">01</div><div class="t">接入数据源</div><div class="d">MySQL / PG / API / Excel · 测连通</div></div>
            <div class="pipe-arrow">→</div>
            <div class="pipe-step" data-go="dataset"><div class="n">02</div><div class="t">维护数据集</div><div class="d">选表 · 字段语义 · 预览取数</div></div>
            <div class="pipe-arrow">→</div>
            <div class="pipe-step" data-go="dashboard"><div class="n">03</div><div class="t">配置仪表盘</div><div class="d">绑定数据集 · 编码槽 · 发布分享</div></div>
            <div class="pipe-arrow">→</div>
            <div class="pipe-step" data-go="report"><div class="n">04</div><div class="t">撰写报告</div><div class="d">Umo 排版 · 引用看板图 / 新建图</div></div>
          </div>
        </div>
        <div class="grid-2">
          <div class="panel-card">
            <h3>最近仪表盘</h3>
            <div class="recent-list">
              ${recent.map(d => `
                <div class="recent-item" data-open="${d.id}">
                  <div class="ico">▣</div>
                  <div class="spacer" style="flex:1;min-width:0">
                    <div class="t">${esc(d.name)}</div>
                    <div class="m">${esc(d.folder)} · ${esc(d.updateBy)} · ${esc(d.updateTime)}</div>
                  </div>
                  ${statusTag(d.status)}
                </div>`).join('')}
            </div>
          </div>
          <div class="panel-card">
            <h3>数据源健康</h3>
            <div class="recent-list">
              ${DATASOURCES.map(s => `
                <div class="recent-item" data-src="${s.id}">
                  <div class="ico" style="background:${s.status==='ok'?'#e3f7ef':s.status==='warn'?'#fff7ed':'#fef2f2'}">${s.type.slice(0,2).toUpperCase()}</div>
                  <div class="spacer" style="flex:1;min-width:0">
                    <div class="t">${esc(s.name)}</div>
                    <div class="m">${esc(s.type)} · 上次检测 ${esc(s.lastCheck)}</div>
                  </div>
                  ${statusSrc(s.status)}
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  app.querySelector('#wbRefresh').onclick = () => toast('已同步连通性（演示）', 'ok');
  app.querySelector('#wbNewDash').onclick = () => {
    state.module = 'dashboard';
    createBlankDash();
  };
  app.querySelectorAll('[data-go]').forEach(el => el.onclick = () => gotoModule(el.dataset.go));
  app.querySelectorAll('[data-open]').forEach(el => el.onclick = () => {
    selectDash(el.dataset.open);
    state.module = 'dashboard';
    state.screen = 'editor';
    render();
  });
  app.querySelectorAll('[data-src]').forEach(el => el.onclick = () => {
    state.srcId = el.dataset.src;
    gotoModule('datasource');
  });
}

function renderDatasource(app) {
  const q = state.search.trim();
  const typeKeys = ['all', ...new Set(DATASOURCES.map(s => s.type))];
  const list = DATASOURCES.filter(s => {
    if (state.srcTypeFilter !== 'all' && s.type !== state.srcTypeFilter) return false;
    return !q || s.name.includes(q) || s.type.includes(q) || (s.desc || '').includes(q);
  });
  const src = DATASOURCES.find(s => s.id === state.srcId) || list[0] || DATASOURCES[0];
  if (src) state.srcId = src.id;
  const used = (src.usedBy || []).map(id => DATASETS[id]).filter(Boolean);
  const meta = srcMeta(src.type);
  const okN = DATASOURCES.filter(s => s.status === 'ok').length;
  const hostLine = src.port ? `${src.host}:${src.port}` : String(src.host);

  const schemaDemo = [
    { name: 'fact_order', rows: '2.1M', kind: '事实表', note: '订单明细' },
    { name: 'dim_product', rows: '12k', kind: '维度表', note: '产品主数据' },
    { name: 'fact_inventory', rows: '480k', kind: '事实表', note: '库存快照' },
    { name: 'ods_event_day', rows: '90d', kind: '聚合表', note: '日流量' }
  ];

  app.innerHTML = `
    <div class="studio">
      <div class="studio-bar">
        <div class="title-block">
          <strong>数据源</strong>
          <span>${DATASOURCES.length} 个连接 · ${okN} 连通 · 飞书式资产管理</span>
        </div>
        <div class="chip-row" id="typeChips">
          ${typeKeys.map(t => {
            const label = t === 'all' ? '全部' : srcMeta(t).label;
            const n = t === 'all' ? DATASOURCES.length : DATASOURCES.filter(s => s.type === t).length;
            return `<button type="button" class="filter-chip ${state.srcTypeFilter===t?'on':''}" data-tf="${t}">${esc(label)} <span style="opacity:.75">${n}</span></button>`;
          }).join('')}
        </div>
        <div class="spacer"></div>
        <label class="studio-search"><span class="ico">⌕</span>
          <input id="srcSearch" placeholder="搜索名称、类型、备注" value="${esc(state.search)}" />
        </label>
        <button type="button" class="btn" id="btnPingAll">全部检测</button>
        <button type="button" class="btn primary" id="btnNewSrc">+ 新建连接</button>
      </div>
      <div class="studio-body">
        <aside class="asset-rail">
          <div class="rail-head"><span>连接列表</span><span>${list.length}</span></div>
          <div class="rail-scroll">
            ${list.map(s => `
              <div class="asset-item ${s.id===src.id?'on':''}" data-sid="${s.id}">
                ${typeBadgeHtml(s.type)}
                <div class="meta">
                  <div class="name">${esc(s.name)}</div>
                  <div class="desc">
                    <span class="status-dot ${s.status}"></span>
                    <span>${esc(srcMeta(s.type).label)}</span>
                    <span>·</span>
                    <span>${statusLabel(s.status)}</span>
                  </div>
                </div>
              </div>`).join('') || '<div class="empty-illus"><div class="big">⌀</div>无匹配连接</div>'}
          </div>
        </aside>
        <section class="asset-stage" id="srcStage">
          <div class="hero-card" id="srcHero">
            <div class="hero-top">
              ${heroIconHtml(src.type)}
              <div class="hero-copy">
                <h2>${esc(src.name)}</h2>
                <div class="sub">${esc(src.desc)} · ${statusSrc(src.status)} · 负责人 ${esc(src.owner)}</div>
              </div>
              <div class="hero-actions">
                <button type="button" class="btn" id="btnPing">测试连接</button>
                <button type="button" class="btn" id="btnExplore">浏览结构</button>
                <button type="button" class="btn primary" id="btnMakeDs">以此创建数据集</button>
              </div>
            </div>
            <div class="metric-strip">
              <div class="metric-cell"><div class="k">引擎类型</div><div class="v" style="color:${meta.ink}">${esc(meta.label)}</div><div class="h">Connector</div></div>
              <div class="metric-cell"><div class="k">主机 / 入口</div><div class="v" style="font-size:13px">${esc(hostLine)}</div><div class="h">Network</div></div>
              <div class="metric-cell"><div class="k">库 / 文件</div><div class="v">${esc(String(src.database))}</div><div class="h">Catalog</div></div>
              <div class="metric-cell"><div class="k">上次检测</div><div class="v" style="font-size:13px">${esc(src.lastCheck)}</div><div class="h">Health check</div></div>
            </div>
          </div>

          <div class="soft-panel">
            <div class="phd"><h3>连接属性</h3><span class="hint">结构化展示 · 非终端日志</span></div>
            <div class="pbd">
              <div class="kv-grid">
                <div class="kv"><div class="kk">显示名</div><div class="vv">${esc(src.name)}</div></div>
                <div class="kv"><div class="kk">类型</div><div class="vv">${esc(meta.label)}</div></div>
                <div class="kv"><div class="kk">Host</div><div class="vv">${esc(String(src.host))}</div></div>
                <div class="kv"><div class="kk">Port</div><div class="vv">${src.port ?? '—'}</div></div>
                <div class="kv"><div class="kk">Database</div><div class="vv">${esc(String(src.database))}</div></div>
                <div class="kv"><div class="kk">表数量</div><div class="vv">≈ ${src.tables}</div></div>
                <div class="kv"><div class="kk">负责人</div><div class="vv">${esc(src.owner)}</div></div>
                <div class="kv"><div class="kk">引用数据集</div><div class="vv">${used.length} 个</div></div>
              </div>
            </div>
          </div>

          <div class="soft-panel">
            <div class="phd">
              <h3>库表结构预览</h3>
              <span class="hint">点击行可选中并创建数据集</span>
              <button type="button" class="btn ghost" id="btnExplore2" style="margin-left:0">刷新</button>
            </div>
            <div class="pbd" style="padding:0">
              <table class="schema-table">
                <thead><tr><th>对象</th><th>类型</th><th>规模</th><th>说明</th><th></th></tr></thead>
                <tbody>
                  ${schemaDemo.map((t, i) => `
                    <tr data-tbl="${esc(t.name)}" class="${i===0?'picked':''}">
                      <td><b style="font-weight:650">${esc(t.name)}</b></td>
                      <td><span class="mini-tag blue">${esc(t.kind)}</span></td>
                      <td>${esc(t.rows)}</td>
                      <td style="color:var(--text-2)">${esc(t.note)}</td>
                      <td><button type="button" class="btn ghost" data-use-tbl="${esc(t.name)}">选用</button></td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="soft-panel">
            <div class="phd"><h3>下游数据集</h3><span class="hint">${used.length} 个引用</span></div>
            <div class="pbd">
              ${used.length ? `<div class="ref-grid">${used.map(d => `
                <div class="ref-card" data-ds="${d.id}">
                  <div class="rt">${esc(d.name)}</div>
                  <div class="rm">${esc(d.desc || d.folder || '')}</div>
                  <div class="rf">
                    <span class="mini-tag">${d.fields.filter(f=>f.group==='dim').length} 维度</span>
                    <span class="mini-tag green">${d.fields.filter(f=>f.group==='quota').length} 指标</span>
                    <span class="mini-tag blue">${d.rows.length} 样例行</span>
                  </div>
                </div>`).join('')}</div>` : `
                <div class="empty-illus">
                  <div class="big">▦</div>
                  还没有数据集引用此连接
                  <div style="margin-top:10px"><button type="button" class="btn primary" id="btnMakeDs2">以此创建第一个数据集</button></div>
                </div>`}
            </div>
          </div>
        </section>
      </div>
    </div>`;

  app.querySelector('#srcSearch').oninput = e => { state.search = e.target.value; render(); };
  app.querySelectorAll('[data-tf]').forEach(el => el.onclick = () => { state.srcTypeFilter = el.dataset.tf; render(); });
  app.querySelectorAll('[data-sid]').forEach(el => el.onclick = () => { state.srcId = el.dataset.sid; render(); });
  app.querySelector('#btnPing').onclick = () => {
    const hero = app.querySelector('#srcHero');
    if (src.status === 'err') { toast('连接失败：超时（演示保持异常态）', 'warn'); return; }
    src.lastCheck = '刚刚';
    src.status = src.status === 'warn' ? 'warn' : 'ok';
    hero?.classList.remove('ping-flash');
    void hero?.offsetWidth;
    hero?.classList.add('ping-flash');
    toast('连接成功 · 延迟 18ms（演示）', 'ok');
    render();
  };
  app.querySelector('#btnPingAll').onclick = () => toast(`已检测 ${DATASOURCES.length} 个数据源`, 'ok');
  app.querySelector('#btnExplore').onclick = () => {
    showModal(`<h3>浏览结构 · ${esc(src.name)}</h3>
      <p style="font-size:12px;color:var(--text-2);margin-bottom:12px">真实环境走 connector.listTables / listColumns</p>
      <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
        <table class="schema-table">
          <thead><tr><th>表名</th><th>类型</th><th>估算行数</th><th>备注</th></tr></thead>
          <tbody>${schemaDemo.map(t => `<tr><td><b>${esc(t.name)}</b></td><td><span class="mini-tag blue">${esc(t.kind)}</span></td><td>${esc(t.rows)}</td><td>${esc(t.note)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="actions"><button type="button" class="btn primary" id="ok">完成</button></div>`);
    document.getElementById('ok').onclick = hideModal;
  };
  app.querySelector('#btnExplore2').onclick = () => toast('已刷新表清单（演示）', 'ok');
  const goMakeDs = (tableName) => {
    state.module = 'dataset';
    if (used[0]) state.datasetId = used[0].id;
    state.dsWizardStep = 1;
    toast(tableName ? `已选用 ${tableName}，进入数据集` : '进入数据集工作台', 'ok');
    render();
    if (tableName) setTimeout(() => openNewDatasetModal(src.id, tableName), 80);
  };
  app.querySelector('#btnMakeDs').onclick = () => goMakeDs();
  app.querySelector('#btnMakeDs2')?.addEventListener('click', () => goMakeDs());
  app.querySelector('#btnNewSrc').onclick = () => openNewDatasourceModal();
  app.querySelectorAll('[data-ds]').forEach(el => el.onclick = () => {
    state.datasetId = el.dataset.ds;
    gotoModule('dataset');
  });
  app.querySelectorAll('[data-use-tbl]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); goMakeDs(el.dataset.useTbl); };
  });
  app.querySelectorAll('[data-tbl]').forEach(el => {
    el.onclick = () => {
      app.querySelectorAll('[data-tbl]').forEach(r => r.classList.toggle('picked', r === el));
    };
  });
}

function openNewDatasourceModal() {
  let picked = 'mysql';
  const paint = () => {
    showModal(`<h3>新建数据源连接</h3>
      <p style="font-size:12px;color:var(--text-2);margin:-4px 0 12px">选择引擎类型 → 填写连接 → 检测保存（Quick BI 式选型）</p>
      <div class="wizard-steps"><span class="on">1 选型</span><span class="on">2 配置</span><span>3 检测</span></div>
      <div class="type-gallery" id="tg">
        ${Object.entries(SRC_TYPE_META).map(([k, m]) => `
          <div class="type-pick ${picked===k?'on':''}" data-t="${k}">
            <div class="tb" style="background:${m.bg}">${m.svg}</div>
            <div class="tn">${esc(m.label)}</div>
            <div class="td">${k === 'excel' ? '文件上传' : k === 'api' ? 'REST / JSON' : 'JDBC 连接'}</div>
          </div>`).join('')}
      </div>
      <div class="field"><label>显示名称</label><input id="n" value="新业务库" /></div>
      <div style="display:grid;grid-template-columns:1fr 100px;gap:8px">
        <div class="field"><label>Host / Endpoint</label><input id="h" value="127.0.0.1" /></div>
        <div class="field"><label>Port</label><input id="p" value="3306" /></div>
      </div>
      <div class="field"><label>Database / 路径</label><input id="db" value="demo" /></div>
      <div class="actions">
        <button type="button" class="btn ghost" id="c">取消</button>
        <button type="button" class="btn" id="ping">测试连接</button>
        <button type="button" class="btn primary" id="ok">保存连接</button>
      </div>`);
    document.getElementById('tg').onclick = e => {
      const card = e.target.closest('[data-t]');
      if (!card) return;
      picked = card.dataset.t;
      document.querySelectorAll('#tg .type-pick').forEach(x => x.classList.toggle('on', x.dataset.t === picked));
      const defPort = { mysql: 3306, postgresql: 5432, clickhouse: 8123, api: '', excel: '' }[picked];
      document.getElementById('p').value = defPort;
    };
    document.getElementById('c').onclick = hideModal;
    document.getElementById('ping').onclick = () => toast(`${srcMeta(picked).label} 连通成功（演示）`, 'ok');
    document.getElementById('ok').onclick = () => {
      const id = uid('src');
      const portVal = document.getElementById('p').value;
      DATASOURCES.unshift({
        id, name: document.getElementById('n').value || '未命名',
        type: picked,
        host: document.getElementById('h').value,
        port: portVal ? +portVal : null,
        database: document.getElementById('db').value,
        status: 'ok', lastCheck: '刚刚', owner: '当前用户', tables: 0, usedBy: [],
        desc: `新建 ${srcMeta(picked).label} 连接`
      });
      state.srcId = id;
      state.srcTypeFilter = 'all';
      hideModal();
      toast('数据源已保存', 'ok');
      render();
    };
  };
  paint();
}

function renderDataset(app) {
  const q = state.search.trim();
  const folders = [...new Set(Object.values(DATASETS).map(d => d.folder || '未分组'))];
  const list = Object.values(DATASETS).filter(d => {
    if (state.folderFilter !== 'all' && (d.folder || '未分组') !== state.folderFilter) return false;
    return !q || d.name.includes(q) || (d.desc || '').includes(q);
  });
  const ds = DATASETS[state.datasetId] || list[0] || Object.values(DATASETS)[0];
  if (ds) state.datasetId = ds.id;
  const src = DATASOURCES.find(s => s.id === ds.datasourceId);
  const usedBy = state.dashboards.filter(d => (d.datasetIds || []).includes(ds.id));
  const previewRows = ds.rows.slice(0, 8);
  const dimN = ds.fields.filter(f => f.group === 'dim').length;
  const quotaN = ds.fields.filter(f => f.group === 'quota').length;
  const tab = state.dsTab || 'fields';

  const fieldsPane = `
    <div class="soft-panel" style="margin:0">
      <div class="phd">
        <h3>字段配置</h3>
        <span class="hint">切换维度 / 指标角色 · 供图表编码槽使用</span>
      </div>
      <div class="pbd" style="padding:0;max-height:420px;overflow:auto">
        <table class="field-table">
          <thead><tr><th style="width:36%">显示名</th><th>字段</th><th>角色</th><th>类型</th></tr></thead>
          <tbody>
            ${ds.fields.map(f => `
              <tr data-fn="${f.name}">
                <td><b style="font-weight:650">${esc(f.label)}</b></td>
                <td style="color:var(--text-3);font-family:ui-monospace,monospace;font-size:11px">${esc(f.name)}</td>
                <td>
                  <div class="role-seg">
                    <button type="button" class="${f.group==='dim'?'on dim':''}" data-role="dim" data-fn="${f.name}">维度</button>
                    <button type="button" class="${f.group==='quota'?'on quota':''}" data-role="quota" data-fn="${f.name}">指标</button>
                  </div>
                </td>
                <td><span class="mini-tag ${f.group==='dim'?'blue':'green'}">${f.group==='dim'?'Abc 文本/维':'# 数值'}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const previewPane = `
    <div class="soft-panel" style="margin:0">
      <div class="phd">
        <h3>数据预览</h3>
        <span class="hint">datasetQuery.execute · 前 ${previewRows.length} 行</span>
        <button type="button" class="btn" id="btnPreviewQ">运行取数</button>
      </div>
      <div class="pbd" style="padding:0;overflow:auto;max-height:420px">
        <table class="schema-table">
          <thead><tr>${ds.fields.map(f => `<th>${esc(f.label)}<div style="font-weight:400;color:#c0c4cc;font-size:10px">${esc(f.name)}</div></th>`).join('')}</tr></thead>
          <tbody>
            ${previewRows.map(r => `<tr>${ds.fields.map(f => `<td>${esc(String(r[f.name] ?? ''))}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const lineagePane = `
    <div class="soft-panel" style="margin:0">
      <div class="phd"><h3>血缘与消费</h3><span class="hint">数据源 → 数据集 → 仪表盘</span></div>
      <div class="pbd">
        <div class="lineage">
          <div class="node" id="linSrc" style="cursor:pointer">
            <b>数据源</b>${esc(src?.name || '—')}
            <div style="margin-top:6px">${src ? typeBadgeHtml(src.type, 28) : ''}</div>
          </div>
          <div class="arrow">→</div>
          <div class="node" style="border-color:#9db7ff;background:#f5f8ff">
            <b>数据集</b>${esc(ds.name)}
            <div style="margin-top:4px;font-size:11px;color:var(--text-3)">${dimN} 维 · ${quotaN} 指标</div>
          </div>
          <div class="arrow">→</div>
          <div class="node" style="flex:1;min-width:180px">
            <b>仪表盘（${usedBy.length}）</b>
            ${usedBy.length ? usedBy.map(d => `<div style="margin-top:4px;font-size:12px">· ${esc(d.name)}</div>`).join('') : '<div style="margin-top:4px;color:var(--text-3)">暂无消费</div>'}
          </div>
        </div>
        <div class="ref-grid" style="margin-top:14px">
          ${usedBy.map(d => `
            <div class="ref-card" data-open="${d.id}">
              <div class="rt">${esc(d.name)}</div>
              <div class="rm">${esc(d.folder)} · ${esc(d.updateBy || '')}</div>
              <div class="rf">${statusTag(d.status)}<span class="mini-tag blue">${Object.keys(d.charts||{}).length} 图</span></div>
            </div>`).join('') || '<div class="empty-illus" style="grid-column:1/-1"><div class="big">▣</div>还没有仪表盘使用此数据集</div>'}
        </div>
      </div>
    </div>`;

  app.innerHTML = `
    <div class="studio">
      <div class="studio-bar">
        <div class="title-block">
          <strong>数据集</strong>
          <span>语义层 · 字段角色 · 预览取数 · 一键上板</span>
        </div>
        <div class="chip-row">
          <button type="button" class="filter-chip ${state.folderFilter==='all'?'on':''}" data-ff="all">全部</button>
          ${folders.map(f => `<button type="button" class="filter-chip ${state.folderFilter===f?'on':''}" data-ff="${esc(f)}">${esc(f)}</button>`).join('')}
        </div>
        <div class="spacer"></div>
        <label class="studio-search"><span class="ico">⌕</span>
          <input id="dsSearch" placeholder="搜索数据集" value="${esc(state.search)}" />
        </label>
        <button type="button" class="btn primary" id="btnNewDs">+ 新建数据集</button>
      </div>
      <div class="studio-body">
        <aside class="asset-rail">
          <div class="rail-head"><span>数据集</span><span>${list.length}</span></div>
          <div class="rail-scroll">
            ${list.map(d => {
              const s = DATASOURCES.find(x => x.id === d.datasourceId);
              return `<div class="asset-item ${d.id===ds.id?'on':''}" data-did="${d.id}">
                <div class="type-badge" style="background:linear-gradient(135deg,#93c5fd,#3370ff);color:#fff">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h10" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><rect x="14" y="15" width="6" height="5" rx="1" stroke="#fff" stroke-width="1.4"/></svg>
                </div>
                <div class="meta">
                  <div class="name">${esc(d.name)}</div>
                  <div class="desc">${esc(d.folder || '未分组')} · ${esc(s ? srcMeta(s.type).label : '—')} · ${d.fields.length} 字段</div>
                </div>
              </div>`;
            }).join('') || '<div class="empty-illus"><div class="big">⌀</div>无匹配数据集</div>'}
          </div>
        </aside>
        <section class="asset-stage">
          <div class="hero-card">
            <div class="hero-top">
              <div class="hero-icon" style="background:linear-gradient(135deg,#60a5fa,#3370ff)">
                <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h10" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><rect x="14" y="15" width="6" height="5" rx="1" stroke="#fff" stroke-width="1.4"/></svg>
              </div>
              <div class="hero-copy">
                <h2>${esc(ds.name)}</h2>
                <div class="sub">${esc(ds.desc || '')} · 来自
                  <a href="javascript:void(0)" id="srcLink" style="color:var(--brand);text-decoration:none;font-weight:600">${esc(src?.name || '—')}</a>
                </div>
              </div>
              <div class="hero-actions">
                <button type="button" class="btn" id="btnOpenSrc">数据源</button>
                <button type="button" class="btn" id="btnEditDs">编辑数据集</button>
                <button type="button" class="btn" id="btnPreviewQTop">预览取数</button>
                <button type="button" class="btn primary" id="btnUseDash">创建仪表盘</button>
              </div>
            </div>
            <div class="metric-strip">
              <div class="metric-cell"><div class="k">维度</div><div class="v" style="color:#245bdb">${dimN}</div><div class="h">Dimension</div></div>
              <div class="metric-cell"><div class="k">指标</div><div class="v" style="color:#047857">${quotaN}</div><div class="h">Measure</div></div>
              <div class="metric-cell"><div class="k">样例行</div><div class="v">${ds.rows.length}</div><div class="h">Preview rows</div></div>
              <div class="metric-cell"><div class="k">引用看板</div><div class="v">${usedBy.length}</div><div class="h">Consumers</div></div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div class="studio-tabs" id="dsTabs">
              <button type="button" class="${tab==='fields'?'on':''}" data-tab="fields">字段</button>
              <button type="button" class="${tab==='preview'?'on':''}" data-tab="preview">预览</button>
              <button type="button" class="${tab==='lineage'?'on':''}" data-tab="lineage">血缘</button>
            </div>
            <span style="font-size:11px;color:var(--text-3)">切换页签不会丢失字段角色修改</span>
          </div>
          <div id="dsPane">
            ${tab === 'preview' ? previewPane : tab === 'lineage' ? lineagePane : fieldsPane}
          </div>
        </section>
      </div>
    </div>`;

  app.querySelector('#dsSearch').oninput = e => { state.search = e.target.value; render(); };
  app.querySelectorAll('[data-ff]').forEach(el => el.onclick = () => { state.folderFilter = el.dataset.ff; render(); });
  app.querySelectorAll('[data-did]').forEach(el => el.onclick = () => { state.datasetId = el.dataset.did; state.dsTab = 'fields'; render(); });
  app.querySelectorAll('#dsTabs [data-tab]').forEach(el => el.onclick = () => { state.dsTab = el.dataset.tab; render(); });

  app.querySelectorAll('[data-role]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const f = ds.fields.find(x => x.name === btn.dataset.fn);
      if (!f) return;
      f.group = btn.dataset.role;
      toast(`${f.label} → ${f.group === 'dim' ? '维度' : '指标'}`, 'ok');
      render();
    };
  });

  const runPreviewQ = () => {
    const dims = ds.fields.filter(f => f.group === 'dim').slice(0, 2).map(f => f.name);
    const quotas = ds.fields.filter(f => f.group === 'quota').slice(0, 1).map(f => f.name);
    showModal(`<h3>预览取数 · ${esc(ds.name)}</h3>
      <p style="font-size:12px;color:var(--text-2);margin-bottom:8px">自研 <code>datasetQuery.execute</code> · FilterAST + ResultTable</p>
      <div class="sql-box">POST /datasetQuery/execute
{
  "datasetId": "${ds.id}",
  "dimensions": ${JSON.stringify(dims)},
  "measures": [{ "field": "${quotas[0] || 'amount'}", "agg": "SUM" }],
  "filters": { "op": "and", "children": [] },
  "limit": 200
}</div>
      <p style="font-size:12px;margin:12px 0 6px;color:var(--text-2)">ResultTable · ${previewRows.length} rows</p>
      <div style="overflow:auto;max-height:180px;border:1px solid var(--line);border-radius:10px">
        <table class="schema-table"><thead><tr>${[...dims, ...quotas].map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead>
        <tbody>${previewRows.map(r => `<tr>${[...dims, ...quotas].map(n => `<td>${esc(String(r[n] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div>
      <div class="actions"><button type="button" class="btn primary" id="ok">关闭</button></div>`);
    document.getElementById('ok').onclick = hideModal;
  };
  app.querySelector('#btnPreviewQ')?.addEventListener('click', runPreviewQ);
  app.querySelector('#btnPreviewQTop')?.addEventListener('click', () => {
    state.dsTab = 'preview';
    render();
    setTimeout(runPreviewQ, 0);
  });

  const goSrc = () => { if (src) state.srcId = src.id; gotoModule('datasource'); };
  app.querySelector('#btnOpenSrc').onclick = goSrc;
  app.querySelector('#srcLink').onclick = goSrc;
  app.querySelector('#linSrc')?.addEventListener('click', goSrc);

  app.querySelector('#btnUseDash').onclick = () => {
    const d = emptyDash(ds.name + '看板');
    const kpiField = ds.fields.find(f => f.group === 'quota')?.name || 'amount';
    const dimField = ds.fields.find(f => f.group === 'dim')?.name || 'region';
    const kpi = mkChart('kpi', '核心指标', { value: kpiField, format: 'raw', calc: 'none' }, {}, ds.id);
    const bar = mkChart('bar', '分布', { category: dimField, value: kpiField, format: 'raw' }, {}, ds.id);
    d.charts = { [kpi.id]: kpi.chart, [bar.id]: bar.chart };
    d.components = [
      { id: uid('w'), type: 'chart', tabId: 'tab_main', x: 0, y: 0, w: 4, h: 2, z: 1, chartId: kpi.id },
      { id: uid('w'), type: 'chart', tabId: 'tab_main', x: 0, y: 2, w: 8, h: 5, z: 2, chartId: bar.id }
    ];
    const packed = packDash(d, { folder: ds.folder || '未分组', desc: '从数据集一键创建', updateBy: '当前用户', updateTime: '刚刚' });
    state.dashboards.unshift(packed);
    selectDash(packed.id);
    state.module = 'dashboard';
    state.screen = 'editor';
    toast('已基于数据集创建仪表盘', 'ok');
    render();
  };
  app.querySelector('#btnNewDs').onclick = () => openDatasetStudio({ mode: 'create' });
  app.querySelector('#btnEditDs').onclick = () => openDatasetStudio({ mode: 'edit', datasetId: ds.id });
  app.querySelectorAll('[data-open]').forEach(el => el.onclick = () => {
    selectDash(el.dataset.open);
    state.module = 'dashboard';
    state.screen = 'list';
    render();
  });
}

function openNewDatasetModal(presetSrcId, tableName) {
  openDatasetStudio({ mode: 'create', srcId: presetSrcId, tableName });
}

/**
 * DataEase / Quick BI 风格：左库表 → 中字段池拖拽 → 右已选字段 → 底预览
 */
function openDatasetStudio(opts = {}) {
  const isEdit = opts.mode === 'edit' && opts.datasetId && DATASETS[opts.datasetId];
  const editing = isEdit ? DATASETS[opts.datasetId] : null;
  let srcId = opts.srcId || editing?.datasourceId || state.srcId || DATASOURCES[0]?.id;
  let tables = tablesOfSrc(srcId);
  let activeTable = opts.tableName || editing?.sourceTable || tables[0]?.name || '';
  let dsName = editing?.name || (opts.tableName ? `${opts.tableName} 数据集` : '未命名数据集');
  /** @type {{key:string,name:string,label:string,group:string,table:string}[]} */
  let selected = [];

  if (editing) {
    selected = editing.fields.map(f => ({
      key: `${editing.sourceTable || 't'}.${f.name}`,
      name: f.name,
      label: f.label,
      group: f.group,
      table: editing.sourceTable || tables[0]?.name || ''
    }));
    if (!activeTable && selected[0]) activeTable = selected[0].table;
  } else if (activeTable) {
    const t = findSchemaTable(srcId, activeTable);
    if (t) selected = t.fields.slice(0, 6).map(f => ({
      key: `${t.name}.${f.name}`, name: f.name, label: f.label, group: f.group, table: t.name
    }));
  }

  const paint = () => {
    tables = tablesOfSrc(srcId);
    if (!tables.find(t => t.name === activeTable)) activeTable = tables[0]?.name || '';
    const curTable = findSchemaTable(srcId, activeTable);
    const poolFields = curTable?.fields || [];
    const selectedKeys = new Set(selected.map(s => s.key));
    const previewCols = selected.length ? selected : poolFields.slice(0, 6).map(f => ({ ...f, table: activeTable }));
    const previewRows = buildStudioPreviewRows(srcId, selected.length ? selected : previewCols.map(f => ({ ...f, table: activeTable, key: `${activeTable}.${f.name}` })));

    showModal(`
      <div class="dss-head">
        <div>
          <h3>${isEdit ? '编辑数据集' : '新建数据集'}</h3>
          <div class="sub">从左侧选表，拖字段到右侧，底部即时预览</div>
        </div>
        <div class="spacer"></div>
        <div class="field" style="margin:0;width:220px">
          <input id="dsName" value="${esc(dsName)}" placeholder="数据集名称" style="height:32px" />
        </div>
        <button type="button" class="btn ghost" id="c">取消</button>
        <button type="button" class="btn primary" id="save">${isEdit ? '保存修改' : '创建数据集'}</button>
      </div>
      <div class="dss-body">
        <div class="dss-col">
          <div class="chd">数据源 / 表</div>
          <div class="cbd">
            <select class="src-select" id="srcPick">
              ${DATASOURCES.map(s => `<option value="${s.id}" ${s.id===srcId?'selected':''}>${esc(s.name)}</option>`).join('')}
            </select>
            ${tables.length ? tables.map(t => `
              <div class="tbl-item ${t.name===activeTable?'on':''}" data-tbl="${esc(t.name)}" draggable="true" title="拖到右侧可整表加入">
                <span style="color:var(--brand)">▦</span>
                <div class="tn">${esc(t.label)}</div>
                <div class="tc">${t.fields.length}</div>
              </div>
              <div style="font-size:10px;color:var(--text-3);padding:0 10px 8px 28px;margin-top:-4px">${esc(t.name)}</div>
            `).join('') : '<div class="empty-illus"><div class="big">⌀</div>该源暂无表结构</div>'}
          </div>
        </div>
        <div class="dss-col">
          <div class="chd">表字段 <span class="hint">拖到右侧 · 或双击添加</span></div>
          <div class="cbd">
            <div class="join-hint">当前表 <b>${esc(curTable?.label || '—')}</b>（${esc(activeTable || '—')}）。可切换左侧其它表继续挑选字段，跨表字段会带表前缀（演示级关联）。</div>
            <div class="field-pool" id="fieldPool">
              ${poolFields.map(f => {
                const key = `${activeTable}.${f.name}`;
                const used = selectedKeys.has(key);
                return `<span class="drag-field ${f.group}" draggable="true" data-key="${esc(key)}" data-name="${esc(f.name)}" data-label="${esc(f.label)}" data-group="${f.group}" data-table="${esc(activeTable)}" style="${used?'opacity:.4':''}" title="${used?'已添加 · 仍可拖':'拖到右侧已选区'}">
                  <i class="ftype">${f.group==='dim'?'Abc':'#'}</i>${esc(f.label)}
                </span>`;
              }).join('') || '<div class="ph" style="padding:24px;color:var(--text-3);font-size:12px">请选择左侧表</div>'}
            </div>
            <div style="margin-top:10px">
              <button type="button" class="btn" id="addAll" ${!poolFields.length?'disabled':''}>全部加入</button>
              <button type="button" class="btn ghost" id="clearSel">清空已选</button>
            </div>
          </div>
        </div>
        <div class="dss-col">
          <div class="chd">已选字段 <span class="hint">${selected.length} 个</span></div>
          <div class="cbd">
            <div class="drop-zone" id="dropZone">
              ${selected.length ? selected.map((s, idx) => `
                <div class="sel-field ${s.group}" draggable="true" data-idx="${idx}">
                  <span class="mini-tag">${esc(s.table)}</span>
                  <span style="font-weight:600">${esc(s.label)}</span>
                  <span style="color:var(--text-3);font-size:10px">${esc(s.name)}</span>
                  <div class="role-seg" style="min-width:88px;margin-left:4px">
                    <button type="button" class="${s.group==='dim'?'on dim':''}" data-setrole="dim" data-idx="${idx}">维</button>
                    <button type="button" class="${s.group==='quota'?'on quota':''}" data-setrole="quota" data-idx="${idx}">指</button>
                  </div>
                  <button type="button" class="rm" data-rm="${idx}" title="移除">×</button>
                </div>`).join('') : `<div class="ph">将左侧表或中间字段<br/>拖拽到此处<br/><span style="font-size:11px">也可双击字段快速添加</span></div>`}
            </div>
          </div>
        </div>
        <div class="dss-preview">
          <div class="chd" style="border-bottom:1px solid #eff0f1">数据预览 <span class="hint">按已选字段生成 ResultTable（最多 8 行）</span></div>
          <div class="cbd" style="padding:0;overflow:auto">
            ${previewCols.length ? `
              <table class="schema-table">
                <thead><tr>${previewCols.map(c => `<th>${esc(c.label)}<div style="font-weight:400;font-size:10px;color:#c0c4cc">${esc(c.table || '')}.${esc(c.name)}</div></th>`).join('')}</tr></thead>
                <tbody>
                  ${(previewRows.length ? previewRows : [{}]).slice(0, 8).map(r => `
                    <tr>${previewCols.map(c => `<td>${esc(String(r[c.name] ?? ''))}</td>`).join('')}</tr>`).join('')}
                </tbody>
              </table>` : '<div class="empty-illus">选择字段后显示预览</div>'}
          </div>
        </div>
      </div>
    `, { studio: true });

    const nameEl = document.getElementById('dsName');
    nameEl.oninput = () => { dsName = nameEl.value; };

    document.getElementById('c').onclick = hideModal;
    document.getElementById('srcPick').onchange = e => {
      srcId = e.target.value;
      tables = tablesOfSrc(srcId);
      activeTable = tables[0]?.name || '';
      selected = selected.filter(s => tables.some(t => t.name === s.table));
      paint();
    };

    document.querySelectorAll('[data-tbl]').forEach(el => {
      el.onclick = () => { activeTable = el.dataset.tbl; paint(); };
      el.ondragstart = ev => {
        ev.dataTransfer.setData('text/table', el.dataset.tbl);
        ev.dataTransfer.effectAllowed = 'copy';
      };
    });

    const addField = (f) => {
      if (selected.some(s => s.key === f.key)) { toast('字段已在已选区', 'warn'); return; }
      selected.push(f);
      paint();
    };

    document.querySelectorAll('#fieldPool .drag-field').forEach(el => {
      el.ondragstart = ev => {
        ev.dataTransfer.setData('text/field', JSON.stringify({
          key: el.dataset.key, name: el.dataset.name, label: el.dataset.label,
          group: el.dataset.group, table: el.dataset.table
        }));
        ev.dataTransfer.effectAllowed = 'copy';
      };
      el.ondblclick = () => addField({
        key: el.dataset.key, name: el.dataset.name, label: el.dataset.label,
        group: el.dataset.group, table: el.dataset.table
      });
    });

    const zone = document.getElementById('dropZone');
    zone.ondragover = ev => { ev.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = ev => {
      ev.preventDefault();
      zone.classList.remove('over');
      const tbl = ev.dataTransfer.getData('text/table');
      if (tbl) {
        const t = findSchemaTable(srcId, tbl);
        if (!t) return;
        activeTable = tbl;
        t.fields.forEach(f => {
          const key = `${t.name}.${f.name}`;
          if (!selected.some(s => s.key === key)) {
            selected.push({ key, name: f.name, label: f.label, group: f.group, table: t.name });
          }
        });
        toast(`已加入表 ${t.label} 的 ${t.fields.length} 个字段`, 'ok');
        paint();
        return;
      }
      const raw = ev.dataTransfer.getData('text/field');
      if (!raw) return;
      try { addField(JSON.parse(raw)); } catch (_) {}
    };

    document.getElementById('addAll').onclick = () => {
      poolFields.forEach(f => {
        const key = `${activeTable}.${f.name}`;
        if (!selected.some(s => s.key === key)) {
          selected.push({ key, name: f.name, label: f.label, group: f.group, table: activeTable });
        }
      });
      paint();
    };
    document.getElementById('clearSel').onclick = () => { selected = []; paint(); };

    zone.querySelectorAll('[data-rm]').forEach(btn => {
      btn.onclick = e => { e.stopPropagation(); selected.splice(+btn.dataset.rm, 1); paint(); };
    });
    zone.querySelectorAll('[data-setrole]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const i = +btn.dataset.idx;
        if (selected[i]) selected[i].group = btn.dataset.setrole;
        paint();
      };
    });

    document.getElementById('save').onclick = () => {
      dsName = (document.getElementById('dsName').value || '').trim() || '未命名数据集';
      if (!selected.length) { toast('请至少选择一个字段', 'warn'); return; }
      const fields = selected.map(s => ({ name: s.name, label: s.label, group: s.group }));
      // 同名字段去重（跨表时保留首次）
      const seen = new Set();
      const uniqFields = [];
      selected.forEach(s => {
        let name = s.name;
        if (seen.has(name)) name = s.table + '_' + s.name;
        if (seen.has(name)) return;
        seen.add(name);
        uniqFields.push({ name, label: s.label, group: s.group, _src: s });
      });
      const rows = buildStudioPreviewRows(srcId, uniqFields.map(f => ({
        key: f._src.key, name: f.name, label: f.label, group: f.group, table: f._src.table
      })), 20);
      const cleanFields = uniqFields.map(({ name, label, group }) => ({ name, label, group }));

      if (isEdit) {
        editing.name = dsName;
        editing.datasourceId = srcId;
        editing.sourceTable = activeTable;
        editing.fields = cleanFields;
        editing.rows = rows.length ? rows : editing.rows;
        editing.desc = `来自 ${activeTable} 等 ${new Set(selected.map(s => s.table)).size} 张表`;
        state.datasetId = editing.id;
        hideModal();
        toast('数据集已更新', 'ok');
        render();
        return;
      }
      const id = uid('ds');
      DATASETS[id] = {
        id, name: dsName, datasourceId: srcId, sourceTable: activeTable,
        folder: '未分组',
        desc: `来自 ${[...new Set(selected.map(s => s.table))].join(', ')}`,
        fields: cleanFields,
        rows: rows.length ? rows : [{ [cleanFields[0].name]: '—' }]
      };
      const s = DATASOURCES.find(x => x.id === srcId);
      if (s) s.usedBy = [...new Set([...(s.usedBy || []), id])];
      state.datasetId = id;
      state.dsTab = 'fields';
      hideModal();
      toast('数据集已创建', 'ok');
      render();
    };
  };

  paint();
}

function buildStudioPreviewRows(srcId, fields, limit = 8) {
  if (!fields.length) return [];
  const byTable = new Map();
  fields.forEach(f => {
    if (!byTable.has(f.table)) byTable.set(f.table, []);
    byTable.get(f.table).push(f);
  });
  // 主表取行最多的表
  let primary = null, max = -1;
  for (const [tname] of byTable) {
    const t = findSchemaTable(srcId, tname);
    const n = t?.rows?.length || 0;
    if (n > max) { max = n; primary = t; }
  }
  if (!primary?.rows?.length) {
    return Array.from({ length: Math.min(3, limit) }, (_, i) => {
      const row = {};
      fields.forEach(f => { row[f.name] = f.group === 'quota' ? (i + 1) * 10 : `${f.label}${i + 1}`; });
      return row;
    });
  }
  return primary.rows.slice(0, limit).map(srcRow => {
    const row = {};
    fields.forEach(f => {
      const t = findSchemaTable(srcId, f.table);
      if (f.table === primary.name) {
        row[f.name] = srcRow[f.name] ?? srcRow[f.name?.replace(/^.*_/, '')];
        // original field name before dedupe
        const orig = f.key?.split('.').pop();
        if (row[f.name] == null && orig) row[f.name] = srcRow[orig];
      } else {
        const sample = t?.rows?.[0] || {};
        const orig = f.key?.split('.').pop() || f.name;
        row[f.name] = sample[orig] ?? sample[f.name] ?? '';
      }
    });
    return row;
  });
}

function createBlankDash() {
  const d = packDash(emptyDash(), { folder: '未分组', desc: '空白画布', updateBy: '当前用户', updateTime: '刚刚' });
  state.dashboards.unshift(d);
  selectDash(d.id);
  state.module = 'dashboard';
  state.screen = 'editor';
  toast('已创建空白仪表盘', 'ok');
  render();
}

function createBlankReport() {
  const r = {
    id: uid('rpt'),
    name: '未命名报告',
    status: 'draft',
    folder: '未分组',
    desc: '空白报告',
    updateBy: '当前用户',
    updateTime: '刚刚',
    contentId: '1',
    blocks: [
      { type: 'heading', level: 1, text: '未命名报告' },
      { type: 'paragraph', text: '点击此处直接输入正文。可用「开始」切换标题/正文并设置加粗对齐；业务图表在「工具」。' }
    ]
  };
  state.reports.unshift(r);
  selectReport(r.id);
  state.module = 'report';
  state.screen = 'editor';
  toast('已创建报告', 'ok');
  render();
}

function resolveReportChartSpec(block) {
  if (block.source === 'dashboard') {
    const dash = state.dashboards.find(d => d.id === block.dashboardId);
    let ch = dash?.charts?.[block.chartId];
    if (!ch && block.chartTitle) ch = findDashChartByTitle(block.dashboardId, block.chartTitle);
    if (!ch) return null;
    return {
      datasetId: ch.datasetId || defaultDatasetId(),
      chartType: ch.chartType || 'bar',
      encode: ch.encode || { category: 'region', value: 'amount', agg: 'SUM' },
      title: block.title || ch.title
    };
  }
  return {
    datasetId: block.datasetId || defaultDatasetId(),
    chartType: block.chartType || 'bar',
    encode: block.encode || { category: 'region', value: 'amount', agg: 'SUM' },
    title: block.title || '图表'
  };
}

function aggregateReportSeries(datasetId, encode) {
  const ds = dsOrFirst(datasetId);
  const cat = encode.category || encode.x || 'region';
  const val = encode.value || encode.y || 'amount';
  const map = new Map();
  (ds.rows || []).forEach(r => {
    const k = String(r[cat] ?? '—');
    map.set(k, (map.get(k) || 0) + (+r[val] || 0));
  });
  const categories = [...map.keys()];
  const data = categories.map(k => map.get(k));
  return { categories, data, name: val };
}

function paintReportChartBlock(dom, block) {
  if (!dom || !echarts) return;
  const spec = resolveReportChartSpec(block);
  if (!spec) {
    dom.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#b42318;font-size:12px">无法解析引用图表（看板或 chartId 缺失）</div>';
    return;
  }
  const series = aggregateReportSeries(spec.datasetId, spec.encode);
  const key = 'rpt_' + block.id;
  let inst = state.chartInst[key];
  if (inst && inst.getDom() !== dom) {
    disposeOneChart(key);
    inst = null;
  }
  if (!inst) {
    inst = echarts.getInstanceByDom(dom) || echarts.init(dom);
    state.chartInst[key] = inst;
  }
  const type = spec.chartType === 'line' || spec.chartType === 'area' ? 'line'
    : spec.chartType === 'pie' ? 'pie'
    : spec.chartType === 'hbar' ? 'bar' : 'bar';
  if (type === 'pie') {
    inst.setOption({
      color: ['#3480f9', '#5b8ff9', '#61ddaa', '#f6bd16', '#7262fd'],
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['35%', '65%'],
        data: series.categories.map((n, i) => ({ name: n, value: series.data[i] }))
      }]
    }, true);
  } else if (spec.chartType === 'hbar') {
    inst.setOption({
      color: ['#3480f9'],
      tooltip: { trigger: 'axis' },
      grid: { left: 72, right: 16, top: 28, bottom: 24 },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: series.categories },
      series: [{ type: 'bar', name: series.name, data: series.data }]
    }, true);
  } else {
    inst.setOption({
      color: ['#3480f9'],
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 16, top: 28, bottom: 32 },
      xAxis: { type: 'category', data: series.categories },
      yAxis: { type: 'value' },
      series: [{
        type,
        name: series.name,
        data: series.data,
        areaStyle: spec.chartType === 'area' ? { opacity: 0.18 } : undefined,
        smooth: spec.chartType === 'line' || spec.chartType === 'area'
      }]
    }, true);
  }
}

function reportDashChartOptions() {
  return state.dashboards.map(d => {
    const charts = Object.values(d.charts || {}).filter(c => c && c.chartType && !['slicer', 'text'].includes(c.chartType));
    return { dash: d, charts };
  }).filter(x => x.charts.length);
}

function datasetFieldOptionsHtml(datasetId, selected, group) {
  const ds = dsOrFirst(datasetId);
  const fields = (ds.fields || []).filter(f => !group || f.group === group);
  const list = fields.length ? fields : (ds.fields || []);
  return list.map(f =>
    `<option value="${esc(f.name)}" ${f.name === selected ? 'selected' : ''}>${esc(f.name)}${f.group ? ' · ' + f.group : ''}</option>`
  ).join('');
}

function markReportDirty(r) {
  r.status = r.status === 'published' ? 'publishedWithDraft' : (r.status || 'draft');
  r.updateTime = '刚刚';
  state.rptDirty = true;
}

/** @param {'dashboard'|'inline'} preferSource 新建时默认来源；编辑时以 block 为准 */
function openReportChartConfigModal({ blockId = null, preferSource = 'inline' } = {}) {
  const r = currentReport();
  const editing = !!(blockId && r.blocks.some(b => b.id === blockId && b.type === 'reportChart'));
  const block = editing ? r.blocks.find(b => b.id === blockId) : null;
  const source0 = block?.source || preferSource;
  const dashOpts = reportDashChartOptions();
  const firstDash = dashOpts[0];
  const dsList = Object.values(DATASETS);
  const enc = block?.encode || {};
  const initDs = block?.datasetId || defaultDatasetId();
  const initCat = enc.category || 'region';
  const initVal = enc.value || 'amount';
  const initType = block?.chartType || 'bar';
  const initTitle = block?.title || '';
  const initH = block?.height || 280;
  const initDash = block?.dashboardId || firstDash?.dash.id || '';
  const initChart = block?.chartId || '';

  const showSourceSwitch = editing; // 新建走专用弹框；编辑可切换来源
  showModal(`
    <div style="padding:16px 18px;min-width:460px;max-width:520px">
      <h3 style="margin:0 0 12px;font-size:15px">${editing ? '配置图表' : '新建图表（仅报告）'}</h3>
      ${showSourceSwitch ? `<label style="display:grid;gap:6px;font-size:12px;margin-bottom:10px">来源
        <select id="rptSrc" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px">
          <option value="dashboard" ${source0 === 'dashboard' ? 'selected' : ''}>引用看板图</option>
          <option value="inline" ${source0 === 'inline' ? 'selected' : ''}>报告内新建（可选数据集）</option>
        </select>
      </label>` : '<input type="hidden" id="rptSrc" value="inline" />'}
      <div id="rptPaneDash" style="display:none">
        <label style="display:grid;gap:6px;font-size:12px;margin-bottom:8px">仪表盘
          <select id="rptDashSel" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px">
            ${dashOpts.map(o => `<option value="${o.dash.id}" ${o.dash.id === initDash ? 'selected' : ''}>${esc(o.dash.name)}</option>`).join('')}
          </select>
        </label>
        <label style="display:grid;gap:6px;font-size:12px;margin-bottom:8px">图表
          <select id="rptChartSel" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px"></select>
        </label>
      </div>
      <div id="rptPaneInline" style="display:none">
        <label style="display:grid;gap:6px;font-size:12px;margin-bottom:8px">数据集
          <select id="rptDs" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px">
            ${dsList.map(d => `<option value="${d.id}" ${d.id === initDs ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </label>
        <label style="display:grid;gap:6px;font-size:12px;margin-bottom:8px">图表类型
          <select id="rptType" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px">
            ${['bar', 'line', 'area', 'pie'].map(t => `<option value="${t}" ${t === initType ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <label style="display:grid;gap:6px;font-size:12px">维度字段
            <select id="rptCat" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px"></select>
          </label>
          <label style="display:grid;gap:6px;font-size:12px">指标字段
            <select id="rptVal" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px"></select>
          </label>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 100px;gap:8px;margin-bottom:8px">
        <label style="display:grid;gap:6px;font-size:12px">显示标题
          <input id="rptTitle" value="${esc(initTitle)}" placeholder="可选" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px" />
        </label>
        <label style="display:grid;gap:6px;font-size:12px">高度
          <input id="rptH" type="number" min="160" max="560" value="${initH}" style="height:32px;border:1px solid var(--line);border-radius:6px;padding:0 8px" />
        </label>
      </div>
      <p style="font-size:11px;color:var(--text-3);margin:0 0 12px" id="rptCfgHint"></p>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" id="rptCfgCancel">取消</button>
        <button class="btn primary" id="rptCfgOk">${editing ? '保存配置' : '插入'}</button>
      </div>
    </div>`);

  const srcSel = document.getElementById('rptSrc');
  const paneDash = document.getElementById('rptPaneDash');
  const paneInline = document.getElementById('rptPaneInline');
  const dashSel = document.getElementById('rptDashSel');
  const chartSel = document.getElementById('rptChartSel');
  const dsSel = document.getElementById('rptDs');
  const catSel = document.getElementById('rptCat');
  const valSel = document.getElementById('rptVal');
  const hint = document.getElementById('rptCfgHint');

  const fillCharts = () => {
    const pack = dashOpts.find(o => o.dash.id === dashSel.value) || firstDash;
    chartSel.innerHTML = (pack?.charts || []).map(c =>
      `<option value="${c.id}" data-title="${esc(c.title)}" ${c.id === initChart ? 'selected' : ''}>${esc(c.title)} (${esc(c.chartType)})</option>`
    ).join('');
  };
  const fillFields = () => {
    const dsId = dsSel.value;
    const catPref = catSel.value || initCat;
    const valPref = valSel.value || initVal;
    const dims = datasetFieldOptionsHtml(dsId, catPref, 'dim');
    const quotas = datasetFieldOptionsHtml(dsId, valPref, 'quota');
    catSel.innerHTML = dims || datasetFieldOptionsHtml(dsId, catPref);
    valSel.innerHTML = quotas || datasetFieldOptionsHtml(dsId, valPref);
  };
  const syncPanes = () => {
    const src = srcSel.value;
    paneDash.style.display = src === 'dashboard' ? 'block' : 'none';
    paneInline.style.display = src === 'inline' ? 'block' : 'none';
    hint.textContent = src === 'dashboard'
      ? '引用模式：改选看板/图表后实时取数；文档只存 dashboardId + chartId。'
      : '报告内模式：可重选数据集与字段；配置只存在于报告，不写回仪表盘。';
    if (src === 'inline') fillFields();
  };

  fillCharts();
  fillFields();
  syncPanes();
  dashSel.onchange = fillCharts;
  dsSel.onchange = fillFields;
  srcSel.onchange = syncPanes;

  document.getElementById('rptCfgCancel').onclick = () => hideModal();
  document.getElementById('rptCfgOk').onclick = () => {
    const source = srcSel.value;
    const title = document.getElementById('rptTitle').value.trim();
    const height = Math.max(160, Math.min(560, Number(document.getElementById('rptH').value) || 280));
    let next;
    if (source === 'dashboard') {
      const dashboardId = dashSel.value;
      const chartId = chartSel.value;
      const opt = chartSel.selectedOptions[0];
      const chartTitle = opt?.dataset?.title || opt?.textContent || '图表';
      next = {
        type: 'reportChart',
        id: block?.id || uid('rc'),
        source: 'dashboard',
        dashboardId,
        chartId,
        chartTitle,
        title: title || (chartTitle + (editing ? '' : '（引用）')),
        height
      };
    } else {
      const datasetId = dsSel.value;
      const chartType = document.getElementById('rptType').value;
      const category = catSel.value || 'region';
      const value = valSel.value || 'amount';
      next = {
        type: 'reportChart',
        id: block?.id || uid('rc'),
        source: 'inline',
        datasetId,
        chartType,
        encode: { category, value, agg: 'SUM' },
        title: title || `${chartType} · ${datasetId}`,
        height
      };
    }
    if (editing) {
      const idx = r.blocks.findIndex(b => b.id === blockId);
      if (idx >= 0) r.blocks[idx] = next;
      state.reportSelectedBlockId = next.id;
      markReportDirty(r);
      hideModal();
      toast('图表配置已更新', 'ok');
      render();
      return;
    }
    r.blocks = r.blocks.filter(b => b.type !== 'empty');
    r.blocks.push(next);
    state.reportSelectedBlockId = next.id;
    markReportDirty(r);
    hideModal();
    toast(source === 'dashboard' ? '已插入引用图表' : '已插入报告内图表', 'ok');
    render();
  };
}

function openInsertDashboardChartModal() {
  const r = currentReport();
  const dashOpts = reportDashChartOptions();
  if (!dashOpts.length) {
    toast('暂无可引用的仪表盘图表', 'warn');
    return;
  }
  let dashId = dashOpts[0].dash.id;
  let focusId = dashOpts[0].charts[0]?.id || null;
  let q = '';
  const selected = new Set();

  const typeLabel = (t) => (CHART_META[t]?.label || t || '图表');

  showModal(`
    <div class="rpt-wizard">
      <div class="rpt-wizard-hd">
        <div>
          <h3>引用仪表盘 · 选择图表</h3>
          <p>非整盘导入。左侧选看板 → 中间勾选图表（可多选）→ 右侧预览当前聚焦图表 → 确认插入。文档只存 dashboardId + chartId。</p>
        </div>
        <button type="button" class="btn" id="rptCiteClose" style="height:30px">关闭</button>
      </div>
      <div class="rpt-cite-body">
        <aside class="rpt-cite-dash">
          <div class="col-hd">仪表盘 <span id="rptCiteDashN">${dashOpts.length}</span></div>
          <div class="rpt-cite-dash-list" id="rptCiteDash"></div>
        </aside>
        <section class="rpt-cite-charts">
          <div class="col-hd">
            图表
            <span id="rptCiteChartN">0</span>
            <div class="acts">
              <button type="button" id="rptCiteAll">全选</button>
              <button type="button" id="rptCiteNone">清空</button>
            </div>
          </div>
          <input class="rpt-cite-search" id="rptCiteSearch" placeholder="搜索图表名称 / 类型…" />
          <div class="rpt-cite-list" id="rptCiteCharts"></div>
        </section>
        <aside class="rpt-cite-preview">
          <div class="col-hd">效果预览 <span>实时取数</span></div>
          <div class="pv-wrap">
            <div class="pv-card" id="rptCitePvCard">
              <div class="pv-empty" id="rptCitePvEmpty">在中间列表点选一张图表<br/>右侧将显示实时预览</div>
              <div class="pv-title" id="rptCitePvTitle" style="display:none"></div>
              <div class="pv-sub" id="rptCitePvSub" style="display:none"></div>
              <div class="pv-chart" id="rptCitePvChart" style="display:none"></div>
            </div>
            <div class="pv-selected" id="rptCiteSelected">已选 <b>0</b> 张 · 将按勾选顺序插入报告</div>
          </div>
        </aside>
      </div>
      <div class="rpt-wizard-ft">
        <div class="hint">引用后报告内可换看板/图表；编码以仪表盘原图为准，取数实时。</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="rptCiteCount" style="font-size:12px;color:rgba(0,0,0,.5)">已选 0</span>
          <button type="button" class="btn" id="rptCiteCancel">取消</button>
          <button type="button" class="btn primary" id="rptCiteOk">插入所选图表</button>
        </div>
      </div>
    </div>`, { wizard: true });

  const dashBox = document.getElementById('rptCiteDash');
  const chartBox = document.getElementById('rptCiteCharts');
  const countEl = document.getElementById('rptCiteCount');
  const selectedEl = document.getElementById('rptCiteSelected');

  const currentPack = () => dashOpts.find(o => o.dash.id === dashId) || dashOpts[0];
  const findChart = (cid) => (currentPack()?.charts || []).find(c => c.id === cid);

  const syncCount = () => {
    const n = selected.size;
    countEl.textContent = `已选 ${n}`;
    const names = (currentPack()?.charts || []).filter(c => selected.has(c.id)).map(c => c.title);
    selectedEl.innerHTML = n
      ? `已选 <b>${n}</b> 张：${esc(names.slice(0, 4).join('、'))}${names.length > 4 ? '…' : ''} · 将按勾选顺序插入`
      : `已选 <b>0</b> 张 · 勾选后可在右侧预览并确认插入`;
  };

  const refreshPreview = () => {
    const empty = document.getElementById('rptCitePvEmpty');
    const title = document.getElementById('rptCitePvTitle');
    const sub = document.getElementById('rptCitePvSub');
    const chartEl = document.getElementById('rptCitePvChart');
    const c = focusId ? findChart(focusId) : null;
    if (!c) {
      disposeOneChart('rpt_ref_preview');
      empty.style.display = 'grid';
      title.style.display = sub.style.display = chartEl.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    title.style.display = sub.style.display = chartEl.style.display = '';
    title.textContent = c.title || '图表';
    const dsName = DATASETS[c.datasetId]?.name || c.datasetId || '—';
    const dashName = currentPack()?.dash?.name || '';
    sub.textContent = `${dashName} · ${typeLabel(c.chartType)} · ${dsName} · 引用模式（实时）`;
    chartEl.innerHTML = '';
    const block = {
      id: 'ref_preview',
      source: 'dashboard',
      dashboardId: dashId,
      chartId: c.id,
      chartTitle: c.title,
      title: c.title,
      height: 280
    };
    // kpi / table 走 paint 通用路径；无 echarts 时兜底
    const kind = c.chartType;
    if (kind === 'kpi') {
      disposeOneChart('rpt_ref_preview');
      const spec = resolveReportChartSpec(block);
      if (!spec) {
        chartEl.innerHTML = '<div class="pv-empty">无法预览该图表</div>';
        return;
      }
      const series = aggregateReportSeries(spec.datasetId, spec.encode);
      const sum = series.data.reduce((a, b) => a + b, 0);
      chartEl.innerHTML = `<div style="height:100%;display:grid;place-items:center;text-align:center;min-height:220px">
        <div>
          <div style="font-size:12px;color:#86909c;margin-bottom:8px">${esc(spec.encode?.value || '指标')}</div>
          <div style="font-size:36px;font-weight:700;color:#3480f9">${Number(sum).toLocaleString()}</div>
        </div>
      </div>`;
      return;
    }
    if (kind === 'table' || kind === 'pivot' || kind === 'grouptable') {
      disposeOneChart('rpt_ref_preview');
      const spec = resolveReportChartSpec(block);
      if (!spec) {
        chartEl.innerHTML = '<div class="pv-empty">无法预览该图表</div>';
        return;
      }
      const series = aggregateReportSeries(spec.datasetId, spec.encode);
      const rows = series.categories.slice(0, 8).map((name, i) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(name)}</td>
         <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${series.data[i]}</td></tr>`
      ).join('');
      chartEl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;min-height:200px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd">${esc(spec.encode?.category || '维度')}</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd">${esc(spec.encode?.value || '指标')}</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="2" style="padding:20px;color:#86909c">暂无数据</td></tr>'}</tbody></table>`;
      return;
    }
    paintReportChartBlock(chartEl, block);
    requestAnimationFrame(() => {
      try { state.chartInst.rpt_ref_preview?.resize?.(); } catch (_) {}
    });
  };

  const renderDashList = () => {
    dashBox.innerHTML = dashOpts.map(o =>
      `<button type="button" class="${o.dash.id === dashId ? 'on' : ''}" data-dash="${o.dash.id}">
        ${esc(o.dash.name)}
        <div class="sub">${o.charts.length} 个可引用图表</div>
      </button>`
    ).join('');
    dashBox.querySelectorAll('[data-dash]').forEach(btn => {
      btn.onclick = () => {
        dashId = btn.dataset.dash;
        selected.clear();
        const pack = currentPack();
        focusId = pack?.charts?.[0]?.id || null;
        q = '';
        const search = document.getElementById('rptCiteSearch');
        if (search) search.value = '';
        renderDashList();
        renderChartList();
        syncCount();
        refreshPreview();
      };
    });
  };

  const renderChartList = () => {
    const pack = currentPack();
    const all = pack?.charts || [];
    const qq = q.trim().toLowerCase();
    const list = qq
      ? all.filter(c => (c.title || '').toLowerCase().includes(qq) || (c.chartType || '').toLowerCase().includes(qq))
      : all;
    document.getElementById('rptCiteChartN').textContent = String(list.length);
    if (!list.length) {
      chartBox.innerHTML = `<div style="padding:28px 12px;text-align:center;color:rgba(0,0,0,.4);font-size:12px">${qq ? '无匹配图表' : '该仪表盘暂无图表'}</div>`;
      return;
    }
    if (focusId && !list.some(c => c.id === focusId)) focusId = list[0].id;
    chartBox.innerHTML = list.map(c => {
      const on = selected.has(c.id);
      const focus = c.id === focusId;
      const dsName = DATASETS[c.datasetId]?.name || c.datasetId || '—';
      return `<div class="rpt-cite-item ${on ? 'on' : ''} ${focus ? 'focus' : ''}" data-cid="${c.id}">
        <input type="checkbox" data-cid="${c.id}" ${on ? 'checked' : ''} />
        <span>
          <div class="t">${esc(c.title)}</div>
          <div class="m">${esc(dsName)}</div>
        </span>
        <span class="badge">${esc(typeLabel(c.chartType))}</span>
      </div>`;
    }).join('');

    chartBox.querySelectorAll('.rpt-cite-item').forEach(row => {
      row.onclick = e => {
        const cid = row.dataset.cid;
        focusId = cid;
        if (e.target.tagName === 'INPUT') {
          const inp = e.target;
          if (inp.checked) selected.add(cid);
          else selected.delete(cid);
        }
        renderChartList();
        syncCount();
        refreshPreview();
      };
      row.ondblclick = () => {
        const cid = row.dataset.cid;
        if (selected.has(cid)) selected.delete(cid);
        else selected.add(cid);
        focusId = cid;
        renderChartList();
        syncCount();
        refreshPreview();
      };
    });
  };

  document.getElementById('rptCiteSearch').oninput = e => {
    q = e.target.value || '';
    renderChartList();
  };
  document.getElementById('rptCiteAll').onclick = () => {
    (currentPack()?.charts || []).forEach(c => selected.add(c.id));
    renderChartList();
    syncCount();
  };
  document.getElementById('rptCiteNone').onclick = () => {
    selected.clear();
    renderChartList();
    syncCount();
  };
  const close = () => hideModal();
  document.getElementById('rptCiteClose').onclick = close;
  document.getElementById('rptCiteCancel').onclick = close;
  document.getElementById('rptCiteOk').onclick = () => {
    if (!selected.size) {
      toast('请至少选择一个图表', 'warn');
      return;
    }
    const pack = currentPack();
    const charts = (pack?.charts || []).filter(c => selected.has(c.id));
    syncReportDocToModel(r);
    r.blocks = (r.blocks || []).filter(b => b.type !== 'empty');
    charts.forEach(c => {
      r.blocks.push({
        type: 'reportChart',
        id: uid('rc'),
        source: 'dashboard',
        dashboardId: dashId,
        chartId: c.id,
        chartTitle: c.title,
        title: c.title + '（引用）',
        height: 280
      });
    });
    state.reportSelectedBlockId = charts.length ? r.blocks[r.blocks.length - 1].id : state.reportSelectedBlockId;
    state.rptInspCollapsed = false;
    markReportDirty(r);
    hideModal();
    toast(`已插入 ${charts.length} 个引用图表`, 'ok');
    render();
  };

  renderDashList();
  renderChartList();
  syncCount();
  refreshPreview();
}

function openCreateInlineChartModal() {
  const r = currentReport();
  const dsList = Object.values(DATASETS);
  const typeOpts = Object.entries(CHART_META).filter(([k]) =>
    ['bar', 'hbar', 'line', 'area', 'pie', 'kpi', 'table', 'pivot'].includes(k)
  );
  const draft = {
    id: 'preview',
    source: 'inline',
    datasetId: defaultDatasetId(),
    chartType: 'bar',
    encode: { ...defaultEncode('bar') },
    title: '',
    height: 320,
    style: {},
    senior: {},
    fieldRoles: {}
  };

  showModal(`
    <div class="rpt-wizard">
      <div class="rpt-wizard-hd">
        <div>
          <h3>新建图表（仅报告）</h3>
          <p>配置只存在于本报告，不会写回仪表盘。左侧实时预览，确认后再插入。</p>
        </div>
        <button type="button" class="btn" id="rptWzClose" style="height:30px">关闭</button>
      </div>
      <div class="rpt-wizard-body">
        <div class="rpt-wizard-preview">
          <div class="pv-hd">
            <span>效果预览</span>
            <span id="rptWzPvBadge">实时聚合</span>
          </div>
          <div class="pv-card">
            <div class="pv-title" id="rptWzPvTitle">未命名图表</div>
            <div class="pv-chart" id="rptWzPvChart"></div>
            <div class="pv-meta" id="rptWzPvMeta"></div>
          </div>
        </div>
        <div class="rpt-wizard-form">
          <div>
            <div class="sec-t">基础</div>
            <div class="row2">
              <label class="f">标题
                <input id="rptWzTitle" placeholder="留空则按类型与字段自动生成" />
              </label>
              <label class="f">图表类型
                <select id="rptWzType">
                  ${typeOpts.map(([k, v]) => `<option value="${k}" ${k === 'bar' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
                </select>
              </label>
            </div>
          </div>
          <div>
            <div class="sec-t">1. 数据集</div>
            <label class="f">选择数据集
              <select id="rptWzDs">
                ${dsList.map(d => `<option value="${d.id}" ${d.id === defaultDatasetId() ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
              </select>
            </label>
            <div id="rptWzDsHint" style="margin-top:6px;font-size:11px;color:rgba(0,0,0,.45)"></div>
          </div>
          <div>
            <div class="sec-t">2. 字段银行（点击填入槽位）</div>
            <div class="chips" id="rptWzBank"></div>
          </div>
          <div>
            <div class="sec-t">3. 编码槽</div>
            <div class="row2" id="rptWzSlots">
              <label class="f" id="rptWzCatLab"><span class="lab">维度</span>
                <select id="rptWzCat"></select>
              </label>
              <label class="f" id="rptWzValLab"><span class="lab">指标</span>
                <select id="rptWzVal"></select>
              </label>
            </div>
            <div class="row2" style="margin-top:8px">
              <label class="f" id="rptWzColLab"><span class="lab">列维度（透视）</span>
                <select id="rptWzCol"></select>
              </label>
              <label class="f">聚合
                <select id="rptWzAgg">
                  ${['SUM', 'COUNT', 'AVG', 'MAX', 'MIN'].map(a => `<option value="${a}" ${a === 'SUM' ? 'selected' : ''}>${a}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="row2" style="margin-top:8px">
              <label class="f">数值格式
                <select id="rptWzFmt">
                  <option value="raw">智能（默认）</option>
                  <option value="integer">整数</option>
                  <option value="thousand" selected>千分位</option>
                  <option value="fixed1">一位小数</option>
                  <option value="fixed2">两位小数</option>
                  <option value="percent">百分比</option>
                </select>
              </label>
              <label class="f">高度 (px)
                <input id="rptWzH" type="number" min="180" max="560" value="320" />
              </label>
            </div>
            <div id="rptWzGuide" style="margin-top:8px;font-size:11px;color:rgba(0,0,0,.45);line-height:1.5"></div>
          </div>
        </div>
      </div>
      <div class="rpt-wizard-ft">
        <div class="hint">source = inline · 插入后仍可在右侧「数据 / 样式 / 高级」继续改</div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn" id="rptWzCancel">取消</button>
          <button type="button" class="btn primary" id="rptWzOk">确认插入</button>
        </div>
      </div>
    </div>`, { wizard: true });

  const $ = id => document.getElementById(id);
  const typeSel = $('rptWzType');
  const dsSel = $('rptWzDs');
  const catSel = $('rptWzCat');
  const valSel = $('rptWzVal');
  const colSel = $('rptWzCol');
  const aggSel = $('rptWzAgg');
  const fmtSel = $('rptWzFmt');
  const titleInp = $('rptWzTitle');
  const hInp = $('rptWzH');
  const bank = $('rptWzBank');
  let pickTarget = 'category'; // category | value | colDim

  const readDraft = () => {
    draft.datasetId = dsSel.value;
    draft.chartType = typeSel.value;
    draft.encode = {
      ...defaultEncode(draft.chartType),
      category: catSel.value || draft.encode.category,
      value: valSel.value || draft.encode.value,
      colDim: colSel.value || draft.encode.colDim,
      agg: aggSel.value || 'SUM',
      format: fmtSel.value || 'thousand'
    };
    draft.title = titleInp.value.trim();
    draft.height = Math.max(180, Math.min(560, Number(hInp.value) || 320));
    return draft;
  };

  const autoTitle = () => {
    if (titleInp.value.trim()) return titleInp.value.trim();
    const meta = CHART_META[draft.chartType];
    const dsName = DATASETS[draft.datasetId]?.name || draft.datasetId;
    return `${meta?.label || draft.chartType} · ${dsName}`;
  };

  const fillFields = (prefer = {}) => {
    const dsId = dsSel.value;
    const dsObj = DATASETS[dsId] || dsOrFirst(dsId);
    const enc = prefer.encode || defaultEncode(typeSel.value);
    const dims = (dsObj.fields || []).filter(f => f.group === 'dim');
    const quotas = (dsObj.fields || []).filter(f => f.group === 'quota');
    const dimList = dims.length ? dims : (dsObj.fields || []);
    const quotaList = quotas.length ? quotas : (dsObj.fields || []);
    const pick = (list, name, fallback) => list.some(f => f.name === name) ? name : (fallback || list[0]?.name || '');
    const cat = pick(dimList, prefer.category || enc.category, dimList[0]?.name);
    const val = pick(quotaList, prefer.value || enc.value, quotaList[0]?.name);
    const col = pick(dimList, prefer.colDim || enc.colDim, dimList[1]?.name || dimList[0]?.name);
    catSel.innerHTML = dimList.map(f => `<option value="${esc(f.name)}" ${f.name === cat ? 'selected' : ''}>${esc(f.label || f.name)}</option>`).join('');
    valSel.innerHTML = quotaList.map(f => `<option value="${esc(f.name)}" ${f.name === val ? 'selected' : ''}>${esc(f.label || f.name)}</option>`).join('');
    colSel.innerHTML = dimList.map(f => `<option value="${esc(f.name)}" ${f.name === col ? 'selected' : ''}>${esc(f.label || f.name)}</option>`).join('');
    bank.innerHTML = [
      ...dimList.map(f => `<button type="button" class="chip dim" data-fn="${esc(f.name)}" data-fg="dim">${esc(f.label || f.name)}</button>`),
      ...quotaList.map(f => `<button type="button" class="chip quota" data-fn="${esc(f.name)}" data-fg="quota">${esc(f.label || f.name)}</button>`)
    ].join('') || '<span style="font-size:12px;color:#86909c">该数据集暂无字段</span>';
    bank.querySelectorAll('.chip').forEach(chip => {
      chip.onclick = () => {
        const name = chip.dataset.fn;
        const fg = chip.dataset.fg;
        if (fg === 'quota' || pickTarget === 'value') {
          valSel.value = name;
          pickTarget = 'value';
        } else if (pickTarget === 'colDim' || (typeSel.value === 'pivot' && fg === 'dim' && document.activeElement === colSel)) {
          colSel.value = name;
          pickTarget = 'colDim';
        } else {
          catSel.value = name;
          pickTarget = 'category';
        }
        bank.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.fn === name));
        refreshPreview();
      };
    });
    $('rptWzDsHint').textContent = `${dsObj.name} · ${(dsObj.fields || []).length} 字段 · ${(dsObj.rows || []).length} 行演示数据`;
  };

  const syncSlotVisibility = () => {
    const t = typeSel.value;
    const meta = CHART_META[t] || CHART_META.bar;
    const colLab = $('rptWzColLab');
    const catLab = $('rptWzCatLab');
    if (colLab) {
      colLab.style.opacity = t === 'pivot' ? '1' : '.4';
      colLab.style.pointerEvents = t === 'pivot' ? 'auto' : 'none';
    }
    if (catLab) catLab.style.display = t === 'kpi' ? 'none' : '';
    const catLabText = catLab?.querySelector('.lab');
    if (catLabText) {
      catLabText.textContent = t === 'pivot' ? '行维度' : (t === 'table' ? '维度（可选）' : '维度');
    }
    $('rptWzGuide').textContent = meta.guide || '';
  };

  const refreshPreview = () => {
    readDraft();
    const title = autoTitle();
    $('rptWzPvTitle').textContent = title;
    const dsObj = DATASETS[draft.datasetId];
    const meta = CHART_META[draft.chartType];
    $('rptWzPvMeta').textContent =
      `${meta?.label || draft.chartType} · ${dsObj?.name || draft.datasetId} · 维度 ${draft.encode.category || '—'} · 指标 ${draft.encode.value || '—'} · ${draft.encode.agg || 'SUM'}`;
    const pv = $('rptWzPvChart');
    if (!pv) return;
    // table / pivot：简易表格预览
    if (draft.chartType === 'table' || draft.chartType === 'pivot') {
      disposeOneChart('rpt_preview');
      const series = aggregateReportSeries(draft.datasetId, draft.encode);
      const rows = series.categories.slice(0, 8).map((c, i) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(c)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${series.data[i]}</td></tr>`
      ).join('');
      pv.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd">${esc(draft.encode.category || '维度')}</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd">${esc(draft.encode.value || '指标')}</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2" style="padding:16px;color:#86909c">暂无数据</td></tr>'}</tbody></table>`;
      return;
    }
    if (draft.chartType === 'kpi') {
      disposeOneChart('rpt_preview');
      const series = aggregateReportSeries(draft.datasetId, draft.encode);
      const sum = series.data.reduce((a, b) => a + b, 0);
      pv.innerHTML = `<div style="height:100%;display:grid;place-items:center;text-align:center">
        <div>
          <div style="font-size:12px;color:#86909c;margin-bottom:8px">${esc(draft.encode.value || '指标')}</div>
          <div style="font-size:40px;font-weight:700;color:#3480f9;letter-spacing:-.02em">${sum.toLocaleString()}</div>
          <div style="font-size:11px;color:#86909c;margin-top:8px">${draft.encode.agg || 'SUM'} · ${series.categories.length} 分组</div>
        </div>
      </div>`;
      return;
    }
    // 确保 echarts 容器干净
    if (!pv.getAttribute('data-echarts-ready')) {
      pv.innerHTML = '';
      pv.setAttribute('data-echarts-ready', '1');
    }
    paintReportChartBlock(pv, { ...draft, id: 'preview', title });
    requestAnimationFrame(() => {
      try { state.chartInst.rpt_preview?.resize?.(); } catch (_) {}
    });
  };

  // slot focus targets
  catSel.onfocus = () => { pickTarget = 'category'; };
  valSel.onfocus = () => { pickTarget = 'value'; };
  colSel.onfocus = () => { pickTarget = 'colDim'; };

  fillFields();
  syncSlotVisibility();
  refreshPreview();

  typeSel.onchange = () => {
    const prev = { category: catSel.value, value: valSel.value, colDim: colSel.value };
    draft.encode = { ...defaultEncode(typeSel.value), ...prev, agg: aggSel.value, format: fmtSel.value };
    fillFields({ encode: draft.encode, ...prev });
    syncSlotVisibility();
    refreshPreview();
  };
  dsSel.onchange = () => {
    fillFields({ encode: defaultEncode(typeSel.value) });
    syncSlotVisibility();
    refreshPreview();
  };
  [catSel, valSel, colSel, aggSel, fmtSel, hInp].forEach(el => {
    el.onchange = refreshPreview;
    el.oninput = refreshPreview;
  });
  titleInp.oninput = () => {
    $('rptWzPvTitle').textContent = titleInp.value.trim() || autoTitle();
  };

  const close = () => hideModal();
  $('rptWzClose').onclick = close;
  $('rptWzCancel').onclick = close;
  $('rptWzOk').onclick = () => {
    readDraft();
    if (!draft.datasetId) {
      toast('请选择数据集', 'warn');
      return;
    }
    if (!draft.encode.value && draft.chartType !== 'table') {
      toast('请选择指标字段', 'warn');
      return;
    }
    const block = {
      type: 'reportChart',
      id: uid('rc'),
      source: 'inline',
      datasetId: draft.datasetId,
      chartType: draft.chartType,
      encode: { ...draft.encode },
      style: {},
      senior: {},
      fieldRoles: {},
      title: autoTitle(),
      height: draft.height
    };
    syncReportDocToModel(r);
    r.blocks = (r.blocks || []).filter(b => b.type !== 'empty');
    r.blocks.push(block);
    state.reportSelectedBlockId = block.id;
    state.rptRightTab = 'data';
    state.rptInspCollapsed = false;
    markReportDirty(r);
    hideModal();
    toast('已插入图表，可在右侧继续配置', 'ok');
    render();
    requestAnimationFrame(() => {
      document.getElementById('rc_' + block.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
}

function openEditReportChartModal(blockId) {
  state.reportSelectedBlockId = blockId;
  state.rptRightTab = 'data';
  state.rptInspCollapsed = false;
  const body = document.getElementById('rptInspBody');
  if (body) {
    document.querySelectorAll('.rpt-chart').forEach(n => n.classList.toggle('on', n.dataset.rc === blockId));
    renderReportInspector(body);
    document.querySelectorAll('.rpt-insp .tabs button').forEach(b => {
      b.classList.toggle('on', b.dataset.rrt === state.rptRightTab);
    });
  } else {
    render();
  }
}

function renderReportList(app) {
  const q = state.search.trim();
  const folders = [...new Set(state.reports.map(r => r.folder || '未分组'))];
  const list = state.reports.filter(r => {
    if (state.folderFilter !== 'all' && (r.folder || '未分组') !== state.folderFilter) return false;
    return !q || r.name.includes(q) || (r.desc || '').includes(q);
  });
  const r = currentReport();
  const chartBlocks = (r.blocks || []).filter(b => b.type === 'reportChart');
  app.innerHTML = `
    <div class="manage">
      <div class="bar">
        <strong style="font-size:14px">在线报告</strong>
        <span class="crumb">Umo 风格高保 · 引用看板图 / 报告内新建 · 实时取数</span>
        <div class="spacer"></div>
        <input class="search-inline" id="rptSearch" placeholder="搜索报告" value="${esc(state.search)}" />
        <button class="btn primary" id="btnNewRpt">+ 新建报告</button>
      </div>
      <div class="list-layout">
        <div class="tree">
          <div class="tree-item ${state.folderFilter==='all'?'on':''}" data-ff="all">全部（${state.reports.length}）</div>
          ${folders.map(f => {
            const n = state.reports.filter(x => (x.folder || '未分组') === f).length;
            return `<div class="tree-item ${state.folderFilter===f?'on':''}" data-ff="${esc(f)}">${esc(f)} <span class="sub">${n} 个</span></div>`;
          }).join('')}
          <div class="tree-sec">列表</div>
          ${list.map(x => `
            <div class="tree-item ${x.id===r.id?'on':''}" data-rpt="${x.id}">
              ${esc(x.name)}
              <span class="sub">${esc(x.folder || '')} · ${x.status === 'draft' ? '草稿' : x.status === 'publishedWithDraft' ? '有改动' : '已发布'}</span>
            </div>`).join('') || '<div class="tree-item">无匹配</div>'}
        </div>
        <div class="detail">
          <div class="detail-hero" style="flex-direction:column;align-items:stretch">
            <div>
              <h2 style="margin-bottom:6px">${esc(r.name)}</h2>
              <p style="color:var(--text-2);font-size:13px;margin-bottom:12px">${esc(r.desc || '—')} · ${statusTag(r.status)}</p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn primary" id="btnEditRpt">打开编辑器</button>
                <button type="button" class="btn" id="btnToDash">去仪表盘选图</button>
              </div>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-card"><div class="k">图表块</div><div class="v">${chartBlocks.length}</div></div>
            <div class="meta-card"><div class="k">引用看板</div><div class="v">${chartBlocks.filter(b => b.source==='dashboard').length}</div></div>
            <div class="meta-card"><div class="k">报告内新建</div><div class="v">${chartBlocks.filter(b => b.source==='inline').length}</div></div>
            <div class="meta-card"><div class="k">更新</div><div class="v" style="font-size:12px">${esc(r.updateBy)} · ${esc(r.updateTime || '')}</div></div>
          </div>
          <div class="preview-mini">
            <div style="font-size:12px;color:var(--text-2);font-weight:600">交互说明</div>
            <div style="margin-top:8px;font-size:12px;color:var(--text-2);line-height:1.6">
              报告编辑器高保对齐 <a href="https://github.com/umodoc/editor" target="_blank" rel="noreferrer">umodoc/editor</a> Ribbon（开始/插入/表格/工具/页面/视图/导出）+ 状态栏；业务图表在「工具」槽位。
            </div>
          </div>
        </div>
      </div>
    </div>`;
  app.querySelector('#rptSearch').oninput = e => { state.search = e.target.value; render(); };
  app.querySelectorAll('[data-ff]').forEach(el => el.onclick = () => { state.folderFilter = el.dataset.ff; render(); });
  app.querySelectorAll('[data-rpt]').forEach(el => {
    el.onclick = () => { selectReport(el.dataset.rpt); render(); };
    el.ondblclick = () => { selectReport(el.dataset.rpt); state.screen = 'editor'; render(); };
  });
  app.querySelector('#btnNewRpt').onclick = () => createBlankReport();
  app.querySelector('#btnEditRpt').onclick = () => { state.module = 'report'; state.screen = 'editor'; render(); };
  app.querySelector('#btnToDash').onclick = () => {
    selectDash('dash_region');
    gotoModule('dashboard');
  };
}

function ensureReportBlockAnchors(r) {
  (r.blocks || []).forEach((b, i) => {
    if (b.type === 'heading' && !b.anchorId) b.anchorId = 'h_' + i + '_' + (b.text || '').slice(0, 8);
    if (b.type === 'reportChart' && !b.id) b.id = uid('rc');
  });
}

function buildReportToc(r) {
  const items = [];
  (r.blocks || []).forEach(b => {
    if (b.type === 'heading') {
      items.push({
        id: b.anchorId,
        level: b.level === 1 ? 1 : (b.level === 3 ? 3 : 2),
        text: b.text || '标题',
        kind: 'heading'
      });
    } else if (b.type === 'reportChart') {
      items.push({
        id: 'rc_' + b.id,
        level: 2,
        text: '▣ ' + (b.title || '图表'),
        kind: 'chart'
      });
    }
  });
  return items;
}

function reportChartMap(r) {
  const map = {};
  (r.blocks || []).forEach(b => {
    if (b.type === 'reportChart' && b.id) map[b.id] = b;
  });
  return map;
}

function isReportTextBlockEl(el) {
  return !!(el && el.nodeType === 1 && (
    /^(H1|H2|H3|H4|H5|H6|P|BLOCKQUOTE|PRE|UL|OL|HR)$/.test(el.tagName) ||
    el.classList.contains('rpt-empty')
  ));
}

function serializeReportDoc(docEl, r) {
  if (!docEl) return r.blocks || [];
  const charts = reportChartMap(r);
  const blocks = [];
  [...docEl.children].forEach((el, i) => {
    if (el.classList.contains('rpt-chart')) {
      const id = el.dataset.rc;
      if (id && charts[id]) blocks.push(charts[id]);
      return;
    }
    if (el.classList.contains('rpt-empty')) return;
    if (el.tagName === 'HR') {
      blocks.push({ type: 'hr' });
      return;
    }
    const text = (el.innerText || '').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
    if (/^H[1-6]$/.test(el.tagName)) {
      const level = Number(el.tagName.slice(1));
      const anchorId = el.id || ('h_' + i + '_' + text.slice(0, 8));
      el.id = anchorId;
      blocks.push({ type: 'heading', level, text, anchorId });
      return;
    }
    if (el.tagName === 'BLOCKQUOTE') {
      blocks.push({ type: 'quote', text });
      return;
    }
    if (el.tagName === 'PRE') {
      blocks.push({ type: 'code', text });
      return;
    }
    if (el.tagName === 'UL') {
      blocks.push({ type: 'bulletList', text, html: el.innerHTML });
      return;
    }
    if (el.tagName === 'OL') {
      blocks.push({ type: 'orderedList', text, html: el.innerHTML });
      return;
    }
    blocks.push({ type: 'paragraph', text, html: el.innerHTML });
  });
  if (!blocks.length) {
    blocks.push({ type: 'heading', level: 1, text: r.name || '未命名报告' });
    blocks.push({ type: 'paragraph', text: '' });
  }
  return blocks;
}

function syncReportDocToModel(r = currentReport()) {
  const doc = document.getElementById('rptDoc');
  if (!doc || !r) return;
  r.blocks = serializeReportDoc(doc, r);
  ensureReportBlockAnchors(r);
  markReportDirty(r);
}

function renderReportBlocksHtml(r) {
  const blocks = (r.blocks || []).filter(b => b.type !== 'empty');
  if (!blocks.length) {
    return `<h1 class="rpt-h1" data-kind="heading">${esc(r.name || '未命名报告')}</h1>
      <p class="rpt-p is-empty" data-kind="paragraph" data-placeholder="输入正文，或点「开始」里的标题 1 / 标题 2…"></p>`;
  }
  return blocks.map(b => {
    if (b.type === 'heading') {
      const level = Math.min(6, Math.max(1, Number(b.level) || 1));
      const tag = 'h' + level;
      const empty = !(b.text || '').trim();
      return `<${tag} class="rpt-h${level}${empty ? ' is-empty' : ''}" id="${esc(b.anchorId || '')}" data-kind="heading">${empty ? '<br>' : esc(b.text || '')}</${tag}>`;
    }
    if (b.type === 'paragraph') {
      const empty = !(b.text || '').trim();
      const inner = b.html && !empty ? b.html : esc(b.text || '');
      return `<p class="rpt-p${empty ? ' is-empty' : ''}" data-kind="paragraph"${empty ? ' data-placeholder="请输入文档内容..."' : ''}>${inner || '<br>'}</p>`;
    }
    if (b.type === 'quote') {
      return `<blockquote class="rpt-quote" data-kind="quote">${esc(b.text || '')}</blockquote>`;
    }
    if (b.type === 'code') {
      return `<pre data-kind="code">${esc(b.text || '')}</pre>`;
    }
    if (b.type === 'hr') return `<hr class="rpt-hr" data-kind="hr" />`;
    if (b.type === 'bulletList') return `<ul data-kind="bulletList">${b.html || `<li>${esc(b.text || '')}</li>`}</ul>`;
    if (b.type === 'orderedList') return `<ol data-kind="orderedList">${b.html || `<li>${esc(b.text || '')}</li>`}</ol>`;
    if (b.type === 'reportChart') {
      const tag = b.source === 'inline'
        ? '<span class="tag inline">仅报告</span>'
        : '<span class="tag">引用看板</span>';
      const sub = b.source === 'inline'
        ? `${esc(b.datasetId)} · ${esc(b.chartType)}`
        : `${esc(b.dashboardId)} / ${esc(b.chartTitle || b.chartId)}`;
      const on = state.reportSelectedBlockId === b.id ? 'on' : '';
      return `<div class="rpt-chart ${on}" id="rc_${esc(b.id)}" data-rc="${b.id}" contenteditable="false">
        <div class="rpt-chart-hd">
          <strong>${esc(b.title || '图表')}</strong>
          ${tag}
          <span style="color:#86909c">${sub} · 实时</span>
          <span class="spacer"></span>
          <button type="button" class="btn" data-cfg-rc="${b.id}" style="height:26px;padding:0 10px">配置</button>
          <button type="button" class="btn ghost" data-refresh="${b.id}" style="height:26px;padding:0 8px">刷新</button>
          <button type="button" class="btn ghost" data-del-rc="${b.id}" style="height:26px;padding:0 8px;color:#f53f3f">删除</button>
        </div>
        <div class="rpt-chart-bd" data-echart-rpt="${b.id}" style="height:${b.height || 280}px"></div>
      </div>`;
    }
    return '';
  }).join('');
}

function switchRptMenu(menu) {
  state.rptMenu = menu;
  document.querySelectorAll('#rptMenubar [data-menu]').forEach(b => {
    b.classList.toggle('on', b.dataset.menu === menu);
  });
  document.querySelectorAll('.umo-ribbon-container').forEach(rb => {
    rb.classList.toggle('show', rb.dataset.ribbon === menu);
  });
}

function getReportCaretBlock() {
  const doc = document.getElementById('rptDoc');
  const sel = window.getSelection();
  if (!doc || !sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === 3) node = node.parentElement;
  while (node && node !== doc) {
    if (node.parentElement === doc && isReportTextBlockEl(node)) return node;
    if (node.classList?.contains('rpt-chart')) return node;
    node = node.parentElement;
  }
  return null;
}

function placeCaretIn(el, toEnd = true) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!toEnd ? true : false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function normalizeReportFormat(format) {
  if (format === 'paragraph' || format === 'p' || format === 'text') return 'p';
  if (format === 'quote') return 'quote';
  if (/^h[1-6]$/.test(String(format))) return String(format);
  if (/^[1-6]$/.test(String(format))) return 'h' + format;
  return 'p';
}

function applyReportBlockFormat(format) {
  format = normalizeReportFormat(format);
  const doc = document.getElementById('rptDoc');
  if (!doc) return;
  doc.focus();
  let block = getReportCaretBlock();
  if (block && block.classList?.contains('rpt-chart')) {
    const p = document.createElement('p');
    p.className = 'rpt-p';
    p.innerHTML = '<br>';
    block.after(p);
    block = p;
    placeCaretIn(p, false);
  }
  if (!block || !isReportTextBlockEl(block)) {
    const el = format === 'p' ? document.createElement('p')
      : format === 'quote' ? document.createElement('blockquote')
      : document.createElement(format);
    if (format === 'p') el.className = 'rpt-p';
    else if (format === 'quote') el.className = 'rpt-quote';
    else el.className = 'rpt-' + format;
    el.innerHTML = '<br>';
    doc.appendChild(el);
    placeCaretIn(el, false);
    syncReportDocToModel();
    refreshReportTocSoft();
    updateReportStyleButtons();
    return;
  }
  if (format === 'quote') {
    const q = document.createElement('blockquote');
    q.className = 'rpt-quote';
    q.innerHTML = block.innerHTML || '<br>';
    block.replaceWith(q);
    placeCaretIn(q);
  } else {
    const tag = format === 'p' ? 'p' : format;
    const next = document.createElement(tag);
    next.className = format === 'p' ? 'rpt-p' : 'rpt-' + format;
    next.innerHTML = block.innerHTML || '<br>';
    if (block.id && tag.startsWith('h')) next.id = block.id;
    block.replaceWith(next);
    placeCaretIn(next);
  }
  syncReportDocToModel();
  refreshReportTocSoft();
  updateReportStyleButtons();
}

function runReportExec(cmd, val = null) {
  const doc = document.getElementById('rptDoc');
  if (!doc) return;
  doc.focus();
  try {
    document.execCommand(cmd, false, val);
  } catch (_) {}
  syncReportDocToModel();
  updateReportStyleButtons();
}

function insertReportNode(kind) {
  const doc = document.getElementById('rptDoc');
  if (!doc) return;
  doc.focus();
  let el;
  if (kind === 'hr') {
    el = document.createElement('hr');
    el.className = 'rpt-hr';
  } else if (kind === 'quote') {
    el = document.createElement('blockquote');
    el.className = 'rpt-quote';
    el.innerHTML = '<br>';
  } else if (kind === 'code') {
    el = document.createElement('pre');
    el.innerHTML = '<br>';
  } else if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
    el = document.createElement(kind);
    el.className = 'rpt-' + kind;
    el.innerHTML = '<br>';
  } else {
    el = document.createElement('p');
    el.className = 'rpt-p';
    el.innerHTML = '<br>';
  }
  const cur = getReportCaretBlock();
  if (cur && cur.parentElement === doc) cur.after(el);
  else doc.appendChild(el);
  if (kind !== 'hr') placeCaretIn(el, false);
  syncReportDocToModel();
  refreshReportTocSoft();
  updateReportStyleButtons();
}

function updateReportStyleButtons() {
  const block = getReportCaretBlock();
  let fmt = 'paragraph';
  if (block?.tagName === 'H1') fmt = '1';
  else if (block?.tagName === 'H2') fmt = '2';
  else if (block?.tagName === 'H3') fmt = '3';
  else if (block?.tagName === 'H4') fmt = '4';
  else if (block?.tagName === 'H5') fmt = '5';
  else if (block?.tagName === 'H6') fmt = '6';
  else if (block?.tagName === 'BLOCKQUOTE') fmt = 'quote';
  document.querySelectorAll('[data-rpt-style]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rptStyle === fmt);
    btn.classList.toggle('on', btn.dataset.rptStyle === fmt);
  });
  const boldOn = document.queryCommandState?.('bold');
  const italicOn = document.queryCommandState?.('italic');
  const underOn = document.queryCommandState?.('underline');
  const strikeOn = document.queryCommandState?.('strikeThrough');
  document.querySelectorAll('[data-rpt-cmd]').forEach(btn => {
    const c = btn.dataset.rptCmd;
    const on = (c === 'bold' && boldOn) || (c === 'italic' && italicOn)
      || (c === 'underline' && underOn) || (c === 'strikeThrough' && strikeOn);
    if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) {
      btn.classList.toggle('active', !!on);
      btn.classList.toggle('on', !!on);
    }
  });
}

function refreshReportTocSoft() {
  const app = elById('app');
  const r = currentReport();
  if (!app || !r) return;
  const list = app.querySelector('.toc-list');
  const countEl = app.querySelector('#rptTocCount');
  if (!list) return;
  const toc = buildReportToc(r);
  if (countEl) countEl.textContent = String(toc.length);
  list.innerHTML = toc.map(t => `
    <button type="button" class="toc-item ${t.level===2?'l2':''} ${t.level>=3?'l3':''} ${t.kind==='chart'?'chart':''} ${('rc_'+state.reportSelectedBlockId)===t.id?'on':''}" data-toc="${esc(t.id)}">${esc(t.text)}</button>
  `).join('') || '<div style="padding:12px;font-size:12px;color:rgba(0,0,0,.5)">暂无页面大纲</div>';
  list.querySelectorAll('[data-toc]').forEach(btn => {
    btn.onclick = () => {
      const el = document.getElementById(btn.dataset.toc);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!el.classList?.contains('rpt-chart')) placeCaretIn(el);
      }
      list.querySelectorAll('.toc-item').forEach(n => n.classList.toggle('on', n === btn));
      if (btn.dataset.toc.startsWith('rc_')) {
        state.reportSelectedBlockId = btn.dataset.toc.slice(3);
        state.rptInspCollapsed = false;
        document.getElementById('rptInsp')?.classList.remove('collapsed');
        app.querySelectorAll('.rpt-chart').forEach(n => n.classList.toggle('on', n.dataset.rc === state.reportSelectedBlockId));
        renderReportInspector(document.getElementById('rptInspBody'));
      }
    };
  });
  const wc = app.querySelector('#rptWordCountLabel');
  if (wc) {
    const n = (document.getElementById('rptDoc')?.innerText || '').replace(/\s+/g, '').length;
    wc.textContent = `${n} 字`;
  }
}

function bindReportDocEditing(app, r) {
  const doc = app.querySelector('#rptDoc');
  if (!doc) return;
  let timer = null;
  const scheduleSync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncReportDocToModel(r);
      refreshReportTocSoft();
      doc.querySelectorAll('p.rpt-p').forEach(p => {
        p.classList.toggle('is-empty', !(p.innerText || '').trim());
      });
    }, 160);
  };
  doc.addEventListener('input', scheduleSync);
  doc.addEventListener('keyup', () => updateReportStyleButtons());
  doc.addEventListener('mouseup', () => updateReportStyleButtons());
  doc.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      syncReportDocToModel(r);
      r.contentId = String(Number(r.contentId || 1) + 1);
      markReportDirty(r);
      toast('报告已保存（演示）', 'ok');
    }
  });
  // 点击空白页尾追加段落，保证总能输入
  doc.addEventListener('click', e => {
    if (e.target !== doc) return;
    const last = [...doc.children].reverse().find(n => !n.classList.contains('rpt-chart'));
    if (last && isReportTextBlockEl(last)) placeCaretIn(last);
    else {
      const p = document.createElement('p');
      p.className = 'rpt-p';
      p.innerHTML = '<br>';
      doc.appendChild(p);
      placeCaretIn(p, false);
    }
  });
}

function renderReportEditor(app) {
  const r = currentReport();
  ensureReportBlockAnchors(r);
  if (!state.rptMenu) state.rptMenu = 'base';
  if (state.rptShowToc == null) state.rptShowToc = false;
  if (!state.rptLayout) state.rptLayout = 'page';
  if (!state.rptZoom) state.rptZoom = 1;
  const toc = buildReportToc(r);
  const blocksHtml = renderReportBlocksHtml(r);
  const menu = state.rptMenu;
  const dirty = !!state.rptDirty;
  const saveLabel = dirty ? '文档未保存' : (state.rptSavedAt ? `${state.rptSavedAt}保存` : '文档已保存');
  const zoomPct = Math.round((state.rptZoom || 1) * 100);
  const hBtn = (label, ico, attrs = '', primary = false) =>
    `<button type="button" class="umo-menu-button huge${primary ? ' primary' : ''}" ${attrs}><span class="ico">${ico}</span><span class="txt">${label}</span></button>`;

  app.innerHTML = `
    <div class="rpt-editor">
      <div class="rpt-hostbar">
        <button class="btn" id="rptBack" style="height:28px">← 列表</button>
        <input class="doc-title" id="rptDocTitle" value="${esc(r.name)}" />
        <span style="font-size:12px;color:rgba(0,0,0,.5)">${statusTag(r.status)}</span>
        <div class="spacer"></div>
        <button class="btn" id="rptToggleInsp" style="height:28px">${state.rptInspCollapsed ? '显示图表配置' : '收起图表配置'}</button>
        <button class="btn primary" id="rptPublish" style="height:28px">发布</button>
      </div>
      <div class="umo-toolbar">
        <div class="umo-ribbon-tabs" id="rptMenubar">
          <button type="button" data-menu="base" class="${menu==='base'?'on':''}">开始</button>
          <button type="button" data-menu="insert" class="${menu==='insert'?'on':''}">插入</button>
          <button type="button" data-menu="table" class="${menu==='table'?'on':''}">表格</button>
          <button type="button" data-menu="tools" class="${menu==='tools'?'on':''}">工具</button>
          <button type="button" data-menu="page" class="${menu==='page'?'on':''}">页面</button>
          <button type="button" data-menu="view" class="${menu==='view'?'on':''}">视图</button>
          <button type="button" data-menu="export" class="${menu==='export'?'on':''}">导出</button>
        </div>
        <div class="umo-toolbar-actions">
          <button type="button" class="umo-save-chip ${dirty?'dirty':''}" id="rptSaveChip" title="保存文档">
            <span class="dot"></span><span id="rptSaveLabel">${saveLabel}</span>
          </button>
          <button type="button" class="umo-menu-button" id="rptToggleToolbarMode" title="切换工具栏">切换工具栏</button>
        </div>
        <div class="umo-ribbon-scroll">
          <div class="umo-ribbon-container ${menu==='base'?'show':''}" data-ribbon="base">
            <div class="umo-virtual-group col">
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" data-rpt-cmd="undo" title="撤消">撤消</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="redo" title="重做">重做</button>
              </div>
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" disabled title="格式刷">格式刷</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="removeFormat" title="清除文本格式">清除</button>
              </div>
            </div>
            <div class="umo-virtual-group col">
              <div class="umo-virtual-group-row">
                <select class="umo-sel" id="rptFontName" title="选择字体">
                  <option value="">默认字体</option>
                  <option value="Microsoft YaHei">微软雅黑</option>
                  <option value="SimSun">宋体</option>
                  <option value="SimHei">黑体</option>
                  <option value="Arial">Arial</option>
                </select>
                <select class="umo-sel" id="rptFontSize" title="字体大小" style="max-width:72px">
                  <option value="">默认</option>
                  <option value="3">小四</option>
                  <option value="4">四号</option>
                  <option value="5">小三</option>
                  <option value="6">三号</option>
                </select>
                <button type="button" class="umo-menu-button" disabled title="文字换行方式">换行</button>
              </div>
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" data-rpt-cmd="bold" title="粗体"><b>B</b></button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="italic" title="斜体"><i>I</i></button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="underline" title="下划线"><u>U</u></button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="strikeThrough" title="中划线"><s>S</s></button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="subscript" title="下标">x₂</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="superscript" title="上标">x²</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="foreColor" data-rpt-val="#3480f9" title="字体颜色">A</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="hiliteColor" data-rpt-val="#fefc7e" title="字体背景颜色">底</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="hiliteColor" data-rpt-val="#fff3bf" title="高亮显示">高亮</button>
              </div>
            </div>
            <div class="umo-virtual-group col">
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" data-rpt-cmd="insertOrderedList" title="有序列表">有序</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="insertUnorderedList" title="无序列表">无序</button>
                <button type="button" class="umo-menu-button" disabled title="待办事项">待办</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="indent" title="增加缩进">缩进+</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="outdent" title="减少缩进">缩进-</button>
                <button type="button" class="umo-menu-button" disabled title="行高">行高</button>
                <button type="button" class="umo-menu-button" disabled title="上下间距">间距</button>
              </div>
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" data-rpt-cmd="justifyLeft" title="左对齐">左</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="justifyCenter" title="居中对齐">中</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="justifyRight" title="右对齐">右</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="justifyFull" title="两端对齐">两端</button>
                <button type="button" class="umo-menu-button" disabled title="分散对齐">分散</button>
                <button type="button" class="umo-menu-button" data-rpt-insert="code" title="代码">代码</button>
                <button type="button" class="umo-menu-button" data-rpt-insert="quote" title="引用">引用</button>
                <button type="button" class="umo-menu-button" data-rpt-cmd="selectAll" title="全选">全选</button>
              </div>
            </div>
            <div class="umo-virtual-group">
              <div class="umo-heading-wrap">
                <div class="umo-heading-container" id="rptHeadingPicker">
                  <div class="card" data-rpt-style="paragraph"><div class="title text">正文</div><div class="subtitle">text</div></div>
                  <div class="card" data-rpt-style="1"><div class="title h1">标题 1</div><div class="subtitle">h1</div></div>
                  <div class="card" data-rpt-style="2"><div class="title h2">标题 2</div><div class="subtitle">h2</div></div>
                  <div class="card" data-rpt-style="3"><div class="title h3">标题 3</div><div class="subtitle">h3</div></div>
                </div>
              </div>
            </div>
            <div class="umo-virtual-group">
              ${hBtn('Markdown', 'M', 'disabled title="Markdown"')}
              ${hBtn('查找替换', '搜', 'id="rptFindBtn"')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('打印', '印', 'id="rptPrint"')}
            </div>
          </div>
          <div class="umo-ribbon-container ${menu==='insert'?'show':''}" data-ribbon="insert">
            <div class="umo-virtual-group">
              ${hBtn('链接', '链', 'disabled')}
              ${hBtn('图片', '图', 'disabled')}
              ${hBtn('视频', '视', 'disabled')}
              ${hBtn('音频', '音', 'disabled')}
              ${hBtn('文件', '文', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('文本框', '框', 'disabled')}
              ${hBtn('详情', '详', 'disabled')}
              ${hBtn('代码块', '</>', 'data-rpt-insert="code"')}
              ${hBtn('特殊字符', '符', 'disabled')}
              ${hBtn('日期', '日', 'disabled')}
              ${hBtn('表情', '表', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('标签', '签', 'disabled')}
              ${hBtn('分栏', '栏', 'disabled')}
              ${hBtn('高亮块', '亮', 'disabled')}
              ${hBtn('提及某人', '@', 'disabled')}
              ${hBtn('选项', '选', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('换行符', '↵', 'disabled')}
              ${hBtn('分隔线', '—', 'data-rpt-insert="hr"')}
              ${hBtn('书签', '书', 'disabled')}
              ${hBtn('脚注', '注', 'disabled')}
              ${hBtn('页面大纲', '纲', 'id="rptInsToc"')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('模板', '模', 'disabled')}
              ${hBtn('网页', '网', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('标题 1', 'H1', 'data-rpt-insert="h1"')}
              ${hBtn('标题 2', 'H2', 'data-rpt-insert="h2"')}
              ${hBtn('段落', 'P', 'data-rpt-insert="p"')}
            </div>
          </div>
          <div class="umo-ribbon-container ${menu==='table'?'show':''}" data-ribbon="table">
            <div class="umo-virtual-group">
              ${hBtn('插入表格', '表', 'id="rptInsTable"')}
              ${hBtn('修复', '修', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('对齐方式', '齐', 'disabled')}
              ${hBtn('背景颜色', '色', 'disabled')}
            </div>
            <div class="umo-virtual-group col">
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" disabled>插入行(前)</button>
                <button type="button" class="umo-menu-button" disabled>插入行(后)</button>
                <button type="button" class="umo-menu-button" disabled>删除行</button>
              </div>
              <div class="umo-virtual-group-row">
                <button type="button" class="umo-menu-button" disabled>插入列(左)</button>
                <button type="button" class="umo-menu-button" disabled>插入列(右)</button>
                <button type="button" class="umo-menu-button" disabled>删除列</button>
              </div>
            </div>
            <div class="umo-virtual-group col">
              <div class="umo-virtual-group-row"><button type="button" class="umo-menu-button" disabled>合并单元格</button></div>
              <div class="umo-virtual-group-row"><button type="button" class="umo-menu-button" disabled>拆分单元格</button></div>
            </div>
            <div class="umo-virtual-group">${hBtn('删除表格', '删', 'disabled')}</div>
          </div>
          <div class="umo-ribbon-container ${menu==='tools'?'show':''}" data-ribbon="tools">
            <div class="umo-virtual-group">
              ${hBtn('签名', '签', 'disabled')}
              ${hBtn('印章', '章', 'disabled')}
              ${hBtn('二维码', '码', 'disabled')}
              ${hBtn('条形码', '条', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('公式', '∑', 'disabled')}
              ${hBtn('流程图', '流', 'disabled')}
              ${hBtn('图表', '图', 'disabled title="Umo 内置图表；业务看板图请用右侧业务入口"')}
              ${hBtn('Mermaid', 'M', 'disabled')}
            </div>
            <div class="umo-virtual-group">${hBtn('中文大小写', '中', 'disabled')}</div>
            <div class="umo-virtual-group is-slot">
              ${hBtn('引用仪表盘', '盘', 'id="rptInsRef" title="先选仪表盘，再勾选一个或多个图表"', true)}
              ${hBtn('新建图表', '新', 'id="rptInsNew" title="选数据集并配置编码，仅存于报告"', true)}
            </div>
          </div>
          <div class="umo-ribbon-container ${menu==='page'?'show':''}" data-ribbon="page">
            <div class="umo-virtual-group">
              ${hBtn('页边距', '边', 'disabled')}
              <div class="umo-virtual-group col">
                <div class="umo-virtual-group-row">
                  <select class="umo-sel" id="rptPageSize" title="页面大小"><option>A4</option><option>A3</option><option>Letter</option></select>
                </div>
                <div class="umo-virtual-group-row">
                  <button type="button" class="umo-menu-button" id="rptPagePortrait" title="页面方向">纵向</button>
                  <button type="button" class="umo-menu-button" id="rptPageLandscape" title="页面方向">横向</button>
                </div>
              </div>
            </div>
            <div class="umo-virtual-group">
              ${hBtn('分页符', '页', 'disabled')}
              ${hBtn('显示换行', '↵', 'disabled')}
              ${hBtn('显示行号', '号', 'disabled')}
              ${hBtn('页面水印', '水', 'disabled')}
              ${hBtn('页面背景', '景', 'id="rptPageBg"')}
            </div>
          </div>
          <div class="umo-ribbon-container ${menu==='view'?'show':''}" data-ribbon="view">
            <div class="umo-virtual-group">
              ${hBtn(state.rptShowToc ? '隐藏大纲' : '显示大纲', '纲', 'id="rptToggleToc"')}
              ${hBtn('全屏模式', '全', 'disabled')}
              ${hBtn('演示模式', '演', 'disabled')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('页面视图', '页', 'id="rptViewPage"')}
              ${hBtn('Web 视图', 'W', 'id="rptViewWeb"')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('缩放比例', zoomPct + '%', 'disabled')}
              ${hBtn('原始比例', '1:1', 'id="rptZoom100"')}
              ${hBtn('最佳比例', '适', 'id="rptZoomAuto"')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('外观设置', '貌', 'disabled')}
              ${hBtn('主题设置', '题', 'disabled')}
              ${hBtn('语言设置', '语', 'disabled')}
            </div>
            <div class="umo-virtual-group">${hBtn('重置设置', '重', 'id="rptResetView"')}</div>
          </div>
          <div class="umo-ribbon-container ${menu==='export'?'show':''}" data-ribbon="export">
            <div class="umo-virtual-group">
              ${hBtn('图片', '图', 'disabled')}
              ${hBtn('PDF', 'PDF', 'disabled')}
              ${hBtn('文本文档', 'TXT', 'id="rptExportText"')}
            </div>
            <div class="umo-virtual-group">
              ${hBtn('分享文档', '享', 'disabled')}
              ${hBtn('Embed', '嵌', 'disabled')}
            </div>
          </div>
        </div>
      </div>
      <div class="umo-main">
        <aside class="umo-toc-container ${state.rptShowToc?'show':''}" id="rptToc">
          <div class="toc-hd">
            <span>页面大纲</span>
            <span id="rptTocCount" style="font-weight:400;color:rgba(0,0,0,.45)">${toc.length}</span>
          </div>
          <div class="toc-list">
            ${toc.map(t => `
              <button type="button" class="toc-item ${t.level===2?'l2':''} ${t.level>=3?'l3':''} ${t.kind==='chart'?'chart':''} ${('rc_'+state.reportSelectedBlockId)===t.id?'on':''}" data-toc="${esc(t.id)}">${esc(t.text)}</button>
            `).join('') || '<div style="padding:12px;font-size:12px;color:rgba(0,0,0,.5)">暂无页面大纲</div>'}
          </div>
        </aside>
        <div class="umo-page-container">
          <div class="umo-page-content ${state.rptLayout==='web'?'web-layout':''}" id="rptPage" style="transform:scale(${state.rptZoom||1})">
            <i class="umo-page-corner tl"></i><i class="umo-page-corner tr"></i>
            <i class="umo-page-corner bl"></i><i class="umo-page-corner br"></i>
            <div class="rpt-doc" id="rptDoc" contenteditable="true" spellcheck="false">${blocksHtml}</div>
          </div>
        </div>
        <aside class="rpt-insp ${state.rptInspCollapsed ? 'collapsed' : ''}" id="rptInsp">
          <div class="tabs">
            <button type="button" data-rrt="data" class="${state.rptRightTab==='data'?'on':''}">数据</button>
            <button type="button" data-rrt="style" class="${state.rptRightTab==='style'?'on':''}">样式</button>
            <button type="button" data-rrt="senior" class="${state.rptRightTab==='senior'?'on':''}">高级</button>
          </div>
          <div id="rptInspBody"></div>
        </aside>
      </div>
      <div class="umo-status-bar">
        <div class="left">
          <button type="button" id="rptStatusToc" class="${state.rptShowToc?'on':''}">页面大纲</button>
          <button type="button" id="rptStatusLayout">${state.rptLayout==='web'?'Web 视图':'页面视图'}</button>
          <span id="rptWordCountLabel">— 字</span>
          <a href="https://github.com/umodoc/editor" target="_blank" rel="noreferrer" style="color:inherit;text-decoration:none">Umo Editor</a>
        </div>
        <div class="right">
          <button type="button" id="rptZoomOut">−</button>
          <span id="rptZoomPct">${zoomPct}%</span>
          <button type="button" id="rptZoomIn">+</button>
        </div>
      </div>
    </div>`;

  const markDirtyUi = () => {
    state.rptDirty = true;
    app.querySelector('#rptSaveChip')?.classList.add('dirty');
    const lab = app.querySelector('#rptSaveLabel');
    if (lab) lab.textContent = '文档未保存';
  };
  const markSavedUi = () => {
    state.rptDirty = false;
    const t = new Date();
    state.rptSavedAt = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    app.querySelector('#rptSaveChip')?.classList.remove('dirty');
    const lab = app.querySelector('#rptSaveLabel');
    if (lab) lab.textContent = `${state.rptSavedAt}保存`;
  };
  const applyZoom = () => {
    const page = document.getElementById('rptPage');
    if (page) page.style.transform = `scale(${state.rptZoom || 1})`;
    const pct = app.querySelector('#rptZoomPct');
    if (pct) pct.textContent = `${Math.round((state.rptZoom || 1) * 100)}%`;
  };
  const setTocVisible = (on) => {
    state.rptShowToc = !!on;
    document.getElementById('rptToc')?.classList.toggle('show', state.rptShowToc);
    app.querySelector('#rptStatusToc')?.classList.toggle('on', state.rptShowToc);
    const btn = app.querySelector('#rptToggleToc .txt');
    if (btn) btn.textContent = state.rptShowToc ? '隐藏大纲' : '显示大纲';
  };

  app.querySelector('#rptBack').onclick = () => { syncReportDocToModel(r); state.screen = 'list'; render(); };
  app.querySelector('#rptToggleInsp').onclick = () => {
    state.rptInspCollapsed = !state.rptInspCollapsed;
    document.getElementById('rptInsp')?.classList.toggle('collapsed', state.rptInspCollapsed);
    app.querySelector('#rptToggleInsp').textContent = state.rptInspCollapsed ? '显示图表配置' : '收起图表配置';
  };
  app.querySelector('#rptDocTitle').onchange = e => {
    r.name = e.target.value.trim() || r.name;
    markReportDirty(r);
    markDirtyUi();
  };
  app.querySelectorAll('#rptMenubar [data-menu]').forEach(btn => {
    btn.onclick = () => switchRptMenu(btn.dataset.menu);
  });
  app.querySelectorAll('.umo-ribbon-container button, .umo-heading-container .card').forEach(el => {
    el.addEventListener('mousedown', e => e.preventDefault());
  });
  app.querySelectorAll('[data-rpt-cmd]').forEach(btn => {
    btn.onclick = e => { e.preventDefault(); runReportExec(btn.dataset.rptCmd, btn.dataset.rptVal || null); markDirtyUi(); };
  });
  app.querySelectorAll('[data-rpt-style]').forEach(btn => {
    btn.onclick = e => { e.preventDefault(); applyReportBlockFormat(btn.dataset.rptStyle); markDirtyUi(); };
  });
  app.querySelectorAll('[data-rpt-insert]').forEach(btn => {
    btn.onclick = e => { e.preventDefault(); insertReportNode(btn.dataset.rptInsert); markDirtyUi(); };
  });
  const fontName = app.querySelector('#rptFontName');
  const fontSize = app.querySelector('#rptFontSize');
  if (fontName) fontName.onchange = () => { if (fontName.value) { runReportExec('fontName', fontName.value); markDirtyUi(); } };
  if (fontSize) fontSize.onchange = () => { if (fontSize.value) { runReportExec('fontSize', fontSize.value); markDirtyUi(); } };

  const findFn = () => {
    const q = prompt('查找文本');
    if (!q) return;
    if (window.find) window.find(q);
    else toast('当前浏览器不支持查找', 'warn');
  };
  app.querySelector('#rptFindBtn')?.addEventListener('click', findFn);
  app.querySelector('#rptPrint')?.addEventListener('click', () => window.print());
  app.querySelector('#rptInsToc')?.addEventListener('click', () => setTocVisible(true));
  app.querySelector('#rptToggleToc')?.addEventListener('click', () => setTocVisible(!state.rptShowToc));
  app.querySelector('#rptStatusToc')?.addEventListener('click', () => setTocVisible(!state.rptShowToc));
  app.querySelector('#rptToggleToolbarMode')?.addEventListener('click', () => {
    toast('高保固定为专业工具栏（ribbon），与 Umo 默认一致', 'ok');
  });
  app.querySelector('#rptInsTable')?.addEventListener('click', () => {
    const doc = document.getElementById('rptDoc');
    if (!doc) return;
    doc.focus();
    const html = '<table style="width:100%;border-collapse:collapse;margin:12px 0"><tbody>'
      + [0, 1, 2].map(() => '<tr>' + [0, 1, 2].map(() => '<td style="border:1px solid #333;padding:8px">&nbsp;</td>').join('') + '</tr>').join('')
      + '</tbody></table><p class="rpt-p"><br></p>';
    document.execCommand('insertHTML', false, html);
    syncReportDocToModel(r);
    markDirtyUi();
    toast('已插入 3×3 表格', 'ok');
  });
  app.querySelector('#rptPagePortrait')?.addEventListener('click', () => {
    const page = document.getElementById('rptPage');
    if (page) { page.style.width = '21cm'; page.style.minHeight = '29.7cm'; }
    toast('纵向', 'ok');
  });
  app.querySelector('#rptPageLandscape')?.addEventListener('click', () => {
    const page = document.getElementById('rptPage');
    if (page) { page.style.width = '29.7cm'; page.style.minHeight = '21cm'; }
    toast('横向', 'ok');
  });
  app.querySelector('#rptPageBg')?.addEventListener('click', () => {
    const page = document.getElementById('rptPage');
    if (page) page.style.background = page.style.background === 'rgb(255, 251, 245)' ? '#fff' : '#fffbf5';
  });
  app.querySelector('#rptViewPage')?.addEventListener('click', () => {
    state.rptLayout = 'page';
    document.getElementById('rptPage')?.classList.remove('web-layout');
    const lab = app.querySelector('#rptStatusLayout');
    if (lab) lab.textContent = '页面视图';
  });
  app.querySelector('#rptViewWeb')?.addEventListener('click', () => {
    state.rptLayout = 'web';
    document.getElementById('rptPage')?.classList.add('web-layout');
    const lab = app.querySelector('#rptStatusLayout');
    if (lab) lab.textContent = 'Web 视图';
  });
  app.querySelector('#rptStatusLayout')?.addEventListener('click', () => {
    if (state.rptLayout === 'web') app.querySelector('#rptViewPage')?.click();
    else app.querySelector('#rptViewWeb')?.click();
  });
  app.querySelector('#rptZoomIn')?.addEventListener('click', () => { state.rptZoom = Math.min(1.5, (state.rptZoom || 1) + 0.1); applyZoom(); });
  app.querySelector('#rptZoomOut')?.addEventListener('click', () => { state.rptZoom = Math.max(0.5, (state.rptZoom || 1) - 0.1); applyZoom(); });
  app.querySelector('#rptZoom100')?.addEventListener('click', () => { state.rptZoom = 1; applyZoom(); });
  app.querySelector('#rptZoomAuto')?.addEventListener('click', () => { state.rptZoom = 0.9; applyZoom(); });
  app.querySelector('#rptResetView')?.addEventListener('click', () => {
    state.rptZoom = 1; state.rptLayout = 'page'; state.rptShowToc = false;
    applyZoom();
    document.getElementById('rptPage')?.classList.remove('web-layout');
    setTocVisible(false);
    toast('已重置视图设置', 'ok');
  });
  app.querySelector('#rptExportText')?.addEventListener('click', () => {
    syncReportDocToModel(r);
    const text = document.getElementById('rptDoc')?.innerText || '';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (r.name || 'report') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出文本文档', 'ok');
  });

  const saveDoc = () => {
    syncReportDocToModel(r);
    r.contentId = String(Number(r.contentId || 1) + 1);
    markReportDirty(r);
    markSavedUi();
    toast('文档保存成功', 'ok');
  };
  app.querySelector('#rptSaveChip').onclick = saveDoc;
  app.querySelector('#rptInsRef').onclick = () => { syncReportDocToModel(r); openInsertDashboardChartModal(); };
  app.querySelector('#rptInsNew').onclick = () => { syncReportDocToModel(r); openCreateInlineChartModal(); };
  app.querySelector('#rptPublish').onclick = () => {
    saveDoc();
    r.status = 'published';
    r.updateTime = '刚刚';
    toast('报告已发布（演示）', 'ok');
    render();
  };
  app.querySelectorAll('[data-rrt]').forEach(btn => {
    btn.onclick = () => {
      state.rptRightTab = btn.dataset.rrt;
      app.querySelectorAll('[data-rrt]').forEach(b => b.classList.toggle('on', b.dataset.rrt === state.rptRightTab));
      renderReportInspector(document.getElementById('rptInspBody'));
    };
  });
  refreshReportTocSoft();
  const selectRptChart = (id) => {
    state.reportSelectedBlockId = id;
    state.rptInspCollapsed = false;
    document.getElementById('rptInsp')?.classList.remove('collapsed');
    app.querySelector('#rptToggleInsp').textContent = '收起图表配置';
    app.querySelectorAll('.rpt-chart').forEach(n => n.classList.toggle('on', n.dataset.rc === id));
    renderReportInspector(document.getElementById('rptInspBody'));
  };
  app.querySelectorAll('[data-rc]').forEach(el => {
    el.onclick = e => { if (e.target.closest('button')) return; selectRptChart(el.dataset.rc); };
    el.ondblclick = e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      state.rptRightTab = 'data';
      selectRptChart(el.dataset.rc);
      app.querySelectorAll('[data-rrt]').forEach(b => b.classList.toggle('on', b.dataset.rrt === 'data'));
    };
  });
  app.querySelectorAll('[data-cfg-rc]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      state.rptRightTab = 'data';
      selectRptChart(btn.dataset.cfgRc);
      app.querySelectorAll('[data-rrt]').forEach(b => b.classList.toggle('on', b.dataset.rrt === 'data'));
    };
  });
  app.querySelectorAll('[data-del-rc]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      syncReportDocToModel(r);
      r.blocks = r.blocks.filter(b => b.id !== btn.dataset.delRc);
      if (!r.blocks.length) {
        r.blocks.push({ type: 'heading', level: 1, text: r.name || '未命名报告' });
        r.blocks.push({ type: 'paragraph', text: '' });
      }
      if (state.reportSelectedBlockId === btn.dataset.delRc) state.reportSelectedBlockId = null;
      toast('已删除图表块', 'ok');
      render();
    };
  });
  app.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const block = r.blocks.find(b => b.id === btn.dataset.refresh);
      paintReportChartBlock(app.querySelector(`[data-echart-rpt="${btn.dataset.refresh}"]`), block);
      toast('已刷新（实时演示）', 'ok');
    };
  });
  bindReportDocEditing(app, r);
  const doc = app.querySelector('#rptDoc');
  if (doc) doc.addEventListener('input', markDirtyUi);
  if (state.rptLayout === 'page') app.querySelector('#rptViewPage')?.classList.add('on');
  if (state.rptLayout === 'web') app.querySelector('#rptViewWeb')?.classList.add('on');
  renderReportInspector(document.getElementById('rptInspBody'));
  updateReportStyleButtons();
  requestAnimationFrame(() => {
    (r.blocks || []).filter(b => b.type === 'reportChart').forEach(b => {
      paintReportChartBlock(app.querySelector(`[data-echart-rpt="${b.id}"]`), b);
    });
    refreshReportTocSoft();
    const first = app.querySelector('#rptDoc h1, #rptDoc p');
    if (first && !state.reportSelectedBlockId) {
      try { placeCaretIn(first, true); } catch (_) {}
    }
  });
}

function disposeCharts() {
  Object.values(state.chartInst).forEach(c => { try { c.dispose(); } catch (_) {} });
  state.chartInst = {};
}

function disposeOneChart(chartId) {
  if (!chartId || !state.chartInst[chartId]) return;
  try { state.chartInst[chartId].dispose(); } catch (_) {}
  delete state.chartInst[chartId];
}

function findComp(id) {
  if (useMobileLayout()) {
    const raw = ensureMobile(state.dash).components.find(c => c.id === id);
    const h = raw ? hydrateMobileComp(raw) : null;
    if (h) return h;
  }
  return state.dash.components.find(c => c.id === id);
}

function findCompByChartId(chartId) {
  if (useMobileLayout()) {
    const h = tabComps().find(c => c.chartId === chartId);
    if (h) return h;
  }
  return state.dash.components.find(c => c.chartId === chartId);
}

/** 仅切换选中态 + 右侧面板，不重建画布 */
function selectComp(id, { right = true, left = false } = {}) {
  state.selectedId = id;
  document.querySelectorAll('.widget').forEach(w => w.classList.toggle('selected', w.dataset.wid === id));
  document.querySelectorAll('.layer').forEach(n => n.classList.toggle('on', n.dataset.sel === id));
  if (right) {
    // Point-select opens config; drag/context keep the collapsed chrome.
    if (state.inspCollapsed) {
      state.inspCollapsed = false;
      syncEditorChrome();
    }
    renderRight(document.getElementById('right'));
  }
  if (left && state.leftTab === 'layer') renderLeft(document.getElementById('left'));
  syncDataOpsLayout();
}

function flashWidget(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 420);
}

function applyCardStyleDom(el, comp) {
  if (!el || comp.type !== 'chart') return;
  const ch = state.dash.charts[comp.chartId];
  if (!ch) return;
  const st = resolveCompStyle(comp);
  const isKpi = ch?.chartType === 'kpi';
  const showTitle = isKpi ? st.showTitle === true : st.showTitle !== false;
  const bw = st.borderWidth != null ? st.borderWidth : 1;
  el.style.background = st.bg || '#fff';
  el.style.borderRadius = (st.cardRadius ?? 10) + 'px';
  el.style.border = `${bw}px solid ${st.borderColor || '#e5e6eb'}`;
  const hd = el.querySelector('.hd');
  if (hd) {
    const titleBg = st.titleBg || '#fafbfc';
    const inverse = isDarkColor(titleBg);
    const titleBold = st.titleBold !== false;
    hd.style.display = showTitle ? '' : 'none';
    hd.style.color = st.titleColor || '#1f2329';
    hd.style.background = titleBg;
    hd.style.fontSize = (st.titleSize || 12) + 'px';
    hd.style.fontWeight = titleBold ? '700' : '500';
    hd.style.justifyContent = st.titleAlign === 'center' ? 'center' : 'space-between';
    hd.classList.toggle('inverse', inverse);
    hd.classList.toggle('bold', titleBold);
  }
  const bd = el.querySelector('.bd');
  if (bd) {
    bd.style.top = showTitle ? '32px' : '0px';
    const pad = st.cardPadding != null ? st.cardPadding : 8;
    if (bd.hasAttribute('data-table') || bd.classList.contains('table-wrap')) {
      bd.style.padding = '0';
    } else {
      bd.style.padding = `${pad}px`;
    }
  }
}

function updateWidgetChrome(comp) {
  const el = document.querySelector(`[data-wid="${comp.id}"]`);
  if (!el || comp.type !== 'chart') return;
  const hd = el.querySelector('.hd');
  if (!hd) return;
  const ch = state.dash.charts[comp.chartId];
  const title = ch?.title || '图表';
  let badge = missingBind(ch).length ? '待配置' : ch.chartType;
  if (!missingBind(ch).length && state.pendingPaint?.has(ch.id)) badge = '待更新';
  const isKpi = ch?.chartType === 'kpi';
  hd.innerHTML = `<span style="font-weight:inherit;color:inherit;font-size:inherit">${esc(title)}</span>${isKpi ? '' : `<span>${esc(badge)}</span>`}`;
  applyCardStyleDom(el, comp);
}

/** 替换单个组件 DOM（类型切换 / miss↔图表） */
function replaceWidget(comp, { paint = true } = {}) {
  const board = document.getElementById('board');
  if (!board) return;
  const old = board.querySelector(`[data-wid="${comp.id}"]`);
  if (!old) { renderBoard(board); return; }
  if (comp.chartId) disposeOneChart(comp.chartId);
  const cw = colW(board);
  const wrap = document.createElement('div');
  wrap.innerHTML = widgetHtml(comp, cw);
  const neu = wrap.firstElementChild;
  old.replaceWith(neu);
  wireDrag(neu, comp, cw);
  if (comp.type === 'chart' && paint) paintChart(neu, comp);
  if (comp.type === 'slicer') wireSlicer(neu);
  if (comp.type === 'query') wireQuery(neu, comp);
  if (paint) flashWidget(neu);
}

/** 只刷新一个组件的数据/样式，其他图不动 */
function refreshComp(compId, { inspector = false, flash = true, paint = true } = {}) {
  const comp = findComp(compId);
  if (!comp) return;
  const board = document.getElementById('board');
  const el = board?.querySelector(`[data-wid="${comp.id}"]`);
  if (!el || !board) return;

  if (comp.type !== 'chart') {
    replaceWidget(comp);
    if (inspector) renderRight(document.getElementById('right'));
    return;
  }
  const ch = state.dash.charts[comp.chartId];
  const wasMiss = !!el.querySelector('.miss');
  const nowMiss = missingBind(ch).length > 0;
  const bodyKind = () => {
    if (el.querySelector('[data-echart]')) return 'echart';
    if (el.querySelector('[data-kpi]')) return 'kpi';
    if (el.querySelector('[data-table]')) return 'table';
    if (el.querySelector('.miss')) return 'miss';
    return 'other';
  };
  const needKind = nowMiss ? 'miss' : (isTableType(ch.chartType) ? 'table' : ch.chartType === 'kpi' ? 'kpi' : 'echart');
  if (wasMiss !== nowMiss || bodyKind() !== needKind) {
    replaceWidget(comp, { paint });
    if (!paint && !nowMiss) updateWidgetChrome(comp);
  } else {
    updateWidgetChrome(comp);
    if (paint) {
      paintChart(el, comp);
      if (flash) flashWidget(el);
    }
  }
  if (inspector) renderRight(document.getElementById('right'));
}

/** 筛选/主题：只重绘画布数据，不拆 DOM */
function repaintAllCharts({ flash = false } = {}) {
  const board = document.getElementById('board');
  if (!board) return;
  tabComps().forEach(c => {
    if (c.type !== 'chart') return;
    const el = board.querySelector(`[data-wid="${c.id}"]`);
    if (!el || el.querySelector('.miss')) return;
    paintChart(el, c);
    if (flash) flashWidget(el);
  });
}

/** 配置变更入口：脏标记 + 单图刷新 + 可选刷新右侧 */
function patchChart(ch, { inspector = true, flash = true, paint = true } = {}) {
  if (state.module === 'report' && state._rptChartProxy && ch === state._rptChartProxy) {
    applyReportChartPatch(ch, { inspector });
    return;
  }
  markDirty();
  const comp = findCompByChartId(ch.id);
  if (comp) refreshComp(comp.id, { inspector, flash, paint });
  else if (inspector) renderRight(document.getElementById('right'));
}

function markChartPending(chId) {
  if (!state.pendingPaint) state.pendingPaint = new Set();
  state.pendingPaint.add(chId);
}

function clearChartPending(chId) {
  state.pendingPaint?.delete(chId);
}

function applyChartDataUpdate(ch) {
  clearChartPending(ch.id);
  patchChart(ch, { inspector: true, flash: true, paint: true });
}

function reportBlockAsChart(block) {
  if (!block.encode) block.encode = defaultEncode(block.chartType || 'bar');
  if (!block.style) block.style = {};
  if (!block.senior) block.senior = {};
  if (!block.fieldRoles) block.fieldRoles = {};
  if (!block.chartType) block.chartType = 'bar';
  // 可变代理：字段银行 / 编码槽 / patchChart 复用仪表盘逻辑
  const proxy = {
    id: block.id,
    get title() { return block.title || ''; },
    set title(v) { block.title = v; },
    get chartType() { return block.chartType || 'bar'; },
    set chartType(v) { block.chartType = v; },
    get datasetId() { return block.datasetId || null; },
    set datasetId(v) { block.datasetId = v || null; },
    encode: block.encode,
    style: block.style,
    senior: block.senior,
    fieldRoles: block.fieldRoles
  };
  state._rptChartProxy = proxy;
  return proxy;
}

function applyReportChartPatch(ch, { inspector = true } = {}) {
  const r = currentReport();
  const block = (r.blocks || []).find(b => b.id === ch.id && b.type === 'reportChart');
  if (!block) return;
  // 保持 block 与 proxy 同步（encode/style 本就是同一引用）
  block.title = ch.title;
  block.chartType = ch.chartType;
  block.datasetId = ch.datasetId;
  if (block.source !== 'dashboard') block.source = 'inline';
  markReportDirty(r);
  const app = elById('app');
  const card = app?.querySelector(`[data-rc="${block.id}"]`);
  if (card) {
    const strong = card.querySelector('.rpt-chart-hd strong');
    if (strong) strong.textContent = block.title || '图表';
    const sub = card.querySelector('.rpt-chart-hd span:not(.tag):not(.spacer)');
    // skip fragile subtitle update
    paintReportChartBlock(card.querySelector(`[data-echart-rpt="${block.id}"]`), block);
  }
  if (inspector) {
    const body = document.getElementById('rptInspBody');
    if (body) renderReportInspector(body);
  }
}

function refreshReportSelectedChart() {
  const r = currentReport();
  const block = (r.blocks || []).find(b => b.id === state.reportSelectedBlockId && b.type === 'reportChart');
  if (!block) return;
  const dom = document.querySelector(`[data-echart-rpt="${block.id}"]`);
  paintReportChartBlock(dom, block);
}

function renderReportInspector(el) {
  if (!el) return;
  const r = currentReport();
  const block = (r.blocks || []).find(b => b.id === state.reportSelectedBlockId && b.type === 'reportChart');
  if (!block) {
    state._rptChartProxy = null;
    el.innerHTML = `<div style="padding:28px 16px;text-align:center;color:#86909c;font-size:12px;line-height:1.7">
      点选报告中的图表进行配置<br/>数据 / 样式 / 高级与仪表盘编辑器一致
    </div>`;
    return;
  }

  if (state.rptRightTab === 'style') return renderReportStylePanel(el, block);
  if (state.rptRightTab === 'senior') return renderReportSeniorPanel(el, block);

  // —— 数据 ——
  if (block.source === 'dashboard') {
    const dashOpts = reportDashChartOptions();
    const pack = dashOpts.find(o => o.dash.id === block.dashboardId) || dashOpts[0];
    el.innerHTML = `
      <div class="sec">
        <h4>来源</h4>
        <div class="field"><label>模式</label>
          <select id="rptSrcMode">
            <option value="dashboard" selected>引用看板图</option>
            <option value="inline">转为报告内配置</option>
          </select>
        </div>
        <p style="font-size:11px;color:#86909c;line-height:1.5;margin:0">引用模式：encode 以看板为准；可更换看板/图表。</p>
      </div>
      <div class="sec">
        <h4>1. 仪表盘</h4>
        <div class="field">
          <select id="rptDash">
            ${dashOpts.map(o => `<option value="${o.dash.id}" ${o.dash.id===block.dashboardId?'selected':''}>${esc(o.dash.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sec">
        <h4>2. 图表</h4>
        <div class="field">
          <select id="rptCh">
            ${(pack?.charts || []).map(c => `<option value="${c.id}" ${c.id===block.chartId?'selected':''}>${esc(c.title)} (${esc(c.chartType)})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sec">
        <h4>显示</h4>
        <div class="field"><label>标题</label><input id="rptCt" value="${esc(block.title || '')}" /></div>
      </div>`;
    el.querySelector('#rptSrcMode').onchange = e => {
      if (e.target.value !== 'inline') return;
      const ch = resolveReportChartSpec(block);
      block.source = 'inline';
      block.datasetId = ch?.datasetId || defaultDatasetId();
      block.chartType = ch?.chartType || 'bar';
      block.encode = { ...(ch?.encode || defaultEncode('bar')) };
      block.dashboardId = undefined;
      block.chartId = undefined;
      markReportDirty(r);
      toast('已转为报告内配置，可改数据集与编码', 'ok');
      renderReportInspector(el);
      refreshReportSelectedChart();
    };
    el.querySelector('#rptDash').onchange = e => {
      block.dashboardId = e.target.value;
      const p = dashOpts.find(o => o.dash.id === block.dashboardId);
      const first = p?.charts?.[0];
      if (first) {
        block.chartId = first.id;
        block.chartTitle = first.title;
        block.title = first.title + '（引用）';
      }
      markReportDirty(r);
      state.reportSelectedBlockId = block.id;
      render();
    };
    el.querySelector('#rptCh').onchange = e => {
      const p = dashOpts.find(o => o.dash.id === block.dashboardId);
      const c = p?.charts?.find(x => x.id === e.target.value);
      if (!c) return;
      block.chartId = c.id;
      block.chartTitle = c.title;
      block.title = c.title + '（引用）';
      markReportDirty(r);
      const card = document.querySelector(`[data-rc="${block.id}"] strong`);
      if (card) card.textContent = block.title;
      refreshReportSelectedChart();
    };
    el.querySelector('#rptCt').onchange = e => {
      block.title = e.target.value;
      markReportDirty(r);
      const card = document.querySelector(`[data-rc="${block.id}"] strong`);
      if (card) card.textContent = block.title;
    };
    return;
  }

  // inline：完整数据面板（对齐仪表盘）
  const ch = reportBlockAsChart(block);
  migrateTableEncode(ch);
  const dataset = ds(ch.datasetId);
  const meta = CHART_META[ch.chartType] || CHART_META.bar;
  const miss = missingBind(ch);
  el.innerHTML = `
    <div class="sec">
      <h4>来源</h4>
      <div class="field"><label>模式</label>
        <select id="rptSrcMode">
          <option value="inline" selected>报告内配置</option>
          <option value="dashboard">改为引用看板图</option>
        </select>
      </div>
    </div>
    <div class="sec">
      <h4>图表</h4>
      <div class="field"><label>标题</label><input id="ct" value="${esc(ch.title)}" /></div>
      <div class="field"><label>类型</label>
        <select id="ctype">${Object.entries(CHART_META).map(([k,v]) => `<option value="${k}" ${ch.chartType===k?'selected':''}>${v.label}</option>`).join('')}</select>
      </div>
    </div>
    <div class="sec">
      <h4>1. 数据集</h4>
      <div class="field">
        <select id="cds">
          <option value="">请选择</option>
          ${Object.values(DATASETS).map(d => `<option value="${d.id}" ${ch.datasetId===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      ${ch.datasetId ? `<div style="font-size:11px;color:var(--text-3)">当前：${esc(dataset?.name || ch.datasetId)}</div>` : ''}
    </div>
    ${dataset ? `
    <div class="sec">
      <h4>2. 字段银行（常驻）</h4>
      ${fieldBankHtml(ch)}
    </div>
    <div class="sec">
      <h4>3. 编码槽 ${ch.chartType === 'table' ? '· 维度 + 指标' : (meta?.need?.length ? '· 需 ' + meta.need.map(s => slotLabel(ch.chartType, s)).join(' + ') : '')}</h4>
      ${encodeGuideHtml(ch)}
      ${ch.chartType === 'pivot' ? slotHtml('category', '行维度', 'dim', ch) : ''}
      ${ch.chartType === 'pivot' ? slotHtml('colDim', '列维度', 'dim', ch) : ''}
      ${ch.chartType === 'table' ? slotHtml('category', '表格列 / 维度', 'dim', ch) : ''}
      ${ch.chartType === 'table' ? slotHtml('value', '表格列 / 指标', 'quota', ch) : ''}
      ${ch.chartType !== 'pivot' && ch.chartType !== 'table' && meta.need.includes('category') ? slotHtml('category', '维度', 'dim', ch) : ''}
      ${ch.chartType !== 'pivot' && ch.chartType !== 'table' ? slotHtml('value', '指标', 'quota', ch) : ''}
      ${ch.chartType !== 'table' ? `<div class="field"><label>聚合</label>
        <select id="agg">${['SUM','COUNT','AVG','MAX','MIN'].map(a => `<option ${ (ch.encode.agg||'SUM')===a?'selected':''}>${a}</option>`).join('')}</select>
      </div>` : ''}
      <div class="field"><label>数值格式</label>
        <select id="fmt">
          <option value="raw" ${ch.encode.format==='raw'?'selected':''}>智能（默认）</option>
          <option value="integer" ${ch.encode.format==='integer'?'selected':''}>整数</option>
          <option value="thousand" ${ch.encode.format==='thousand'?'selected':''}>千分位</option>
          <option value="fixed1" ${ch.encode.format==='fixed1'?'selected':''}>一位小数</option>
          <option value="fixed2" ${ch.encode.format==='fixed2'?'selected':''}>两位小数</option>
          <option value="percent" ${ch.encode.format==='percent'?'selected':''}>百分比</option>
        </select>
      </div>
    </div>` : ''}
    ${miss.length ? `<div class="miss"><b>缺失要素</b>${miss.map(m=>`<div style="margin-top:4px">→ ${esc(m.label)}</div>`).join('')}</div>` : ''}`;

  el.querySelector('#rptSrcMode').onchange = e => {
    if (e.target.value !== 'dashboard') return;
    block.source = 'dashboard';
    block.dashboardId = 'dash_region';
    const city = findDashChartByTitle('dash_region', '城市销售额');
    block.chartId = city?.id || '';
    block.chartTitle = city?.title || '';
    markReportDirty(r);
    toast('已改为引用看板图', 'ok');
    render();
    state.reportSelectedBlockId = block.id;
  };
  el.querySelector('#ct').onchange = e => { ch.title = e.target.value; patchChart(ch, { inspector: false }); };
  el.querySelector('#ctype').onchange = e => {
    ch.chartType = e.target.value;
    ch.encode = { ...defaultEncode(ch.chartType), calc: ch.encode.calc || 'none' };
    block.encode = ch.encode;
    if (!ch.datasetId) ch.datasetId = defaultDatasetId();
    patchChart(ch, { inspector: true });
  };
  el.querySelector('#cds').onchange = e => {
    ch.datasetId = e.target.value || null;
    block.encode = ch.datasetId ? defaultEncode(ch.chartType) : { agg: 'SUM', format: 'raw', calc: 'none' };
    ch.encode = block.encode;
    toast(ch.datasetId ? '已选数据集并套用默认字段' : '已清空', 'ok');
    patchChart(ch, { inspector: true });
  };
  if (dataset) {
    el.querySelector('#agg') && (el.querySelector('#agg').onchange = e => {
      ch.encode.agg = e.target.value; patchChart(ch, { inspector: false });
    });
    el.querySelector('#fmt').onchange = e => {
      ch.encode.format = e.target.value; patchChart(ch, { inspector: false });
    };
    wireSlots(el, ch);
  }
}

function renderReportStylePanel(el, block) {
  el.innerHTML = `
    <div class="sec">
      <h4>样式</h4>
      <div class="field"><label>显示标题</label><input id="stTitle" value="${esc(block.title || '')}" /></div>
      <div class="field"><label>高度 (px)</label><input id="stH" type="number" min="160" max="560" value="${block.height || 280}" /></div>
      <p style="font-size:11px;color:#86909c;line-height:1.5;margin:8px 0 0">报告块展示壳；图内系列色等仍跟图表类型默认主题（高保简化）。</p>
    </div>`;
  el.querySelector('#stTitle').onchange = e => {
    block.title = e.target.value;
    markReportDirty(currentReport());
    const card = document.querySelector(`[data-rc="${block.id}"] strong`);
    if (card) card.textContent = block.title;
  };
  el.querySelector('#stH').onchange = e => {
    block.height = Math.max(160, Math.min(560, +e.target.value || 280));
    markReportDirty(currentReport());
    const bd = document.querySelector(`[data-echart-rpt="${block.id}"]`);
    if (bd) {
      bd.style.height = block.height + 'px';
      paintReportChartBlock(bd, block);
      const inst = state.chartInst['rpt_' + block.id];
      try { inst?.resize(); } catch (_) {}
    }
  };
}

function renderReportSeniorPanel(el, block) {
  el.innerHTML = `
    <div class="sec">
      <h4>高级</h4>
      <p style="font-size:12px;color:#4e5969;line-height:1.6;margin:0 0 10px">
        来源：<b>${block.source === 'dashboard' ? '引用看板' : '仅报告'}</b><br/>
        ${block.source === 'dashboard'
          ? `看板 ${esc(block.dashboardId)} / 图 ${esc(block.chartTitle || block.chartId)}`
          : `数据集 ${esc(block.datasetId)} · ${esc(block.chartType)}`}
      </p>
      <button class="btn" id="rptAdvRefresh" style="width:100%;margin-bottom:8px">刷新取数</button>
      <button class="btn danger" id="rptAdvDel" style="width:100%">删除此图表块</button>
    </div>`;
  el.querySelector('#rptAdvRefresh').onclick = () => {
    refreshReportSelectedChart();
    toast('已刷新', 'ok');
  };
  el.querySelector('#rptAdvDel').onclick = () => {
    const r = currentReport();
    syncReportDocToModel(r);
    r.blocks = r.blocks.filter(b => b.id !== block.id);
    if (!r.blocks.length) {
      r.blocks.push({ type: 'heading', level: 1, text: r.name || '未命名报告' });
      r.blocks.push({ type: 'paragraph', text: '' });
    }
    state.reportSelectedBlockId = null;
    markReportDirty(r);
    toast('已删除', 'ok');
    render();
  };
}

function statusTag(st) {
  if (st === 'published') return '<span class="tag pub">已发布</span>';
  if (st === 'publishedWithDraft') return '<span class="tag dirty">已发布·有未发布改动</span>';
  return '<span class="tag draft">草稿</span>';
}

function renderList(app) {
  const q = state.search.trim();
  const folders = [...new Set(state.dashboards.map(d => d.folder || '未分组'))];
  const list = state.dashboards.filter(d => {
    if (state.folderFilter !== 'all' && (d.folder || '未分组') !== state.folderFilter) return false;
    return !q || d.name.includes(q) || (d.desc || '').includes(q);
  });
  const d = currentDash();
  if (d && state.dash?.id !== d.id) selectDash(d.id);
  const chartCount = Object.keys(d.charts || {}).length;
  const dsNames = (d.datasetIds || []).map(id => DATASETS[id]?.name || id).join('、') || '—';
  const sampleDs = DATASETS[(d.datasetIds || [])[0]] || dsOrFirst();
  const dim = sampleDs.fields.find(f => f.group === 'dim')?.name;
  const quota = sampleDs.fields.find(f => f.group === 'quota')?.name;
  app.innerHTML = `
    <div class="manage">
      <div class="bar">
        <strong style="font-size:14px">仪表盘</strong>
        <span class="crumb">场景库 · 编辑器能力不变，仅扩充列表</span>
        <div class="spacer"></div>
        <input class="search-inline" id="dashSearch" placeholder="搜索仪表盘" value="${esc(state.search)}" />
        <button class="btn primary" id="btnNew">+ 新建</button>
      </div>
      <div class="list-layout">
        <div class="tree">
          <div class="tree-item ${state.folderFilter==='all'?'on':''}" data-ff="all">全部（${state.dashboards.length}）</div>
          ${folders.map(f => {
            const n = state.dashboards.filter(x => (x.folder || '未分组') === f).length;
            return `<div class="tree-item ${state.folderFilter===f?'on':''}" data-ff="${esc(f)}">${esc(f)} <span class="sub">${n} 个</span></div>`;
          }).join('')}
          <div class="tree-sec">列表</div>
          ${list.map(x => `
            <div class="tree-item ${x.id===d.id?'on':''}" data-dash="${x.id}">
              ${esc(x.name)}${(x.mobile && x.mobile.enabled) ? ' · 移动' : ''}
              <span class="sub">${esc(x.folder || '')} · ${x.status === 'draft' ? '草稿' : x.status === 'publishedWithDraft' ? '有改动' : '已发布'}</span>
            </div>`).join('') || '<div class="tree-item">无匹配</div>'}
        </div>
        <div class="detail">
          <div class="detail-hero" style="flex-direction:column;align-items:stretch">
            <div>
              <h2 style="margin-bottom:6px">${esc(d.name)}${(d.mobile && d.mobile.enabled) ? '<span class="tag mob">移动端</span>' : ''}</h2>
              <p style="color:var(--text-2);font-size:13px;margin-bottom:12px">${esc(d.desc || '—')} · ${statusTag(d.status)}</p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn primary" id="btnEdit">编辑</button>
                <button type="button" class="btn" id="btnPrev" title="${d.status==='draft'?'草稿尚未发布，点击查看说明':'打开已发布只读预览'}">预览已发布</button>
                <button type="button" class="btn" id="btnShareList">分享</button>
              </div>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-card"><div class="k">图表数</div><div class="v">${chartCount}</div></div>
            <div class="meta-card"><div class="k">数据集</div><div class="v" style="font-size:12px">${esc(dsNames)}</div></div>
            <div class="meta-card"><div class="k">更新</div><div class="v" style="font-size:12px">${esc(d.updateBy)} · ${esc(d.updateTime || '')}</div></div>
            <div class="meta-card"><div class="k">分享</div><div class="v">${d.share ? '已开启' : '未开启'}</div></div>
          </div>
          <div class="preview-mini">
            <div style="font-size:12px;color:var(--text-2);font-weight:600">场景缩略（示例聚合）</div>
            ${dim && quota ? sparkHtml(sampleDs.rows, dim, quota) : ''}
            <div style="margin-top:10px;font-size:11px;color:var(--text-3)">双击左侧名称可直接进入编辑 · 画布逻辑与原先一致</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" id="btnDup">复制场景</button>
            <button class="btn danger" id="btnDel" ${state.dashboards.length<=1?'disabled':''}>删除</button>
            <button class="btn ghost" id="btnToDs">查看关联数据集</button>
          </div>
        </div>
      </div>
    </div>`;
  app.querySelector('#dashSearch').oninput = e => { state.search = e.target.value; render(); };
  app.querySelectorAll('[data-ff]').forEach(el => el.onclick = () => { state.folderFilter = el.dataset.ff; render(); });
  app.querySelectorAll('[data-dash]').forEach(el => {
    el.onclick = () => { selectDash(el.dataset.dash); render(); };
    el.ondblclick = () => { selectDash(el.dataset.dash); state.screen = 'editor'; render(); };
  });
  app.querySelector('#btnEdit').onclick = () => { state.module = 'dashboard'; state.screen = 'editor'; render(); };
  app.querySelector('#btnPrev').onclick = () => openPublishedPreview('list');
  app.querySelector('#btnShareList').onclick = () => openShareModal();
  app.querySelector('#btnNew').onclick = () => createBlankDash();
  app.querySelector('#btnDup').onclick = () => {
    const copy = packDash(clone(d), {
      folder: d.folder, desc: (d.desc || '') + '（副本）',
      updateBy: '当前用户', updateTime: '刚刚'
    });
    copy.id = uid('dash');
    copy.name = d.name + ' 副本';
    copy.status = 'draft';
    copy.share = null;
    state.dashboards.unshift(copy);
    selectDash(copy.id);
    toast('已复制场景', 'ok');
    render();
  };
  app.querySelector('#btnDel').onclick = () => {
    if (state.dashboards.length <= 1) return;
    state.dashboards = state.dashboards.filter(x => x.id !== d.id);
    selectDash(state.dashboards[0].id);
    toast('已删除', 'ok');
    render();
  };
  app.querySelector('#btnToDs').onclick = () => {
    state.datasetId = (d.datasetIds || [])[0] || defaultDatasetId();
    gotoModule('dataset');
  };
}

function renderEditor(app) {
  const d = state.dash;
  const mob = ensureMobile(d);
  const isMob = state.phase !== 'a' && state.editSurface === 'mobile';
  const leftCompLabel = isMob ? '组件池' : '组件';
  app.innerHTML = `
    <div class="bar bar-editor ${editorShellClass()}">
      <div class="bar-leading">
        <button class="btn ghost" id="toList" title="返回仪表盘" aria-label="返回仪表盘">←</button>
        <b contenteditable="true" id="title" title="${esc(d.name)}">${esc(d.name)}</b>
        ${statusTag(d.status)}
        ${mob.enabled ? '<span class="tag mob">移动端</span>' : ''}
      </div>
      <div class="bar-mid"></div>
      <div class="bar-actions">
        ${state.phase !== 'a' ? `<div class="seg2" id="surfaceSeg">
          <button type="button" data-sf="pc" class="${!isMob?'on':''}">PC布局</button>
          <button type="button" data-sf="mobile" class="${isMob?'on':''}">移动布局</button>
        </div>` : ''}
        <button class="btn ghost" id="btnUndo">撤销</button>
        <button class="btn" id="btnPreview">预览</button>
        <button class="btn ghost" id="btnShare">分享</button>
        <button class="btn primary" id="btnPub">发布</button>
        <div id="editorShellHost" class="bar-shell-host" aria-hidden="true"></div>
      </div>
    </div>
    <div class="editor ${editorShellClass()}">
      <aside class="pane left-pane">
        <div class="left-pane-full">
          <div class="ptabs">
            <button type="button" class="${state.leftTab==='comp'?'on':''}" data-lt="comp">${leftCompLabel}</button>
            <button type="button" class="${state.leftTab==='layer'?'on':''}" data-lt="layer">图层</button>
            ${paneFoldBtn('left', '收起组件库')}
          </div>
          <div class="pbody" id="left"></div>
          <div class="left-guide-foot">
            <button type="button" class="btn ghost" id="btnGuide">？ 新手指引</button>
          </div>
        </div>
        ${leftDockHtml(leftCompLabel)}
      </aside>
      <section class="stage ${isMob?'mobile-stage':''}">
        <div class="layout-bar" id="layoutBar"></div>
        <div class="canvas-wrap ${isMob?'mobile-edit':''}" id="cwrap">
          ${isMob ? '' : '<div class="tab-strip" id="tabStrip"></div>'}
          ${isMob ? phoneShellHtml(mob, { mode: 'edit' }) : `<div class="board" id="board"></div>`}
        </div>
      </section>
      <aside class="pane insp">
        <div class="pbody" id="right"></div>
      </aside>
    </div>`;

  app.querySelector('#toList').onclick = () => { state.module = 'dashboard'; state.screen = 'list'; state.editSurface = 'pc'; render(); };
  app.querySelector('#btnGuide')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('od:open-dashboard-guide')));
  wireLeftPaneChrome(app);
  app.querySelector('#btnUndo').onclick = undo;
  app.querySelector('#btnPreview').onclick = () => openPublishedPreview('editor');
  app.querySelector('#btnShare').onclick = () => openShareModal();
  app.querySelector('#btnPub').onclick = () => openPublishModal();
  app.querySelector('#title').onblur = e => {
    const n = e.target.textContent.trim();
    if (n && n !== d.name) { pushUndo(); d.name = n; markDirty(); toast('已重命名', 'ok'); }
  };
  app.querySelectorAll('[data-sf]').forEach(b => b.onclick = () => {
    state.editSurface = b.dataset.sf;
    state.selectedId = null;
    if (state.editSurface === 'mobile') ensureMobile(d).enabled = true;
    render();
  });

  app.querySelectorAll('[data-lt]').forEach(b => b.onclick = () => {
    state.leftTab = b.dataset.lt;
    app.querySelectorAll('[data-lt]').forEach(x => x.classList.toggle('on', x.dataset.lt === state.leftTab));
    renderLeft(document.getElementById('left'));
  });
  renderLayoutBar(app.querySelector('#layoutBar'));
  renderLeft(app.querySelector('#left'));
  if (app.querySelector('#tabStrip')) renderTabStrip(app.querySelector('#tabStrip'));
  if (isMob) {
    ensureMobileKpiRoom();
    renderBoard(app.querySelector('#board'));
    wirePhoneDeviceSwitch(app);
    // 等 DOM/高度稳定后再按比例适配机框，避免下方留白
    requestAnimationFrame(() => fitMobilePhone());
  } else {
    renderBoard(app.querySelector('#board'));
  }
  renderRight(app.querySelector('#right'));
  syncEditorChrome();
  wireKeyboardLayout();
}

function renderLayoutBar(el) {
  if (!el) return;
  const L = state.layout;
  const mob = ensureMobile(state.dash);
  const deviceBar = isMobileEdit()
    ? `<label class="tog" style="gap:6px">机型
        <select id="layDevice" style="height:28px;border:1px solid var(--line);border-radius:6px;padding:0 6px;max-width:220px">
          ${mobileDeviceOptgroupsHtml(mob.device)}
        </select>
      </label>`
    : '';
  el.innerHTML = `
    ${deviceBar}
    <button class="btn ghost" id="toggleLeft" title="${state.leftCollapsed ? '展开左侧组件库' : '收起左侧组件库'}">${state.leftCollapsed ? '显示组件' : '收起组件'}</button>
    <button class="btn ghost" id="toggleInsp" title="${state.inspCollapsed ? '展开右侧配置' : '收起右侧配置'}">${state.inspCollapsed ? '显示配置' : '收起配置'}</button>
    <button class="btn ghost" id="layCompact" title="消除纵向空隙">自动紧凑</button>
    <button class="btn ghost" id="layFull" title="选中组件拉满整行">整行</button>
    <button class="btn ghost" id="layHalf" title="选中组件半宽">半宽</button>
    <button class="btn ghost" id="layThird" title="选中组件 1/3 宽">1/3</button>
    <label class="tog"><input type="checkbox" id="layPush" ${L.push?'checked':''}/> 推挤</label>
    <label class="tog"><input type="checkbox" id="layAuto" ${L.compactOnDrop?'checked':''}/> 落位紧凑</label>
    <label class="tog"><input type="checkbox" id="layGrid" ${L.showGrid?'checked':''}/> 网格</label>
    <span class="hint">${isMobileEdit() ? '顶栏选 iOS / Android / Pad 机型（含中兴平板）' : '拖拽移动 · 八向缩放 · 方向键微调 · 组件库可拖入画布'}</span>`;
  el.querySelector('#toggleLeft').onclick = () => {
    state.leftCollapsed = !state.leftCollapsed;
    syncEditorChrome();
  };
  el.querySelector('#toggleInsp').onclick = () => {
    state.inspCollapsed = !state.inspCollapsed;
    state.inspUserToggled = true;
    syncEditorChrome();
    if (!state.inspCollapsed) renderRight(document.getElementById('right'));
  };
  el.querySelector('#layDevice')?.addEventListener('change', e => {
    if (setMobileDevice(e.target.value)) render();
  });
  el.querySelector('#layCompact').onclick = () => {
    pushUndo();
    commitLayout(compactLayout(tabComps()));
    markDirty(); render(); toast('已自动紧凑', 'ok');
  };
  const preset = (w) => {
    const comp = findComp(state.selectedId);
    if (!comp) { toast('请先选中组件', 'warn'); return; }
    pushUndo();
    const min = minWH(comp);
    const cols = gridCols();
    const target = Math.min(cols, w);
    let nw = Math.max(min.w, Math.min(cols, target));
    let nx = comp.x;
    if (nx + nw > cols) nx = cols - nw;
    let layout = tabComps().map(c => c.id === comp.id ? { ...c, w: nw, x: nx } : { ...c });
    if (state.layout.push) layout = pushLayout(layout, comp.id);
    if (state.layout.compactOnDrop) layout = compactLayout(layout);
    commitLayout(layout);
    markDirty(); render();
  };
  const cols = gridCols();
  el.querySelector('#layFull').onclick = () => preset(cols);
  el.querySelector('#layHalf').onclick = () => preset(Math.max(1, Math.floor(cols / 2)));
  el.querySelector('#layThird').onclick = () => preset(Math.max(1, Math.floor(cols / 3)));
  el.querySelector('#layPush').onchange = e => { state.layout.push = e.target.checked; };
  el.querySelector('#layAuto').onchange = e => { state.layout.compactOnDrop = e.target.checked; };
  el.querySelector('#layGrid').onchange = e => { state.layout.showGrid = e.target.checked; };
}

function wireKeyboardLayout() {
  if (window.__layKeyWired) return;
  window.__layKeyWired = true;
  document.addEventListener('keydown', e => {
    if (state.screen !== 'editor') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    const comp = findComp(state.selectedId);
    if (!comp) return;
    const step = e.shiftKey ? 2 : 1;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      pushUndo();
      deleteSelectedComp(comp);
      markDirty(); render(); toast('已删除', 'ok');
      return;
    } else return;
    e.preventDefault();
    pushUndo();
    const nx = Math.max(0, Math.min(gridCols() - comp.w, comp.x + dx));
    const ny = Math.max(0, comp.y + dy);
    let layout = tabComps().map(c => c.id === comp.id ? { ...c, x: nx, y: ny } : { ...c });
    if (state.layout.push) layout = pushLayout(layout, comp.id);
    commitLayout(layout);
    markDirty();
    const board = document.getElementById('board');
    paintPositions(board, layout, colW(board));
    Object.values(state.chartInst).forEach(c => { try { c.resize(); } catch (_) {} });
    renderRight(document.getElementById('right'));
  });
}

function renderTabStrip(el) {
  if (!el) return;
  const d = state.dash;
  const show = state.phase !== 'a' && d.tabs.length > 0;
  el.classList.toggle('show', show);
  if (!show) { el.innerHTML = ''; return; }
  const readonly = isPreviewReadonly();
  const canClose = !readonly && d.tabs.length > 1;
  el.innerHTML = d.tabs.map(t => {
    const on = t.id === d.activeTab;
    return `<div class="tab-item ${on ? 'on' : ''}" data-tab="${t.id}">
      <button type="button" class="tab-lab" data-tab-switch="${t.id}" ${readonly ? '' : 'title="双击重命名"'}>${esc(t.name)}</button>
      ${canClose ? `<button type="button" class="tab-close" data-tab-del="${t.id}" title="删除页签">×</button>` : ''}
    </div>`;
  }).join('') + (readonly ? '' : `<button type="button" class="tab-add" id="tabAdd" title="新建页签">+</button>`);

  el.querySelectorAll('[data-tab-switch]').forEach(b => {
    b.onclick = () => {
      d.activeTab = b.dataset.tabSwitch;
      state.selectedId = null;
      render();
    };
    if (readonly) return;
    b.ondblclick = e => {
      e.preventDefault();
      e.stopPropagation();
      const tab = d.tabs.find(t => t.id === b.dataset.tabSwitch);
      if (!tab) return;
      const name = prompt('页签名称', tab.name);
      if (name == null) return;
      const next = name.trim();
      if (!next || next === tab.name) return;
      pushUndo();
      tab.name = next;
      markDirty();
      render();
    };
  });
  if (readonly) return;
  el.querySelectorAll('[data-tab-del]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      deleteTab(b.dataset.tabDel);
    };
  });
  el.querySelector('#tabAdd')?.addEventListener('click', () => addComp('tab'));
}

/** 删除页签及其下组件；至少保留一个页签 */
function deleteTab(tabId) {
  const d = state.dash;
  if (!d || d.tabs.length <= 1) {
    toast('至少保留一个页签', 'warn');
    return;
  }
  const tab = d.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const comps = d.components.filter(c => (c.tabId || 'tab_main') === tabId);
  const hint = comps.length
    ? `删除页签「${tab.name}」将同时删除其中 ${comps.length} 个组件，确定？`
    : `确定删除页签「${tab.name}」？`;
  if (!confirm(hint)) return;
  pushUndo();
  // 先删组件与图表
  comps.forEach(c => {
    if (c.chartId) delete d.charts[c.chartId];
    removeFromMobileLayout(c.id);
  });
  d.components = d.components.filter(c => (c.tabId || 'tab_main') !== tabId);
  d.tabs = d.tabs.filter(t => t.id !== tabId);
  if (d.activeTab === tabId) {
    d.activeTab = d.tabs[0]?.id || 'tab_main';
  }
  if (state.selectedId && comps.some(c => c.id === state.selectedId)) {
    state.selectedId = null;
  }
  markDirty();
  render();
  toast(`已删除页签「${tab.name}」`, 'ok');
}

function allDimFields() {
  const uniq = [];
  const seen = new Set();
  Object.values(DATASETS).forEach(d => {
    (d.fields || []).filter(f => f.group === 'dim').forEach(f => {
      if (seen.has(f.name)) return;
      seen.add(f.name);
      uniq.push({ name: f.name, label: f.label || f.name, datasetId: d.id });
    });
  });
  return uniq;
}

function queryItemControlHtml(it) {
  normalizeQueryItem(it);
  const label = it.label || it.field || '筛选项';
  const qid = it.id;
  if (it.kind === 'dateRange') {
    const ph = it.placeholder || '全部日期';
    return `<label class="q-item"><span>${esc(label)}</span>
      <input type="date" data-qkind="dateFrom" data-qfield="${esc(it.field || 'date')}" data-qitem="${esc(qid)}" value="${esc(state.filter.dateFrom || it.fromDefault || '')}" placeholder="${esc(ph)}" />
      <span>~</span>
      <input type="date" data-qkind="dateTo" data-qfield="${esc(it.field || 'date')}" data-qitem="${esc(qid)}" value="${esc(state.filter.dateTo || it.toDefault || '')}" placeholder="${esc(ph)}" />
    </label>`;
  }
  const field = it.field || '';
  const cur = field ? (state.filter[field] || '') : '';
  const opts = field ? slicerOptions(field) : [];
  return `<label class="q-item"><span>${esc(label)}</span>
    <select data-qkind="select" data-qfield="${esc(field)}" data-qitem="${esc(qid)}">
      <option value="">全部</option>
      ${opts.map(o => `<option value="${esc(o)}" ${cur===o?'selected':''}>${esc(o)}</option>`).join('')}
    </select>
  </label>`;
}

function findQueryItem(comp, itemId) {
  return (comp.props?.items || []).find(it => it.id === itemId);
}

function wireQuery(el, comp) {
  el.querySelectorAll('[data-qkind]').forEach(inp => {
    const apply = () => {
      const kind = inp.dataset.qkind;
      const field = inp.dataset.qfield || '';
      const item = findQueryItem(comp, inp.dataset.qitem) || { field, kind: 'select', scope: 'all' };
      normalizeQueryItem(item);
      setFilterMetaForItem(item);
      if (kind === 'dateFrom') {
        state.filter.dateFrom = inp.value;
        if (field) state.filter._dateField = field;
      } else if (kind === 'dateTo') {
        state.filter.dateTo = inp.value;
        if (field) state.filter._dateField = field;
      } else if (kind === 'select' && field) {
        state.filter[field] = inp.value;
      }
      repaintAllCharts();
    };
    inp.onmousedown = e => e.stopPropagation();
    inp.onclick = e => e.stopPropagation();
    inp.onchange = apply;
  });
}

function queryBindSummary(it, charts) {
  const targets = effectiveTargets(it, charts);
  if (!it.field) return '请先选择查询字段';
  if (!targets.length) return '未绑定任何图表';
  const names = targets
    .map(id => charts.find(c => c.chartId === id)?.title || id)
    .slice(0, 3);
  const more = targets.length > 3 ? ` 等 ${targets.length} 个` : '';
  const mode = it.scope === 'custom' ? '自定义' : '默认';
  return `${mode} · ${names.join('、')}${more}`;
}

function openChartFilterModal(ch) {
  if (!ch?.datasetId) {
    toast('请先选择数据集', 'warn');
    return;
  }
  const dataset = ds(ch.datasetId);
  const fields = dataset?.fields || [];
  if (!fields.length) {
    toast('当前数据集无字段', 'warn');
    return;
  }
  const draft = ensureChartFilters(ch).map(f => ({ ...f }));
  if (!draft.length) draft.push({ id: uid('cf'), field: fields[0].name, op: 'eq', value: '' });

  const renderList = () => {
    const list = document.getElementById('cfList');
    if (!list) return;
    list.innerHTML = draft.map((f, idx) => {
      const needVal = chartFilterNeedsValue(f.op);
      return `<div class="cf-row" data-cf-idx="${idx}">
        <select data-cf="field">
          ${fields.map(fd => `<option value="${esc(fd.name)}" ${f.field===fd.name?'selected':''}>${esc(fd.label || fd.name)}</option>`).join('')}
        </select>
        <select data-cf="op">
          ${CHART_FILTER_OPS.map(o => `<option value="${o.value}" ${f.op===o.value?'selected':''}>${o.label}</option>`).join('')}
        </select>
        <input data-cf="value" type="text" ${needVal ? '' : 'disabled'} value="${esc(f.value || '')}" placeholder="${needVal ? '条件值' : '—'}" />
        <button type="button" class="btn ghost" data-cf-del title="删除">×</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.cf-row').forEach(row => {
      const idx = +row.dataset.cfIdx;
      row.querySelector('[data-cf="field"]').onchange = e => { draft[idx].field = e.target.value; };
      row.querySelector('[data-cf="op"]').onchange = e => {
        draft[idx].op = e.target.value;
        renderList();
      };
      row.querySelector('[data-cf="value"]').oninput = e => { draft[idx].value = e.target.value; };
      row.querySelector('[data-cf-del]').onclick = () => {
        draft.splice(idx, 1);
        renderList();
      };
    });
  };

  showModal(`
    <h3>过滤条件 · ${esc(ch.title || '图表')}</h3>
    <p style="font-size:12px;color:var(--text-2);margin:-4px 0 12px;line-height:1.5">
      条件作用于本图表查询前的明细行，与页面查询条件、图间联动叠加生效（AND）。
    </p>
    <div class="cf-list" id="cfList"></div>
    <div class="q-bind-actions" style="margin:10px 0 0">
      <button type="button" class="btn ghost" id="cfAdd" style="height:28px">+ 添加条件</button>
    </div>
    <div class="actions">
      <button type="button" class="btn ghost" id="cfCancel">取消</button>
      <button type="button" class="btn primary" id="cfOk">保存</button>
    </div>
  `, { wide: true });

  renderList();
  document.getElementById('cfAdd').onclick = () => {
    draft.push({ id: uid('cf'), field: fields[0].name, op: 'eq', value: '' });
    renderList();
  };
  document.getElementById('cfCancel').onclick = hideModal;
  document.getElementById('cfOk').onclick = () => {
    pushUndo();
    ch.encode.filters = draft
      .filter(f => f.field)
      .map(f => ({
        id: f.id || uid('cf'),
        field: f.field,
        op: f.op || 'eq',
        value: chartFilterNeedsValue(f.op) ? String(f.value ?? '') : ''
      }));
    markChartPending(ch.id);
    markDirty();
    hideModal();
    renderRight(document.getElementById('right'));
  };
}

function openQueryBindModal(comp, itemIndex) {
  const items = comp.props?.items || [];
  const it = items[itemIndex];
  if (!it) return;
  normalizeQueryItem(it);
  const charts = pageChartOptions();
  const draftIds = new Set(effectiveTargets(it, charts));
  const draftMap = { ...(it.fieldMap || {}) };
  draftIds.forEach(id => {
    if (!draftMap[id]) draftMap[id] = it.field;
  });

  const rowsHtml = charts.length
    ? charts.map(c => {
      const has = chartHasField(c.chartId, it.field);
      const checked = draftIds.has(c.chartId);
      const mapField = draftMap[c.chartId] || it.field || '';
      const fieldOpts = c.dimFields.length
        ? c.dimFields
        : (mapField ? [{ name: mapField, label: mapField }] : []);
      return `<div class="q-bind-row ${has ? '' : 'weak'}">
        <label class="q-bind-check">
          <input type="checkbox" data-qt="${esc(c.chartId)}" ${checked ? 'checked' : ''} />
        </label>
        <div class="q-bind-meta">
          <div class="q-bind-title">${esc(c.title)}</div>
          <div class="q-bind-ds">数据集：${esc(c.datasetName)}${c.datasetId ? ` · ${esc(c.datasetId)}` : ''}</div>
        </div>
        <select data-qmap="${esc(c.chartId)}">
          <option value="">匹配字段</option>
          ${fieldOpts.map(f => `<option value="${esc(f.name)}" ${mapField===f.name?'selected':''}>${esc(f.label)}（${esc(f.name)}）</option>`).join('')}
        </select>
      </div>`;
    }).join('')
    : '<p class="q-scope-hint">画布上还没有图表</p>';

  showModal(`
    <h3>配置作用图表 · ${esc(it.label || it.field || '筛选项')}</h3>
    <p style="font-size:12px;color:var(--text-2);margin:-4px 0 12px;line-height:1.5">
      勾选要过滤的图表，并为其选择匹配字段。查询字段：<b>${esc(it.field || '未选')}</b>
    </p>
    <div class="q-bind-actions" style="margin-bottom:10px">
      <button type="button" class="btn ghost" id="qbAll" style="height:28px">全选含字段</button>
      <button type="button" class="btn ghost" id="qbNone" style="height:28px">全不选</button>
      <button type="button" class="btn ghost" id="qbReset" style="height:28px">恢复默认</button>
      <span id="qbCount" class="q-scope-hint" style="margin-left:auto">${draftIds.size}/${charts.length} 已选</span>
    </div>
    <div class="q-bind-table" id="qbList">${rowsHtml}</div>
    <div class="actions">
      <button type="button" class="btn ghost" id="qbCancel">取消</button>
      <button type="button" class="btn primary" id="qbOk">保存</button>
    </div>
  `, { wide: true });

  const list = document.getElementById('qbList');
  const countEl = document.getElementById('qbCount');
  const refreshCount = () => {
    const n = list.querySelectorAll('[data-qt]:checked').length;
    if (countEl) countEl.textContent = `${n}/${charts.length} 已选`;
  };
  const setChecks = (ids) => {
    const set = new Set(ids);
    list.querySelectorAll('[data-qt]').forEach(cb => {
      cb.checked = set.has(cb.dataset.qt);
      const sel = list.querySelector(`[data-qmap="${CSS.escape(cb.dataset.qt)}"]`);
      if (sel && cb.checked && !sel.value && it.field) sel.value = it.field;
    });
    refreshCount();
  };

  document.getElementById('qbAll').onclick = () => {
    setChecks(charts.filter(c => chartHasField(c.chartId, it.field)).map(c => c.chartId));
  };
  document.getElementById('qbNone').onclick = () => setChecks([]);
  document.getElementById('qbReset').onclick = () => {
    setChecks(charts.filter(c => chartHasField(c.chartId, it.field)).map(c => c.chartId));
  };
  list.querySelectorAll('[data-qt]').forEach(cb => cb.onchange = refreshCount);
  document.getElementById('qbCancel').onclick = hideModal;
  document.getElementById('qbOk').onclick = () => {
    pushUndo();
    const nextIds = [];
    const nextMap = {};
    list.querySelectorAll('[data-qt]').forEach(cb => {
      if (!cb.checked) return;
      const id = cb.dataset.qt;
      nextIds.push(id);
      const sel = list.querySelector(`[data-qmap="${CSS.escape(id)}"]`);
      nextMap[id] = sel?.value || it.field || '';
    });
    const defaultIds = charts.filter(c => chartHasField(c.chartId, it.field)).map(c => c.chartId);
    const sameAsDefault =
      nextIds.length === defaultIds.length &&
      nextIds.every(id => defaultIds.includes(id)) &&
      nextIds.every(id => !nextMap[id] || nextMap[id] === it.field);
    it.scope = sameAsDefault ? 'all' : 'custom';
    it.targetChartIds = nextIds;
    it.fieldMap = nextMap;
    setFilterMetaForItem(it);
    markDirty();
    hideModal();
    toast('作用图表已保存', 'ok');
    replaceWidget(comp, { paint: false });
    renderRight(document.getElementById('right'));
    repaintAllCharts();
  };
}

function renderQueryPanel(el, comp) {
  if (!comp.props) comp.props = { label: '查询条件', items: [] };
  if (!Array.isArray(comp.props.items)) comp.props.items = [];
  const dims = allDimFields();
  const items = comp.props.items;
  items.forEach(normalizeQueryItem);
  const charts = pageChartOptions();

  el.innerHTML = `
    ${inspModeSegHtml()}
    <div class="insp-scroll">
    <div class="sec">
      <h4>查询控件</h4>
      <p style="font-size:11px;color:var(--text-3);line-height:1.5;margin:0 0 8px">
        筛选项基础信息在此配置；与图表的绑定关系点「配置作用图表」在弹窗中管理。
      </p>
      <div class="field"><label>标题</label><input id="qlabel" value="${esc(comp.props.label || '')}" placeholder="查询条件" /></div>
    </div>
    <div class="sec">
      <h4>筛选项 <span style="font-weight:400;color:var(--text-3)">${items.length}</span></h4>
      ${items.length ? items.map((it, idx) => `
        <div class="q-cfg" data-qi="${idx}">
          <div class="q-cfg-hd">
            <strong>${esc(it.label || it.field || `筛选项 ${idx + 1}`)}</strong>
            <button type="button" class="btn q-del" data-qdel title="删除此筛选项">删除</button>
          </div>
          <div class="field"><label>类型</label>
            <select data-qk>
              <option value="select" ${it.kind!=='dateRange'?'selected':''}>下拉筛选</option>
              <option value="dateRange" ${it.kind==='dateRange'?'selected':''}>日期范围</option>
            </select>
          </div>
          <div class="field"><label>显示名</label><input data-ql value="${esc(it.label || '')}" placeholder="可选" /></div>
          <div class="field"><label>查询字段</label>
            <select data-qf>
              <option value="">请选择字段</option>
              ${dims.map(f => `<option value="${esc(f.name)}" ${it.field===f.name?'selected':''}>${esc(f.label)}（${esc(f.name)}）</option>`).join('')}
            </select>
          </div>
          <div class="q-bind-summary">
            <div class="q-bind-summary-text">${esc(queryBindSummary(it, charts))}</div>
            <button type="button" class="btn" data-qbind style="height:28px" ${it.field ? '' : 'disabled'}>配置作用图表…</button>
          </div>
        </div>`).join('') : '<div style="padding:12px 0;font-size:12px;color:var(--text-3)">还没有筛选项，点下方按钮添加</div>'}
      <div class="preset-row" style="margin-top:10px;gap:6px">
        <button type="button" class="btn" id="qAddSelect" style="height:28px">+ 下拉筛选</button>
        <button type="button" class="btn" id="qAddDate" style="height:28px">+ 日期范围</button>
      </div>
    </div>
    </div>`;

  const refresh = () => { markDirty(); replaceWidget(comp, { paint: false }); renderRight(el); };

  wireInspMode(el);
  el.querySelector('#qlabel').onchange = e => {
    pushUndo();
    comp.props.label = e.target.value;
    refresh();
  };
  el.querySelectorAll('.q-cfg').forEach(row => {
    const idx = +row.dataset.qi;
    const it = items[idx];
    row.querySelector('[data-qk]').onchange = e => {
      pushUndo();
      it.kind = e.target.value;
      refresh();
    };
    row.querySelector('[data-ql]').onchange = e => {
      pushUndo();
      it.label = e.target.value;
      refresh();
    };
    row.querySelector('[data-qf]').onchange = e => {
      pushUndo();
      it.field = e.target.value;
      if (!it.label) {
        const f = dims.find(d => d.name === e.target.value);
        it.label = f?.label || e.target.value;
      }
      it.scope = 'all';
      it.targetChartIds = charts.filter(c => chartHasField(c.chartId, it.field)).map(c => c.chartId);
      it.fieldMap = {};
      setFilterMetaForItem(it);
      refresh();
    };
    row.querySelector('[data-qbind]')?.addEventListener('click', () => openQueryBindModal(comp, idx));
    row.querySelector('[data-qdel]').onclick = () => {
      pushUndo();
      if (it.field && state.filter[it.field] != null) state.filter[it.field] = '';
      if (it.kind === 'dateRange') {
        state.filter.dateFrom = '';
        state.filter.dateTo = '';
      }
      items.splice(idx, 1);
      refresh();
      repaintAllCharts();
    };
  });
  el.querySelector('#qAddSelect').onclick = () => {
    pushUndo();
    items.push({ id: uid('qf'), kind: 'select', field: '', label: '', scope: 'all', targetChartIds: [], fieldMap: {} });
    refresh();
  };
  el.querySelector('#qAddDate').onclick = () => {
    pushUndo();
    items.push({ id: uid('qf'), kind: 'dateRange', field: 'date', label: '日期', scope: 'all', targetChartIds: [], fieldMap: {} });
    refresh();
  };
}

function renderLeft(el) {
  if (state.leftTab === 'layer') {
    const comps = tabComps().slice().sort((a,b)=>a.z-b.z);
    el.innerHTML = comps.map(c => {
      const title = c.type === 'chart' ? (state.dash.charts[c.chartId]?.title || '图') : (c.props?.label || c.type);
      return `<div class="layer ${c.id===state.selectedId?'on':''}" data-sel="${c.id}">${c.type} · ${esc(title)} <small style="color:var(--text-3)">${c.w}×${c.h}</small></div>`;
    }).join('') || '<p style="color:var(--text-3);font-size:12px">暂无组件</p>';
    el.querySelectorAll('[data-sel]').forEach(n => n.onclick = () => selectComp(n.dataset.sel, { left: true }));
    return;
  }
  if (isMobileEdit()) {
    renderMobilePool(el);
    return;
  }
  const groups = {};
  Object.entries(CHART_META).forEach(([k,v]) => {
    (groups[v.group] = groups[v.group] || []).push([k,v]);
  });
  Object.entries(CHART_PRESETS).forEach(([k,v]) => {
    (groups[v.group] = groups[v.group] || []).push([k,v]);
  });
  let html = `<div class="sec"><h4>控件</h4><div class="comp">
    <div class="comp-card" data-add="query"><div class="thumb">${chartIcon('query')}</div><div class="name">查询控件</div><small>筛选条件</small></div>
    <div class="comp-card" data-add="slicer"><div class="thumb">${chartIcon('slicer')}</div><div class="name">切片器</div><small>单字段筛选</small></div>
    <div class="comp-card" data-add="text"><div class="thumb">${chartIcon('text')}</div><div class="name">文本</div><small>标题 / 说明</small></div>
    ${state.phase !== 'a' ? `<div class="comp-card" data-add="tab"><div class="thumb">${chartIcon('table')}</div><div class="name">Tab</div><small>容器</small></div>` : ''}
  </div></div>`;
  for (const g of ['指标', '比较', '表格', '分布', '趋势']) {
    const items = groups[g] || [];
    html += `<div class="sec"><h4>${g}</h4><div class="comp">`;
    for (const [k,v] of items) {
      html += `<div class="comp-card" data-add="${k}" title="${esc(v.guide || '')}">
        <div class="thumb">${chartIcon(v.icon)}</div>
        <div class="name">${esc(v.label)}</div>
      </div>`;
    }
    html += `</div></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = () => addComp(b.dataset.add);
    b.draggable = true;
    b.ondragstart = e => {
      state._dragKind = b.dataset.add;
      e.dataTransfer.setData('add-kind', b.dataset.add);
      e.dataTransfer.setData('text/plain', b.dataset.add);
      e.dataTransfer.effectAllowed = 'copy';
    };
    b.ondragend = () => { state._dragKind = null; hidePlaceholder(document.getElementById('board')); };
  });
}

function renderMobilePool(el) {
  const tab = state.dash.activeTab;
  const pcs = state.dash.components.filter(c => (c.tabId || 'tab_main') === tab);
  const m = ensureMobile(state.dash);
  const onIds = new Set(m.components.map(c => c.refId));
  el.innerHTML = `
    <div class="sec">
      <h4>移动端组件池</h4>
      <p style="font-size:11px;color:var(--text-3);line-height:1.5;margin-bottom:8px">勾选 PC 组件上板；数据与编码与 PC 共用，仅布局/可选样式独立。</p>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="btn" id="mobImportAll" style="height:28px">导入全部</button>
        <button type="button" class="btn ghost" id="mobClear" style="height:28px">清空</button>
      </div>
      ${pcs.map(pc => {
        const title = pc.type === 'chart' ? (state.dash.charts[pc.chartId]?.title || '图') : (pc.props?.label || pc.type);
        const kind = pc.type === 'chart' ? (state.dash.charts[pc.chartId]?.chartType || 'chart') : pc.type;
        const on = onIds.has(pc.id);
        return `<label class="mobile-pool-item ${on?'on':''}">
          <input type="checkbox" data-pc="${pc.id}" ${on?'checked':''}/>
          <span>${esc(title)}</span>
          <small>${esc(kind)}</small>
        </label>`;
      }).join('') || '<p style="font-size:12px;color:var(--text-3)">当前页签暂无 PC 组件</p>'}
    </div>`;
  el.querySelector('#mobImportAll').onclick = () => {
    pushUndo(); importAllToMobile(); markDirty(); render(); toast('已导入并重排', 'ok');
  };
  el.querySelector('#mobClear').onclick = () => {
    pushUndo(); clearMobileLayout(); state.selectedId = null; markDirty(); render(); toast('已清空移动布局', 'ok');
  };
  el.querySelectorAll('[data-pc]').forEach(inp => {
    inp.onchange = () => {
      pushUndo();
      if (inp.checked) addToMobileLayout(inp.dataset.pc);
      else removeFromMobileLayout(inp.dataset.pc);
      const mm = ensureMobile(state.dash);
      if (!mm.components.length) mm.enabled = false;
      else mm.enabled = true;
      markDirty(); render();
    };
  });
}

function addComp(kind, at) {
  if (isMobileEdit()) {
    toast('移动布局请从左侧组件池勾选上板', 'warn');
    return;
  }
  pushUndo();
  const d = state.dash;
  if (kind === 'tab') {
    const id = uid('tab');
    d.tabs.push({ id, name: '页签' + d.tabs.length });
    d.activeTab = id;
    state.selectedId = null;
    toast('已添加页签，可点页签右侧 × 删除', 'ok');
    markDirty(); render();
    return;
  }
  const preset = CHART_PRESETS[kind];
  const chartType = preset?.chartType || kind;
  const size = defaultSize(chartType);
  const slot = at || findFreeSlot(size.w, size.h);
  let x = Math.max(0, Math.min(gridCols() - size.w, at?.x ?? slot.x));
  let y = Math.max(0, at?.y ?? slot.y);
  let comp;
  if (kind === 'slicer') {
    const id = uid('w');
    comp = { id, type:'slicer', tabId:d.activeTab, x, y, w:size.w, h:size.h, z:d.components.length+1, props:{ field:'', label:'切片器' } };
  } else if (kind === 'query') {
    const id = uid('w');
    comp = {
      id, type: 'query', tabId: d.activeTab, x, y, w: size.w, h: size.h, z: d.components.length + 1,
      props: { label: '查询条件', items: [], align: 'center' }
    };
    state.rightTab = 'data';
  } else if (kind === 'text') {
    const id = uid('w');
    comp = { id, type:'text', tabId:d.activeTab, x, y, w:size.w, h:size.h, z:d.components.length+1, props:{ content:'' } };
  } else {
    const cid = uid('chart'), wid = uid('w');
    d.charts[cid] = {
      id: cid, title: preset?.label || CHART_META[chartType].label, chartType, datasetId: null,
      encode: emptyEncode(chartType),
      style: { ...styleDefaultsFor(chartType), ...(preset?.style || {}) }
    };
    comp = { id:wid, type:'chart', tabId:d.activeTab, x, y, w:size.w, h:size.h, z:d.components.length+1, chartId:cid };
    state.rightTab = 'data';
  }
  d.components.push(comp);
  state.selectedId = comp.id;
  let layout = tabComps().map(c => ({ ...c }));
  if (state.layout.push) layout = pushLayout(layout, comp.id);
  if (state.layout.compactOnDrop && !at) layout = compactLayout(layout);
  commitLayout(layout);
  markDirty();
  render();
  toast(`已添加 ${preset?.label || CHART_META[chartType]?.label || kind}`, 'ok');
}

function renderBoard(board) {
  disposeCharts();
  if (!board) return;
  const readonly = isPreviewReadonly();
  if (readonly) state.selectedId = null;
  const comps = boardComps();
  const cw = colW(board);
  board.style.backgroundSize = `${cw + gapSize()}px ${rowH() + gapSize()}px`;
  board.classList.toggle('preview-readonly', readonly);

  if (!comps.length) {
    board.style.height = '240px';
    if (isMobileEdit()) {
      board.style.height = '100%';
      board.innerHTML = `<div class="mob-empty">
        <b>暂无组件</b>
        <span>在左侧勾选 PC 组件上板，或点「导入全部」</span>
      </div>`;
      return;
    }
    board.innerHTML = `<div class="empty" style="position:relative;inset:auto;min-height:200px;border:0">
      <b>从左侧拖入组件开始搭建</b>
      <span style="font-size:12px">需要筛选时请拖入「查询控件」，自行配置条件</span>
      <button class="btn primary" id="emptyAdd">+ 添加柱状图</button>
    </div>`;
    if (!readonly) board.querySelector('#emptyAdd')?.addEventListener('click', () => addComp('bar'));
    if (!readonly) wireBoardDrop(board);
    return;
  }

  const rows = contentRows(comps) + extraRows();
  const contentH = rows * rowH() + Math.max(0, rows - 1) * gapSize() + boardPad();
  board.style.height = contentH + 'px';
  board.innerHTML = comps.map(c => widgetHtml(c, cw)).join('') + (readonly ? '' : `<div class="grid-ph"></div>`);

  comps.forEach(c => {
    const el = board.querySelector(`[data-wid="${c.id}"]`);
    if (!el) return;
    if (!readonly) wireDrag(el, c, cw);
    if (c.type === 'chart') paintChart(el, c);
    if (c.type === 'slicer') wireSlicer(el);
    if (c.type === 'query') wireQuery(el, c);
  });
  if (readonly) {
    board.onclick = null;
    board.ondragover = null;
    board.ondrop = null;
    board.ondragleave = null;
  } else {
    board.onclick = e => {
      if (e.target === board) selectComp(null);
    };
    wireBoardDrop(board);
  }
}

function wireBoardDrop(board) {
  if (isMobileEdit()) {
    board.ondragover = e => e.preventDefault();
    board.ondrop = e => { e.preventDefault(); toast('移动布局请从左侧组件池勾选', 'warn'); };
    return;
  }
  board.ondragover = e => {
    if (![...e.dataTransfer.types].includes('add-kind') && !e.dataTransfer.types.includes('text/plain')) {
      // chromium reports types differently
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const kind = state._dragKind || 'bar';
    const size = defaultSize(CHART_PRESETS[kind]?.chartType || kind);
    const cell = cellFromPoint(board, e.clientX, e.clientY, size.w, size.h);
    if (state.layout.showGrid) board.classList.add('editing-grid');
    showPlaceholder(board, cell.x, cell.y, size.w, size.h, colW(board));
  };
  board.ondragleave = e => {
    if (!board.contains(e.relatedTarget)) {
      hidePlaceholder(board);
      board.classList.remove('editing-grid');
    }
  };
  board.ondrop = e => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('add-kind') || state._dragKind;
    hidePlaceholder(board);
    board.classList.remove('editing-grid');
    state._dragKind = null;
    if (!kind || kind === 'tab') return;
    const size = defaultSize(CHART_PRESETS[kind]?.chartType || kind);
    const cell = cellFromPoint(board, e.clientX, e.clientY, size.w, size.h);
    addComp(kind, cell);
  };
}

function widgetHtml(c, cw) {
  const box = px(c.x, c.y, c.w, c.h, cw);
  const readonly = isPreviewReadonly();
  const sel = !readonly && c.id === state.selectedId ? 'selected' : '';
  const handles = readonly ? '' : handlesHtml(c.id);
  let title = c.type, badge = '';
  if (c.type === 'chart') {
    const ch = state.dash.charts[c.chartId];
    title = ch?.title || '图表';
    badge = missingBind(ch).length ? '待配置' : (state.pendingPaint?.has(ch.id) ? '待更新' : ch.chartType);
    if (readonly) badge = '';
  } else if (c.type === 'slicer') {
    title = c.props?.label || '切片器';
    badge = 'slicer';
  } else if (c.type === 'query') {
    title = c.props?.label || '查询条件';
    badge = 'query';
  } else if (c.type === 'text') {
    title = '文本';
  }
  // slicer: single compact row (no tall empty header)
  if (c.type === 'slicer') {
    const p = c.props || {};
    const field = p.field || '';
    const cur = field ? (state.filter[field] || '') : '';
    const opts = field ? slicerOptions(field) : [];
    const slicerStyle = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:${c.z};background:${p.bg || '#fff'};color:${p.titleColor || '#1f2329'};border-radius:${p.radius ?? 10}px`;
    return `<div class="widget slicer ${sel}" data-wid="${c.id}" style="${slicerStyle}">
      <div class="slicer-inline" ${readonly ? '' : `data-drag="${c.id}"`}>
        <b style="color:inherit">${esc(title)}</b>
        <div class="slicer" data-sfield="${esc(field)}">
          ${field ? `<button class="sc ${!cur?'on':''}" data-sv="">全部</button>
          ${opts.map(r => `<button class="sc ${cur===r?'on':''}" data-sv="${esc(r)}">${esc(r)}</button>`).join('')}` : '<span style="font-size:12px;color:var(--text-3)">请在右侧选择字段</span>'}
        </div>
      </div>
      ${handles}
    </div>`;
  }
  if (c.type === 'query') {
    const p = c.props || {};
    const items = Array.isArray(p.items) ? p.items : [];
    const align = ['left', 'center', 'between', 'evenly'].includes(p.align) ? p.align : 'left';
    const qStyle = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:${c.z};background:${p.bg || '#fff'};border-radius:${p.radius ?? 10}px`;
    const body = items.length
      ? items.map(it => queryItemControlHtml(it)).join('')
      : '<span class="q-empty">从左侧拖入「查询控件」后，在右侧添加日期 / 下拉等筛选项</span>';
    return `<div class="widget query-bar ${sel}" data-wid="${c.id}" style="${qStyle}">
      <div class="query-inline align-${align}" ${readonly ? '' : `data-drag="${c.id}"`}>
        <b>${esc(title)}</b>
        <div class="query-items">${body}</div>
      </div>
      ${handles}
    </div>`;
  }

  let body = '';
  let kindClass = '';
  let cardStyle = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:${c.z}`;
  if (c.type === 'text') {
    const p = c.props || {};
    const fs = p.fontSize || (c.h <= 1 ? 13 : 16);
    // 通栏说明条：单行横排，避免标题栏把内容挤折叠
    cardStyle += `;background:${p.bg || '#fff'};border-radius:${p.radius ?? 10}px`;
    const align = p.align === 'center' ? 'center' : 'left';
    return `<div class="widget text-banner ${sel}" data-wid="${c.id}" style="${cardStyle}">
      <div class="text-inline" ${readonly ? '' : `data-drag="${c.id}"`} style="color:${p.color || '#1f2329'};font-size:${fs}px;text-align:${align}" title="${esc(p.content || '')}">${esc(p.content || '文本')}</div>
      ${handles}
    </div>`;
  } else {
    const ch = state.dash.charts[c.chartId];
    const st = resolveCompStyle(c);
    kindClass = ch ? `kind-${ch.chartType}` : '';
    const isKpi = ch?.chartType === 'kpi';
    // KPI：默认隐藏卡片标题栏，避免与数值区标题重复挤压
    const showTitle = isKpi ? st.showTitle === true : st.showTitle !== false;
    const bw = st.borderWidth != null ? st.borderWidth : 1;
    cardStyle += `;background:${st.bg || '#fff'};border-radius:${st.cardRadius ?? 10}px;border:${bw}px solid ${st.borderColor || '#e5e6eb'}`;
    const hdAlign = st.titleAlign === 'center' ? 'center' : 'left';
    const titleBg = st.titleBg || '#fafbfc';
    const inverse = isDarkColor(titleBg);
    const titleBold = st.titleBold !== false;
    const hdStyle = `color:${st.titleColor || '#1f2329'};background:${titleBg};font-size:${st.titleSize || 12}px;font-weight:${titleBold ? 700 : 500};justify-content:${hdAlign === 'center' ? 'center' : 'space-between'};${showTitle ? '' : 'display:none'}`;
    const bdTop = showTitle ? 32 : (isKpi ? 0 : 0);
    const dragAttr = readonly ? '' : `data-drag="${c.id}"`;
    const head = `<div class="hd ${inverse ? 'inverse' : ''} ${titleBold ? 'bold' : ''}" ${dragAttr} style="${hdStyle}"><span style="font-weight:inherit;color:inherit;font-size:inherit">${esc(title)}</span>${isKpi ? '' : `<span>${esc(badge)}</span>`}</div>`;
    const miss = missingBind(ch);
    // KPI 无标题栏时也要能拖动：整卡可拖
    const dragPad = (!showTitle && isKpi)
      ? `<div class="bd" data-kpi="${c.chartId}" ${dragAttr} style="top:0;${readonly ? '' : 'cursor:move'}"></div>`
      : `<div class="bd" data-kpi="${c.chartId}" style="top:${bdTop}px"></div>`;
    if (miss.length) {
      body = `${head}<div class="miss" style="margin:8px">
        <b>${esc(ch.title)}</b> 缺少配置
        ${readonly ? '' : miss.map(m => `<button data-fix="${m.key}" data-wid="${c.id}">→ ${esc(m.label)}</button>`).join('')}
      </div>`;
    } else if (isTableType(ch.chartType)) {
      body = `${head}<div class="bd table-wrap" data-table="${c.chartId}" style="top:${bdTop}px"></div>`;
    } else if (isKpi) {
      body = `${head}${dragPad}`;
    } else {
      body = `${head}<div class="bd chart-el" data-echart="${c.chartId}" style="top:${bdTop}px"></div>`;
    }
  }
  return `<div class="widget ${kindClass} ${sel}" data-wid="${c.id}" style="${cardStyle}">
    ${body}
    ${handles}
  </div>`;
}

function slicerOptions(field) {
  const set = new Set();
  Object.values(DATASETS).forEach(d => {
    (d.rows || []).forEach(r => { if (r[field] != null && r[field] !== '') set.add(String(r[field])); });
  });
  const list = [...set].slice(0, 40);
  if (list.length) return list;
  if (isProductLive()) return [];
  const defaults = { region: ['华东', '华北', '华南'], channel: ['线上', '线下'] };
  return defaults[field] || [];
}

function wireSlicer(el) {
  const field = el.querySelector('.slicer')?.dataset.sfield || 'region';
  el.querySelectorAll('[data-sv]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      state.filter[field] = b.dataset.sv;
      el.querySelectorAll('[data-sv]').forEach(x => x.classList.toggle('on', x.dataset.sv === (state.filter[field] || '')));
      repaintAllCharts();
    };
  });
}

function wireDrag(el, comp, cw) {
  const board = el.parentElement;
  const unit = cw || colW(board);
  el.onmousedown = e => {
    if (e.target.closest('[data-fix]')) {
      e.stopPropagation();
      state.rightTab = 'data';
      state.inspCollapsed = false;
      syncEditorChrome();
      selectComp(comp.id);
      return;
    }
    if (e.button === 2) return;
    selectComp(comp.id);
  };
  el.oncontextmenu = e => {
    e.preventDefault();
    selectComp(comp.id, { right: false });
    openCtx(e.clientX, e.clientY, comp);
  };

  const beginInteract = () => {
    selectComp(comp.id, { right: false });
    el.classList.add('dragging');
    board.classList.add('interacting');
    if (state.layout.showGrid) board.classList.add('editing-grid');
  };
  const endInteract = (layout) => {
    el.classList.remove('dragging');
    board.classList.remove('editing-grid', 'interacting');
    hidePlaceholder(board);
    board.querySelectorAll('.widget').forEach(w => w.classList.remove('pushed'));
    if (layout) {
      commitLayout(layout);
      // 松手再统一 resize，拖动过程不碰 ECharts
      paintPositions(board, layout, unit, null, { resizeCharts: true });
    }
    markDirty();
    requestAnimationFrame(() => selectComp(comp.id, { right: true }));
  };

  const hd = el.querySelector('[data-drag]');
  if (hd) {
    hd.onmousedown = e => {
      if (e.button !== 0) return;
      // 查询/切片等控件本身需要点击，不要抢成拖拽
      if (e.target.closest('select, input, textarea, button, [data-sv], [data-qkind], a, label.q-item')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      pushUndo();
      beginInteract();
      const startX = e.clientX, startY = e.clientY, ox = comp.x, oy = comp.y;
      const base = tabComps().map(c => ({ ...c }));
      let latest = base.map(c => ({ ...c }));
      createPointerTracker((ev, changed, isUp) => {
        if (isUp) {
          if (state.layout.compactOnDrop) latest = compactLayout(latest);
          endInteract(latest);
          return;
        }
        const nx = Math.min(gridCols() - comp.w, Math.max(0, ox + snap(ev.clientX - startX, unit)));
        const ny = Math.max(0, oy + snap(ev.clientY - startY, rowH()));
        if (!changed(`${nx},${ny}`)) return;
        latest = base.map(c => c.id === comp.id ? { ...c, x: nx, y: ny } : { ...c });
        if (state.layout.push) latest = pushLayout(latest, comp.id);
        const me = latest.find(c => c.id === comp.id);
        showPlaceholder(board, me.x, me.y, me.w, me.h, unit);
        const others = state.layout.push
          ? new Set(latest.filter(c => c.id !== comp.id).map(c => c.id))
          : null;
        paintPositions(board, latest, unit, others, { resizeCharts: false, fitHeight: false });
      });
    };
  }

  el.querySelectorAll('[data-resize]').forEach(h => {
    h.onmousedown = e => {
      e.preventDefault(); e.stopPropagation();
      pushUndo();
      beginInteract();
      const mode = h.dataset.resize;
      const startX = e.clientX, startY = e.clientY;
      const ow = comp.w, oh = comp.h, ox = comp.x, oy = comp.y;
      const min = minWH(comp);
      const base = tabComps().map(c => ({ ...c }));
      let latest = base.map(c => ({ ...c }));
      createPointerTracker((ev, changed, isUp) => {
        if (isUp) {
          if (state.layout.compactOnDrop) latest = compactLayout(latest);
          endInteract(latest);
          return;
        }
        const ddx = snap(ev.clientX - startX, unit);
        const ddy = snap(ev.clientY - startY, rowH());
        let nx = ox, ny = oy, nw = ow, nh = oh;
        if (mode.includes('e')) nw = Math.max(min.w, Math.min(gridCols() - ox, ow + ddx));
        if (mode.includes('s')) nh = Math.max(min.h, oh + ddy);
        if (mode.includes('w')) {
          const right = ox + ow;
          nw = Math.max(min.w, Math.min(right, ow - ddx));
          nx = right - nw;
        }
        if (mode.includes('n')) {
          const bottom = oy + oh;
          nh = Math.max(min.h, Math.min(bottom, oh - ddy));
          ny = bottom - nh;
        }
        nx = Math.max(0, Math.min(gridCols() - nw, nx));
        ny = Math.max(0, ny);
        nw = Math.max(min.w, Math.min(gridCols() - nx, nw));
        nh = Math.max(min.h, nh);
        if (!changed(`${nx},${ny},${nw},${nh}`)) return;
        latest = base.map(c => c.id === comp.id ? { ...c, x: nx, y: ny, w: nw, h: nh } : { ...c });
        if (state.layout.push) latest = pushLayout(latest, comp.id);
        const me = latest.find(c => c.id === comp.id);
        showPlaceholder(board, me.x, me.y, me.w, me.h, unit);
        paintPositions(
          board,
          latest,
          unit,
          state.layout.push ? new Set(latest.filter(c => c.id !== comp.id).map(c => c.id)) : null,
          { resizeCharts: false, fitHeight: false }
        );
      });
    };
  });
}

function fitBoardHeight(board, comps) {
  if (!board) return;
  const list = comps || tabComps();
  const rows = contentRows(list) + extraRows();
  board.style.height = (rows * rowH() + Math.max(0, rows - 1) * gapSize() + boardPad()) + 'px';
}

function wireTablePager(box, ch, el, comp, totalPages, page) {
  box.querySelectorAll('[data-tp]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      if (btn.dataset.tp === 'prev') ch._page = Math.max(1, page - 1);
      else ch._page = Math.min(totalPages, page + 1);
      paintChart(el, comp);
    };
  });
}

function isDarkColor(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 160;
}

function tableHeadStyle(st) {
  const bold = st.headerBold !== false ? 'font-weight:700;' : 'font-weight:500;';
  const size = `font-size:${st.headerSize || st.tableFontSize || 12}px;`;
  return `background:${st.headerBg || '#f5f6f7'};color:${st.headerColor || '#1f2329'};${bold}${size}`;
}

function tableRowHeadStyle(st) {
  const bold = st.rowHeadBold !== false ? 'font-weight:700;' : 'font-weight:500;';
  const size = `font-size:${st.tableFontSize || 12}px;`;
  return `background:${st.rowHeadBg || '#fff'};color:${st.rowHeadColor || '#1f2329'};${bold}${size}`;
}

function tableCornerStyle(st) {
  const bold = st.headerBold !== false ? 'font-weight:700;' : 'font-weight:500;';
  const size = `font-size:${st.headerSize || st.tableFontSize || 12}px;`;
  return `background:${st.cornerBg || st.headerBg || '#eef2ff'};color:${st.cornerColor || st.headerColor || '#1f2329'};${bold}${size}`;
}

function tableCellStyle(st) {
  const align = st.cellAlign === 'center' ? 'center' : (st.cellAlign === 'right' ? 'right' : 'left');
  const valign = st.cellVAlign === 'top' ? 'top' : (st.cellVAlign === 'bottom' ? 'bottom' : 'middle');
  const wrap = st.autoWrap ? 'white-space:normal;word-break:break-word;' : 'white-space:nowrap;';
  const bold = st.cellBold ? 'font-weight:700;' : '';
  const italic = st.cellItalic ? 'font-style:italic;' : '';
  const rh = Math.max(24, +st.rowHeight || 36);
  return `background:${st.cellBg || '#fff'};color:${st.cellColor || '#1f2329'};font-size:${st.tableFontSize || 12}px;text-align:${align};vertical-align:${valign};height:${rh}px;${bold}${italic}${wrap}`;
}

function tableColWidthStyle(st, field) {
  if (st.colWidthMode === 'fixed') {
    const w = Math.max(60, +st.colWidthPx || 120);
    return `min-width:${w}px;width:${w}px;`;
  }
  if (st.colWidthMode === 'custom' && field && st.colWidths && st.colWidths[field] != null) {
    const pct = Math.max(1, Math.min(100, +st.colWidths[field] || 8));
    return `width:${pct}%;min-width:${Math.max(48, Math.round(pct * 4))}px;`;
  }
  return '';
}

function tableColLeftOffset(st, fields, visualCol, showIdx) {
  let left = 0;
  for (let i = 0; i < visualCol; i++) {
    if (showIdx && i === 0) { left += 36; continue; }
    const fi = showIdx ? i - 1 : i;
    const field = fields[fi];
    if (st.colWidthMode === 'fixed') left += Math.max(60, +st.colWidthPx || 120);
    else if (st.colWidthMode === 'custom' && field && st.colWidths?.[field] != null) {
      left += Math.max(48, Math.round((+st.colWidths[field] / 100) * 480));
    } else left += 96;
  }
  return left;
}

function tableTotalStyle(st) {
  return `background:${st.totalBg || '#f0f4ff'};color:${st.totalColor || '#1f2329'};font-weight:600;`;
}

/** 合并相邻相同单元格（明细/汇总第一列示意，对齐 DataEase 合并单元格） */
function mergeFlags(values) {
  const flags = values.map(() => ({ show: true, rowspan: 1 }));
  let i = 0;
  while (i < values.length) {
    let j = i + 1;
    while (j < values.length && String(values[j]) === String(values[i])) j++;
    const span = j - i;
    flags[i] = { show: true, rowspan: span };
    for (let k = i + 1; k < j; k++) flags[k] = { show: false, rowspan: 0 };
    i = j;
  }
  return flags;
}

/** 多指标时按「列维 · 指标」拆成两行表头（对齐截图中 年月/指标 多层） */
function groupPivotColHeaders(colKeys, valFields) {
  if (!valFields || valFields.length <= 1) return null;
  const groups = [];
  let cur = null;
  for (const key of colKeys) {
    const idx = key.lastIndexOf(' · ');
    const parent = idx >= 0 ? key.slice(0, idx) : key;
    const child = idx >= 0 ? key.slice(idx + 3) : key;
    if (!cur || cur.parent !== parent) {
      cur = { parent, children: [] };
      groups.push(cur);
    }
    cur.children.push({ key, label: child });
  }
  return groups;
}

function paintTableChart(el, comp, ch, st, rows) {
  const box = el.querySelector('[data-table]');
  if (!box) return;
  const fmt = ch.encode.format;
  const useStripe = st.stripe !== false && !st.mergeCells;
  const stripe = useStripe ? 'stripe' : '';
  const hs = tableHeadStyle(st);
  const csBase = tableCellStyle(st);
  const cw = (field) => tableColWidthStyle(st, field);
  const ts = tableTotalStyle(st);
  const sn = ensureSenior(ch);
  const freezeN = Math.max(0, Math.min(3, +st.freezeLeft || 0));
  const freezeTop = Math.max(0, Math.min(5, +st.freezeTop || 0));
  const showIdx = !!st.showIndex;
  const wrapCls = st.autoWrap ? 'wrap' : '';
  const treeCls = st.pivotLayout === 'tree' ? 'pivot-tree' : '';
  const borderCls = [
    st.showHBorder === false ? 'no-h-border' : '',
    st.showVBorder === false ? 'no-v-border' : '',
    st.showTableBorder === false ? 'no-outer-border' : ''
  ].filter(Boolean).join(' ');
  const alignCls = st.cellAlign === 'center' ? 'cell-center' : (st.cellAlign === 'left' ? 'cell-left' : (st.cellAlign === 'right' ? 'cell-right' : ''));

  // 斑马纹 / 滚动条 / 透明度 / 行高
  if (useStripe && st.stripeBg) box.style.setProperty('--stripe-bg', st.stripeBg);
  else box.style.removeProperty('--stripe-bg');
  if (st.scrollbarColor) box.style.setProperty('--tbl-scroll', st.scrollbarColor);
  else box.style.removeProperty('--tbl-scroll');
  box.style.opacity = `${Math.max(40, Math.min(100, +st.tableOpacity || 100)) / 100}`;
  box.style.setProperty('--row-h', `${Math.max(24, +st.rowHeight || 36)}px`);
  if (st.borderColor) box.style.setProperty('--tbl-border', st.borderColor);

  const stickyStyle = (colIdx, isHead, fields) => {
    if (freezeN <= 0 || colIdx >= freezeN) return '';
    const left = tableColLeftOffset(st, fields || [], colIdx, showIdx);
    const z = isHead ? 4 : 2;
    const bg = isHead ? (st.headerBg || '#f5f6f7') : (st.cellBg || '#fff');
    return `position:sticky;left:${left}px;z-index:${z};background:${bg};box-shadow:1px 0 0 #eff0f1;`;
  };
  const headSticky = freezeTop > 0 ? 'position:sticky;top:0;z-index:5;' : '';
  const bodySticky = (ri) => {
    if (freezeTop <= 0 || ri >= freezeTop) return '';
    const headH = st.showHeader === false ? 0 : Math.max(28, +st.rowHeight || 36);
    const top = headH + ri * Math.max(24, +st.rowHeight || 36);
    return `position:sticky;top:${top}px;z-index:3;background:${st.cellBg || '#fff'};`;
  };

  const pagerHtml = (page, totalPages, summary, enablePage) => {
    if (!enablePage) {
      return `<div class="table-pager muted"><span>${esc(summary)}</span></div>`;
    }
    return `<div class="table-pager">
      <span>${page} / ${totalPages} · ${esc(summary)}</span>
      <span>
        <button type="button" data-tp="prev" ${page<=1?'disabled':''}>上一页</button>
        <button type="button" data-tp="next" ${page>=totalPages?'disabled':''}>下一页</button>
      </span>
    </div>`;
  };

  if (ch.chartType === 'pivot') {
    const rowFields = encodeFields(ch.encode, 'category');
    const colFields = encodeFields(ch.encode, 'colDim');
    const valFields = encodeFields(ch.encode, 'value');
    const piv = pivotAggregate(rows, rowFields, colFields, valFields, ch.encode.agg || 'SUM', ch.datasetId);
    if (sn.resultLimit > 0 && piv.matrix.length > sn.resultLimit) {
      piv.matrix = piv.matrix.slice(0, sn.resultLimit);
      piv.rowKeys = piv.rowKeys.slice(0, sn.resultLimit);
    }
    const rowLab = dimLabels(ch.datasetId, rowFields) || '指标类型';
    const showRT = st.showRowTotal === true;
    const showCT = st.showColTotal === true;
    const rhs = tableRowHeadStyle(st);
    const cs = tableCornerStyle(st);
    const groups = st.pivotMultiHead !== false && valFields.length > 1 && st.pivotMeasurePos !== 'row'
      ? groupPivotColHeaders(piv.colKeys, valFields)
      : null;
    const colSpan = 1 + piv.colKeys.length + (showRT ? 1 : 0);
    let metaRow = '';
    if (st.pivotMeta !== false) {
      const metaLab = st.pivotMetaLabel || '当前年月';
      const metaVal = (st.pivotMetaValue && String(st.pivotMetaValue).trim()) || defaultPivotMetaValue();
      metaRow = `<tr class="pivot-meta">
        <th class="corner meta-lab" style="${rhs}">${esc(metaLab)}</th>
        <th class="meta-val" colspan="${Math.max(1, colSpan - 1)}" style="${hs}">${esc(metaVal)}</th>
      </tr>`;
    }
    let head = '';
    if (st.showHeader !== false) {
      if (groups) {
        const topCols = groups.map(g =>
          `<th class="num" colspan="${g.children.length}" style="${hs}${cw()}">${esc(g.parent)}</th>`
        ).join('') + (showRT ? `<th class="num" rowspan="2" style="${hs}${cw()}">行合计</th>` : '');
        const subCols = groups.flatMap(g => g.children.map(c =>
          `<th class="num" style="${hs}${cw()}">${esc(c.label)}</th>`
        )).join('');
        head = `<thead>
          ${metaRow}
          <tr><th class="corner" rowspan="2" style="${cs}">${esc(rowLab)}</th>${topCols}</tr>
          <tr>${subCols}</tr>
        </thead>`;
      } else {
        head = `<thead>
          ${metaRow}
          <tr><th class="corner" style="${cs}">${esc(rowLab)}</th>${
          piv.colKeys.map(c => `<th class="num" style="${hs}${cw()}">${esc(c)}</th>`).join('')
        }${showRT ? `<th class="num" style="${hs}${cw()}">行合计</th>` : ''}</tr></thead>`;
      }
    } else if (metaRow) {
      head = `<thead>${metaRow}</thead>`;
    }
    const treePad = st.pivotLayout === 'tree' ? 'padding-left:18px;' : '';
    const body = piv.matrix.map(r => `<tr>
      <td class="row-head" style="${rhs}${treePad}">${esc(r.row)}</td>
      ${r.vals.map(v => `<td class="num" style="${csBase}${cw()}">${formatVal(v, fmt)}</td>`).join('')}
      ${showRT ? `<td class="num" style="${csBase}${cw()}">${formatVal(r.total, fmt)}</td>` : ''}
    </tr>`).join('');
    const foot = showCT ? `<tr class="total">
      <td class="row-head" style="${rhs}${ts}">列合计</td>
      ${piv.colTotals.map(v => `<td class="num" style="${ts}${cw()}">${formatVal(v, fmt)}</td>`).join('')}
      ${showRT ? `<td class="num" style="${ts}${cw()}">${formatVal(piv.grand, fmt)}</td>` : ''}
    </tr>` : '';
    const measureHint = valFields.map(f => displayFieldLabel(ch, f)).join(', ');
    const gridCls = isDarkColor(st.headerBg) ? 'grid-full' : '';
    box.innerHTML = `<table class="dt pivot ${stripe} ${alignCls} ${gridCls} ${wrapCls} ${treeCls} ${borderCls}">${head}<tbody>${body || `<tr><td colspan="${colSpan}">暂无数据</td></tr>`}${foot}</tbody></table>
      ${pagerHtml(1, 1, `${piv.rowKeys.length} 行 · ${piv.colKeys.length} 列${measureHint ? ` · ${ch.encode.agg || 'SUM'}(${measureHint})` : ''}${st.pivotLayout === 'tree' ? ' · 树形' : ''}`, false)}`;
    return;
  }

  if (ch.chartType === 'grouptable') {
    const catFields = encodeFields(ch.encode, 'category');
    const valFields = encodeFields(ch.encode, 'value');
    const allFields = [...catFields, ...valFields];
    let data;
    if (valFields.length <= 1) {
      data = aggregateTable(rows, catFields, valFields, valFields[0] ? fieldAggOf(ch, valFields[0]) : (ch.encode.agg || 'SUM'));
    } else {
      const packs = valFields.map(f => {
        const part = aggregateTable(rows, catFields, [f], fieldAggOf(ch, f));
        return { field: f, map: new Map(part.map(r => [r.key, r])) };
      });
      const keys = [...new Set(packs.flatMap(p => [...p.map.keys()]))];
      data = keys.map(key => {
        const base = packs.map(p => p.map.get(key)).find(Boolean);
        const values = Object.fromEntries(valFields.map(f => {
          const hit = packs.find(p => p.field === f)?.map.get(key);
          return [f, hit?.values?.[f] || 0];
        }));
        return { key, dims: base?.dims || [key], values };
      });
    }
    if (sn.resultLimit > 0) data = data.slice(0, sn.resultLimit);
    const pageMode = st.pageMode || 'page';
    const pageSize = pageMode === 'scroll' ? Math.max(1, +st.scrollRows || 5) : (st.pageSize || 10);
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    if (!ch._page || ch._page > totalPages) ch._page = 1;
    const page = ch._page;
    const slice = data.slice((page - 1) * pageSize, page * pageSize);
    const idxOff = (page - 1) * pageSize;
    const colSpan = (showIdx ? 1 : 0) + catFields.length + valFields.length;
    const firstDimVals = slice.map(r => (r.dims.length ? r.dims[0] : r.key));
    const merge = st.mergeCells ? mergeFlags(firstDimVals) : null;
    const headCells = [];
    if (showIdx) headCells.push(`<th class="idx" style="${hs}${cw()}${headSticky}${stickyStyle(0, true, allFields)}">#</th>`);
    catFields.forEach((f, i) => {
      const col = (showIdx ? 1 : 0) + i;
      headCells.push(`<th style="${hs}${cw(f)}${headSticky}${stickyStyle(col, true, allFields)}">${esc(displayFieldLabel(ch, f))}</th>`);
    });
    valFields.forEach(f => headCells.push(`<th class="num" style="${hs}${cw(f)}${headSticky}">${esc(displayFieldLabel(ch, f))}</th>`));
    const head = st.showHeader !== false ? `<thead><tr>${headCells.join('')}</tr></thead>` : '';
    const totals = Object.fromEntries(valFields.map(f => [f, data.reduce((s, r) => s + (r.values[f] || 0), 0)]));
    const bodyRows = slice.map((r, ri) => {
      const cells = [];
      let col = 0;
      const rowSticky = bodySticky(ri);
      if (showIdx) {
        cells.push(`<td class="idx" style="${csBase}${cw()}${rowSticky}${stickyStyle(col, false, allFields)}">${idxOff + ri + 1}</td>`);
        col++;
      }
      const dims = r.dims.length ? r.dims : [r.key];
      dims.forEach((d, di) => {
        if (di === 0 && merge && !merge[ri].show) { col++; return; }
        const rs = di === 0 && merge ? ` rowspan="${merge[ri].rowspan}"` : '';
        const field = catFields[di];
        const empty = formatEmpty(d, st.emptyValue ?? '-');
        const text = empty != null ? empty : String(d);
        const cond = field ? matchCondStyle(st, field, d) : null;
        const condCss = cond ? `background:${cond.background};color:${cond.color};` : '';
        cells.push(`<td${rs} style="${csBase}${cw(field)}${rowSticky}${condCss}${stickyStyle(col, false, allFields)}">${esc(text)}</td>`);
        col++;
      });
      valFields.forEach(f => {
        const raw = r.values[f];
        const text = displayCellValue(ch, st, f, raw);
        const cond = matchCondStyle(st, f, raw);
        const condCss = cond ? `background:${cond.background};color:${cond.color};` : '';
        cells.push(`<td class="num" style="${csBase}${cw(f)}${rowSticky}${condCss}">${esc(text)}</td>`);
      });
      return `<tr>${cells.join('')}</tr>`;
    }).join('');
    const totalRow = st.showRowTotal !== false
      ? `<tr class="total"><td colspan="${Math.max(1, (showIdx ? 1 : 0) + catFields.length)}" style="${ts}">合计</td>${valFields.map(f => `<td class="num" style="${ts}${cw(f)}">${formatVal(totals[f], fieldFormatOf(ch, f))}</td>`).join('')}</tr>`
      : '';
    box.innerHTML = `<table class="dt ${stripe} ${alignCls} ${wrapCls} ${borderCls} freeze-${freezeN}">${head}
      <tbody>
        ${bodyRows || `<tr><td colspan="${colSpan || 1}">暂无数据</td></tr>`}
        ${totalRow}
      </tbody></table>
      ${pagerHtml(page, totalPages, `共 ${data.length} 组${pageMode === 'scroll' ? ' · 滚动分页' : ''}`, pageMode !== 'scroll' || totalPages > 1)}`;
    wireTablePager(box, ch, el, comp, totalPages, page);
    if (pageMode === 'scroll' && totalPages > 1) wireTableAutoScroll(box, ch, el, comp, totalPages, st);
    return;
  }

  // 明细表
  migrateTableEncode(ch);
  const cols = tableColumnsOf(ch);
  let detailRows = rows;
  if (sn.resultLimit > 0) detailRows = detailRows.slice(0, sn.resultLimit);
  const pageMode = st.pageMode || 'page';
  const pageSize = pageMode === 'scroll' ? Math.max(1, +st.scrollRows || 5) : (st.pageSize || 5);
  const totalPages = Math.max(1, Math.ceil(detailRows.length / pageSize));
  if (!ch._page || ch._page > totalPages) ch._page = 1;
  const page = ch._page;
  const slice = detailRows.slice((page - 1) * pageSize, page * pageSize);
  const idxOff = (page - 1) * pageSize;
  const firstColVals = slice.map(r => r[cols[0]]);
  const merge = st.mergeCells && cols.length ? mergeFlags(firstColVals) : null;
  const headCells = [];
  if (showIdx) headCells.push(`<th class="idx" style="${hs}${cw()}${headSticky}${stickyStyle(0, true, cols)}">#</th>`);
  cols.forEach((c, i) => {
    const lab = displayFieldLabel(ch, c);
    const num = fieldMeta(ch.datasetId, c)?.group === 'quota';
    const col = (showIdx ? 1 : 0) + i;
    headCells.push(`<th class="${num?'num':''}" style="${hs}${cw(c)}${headSticky}${stickyStyle(col, true, cols)}">${esc(lab)}</th>`);
  });
  const head = st.showHeader !== false ? `<thead><tr>${headCells.join('')}</tr></thead>` : '';
  const bodyRows = slice.map((r, ri) => {
    const cells = [];
    let col = 0;
    const rowSticky = bodySticky(ri);
    if (showIdx) {
      cells.push(`<td class="idx" style="${csBase}${cw()}${rowSticky}${stickyStyle(col, false, cols)}">${idxOff + ri + 1}</td>`);
      col++;
    }
    cols.forEach((c, ci) => {
      if (ci === 0 && merge && !merge[ri].show) { col++; return; }
      const num = fieldMeta(ch.datasetId, c)?.group === 'quota';
      const v = r[c];
      const text = displayCellValue(ch, st, c, v);
      const cond = matchCondStyle(st, c, v);
      const condCss = cond ? `background:${cond.background};color:${cond.color};` : '';
      const rs = ci === 0 && merge ? ` rowspan="${merge[ri].rowspan}"` : '';
      const alignOverride = num && st.cellAlign === 'left' ? 'text-align:right;' : '';
      cells.push(`<td class="${num?'num':''}"${rs} style="${csBase}${cw(c)}${rowSticky}${alignOverride}${condCss}${stickyStyle(col, false, cols)}">${esc(text)}</td>`);
      col++;
    });
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
  const span = (showIdx ? 1 : 0) + cols.length;
  box.innerHTML = `<table class="dt ${stripe} ${alignCls} ${wrapCls} ${borderCls} freeze-${freezeN}">${head}
    <tbody>${bodyRows || `<tr><td colspan="${span || 1}">暂无数据</td></tr>`}</tbody></table>
    ${pagerHtml(page, totalPages, `共 ${detailRows.length} 行 · ${cols.length} 列${pageMode === 'scroll' ? ' · 滚动' : ''}`, pageMode !== 'scroll' || totalPages > 1)}`;
  wireTablePager(box, ch, el, comp, totalPages, page);
  if (pageMode === 'scroll' && totalPages > 1) wireTableAutoScroll(box, ch, el, comp, totalPages, st);
}

function wireTableAutoScroll(box, ch, el, comp, totalPages, st) {
  const key = `_scrollTimer_${ch.id}`;
  if (state[key]) { clearInterval(state[key]); delete state[key]; }
  const sec = Math.max(1, +st.scrollInterval || 2) * 1000;
  state[key] = setInterval(() => {
    if (!document.body.contains(box)) { clearInterval(state[key]); delete state[key]; return; }
    ch._page = (ch._page || 1) >= totalPages ? 1 : (ch._page || 1) + 1;
    paintChart(el, comp);
  }, sec);
}

function legendOption(st, legendNames) {
  if (st.showLegend === false) return { show: false };
  const pos = st.legendPos || 'top';
  const textStyle = { fontSize: st.legendFontSize || 11, color: '#646a73' };
  const base = { data: legendNames, textStyle };
  if (pos === 'bottom') return { ...base, bottom: 0 };
  if (pos === 'left') return { ...base, left: 0, top: 'middle', orient: 'vertical' };
  if (pos === 'right') return { ...base, right: 0, top: 'middle', orient: 'vertical' };
  return { ...base, top: 0 };
}

function applyPieTopN(data, topN) {
  if (!topN || topN <= 0 || data.length <= topN) return data;
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const other = rest.reduce((s, d) => s + d.value, 0);
  return other > 0 ? [...head, { name: '其他', value: other }] : head;
}

function packQueryResult(ch, result) {
  const dataRows = Array.isArray(result?.data) ? result.data : [];
  const cat = encodePrimary(ch.encode, 'category');
  const val = encodePrimary(ch.encode, 'value') || 'value';
  const rows = dataRows.map((r) => {
    const row = Array.isArray(r) ? r : [];
    const o = {};
    if (ch.chartType === 'kpi' || !cat) {
      o[val] = row.length > 1 ? row[1] : row[0];
    } else {
      o[cat] = row[0];
      o[val] = row.length > 1 ? row[1] : 0;
    }
    return o;
  });
  const toNum = (v) => {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  if (ch.chartType === 'kpi' || !cat) {
    const v = toNum(rows[0]?.[val]);
    return {
      rows,
      data: [{ name: '合计', value: v }],
      seriesPack: {
        categories: ['合计'],
        series: [{ name: displayFieldLabel(ch, val), field: val, data: [v] }]
      }
    };
  }
  return {
    rows,
    data: rows.map((r) => ({ name: String(r[cat] ?? ''), value: toNum(r[val]) })),
    seriesPack: {
      categories: rows.map((r) => String(r[cat] ?? '')),
      series: [{
        name: displayFieldLabel(ch, val),
        field: val,
        data: rows.map((r) => toNum(r[val]))
      }]
    }
  };
}

function beginLiveChartQuery(el, comp, ch) {
  if (!__productOpts || typeof __productOpts.queryChart !== 'function') return null;
  if (!state._chartQueryCache) state._chartQueryCache = {};
  const cache = state._chartQueryCache;
  const filters = currentChartQueryFilters();
  const key = `${ch.id}|${ch.chartType}|${ch.datasetId || ''}|${JSON.stringify(ch.encode || {})}|${JSON.stringify(filters)}`;
  const hit = cache[ch.id];
  if (hit && hit.key === key) {
    if (hit.status === 'ok') return { ready: true, ...hit.payload };
    if (hit.status === 'pending') return { pending: true };
    if (hit.status === 'fail') return { failed: true };
  }
  cache[ch.id] = { key, status: 'pending' };
  ch._qgen = (ch._qgen || 0) + 1;
  const gen = ch._qgen;
  Promise.resolve(__productOpts.queryChart(ch.id, {
    datasetId: ch.datasetId,
    chartType: ch.chartType,
    encode: ch.encode,
    title: ch.title,
    filters
  })).then((result) => {
    if (ch._qgen !== gen) return;
    cache[ch.id] = { key, status: 'ok', payload: packQueryResult(ch, result) };
    const board = document.getElementById('board');
    const node = board && board.querySelector(`[data-wid="${comp.id}"]`);
    if (node) paintChart(node, comp);
  }).catch(() => {
    if (ch._qgen !== gen) return;
    cache[ch.id] = { key, status: 'fail' };
    const board = document.getElementById('board');
    const node = board && board.querySelector(`[data-wid="${comp.id}"]`);
    if (node) paintChart(node, comp);
  });
  return { pending: true };
}

function paintChart(el, comp) {
  const ch = state.dash.charts[comp.chartId];
  if (!ch || missingBind(ch).length) return;
  const st = resolveCompStyle(comp);
  // keep PC style bag hydrated for editors that mutate ensureStyle(ch)
  ensureStyle(ch);
  const sn = ensureSenior(ch);
  const live = beginLiveChartQuery(el, comp, ch);
  const useLive = !!(live && live.ready);
  const rows = useLive
    ? live.rows
    : ((live && (live.pending || live.failed)) || isProductLive() ? [] : filteredRows(ch));
  const catFields = encodeFields(ch.encode, 'category');
  const valFields = encodeFields(ch.encode, 'value');
  const colorField = encodePrimary(ch.encode, 'color');
  const primaryVal = valFields[0];
  const primaryAgg = primaryVal ? fieldAggOf(ch, primaryVal) : (ch.encode.agg || 'SUM');
  let seriesPack;
  let data;
  if (useLive) {
    seriesPack = live.seriesPack;
    data = live.data;
  } else {
    seriesPack = colorField && primaryVal && ['bar', 'hbar', 'line', 'area'].includes(ch.chartType)
      ? aggregateByColor(rows, catFields, colorField, primaryVal, primaryAgg)
      : aggregateSeries(rows, catFields, valFields, ch.encode.agg || 'SUM', ch.datasetId, ch);
    data = aggregate(rows, catFields, primaryVal, primaryAgg);
  }
  seriesPack = sortSeriesPack(ch, seriesPack);
  data = sortPieData(ch, data);
  // Live packs historically used raw field names; always prefer display labels.
  if (seriesPack?.series?.length) {
    seriesPack = {
      ...seriesPack,
      series: seriesPack.series.map((s) => {
        const field = s.field || (valFields.includes(s.name) ? s.name : null);
        if (!field) return s;
        return { ...s, field, name: displayFieldLabel(ch, field) };
      })
    };
  }
  if (sn.resultLimit > 0 && ch.chartType !== 'pie' && ch.chartType !== 'kpi') {
    seriesPack = {
      categories: seriesPack.categories.slice(0, sn.resultLimit),
      series: seriesPack.series.map(s => ({ ...s, data: s.data.slice(0, sn.resultLimit) }))
    };
    data = data.slice(0, sn.resultLimit);
  }
  if (ch.chartType === 'pie' && sn.topN > 0) {
    data = applyPieTopN(data, sn.topN);
  }
  const theme = THEMES[state.dash.theme] || THEMES.default;

  if (ch.chartType === 'kpi') {
    const box = el.querySelector('[data-kpi]');
    let v = data[0]?.value || 0;
    let delta = 0;
    if (ch.encode.calc === 'yoy') { delta = 0.126; }
    if (ch.encode.calc === 'mom') { delta = 0.048; }
    const alert = state.dash.alerts.find(a => a.enabled && a.chartId === ch.id);
    let alertOn = false;
    if (alert) {
      if (alert.operator === 'lt') alertOn = v < alert.threshold;
      if (alert.operator === 'gt') alertOn = v > alert.threshold;
      if (alert.operator === 'lte') alertOn = v <= alert.threshold;
      if (alert.operator === 'gte') alertOn = v >= alert.threshold;
    }
    const vColor = st.valueColor || '#1f2329';
    const mobile = useMobileLayout();
    const compact = mobile || (comp.h || 2) <= 2;
    // 移动端卡片矮：限制字号，避免数值被 overflow 裁切
    let vSize = st.valueSize || (compact ? 24 : 28);
    if (mobile) vSize = Math.min(vSize, (comp.h || 2) <= 2 ? 18 : 22);
    const showInnerTitle = st.showTitle !== true;
    const align = st.valueAlign === 'center' ? 'center' : 'left';
    const prefix = st.valuePrefix || '';
    const suffix = st.valueSuffix || '';
    const calc = String(ch.encode?.calc || 'none');
    const showDelta = st.showCompare !== false && (calc === 'yoy' || calc === 'mom');
    const compareHtml = showDelta
      ? `<div class="d ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '↑' : '↓'} ${(delta * 100).toFixed(1)}% ${calc === 'yoy' ? '同比' : '环比'}${alertOn ? ' · 触发告警' : ''}</div>`
      : (alertOn ? '<div class="d down">触发告警</div>' : '');
    const subHtml = st.kpiSubtitle ? `<div class="kpi-sub">${esc(st.kpiSubtitle)}</div>` : '';
    box.innerHTML = `<div class="kpi-box ${compact ? 'compact' : ''} ${alertOn ? 'alert' : ''}" style="text-align:${align}">
      ${showInnerTitle ? `<div class="kpi-label" style="color:${st.titleColor || 'var(--text-2)'}">${esc(ch.title)}</div>` : ''}
      ${subHtml}
      <div class="n" style="color:${vColor};font-size:${vSize}px;line-height:1.2">${esc(prefix)}${measureDisplayVal(v, st, ch.encode.format, v)}</div>
      ${compareHtml}
    </div>`;
    return;
  }
  if (isTableType(ch.chartType)) {
    paintTableChart(el, comp, ch, st, rows);
    return;
  }
  const dom = el.querySelector('[data-echart]');
  if (!dom || !echarts) return;
  let inst = state.chartInst[ch.id];
  if (inst && inst.getDom() !== dom) {
    disposeOneChart(ch.id);
    inst = null;
  }
  if (!inst) {
    inst = echarts.getInstanceByDom(dom) || echarts.init(dom);
    state.chartInst[ch.id] = inst;
  }
  const names = seriesPack.categories.length ? seriesPack.categories : data.map(d => d.name);
  const showLabel = !!st.showLabel;
  const labelSize = st.labelSize || 10;
  const labelColor = st.labelColor || '#1f2329';
  const labelAvoid = (st.labelMode || 'adaptive') !== 'all';
  const showTip = st.showTooltip !== false;
  const tipFs = st.tooltipFontSize || 12;
  let option = {};
  const fmt = ch.encode.format || 'raw';
  const autoProbe = (() => {
    const vals = (seriesPack?.series || []).flatMap((s) => s.data || []);
    let m = 0;
    for (const x of vals) {
      const n = Number(x);
      if (Number.isFinite(n) && Math.abs(n) > m) m = Math.abs(n);
    }
    return m || data.reduce((m, d) => Math.max(m, Math.abs(Number(d.value) || 0)), 0);
  })();
  const tipVal = (v) => measureDisplayVal(v, st, fmt, autoProbe);
  const seriesColors = resolveSeriesColors(st, theme);
  const legendNames = ch.chartType === 'pie'
    ? data.map(d => d.name)
    : (seriesPack.series.length > 1
      ? seriesPack.series.map(s => s.name)
      : [seriesPack.series[0]?.name || ch.title]);
  const legend = legendOption(st, legendNames);
  const pos = st.legendPos || 'top';

  if (ch.chartType === 'pie') {
    const inner = Math.min(+st.pieInner || 35, (+st.pieOuter || 65) - 5);
    const outer = +st.pieOuter || 65;
    const pieFmt = primaryVal ? fieldFormatOf(ch, primaryVal) : fmt;
    const pieTip = (v) => measureDisplayVal(v, st, pieFmt);
    option = {
      color: seriesColors,
      tooltip: showTip ? {
        trigger: 'item',
        textStyle: { fontSize: tipFs },
        formatter: p => `${p.name}<br/>${pieTip(p.value)} (${p.percent}%)`
      } : { show: false },
      legend,
      series: [{
        type: 'pie',
        radius: [`${inner}%`, `${outer}%`],
        roseType: st.pieRose ? 'radius' : undefined,
        padAngle: +st.piePadAngle || 0,
        itemStyle: (+st.piePadAngle || 0) > 0 ? { borderRadius: 3 } : undefined,
        label: {
          show: showLabel,
          fontSize: labelSize,
          color: labelColor,
          formatter: pieLabelFormatter(st, pieTip),
          overflow: labelAvoid ? 'truncate' : 'none'
        },
        labelLayout: labelAvoid ? { hideOverlap: true } : undefined,
        data: data.map(d => ({ name: d.name, value: d.value }))
      }]
    };
  } else {
    const isH = ch.chartType === 'hbar';
    const isArea = ch.chartType === 'area';
    const isLine = ch.chartType === 'line' || isArea;
    const multi = seriesPack.series.length > 1;
    const stackMode = st.stackMode || 'group';
    const canStack = multi && (colorField || valFields.length > 1) && !isLine;
    const useStack = canStack && (stackMode === 'stack' || stackMode === 'percent');
    const topPad = legend.show !== false && pos === 'top' ? (multi ? 40 : 36) : 28;
    const botPad = legend.show !== false && pos === 'bottom' ? 40 : 32;
    const leftPad = legend.show !== false && pos === 'left' ? 88 : (st.showYAxisName ? 64 : 48);
    const rightPad = legend.show !== false && pos === 'right' ? 88 : 16;
    const axisLineStyle = (on, color, width, type) => (on
      ? { show: true, lineStyle: { color: color || '#c9cdd4', width: width || 1, type: type || 'solid' } }
      : { show: false });
    const splitStyle = (on, color) => (on
      ? { show: true, lineStyle: { type: 'dashed', color: color || '#eff0f1', opacity: 0.9 } }
      : { show: false });
    const nameStyle = (color, size) => ({ color: color || '#1f2329', fontSize: size || 12 });
    let seriesData = seriesPack.series;
    if (useStack && stackMode === 'percent') {
      const totals = seriesPack.categories.map((_, i) =>
        seriesPack.series.reduce((s, ser) => s + (+ser.data[i] || 0), 0)
      );
      seriesData = seriesPack.series.map(s => ({
        ...s,
        data: s.data.map((v, i) => {
          const t = totals[i] || 0;
          return t ? +((v / t) * 100).toFixed(2) : 0;
        })
      }));
    }
    // hbar：数值在横轴、类目在纵轴；普通柱/线：类目在横轴、数值在纵轴
    const valueAxisFinal = {
      type: 'value',
      show: isH ? st.showXAxis !== false : st.showYAxis !== false,
      position: isH ? (st.xAxisPos || 'bottom') : (st.yAxisPos || 'left'),
      name: (isH ? st.showXAxisName : st.showYAxisName) ? (isH ? (st.xAxisName || '') : (st.yAxisName || '')) : undefined,
      nameTextStyle: nameStyle(isH ? st.xAxisNameColor : st.yAxisNameColor, isH ? st.xAxisNameSize : st.yAxisNameSize),
      axisLine: axisLineStyle(
        isH ? st.showXAxisLine !== false : st.showYAxisLine !== false,
        isH ? st.xAxisLineColor : st.yAxisLineColor,
        isH ? st.xAxisLineWidth : st.yAxisLineWidth,
        isH ? st.xAxisLineType : st.yAxisLineType
      ),
      axisTick: { show: isH ? st.showXAxisLine !== false : st.showYAxisLine !== false },
      splitLine: splitStyle(
        isH ? !!st.showXSplitLine : st.showYSplitLine !== false,
        isH ? st.xSplitLineColor : st.ySplitLineColor
      ),
      axisLabel: (isH ? st.showXAxisLabel !== false : st.showYAxisLabel !== false)
        ? {
            show: true,
            color: (isH ? st.xAxisLabelColor : st.yAxisLabelColor) || '#646a73',
            fontSize: (isH ? st.xAxisLabelSize : st.yAxisLabelSize) || 11,
            rotate: isH ? (+st.xAxisLabelRotate || 0) : 0,
            formatter: v => (useStack && stackMode === 'percent' ? `${v}%` : tipVal(v))
          }
        : { show: false },
      max: useStack && stackMode === 'percent' ? 100 : undefined
    };
    const catAxisFinal = {
      type: 'category',
      data: names,
      show: isH ? st.showYAxis !== false : st.showXAxis !== false,
      position: isH ? (st.yAxisPos || 'left') : (st.xAxisPos || 'bottom'),
      name: (isH ? st.showYAxisName : st.showXAxisName) ? (isH ? (st.yAxisName || '') : (st.xAxisName || '')) : undefined,
      nameTextStyle: nameStyle(isH ? st.yAxisNameColor : st.xAxisNameColor, isH ? st.yAxisNameSize : st.xAxisNameSize),
      axisLine: axisLineStyle(
        isH ? st.showYAxisLine !== false : st.showXAxisLine !== false,
        isH ? st.yAxisLineColor : st.xAxisLineColor,
        isH ? st.yAxisLineWidth : st.xAxisLineWidth,
        isH ? st.yAxisLineType : st.xAxisLineType
      ),
      axisTick: { show: isH ? st.showYAxisLine !== false : st.showXAxisLine !== false },
      splitLine: splitStyle(
        isH ? st.showYSplitLine !== false : !!st.showXSplitLine,
        isH ? st.ySplitLineColor : st.xSplitLineColor
      ),
      axisLabel: (isH ? st.showYAxisLabel !== false : st.showXAxisLabel !== false)
        ? {
            show: true,
            color: (isH ? st.yAxisLabelColor : st.xAxisLabelColor) || '#646a73',
            fontSize: (isH ? st.yAxisLabelSize : st.xAxisLabelSize) || 11,
            rotate: isH ? 0 : (+st.xAxisLabelRotate || (names.length > 8 ? 30 : 0))
          }
        : { show: false }
    };
    const markLine = sn.auxEnabled ? {
      symbol: 'none',
      data: [isH
        ? { xAxis: sn.auxValue, name: sn.auxLabel || '辅助线', label: { formatter: sn.auxLabel || '{c}' }, lineStyle: { type: 'dashed', color: '#f54a45' } }
        : { yAxis: sn.auxValue, name: sn.auxLabel || '辅助线', label: { formatter: sn.auxLabel || '{c}' }, lineStyle: { type: 'dashed', color: '#f54a45' } }]
    } : undefined;
    const series = seriesData.map((s, idx) => ({
      name: s.name,
      type: isLine ? 'line' : 'bar',
      stack: useStack ? 'total' : undefined,
      data: s.data,
      barWidth: !isLine && +st.barWidth > 0 ? `${+st.barWidth}%` : undefined,
      barGap: !isLine ? (st.barGap || '30%') : undefined,
      areaStyle: isArea ? { opacity: st.areaOpacity != null ? +st.areaOpacity : 0.35 } : undefined,
      smooth: isLine ? st.smooth !== false : undefined,
      showSymbol: isLine ? st.showSymbol !== false : undefined,
      symbolSize: isLine ? (+st.symbolSize || 6) : undefined,
      lineStyle: isLine ? { width: +st.lineWidth || 2 } : undefined,
      itemStyle: !isLine ? { borderRadius: st.barRadius || 0 } : undefined,
      label: {
        show: showLabel,
        position: isH ? 'right' : 'top',
        fontSize: labelSize,
        color: labelColor,
        formatter: p => (useStack && stackMode === 'percent' ? `${p.value}%` : tipVal(p.value))
      },
      labelLayout: labelAvoid ? { hideOverlap: true } : undefined,
      markLine: idx === 0 ? markLine : undefined
    }));
    if (useStack && st.showStackTotal && showLabel) {
      const totals = seriesPack.categories.map((_, i) =>
        seriesData.reduce((s, ser) => s + (+ser.data[i] || 0), 0)
      );
      const last = series[seriesData.length - 1];
      if (last) {
        last.label = {
          show: true,
          position: isH ? 'right' : 'top',
          fontSize: labelSize,
          color: labelColor,
          formatter: (p) => {
            const sum = totals[p.dataIndex] || 0;
            const self = tipVal(p.value);
            return `${self}\nΣ ${useStack && stackMode === 'percent' ? '100%' : tipVal(sum)}`;
          }
        };
      }
    }
    option = {
      color: seriesColors,
      grid: { left: leftPad, right: rightPad, top: topPad, bottom: botPad, containLabel: true },
      legend,
      tooltip: showTip ? {
        trigger: 'axis',
        textStyle: { fontSize: tipFs },
        valueFormatter: v => (useStack && stackMode === 'percent' ? `${v}%` : tipVal(v))
      } : { show: false },
      xAxis: isH ? valueAxisFinal : catAxisFinal,
      yAxis: isH ? catAxisFinal : valueAxisFinal,
      series
    };
  }
  inst.setOption(option, true);
  // 提示轮播（演示）
  const carKey = `_tipCar_${ch.id}`;
  if (state[carKey]) { clearInterval(state[carKey]); delete state[carKey]; }
  if (st.tooltipCarousel && showTip && ch.chartType !== 'kpi') {
    let i = 0;
    const stay = Math.max(1, +st.tooltipStay || 2) * 1000;
    const gap = Math.max(1, +st.tooltipInterval || 3) * 1000;
    state[carKey] = setInterval(() => {
      if (!state.chartInst[ch.id]) { clearInterval(state[carKey]); delete state[carKey]; return; }
      const n = ch.chartType === 'pie' ? data.length : names.length;
      if (!n) return;
      const idx = i % n;
      try {
        inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
      } catch (_) {}
      i++;
    }, stay + gap);
  }
  inst.off('click');
  inst.on('click', params => {
    const name = params.name || params.value;
    const links = state.dash.linkages.filter(l => l.enabled && l.sourceChartId === ch.id);
    const jump = state.dash.jumps.find(j => j.sourceChartId === ch.id);
    const primaryCat = encodePrimary(ch.encode, 'category');
    const canDrill = state.phase !== 'a' && sn.drillEnabled !== false && primaryCat === 'region' && catFields.length === 1;
    const action = sn.clickAction || 'auto';
    const refreshIds = new Set();

    const doLink = () => {
      if (!links.length) return false;
      state.linkageHits = links.map(l => ({
        sourceChartId: ch.id, sourceField: l.sourceField, value: name,
        targetChartId: l.targetChartId, targetField: l.targetField
      }));
      links.forEach(l => refreshIds.add(l.targetChartId));
      toast(`联动：${name}`, 'ok');
      return true;
    };
    const doDrill = () => {
      if (!canDrill) return false;
      state.drillStack.push({ chartId: ch.id, field: 'region', value: name, next: 'product' });
      pushUndo();
      setEncodeFields(ch.encode, 'category', ['product']);
      toast(`下钻到产品 · ${name}`, 'ok');
      refreshIds.add(ch.id);
      return true;
    };
    const doJump = () => {
      if (!jump) return false;
      toast(`跳转：${jump.target.replace('{value}', name)}`);
      return true;
    };

    if (action === 'linkage') doLink() || doDrill() || doJump();
    else if (action === 'drill') doDrill() || doLink() || doJump();
    else if (action === 'jump') doJump() || doLink() || doDrill();
    else doLink() || doDrill() || doJump();

    refreshIds.forEach(cid => {
      const c = findCompByChartId(cid);
      if (c) refreshComp(c.id, { inspector: false, flash: true });
    });
  });
}

function openCtx(x, y, comp) {
  const ctx = elById('ctx');
  ctx.style.display = 'block';
  ctx.style.left = x + 'px';
  ctx.style.top = y + 'px';
  ctx.innerHTML = `
    <button data-a="copy">复制</button>
    <button data-a="paste">粘贴</button>
    <button data-a="data">查看数据</button>
    ${state.phase==='c'?'<button data-a="sql">查看 SQL</button>':''}
    <button data-a="top">置顶</button>
    <button data-a="bottom">置底</button>
    <button data-a="full">整行宽度</button>
    <button data-a="del">删除</button>`;
  const close = () => { ctx.style.display = 'none'; document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
  ctx.querySelectorAll('button').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'copy') {
        state.clipboard = clone(comp);
        if (comp.chartId) state.clipboard._chart = clone(state.dash.charts[comp.chartId]);
        toast('已复制', 'ok');
      } else if (a === 'paste') pasteComp();
      else if (a === 'data') openDataModal(comp);
      else if (a === 'sql') openSqlModal(comp);
      else if (a === 'top') {
        pushUndo();
        const zs = tabComps().map(c => c.z || 1);
        comp.z = (zs.length ? Math.max(...zs) : 0) + 1;
        commitLayout(tabComps().map(c => c.id === comp.id ? { ...c, z: comp.z } : { ...c }));
        markDirty(); render();
      }
      else if (a === 'bottom') {
        pushUndo();
        const zs = tabComps().map(c => c.z || 1);
        comp.z = (zs.length ? Math.min(...zs) : 1) - 1;
        commitLayout(tabComps().map(c => c.id === comp.id ? { ...c, z: comp.z } : { ...c }));
        markDirty(); render();
      }
      else if (a === 'full') {
        pushUndo();
        const cols = gridCols();
        let layout = tabComps().map(c => c.id === comp.id ? { ...c, w: cols, x: 0 } : { ...c });
        if (state.layout.push) layout = pushLayout(layout, comp.id);
        commitLayout(layout);
        markDirty(); render();
      }
      else if (a === 'del') {
        pushUndo();
        deleteSelectedComp(comp);
        markDirty(); render(); toast('已删除', 'ok');
      }
      ctx.style.display = 'none';
    };
  });
}

function pasteComp() {
  if (!state.clipboard) { toast('剪贴板为空', 'warn'); return; }
  pushUndo();
  const c = clone(state.clipboard);
  c.id = uid('w');
  c.tabId = state.dash.activeTab;
  const slot = findFreeSlot(c.w, c.h);
  c.x = slot.x; c.y = slot.y;
  c.z = state.dash.components.length + 1;
  if (c._chart) {
    const nc = clone(c._chart);
    nc.id = uid('chart');
    nc.title = nc.title + ' 副本';
    state.dash.charts[nc.id] = nc;
    c.chartId = nc.id;
    delete c._chart;
  }
  state.dash.components.push(c);
  state.selectedId = c.id;
  let layout = tabComps().map(x => ({ ...x }));
  if (state.layout.push) layout = pushLayout(layout, c.id);
  commitLayout(layout);
  markDirty();
  render();
  toast('已粘贴', 'ok');
}

function renderMobileDashSettings(el) {
  const m = ensureMobile(state.dash);
  el.innerHTML = `
    <div class="sec"><h4>移动端画布</h4>
      <label class="chk"><input type="checkbox" id="mobEnabled" ${m.enabled?'checked':''}/> 启用移动端布局</label>
      <div class="field"><label>预览机型</label>
        <select id="mobDevice">${mobileDeviceOptgroupsHtml(m.device)}</select>
      </div>
      <div class="field"><label>画布背景</label>
        <div class="color-row"><input type="color" id="mobBg" value="${m.bg || '#f0f2f5'}"/></div>
      </div>
      <p style="font-size:11px;color:var(--text-3);line-height:1.5;margin-top:8px">当前板上 ${m.components.length} 个组件。从左侧勾选上板后可拖拽排版。</p>
    </div>`;
  el.querySelector('#mobEnabled').onchange = e => {
    pushUndo(); m.enabled = e.target.checked; markDirty(); render();
  };
  el.querySelector('#mobDevice').onchange = e => {
    if (setMobileDevice(e.target.value)) render();
  };
  el.querySelector('#mobBg').oninput = e => {
    m.bg = e.target.value; markDirty();
    const shell = document.getElementById('phoneShell');
    const board = document.getElementById('board');
    if (shell) shell.style.background = m.bg;
    if (board && isMobileEdit()) board.style.background = m.bg;
  };
  el.querySelector('#mobBg').onchange = e => {
    pushUndo(); m.bg = e.target.value; markDirty();
  };
}

function editorShellClass() {
  return [
    state.leftCollapsed ? 'no-left' : '',
    state.inspCollapsed ? 'no-insp' : '',
    shouldDataOpsOpen() ? 'data-ops-open' : '',
    state.bindCollapsed ? 'bind-collapsed' : '',
    state.opsCollapsed ? 'ops-collapsed' : ''
  ].filter(Boolean).join(' ');
}

/** After chrome/grid width changes, remeasure colW and reposition widgets + charts. */
let __lastBoardInnerW = 0;
function reflowBoardLayout(force = false) {
  if (isMobileEdit()) {
    requestAnimationFrame(() => fitMobilePhone());
    return;
  }
  const run = () => {
    const board = document.getElementById('board');
    if (!board) return;
    const w = board.clientWidth || 0;
    if (!force && w > 0 && Math.abs(w - __lastBoardInnerW) < 2) return;
    __lastBoardInnerW = w;
    const comps = tabComps();
    const cw = colW(board);
    board.style.backgroundSize = `${cw + gapSize()}px ${rowH() + gapSize()}px`;
    paintPositions(board, comps, cw);
    Object.values(state.chartInst || {}).forEach((c) => {
      try { c.resize(); } catch (_) {}
    });
  };
  // Double rAF: wait for CSS grid column change to commit before measuring clientWidth.
  requestAnimationFrame(() => requestAnimationFrame(run));
}

let __boardResizeObs = null;
function ensureBoardResizeObserver() {
  if (typeof ResizeObserver === 'undefined') return;
  const wrap = document.getElementById('cwrap') || document.querySelector('.canvas-wrap');
  if (!wrap) return;
  if (__boardResizeObs) {
    try { __boardResizeObs.disconnect(); } catch (_) {}
  }
  let timer = 0;
  __boardResizeObs = new ResizeObserver(() => {
    if (timer) cancelAnimationFrame(timer);
    timer = requestAnimationFrame(() => {
      timer = 0;
      if (state.screen !== 'editor' && state.screen !== 'preview') return;
      reflowBoardLayout(false);
    });
  });
  __boardResizeObs.observe(wrap);
}

function syncEditorChrome() {
  const editor = document.querySelector('.hifi-dash-root .editor') || document.querySelector('.editor');
  const bar = document.querySelector('.hifi-dash-root .bar-editor') || document.querySelector('.bar-editor');
  const cls = editorShellClass().split(/\s+/).filter(Boolean);
  const flags = ['no-left', 'no-insp', 'data-ops-open', 'bind-collapsed', 'ops-collapsed'];
  [editor, bar].filter(Boolean).forEach((node) => {
    flags.forEach((f) => node.classList.toggle(f, cls.includes(f)));
  });
  const toggleLeft = document.getElementById('toggleLeft');
  if (toggleLeft) {
    toggleLeft.textContent = state.leftCollapsed ? '显示组件' : '收起组件';
    toggleLeft.title = state.leftCollapsed ? '展开左侧组件库' : '收起左侧组件库';
  }
  const toggleInsp = document.getElementById('toggleInsp');
  if (toggleInsp) {
    toggleInsp.textContent = state.inspCollapsed ? '显示配置' : '收起配置';
    toggleInsp.title = state.inspCollapsed ? '展开右侧配置' : '收起右侧配置';
  }
  syncDataOpsLayout({ skipReflow: true });
  reflowBoardLayout(true);
  ensureBoardResizeObserver();
}

function shouldDataOpsOpen() {
  if (state.inspCollapsed || isMobileEdit()) return false;
  return findComp(state.selectedId)?.type === 'chart';
}

function leftDockHtml(compLabel) {
  return `<nav class="left-dock" aria-label="已收起的组件库">
    <button type="button" class="left-dock-item" data-unfold-left="comp" title="展开组件">
      ${dockIcon('comp')}<span>${esc(compLabel || '组件')}</span>
    </button>
    <button type="button" class="left-dock-item" data-unfold-left="layer" title="展开图层">
      ${dockIcon('layer')}<span>图层</span>
    </button>
  </nav>`;
}

function wireLeftPaneChrome(root) {
  const el = root?.querySelector?.('.left-pane') || root;
  if (!el) return;
  el.querySelectorAll('[data-fold="left"]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      state.leftCollapsed = true;
      syncEditorChrome();
    };
  });
  el.querySelectorAll('[data-unfold-left]').forEach((b) => {
    b.onclick = () => {
      state.leftTab = b.dataset.unfoldLeft === 'layer' ? 'layer' : 'comp';
      state.leftCollapsed = false;
      syncEditorChrome();
      const pane = document.querySelector('.left-pane');
      pane?.querySelectorAll('[data-lt]').forEach((x) => x.classList.toggle('on', x.dataset.lt === state.leftTab));
      renderLeft(document.getElementById('left'));
    };
  });
}

function paneFoldBtn(which, title) {
  return `<button type="button" class="pane-fold" data-fold="${which}" title="${title}" aria-label="${title}">
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3.2 2.6 7 7l-3.8 4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7.2 2.6 11 7l-3.8 4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>`;
}

function dockIcon(kind) {
  if (kind === 'bind') {
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <path d="M2.5 6.2h11M6.2 6.2v7.3" fill="none" stroke="currentColor" stroke-width="1.4"/>
    </svg>`;
  }
  if (kind === 'comp') {
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
    </svg>`;
  }
  if (kind === 'layer') {
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.8 13.2 5.6 8 8.4 2.8 5.6Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M2.8 8.2 8 11l5.2-2.8M2.8 10.6 8 13.4l5.2-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 4.2h10v8.2H3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M3 7h10M6.2 4.2v8.2M9.8 4.2v8.2" fill="none" stroke="currentColor" stroke-width="1.4"/>
  </svg>`;
}

function inspDockHtml() {
  const items = [];
  if (state.bindCollapsed) {
    items.push(`<button type="button" class="insp-dock-item" data-unfold="bind" title="展开图表配置">
      ${dockIcon('bind')}<span>配置</span>
    </button>`);
  }
  if (state.opsCollapsed) {
    items.push(`<button type="button" class="insp-dock-item" data-unfold="ops" title="展开数据集">
      ${dockIcon('ops')}<span>数据</span>
    </button>`);
  }
  if (!items.length) return '';
  return `<nav class="insp-dock" aria-label="已收起的面板">${items.join('')}</nav>`;
}

function wirePaneFolds(el) {
  el.querySelectorAll('[data-fold]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.fold === 'bind') state.bindCollapsed = true;
      else state.opsCollapsed = true;
      syncDataOpsLayout();
      renderRight(document.getElementById('right'));
    };
  });
  el.querySelectorAll('[data-unfold]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.unfold === 'bind') state.bindCollapsed = false;
      else state.opsCollapsed = false;
      syncDataOpsLayout();
      renderRight(document.getElementById('right'));
    };
  });
}

function inspModeSegHtml() {
  return `<div class="insp-mode">
    <div class="seg3" role="tablist" aria-label="配置分组">
      <button type="button" class="${state.rightTab === 'data' ? 'on' : ''}" data-rt="data">数据</button>
      <button type="button" class="${state.rightTab === 'style' ? 'on' : ''}" data-rt="style">样式</button>
      <button type="button" class="${state.rightTab === 'senior' ? 'on' : ''}" data-rt="senior">高级</button>
    </div>
  </div>`;
}

function wireInspMode(el) {
  el.querySelectorAll('[data-rt]').forEach((b) => {
    b.onclick = () => {
      if (state.rightTab === b.dataset.rt) return;
      state.rightTab = b.dataset.rt;
      syncDataOpsLayout();
      renderRight(document.getElementById('right'));
    };
  });
}

function syncDataOpsLayout(opts = {}) {
  const editor = document.querySelector('.hifi-dash-root .editor') || document.querySelector('.editor');
  const bar = document.querySelector('.hifi-dash-root .bar-editor') || document.querySelector('.bar-editor');
  if (!editor) return;
  const open = shouldDataOpsOpen();
  const prevOpen = editor.classList.contains('data-ops-open');
  const prevBind = editor.classList.contains('bind-collapsed');
  const prevOps = editor.classList.contains('ops-collapsed');
  [editor, bar].filter(Boolean).forEach((node) => {
    node.classList.toggle('data-ops-open', open);
    node.classList.toggle('bind-collapsed', !!state.bindCollapsed);
    node.classList.toggle('ops-collapsed', !!state.opsCollapsed);
  });
  const changed = prevOpen !== open
    || prevBind !== !!state.bindCollapsed
    || prevOps !== !!state.opsCollapsed;
  // Collapsing bind/ops to the 48px dock frees width — must reflow even if data-ops-open stays true.
  if (changed && !opts.skipReflow) reflowBoardLayout(true);
}

function closeChartTypePop() {
  document.querySelectorAll('.chart-type-pop').forEach(pop => {
    if (pop._onDoc) document.removeEventListener('mousedown', pop._onDoc, true);
    pop._onDoc = null;
    pop.remove();
  });
  document.querySelectorAll('#ctypeBtn').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
}

function closeDatasetPop() {
  document.querySelectorAll('.ds-picker-pop').forEach(pop => {
    if (pop._onDoc) document.removeEventListener('mousedown', pop._onDoc, true);
    if (pop._onKey) document.removeEventListener('keydown', pop._onKey, true);
    pop._onDoc = null;
    pop._onKey = null;
    pop.remove();
  });
  document.querySelectorAll('#dsPickerTrig').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
}

function chartTypeGroups() {
  const groups = {};
  Object.entries(CHART_META).forEach(([k, v]) => {
    (groups[v.group] = groups[v.group] || []).push([k, v]);
  });
  return ['指标', '比较', '表格', '分布', '趋势']
    .filter(g => groups[g]?.length)
    .map(g => ({ title: g, items: groups[g] }));
}

function chartTypeSwitchHtml(ch) {
  const meta = CHART_META[ch.chartType] || CHART_META.bar;
  const groups = chartTypeGroups();
  const nav = groups.map((g, i) =>
    `<button type="button" class="ctp-nav-item${i === 0 ? ' on' : ''}" data-ctp-cat="${esc(g.title)}">${esc(g.title)}</button>`
  ).join('');
  const panels = groups.map(g => {
    const tiles = g.items.map(([k, v]) =>
      `<button type="button" class="ctp-item${ch.chartType === k ? ' on' : ''}" data-ctype="${k}" title="${esc(v.guide || v.label)}">
        <span class="ctp-thumb">${chartIcon(v.icon)}</span>
        <span class="ctp-name">${esc(v.label)}</span>
      </button>`
    ).join('');
    return `<section class="ctp-sec" data-ctp-sec="${esc(g.title)}">
      <div class="ctp-sec-title">${esc(g.title)}</div>
      <div class="ctp-grid">${tiles}</div>
    </section>`;
  }).join('');
  return `<div class="chart-switch">
    <span class="data-area-label">切换图表</span>
    <button type="button" class="chart-type-select" id="ctypeBtn" aria-haspopup="dialog" aria-expanded="false">
      <span class="chart-type-select-icon">${chartIcon(meta.icon)}</span>
      <span class="chart-type-select-lab">${esc(meta.label)}</span>
      <span class="chart-type-select-caret" aria-hidden="true"></span>
    </button>
    <div class="chart-type-pop" id="ctypePop" hidden role="dialog" aria-label="选择图表类型">
      <div class="ctp-nav">${nav}</div>
      <div class="ctp-body">${panels}</div>
    </div>
  </div>`;
}

function placeChartTypePop(btn, pop) {
  const r = btn.getBoundingClientRect();
  const w = 420;
  const maxH = Math.min(400, window.innerHeight - 16);
  pop.style.width = w + 'px';
  pop.style.maxHeight = maxH + 'px';
  let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
  let top = r.bottom + 6;
  if (top + 280 > window.innerHeight) top = Math.max(8, r.top - Math.min(maxH, 360) - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function wireChartTypePicker(el, ch) {
  const btn = el.querySelector('#ctypeBtn');
  const pop = el.querySelector('#ctypePop');
  if (!btn || !pop) return;
  const host = document.querySelector('.hifi-dash-root') || document.body;
  const close = () => {
    if (pop._onDoc) document.removeEventListener('mousedown', pop._onDoc, true);
    pop._onDoc = null;
    btn.setAttribute('aria-expanded', 'false');
    pop.hidden = true;
    if (pop.parentElement === host) {
      el.querySelector('.chart-switch')?.appendChild(pop);
    }
  };
  const open = () => {
    closeDatasetPop();
    host.appendChild(pop);
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    placeChartTypePop(btn, pop);
    const current = pop.querySelector(`.ctp-item[data-ctype="${ch.chartType}"]`);
    const sec = current?.closest('.ctp-sec');
    pop.querySelectorAll('[data-ctp-cat]').forEach(x => x.classList.toggle('on', x.dataset.ctpCat === sec?.dataset.ctpSec));
    const body = pop.querySelector('.ctp-body');
    if (sec && body) body.scrollTop = sec.offsetTop;
    pop._onDoc = e => {
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      close();
    };
    setTimeout(() => document.addEventListener('mousedown', pop._onDoc, true), 0);
  };
  btn.onclick = e => {
    e.stopPropagation();
    if (pop.hidden) open();
    else close();
  };
  pop.querySelectorAll('[data-ctp-cat]').forEach(n => {
    n.onclick = () => {
      pop.querySelectorAll('[data-ctp-cat]').forEach(x => x.classList.toggle('on', x === n));
      const sec = pop.querySelector(`[data-ctp-sec="${n.dataset.ctpCat}"]`);
      const body = pop.querySelector('.ctp-body');
      if (sec && body) body.scrollTop = sec.offsetTop;
    };
  });
  pop.querySelectorAll('[data-ctype]').forEach(n => {
    n.onclick = () => {
      const next = n.dataset.ctype;
      close();
      if (!next || next === ch.chartType) return;
      pushUndo();
      const prev = ch.encode;
      ch.chartType = next;
      ch.encode = adaptEncodeForChartType(prev, ch.chartType);
      markChartPending(ch.id);
      patchChart(ch, { inspector: true, flash: false, paint: false });
    };
  });
}

function renderRight(el) {
  if (!el) return;
  closeChartTypePop();
  closeDatasetPop();
  syncDataOpsLayout();
  const comp = findComp(state.selectedId);
  if (!comp) {
    if (isMobileEdit()) return renderMobileDashSettings(el);
    // Embedded: keep right chrome collapsed when nothing is selected (avoid blank slab).
    if (__productOpts?.embedded && state.inspCollapsed !== false) {
      state.inspCollapsed = true;
      syncEditorChrome();
    }
    if (state.inspCollapsed) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<div class="insp-scroll"><div class="insp-empty">
      <p>点选组件进行配置</p>
      <p class="insp-empty-hint">画布支持拖拽 / 缩放 / 右键菜单</p>
      <button type="button" class="btn ghost" id="collapseInspEmpty">收起配置</button>
    </div></div>`;
    el.querySelector('#collapseInspEmpty').onclick = () => {
      state.inspCollapsed = true;
      state.inspUserToggled = true;
      syncEditorChrome();
    };
    return;
  }
  if (state.rightTab === 'style') return renderStyle(el, comp);
  if (state.rightTab === 'senior') return renderSenior(el, comp);
  if (comp.type === 'chart') return renderDataPanel(el, comp);
  if (comp.type === 'query') return renderQueryPanel(el, comp);
  if (comp.type === 'slicer') {
    const dimOpts = Object.values(DATASETS).flatMap(d =>
      (d.fields || []).filter(f => f.group === 'dim').map(f => ({ id: d.id, ...f }))
    );
    const uniq = [];
    const seen = new Set();
    dimOpts.forEach(f => {
      if (seen.has(f.name)) return;
      seen.add(f.name);
      uniq.push(f);
    });
    el.innerHTML = `${inspModeSegHtml()}<div class="insp-scroll"><div class="sec"><h4>切片器</h4>
      <div class="field"><label>字段</label>
        <select id="sf">
          <option value="">请选择字段</option>
          ${uniq.map(f => `<option value="${esc(f.name)}">${esc(f.label || f.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>显示名</label><input id="sl" value="${esc(comp.props.label||'')}" placeholder="切片器显示名" /></div>
    </div></div>`;
    el.querySelector('#sf').value = comp.props.field || '';
    el.querySelector('#sf').onchange = e => { pushUndo(); comp.props.field = e.target.value; markDirty(); replaceWidget(comp); };
    el.querySelector('#sl').onchange = e => { pushUndo(); comp.props.label = e.target.value; markDirty(); replaceWidget(comp); };
    wireInspMode(el);
    return;
  }
  if (comp.type === 'text') {
    el.innerHTML = `${inspModeSegHtml()}<div class="insp-scroll"><div class="field"><label>内容</label><textarea id="tx">${esc(comp.props.content||'')}</textarea></div></div>`;
    el.querySelector('#tx').onchange = e => { pushUndo(); comp.props.content = e.target.value; markDirty(); replaceWidget(comp); };
    wireInspMode(el);
  }
}

function chartTitleFieldHtml(ch) {
  return `<div class="chart-title-field">
    <label for="ct">标题</label>
    <input id="ct" value="${esc(ch.title)}" />
  </div>`;
}

function chartOpsAsideHtml(ch) {
  const dataset = ds(ch.datasetId);
  return `<aside class="data-ops">
    <div class="data-pane-hd">
      <span>数据集</span>
      ${paneFoldBtn('ops', '收起数据集')}
    </div>
    <div class="data-ops-ds">${datasetPickerHtml(ch)}</div>
    ${dataset ? fieldBankHtml(ch) : `<p class="data-ops-empty">选择数据集后，在此浏览维度和指标</p>`}
  </aside>`;
}

function datasetPickerLabel(ch) {
  if (!ch.datasetId) return '请选择';
  return ds(ch.datasetId)?.name || '数据集不存在';
}

function datasetGroupOf(d) {
  const f = String(d?.folder || '').trim();
  return f || '未分组';
}

function datasetPickerGroups() {
  const map = new Map();
  Object.values(DATASETS).forEach(d => {
    const g = datasetGroupOf(d);
    map.set(g, (map.get(g) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
}

function datasetPickerChipsHtml(group = '全部') {
  const groups = datasetPickerGroups();
  if (groups.length <= 1) return '';
  const chips = [`<button type="button" class="dsp-chip${group === '全部' ? ' on' : ''}" data-ds-group="全部">全部</button>`];
  groups.forEach(([name, n]) => {
    chips.push(`<button type="button" class="dsp-chip${group === name ? ' on' : ''}" data-ds-group="${esc(name)}">${esc(name)} ${n}</button>`);
  });
  return chips.join('');
}

function datasetPickerListHtml(ch, query = '', group = '全部') {
  const q = String(query || '').trim().toLowerCase();
  const all = Object.values(DATASETS);
  const items = all.filter(d => {
    if (group !== '全部' && datasetGroupOf(d) !== group) return false;
    if (!q) return true;
    return (d.name || '').toLowerCase().includes(q) || String(d.id || '').toLowerCase().includes(q);
  }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  if (!items.length) {
    return `<div class="dsp-empty">${all.length ? '暂无匹配数据集' : '暂无数据集'}</div>`;
  }
  return items.map(d => {
    const g = datasetGroupOf(d);
    const on = ch.datasetId === d.id;
    return `<button type="button" class="dsp-item${on ? ' on' : ''}" data-ds-id="${esc(d.id)}" title="${esc(d.name)}">
      <span class="dsp-name">${esc(d.name)}</span>
      <span class="dsp-meta">${esc(g)}</span>
    </button>`;
  }).join('');
}

function datasetPickerHtml(ch) {
  const current = ds(ch.datasetId);
  const label = datasetPickerLabel(ch);
  return `<div class="ds-picker-row">
    <div class="ds-picker" id="dsPicker">
      <button type="button" class="ds-picker-trig" id="dsPickerTrig" aria-haspopup="dialog" aria-expanded="false" title="${esc(label)}">
        <span class="ds-picker-lab">${esc(label)}</span>
        <span class="ds-picker-caret" aria-hidden="true"></span>
      </button>
      <div class="ds-picker-pop" id="dsPickerPop" hidden role="dialog" aria-label="选择数据集">
        <div class="dsp-hd">
          <b>数据集</b>
          <button type="button" class="dsp-link" id="dsRefresh">刷新</button>
        </div>
        <div class="dsp-search">
          <span class="dsp-search-ico" aria-hidden="true"></span>
          <input id="dsSearch" type="search" placeholder="搜索名称" autocomplete="off" />
        </div>
        <div class="dsp-groups" id="dsGroups">${datasetPickerChipsHtml('全部')}</div>
        <div class="dsp-list" id="dsList">${datasetPickerListHtml(ch)}</div>
        <div class="dsp-ft">
          <button type="button" class="dsp-link dsp-add" id="dsCreate"><span class="dsp-plus" aria-hidden="true"></span>新建数据集</button>
        </div>
      </div>
    </div>
    ${current ? `<button type="button" class="ds-picker-edit" id="dsEdit" title="编辑数据集" aria-label="编辑数据集">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M9.1 3.3 12.7 6.9 6.2 13.4H2.6v-3.6z"/><path fill="none" stroke="currentColor" stroke-width="1.4" d="m8 4.4 3.6 3.6"/></svg>
    </button>` : ''}
  </div>`;
}

function openDatasetManagePage(id) {
  const path = id ? `/datasets/${encodeURIComponent(id)}?studio=1` : '/datasets?studio=1';
  window.open(path, '_blank', 'noopener');
}

async function refreshProductDatasets() {
  const fn = __productOpts && __productOpts.refreshDatasets;
  if (typeof fn !== 'function') return;
  const next = await fn();
  if (!next || typeof next !== 'object') return;
  Object.keys(DATASETS).forEach((k) => { delete DATASETS[k]; });
  Object.keys(next).forEach((k) => { DATASETS[k] = next[k]; });
}

function applyDatasetChoice(ch, nextId) {
  const id = nextId || null;
  if (id === (ch.datasetId || null)) return;
  pushUndo();
  ch.datasetId = id;
  ch.encode = emptyEncode(ch.chartType);
  markChartPending(ch.id);
  patchChart(ch, { inspector: true, flash: false, paint: false });
}

function placeDatasetPop(btn, pop) {
  const r = btn.getBoundingClientRect();
  const w = 320;
  const maxH = Math.min(356, window.innerHeight - 16);
  pop.style.width = w + 'px';
  pop.style.maxHeight = maxH + 'px';
  let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
  let top = r.bottom + 4;
  if (top + 280 > window.innerHeight) top = Math.max(8, r.top - Math.min(maxH, 320) - 4);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function wireDatasetPicker(el, ch) {
  const trig = el.querySelector('#dsPickerTrig');
  const pop = el.querySelector('#dsPickerPop');
  if (!trig || !pop) return;
  const host = document.querySelector('.hifi-dash-root') || document.body;
  const listEl = () => pop.querySelector('#dsList');
  const searchEl = () => pop.querySelector('#dsSearch');
  const chipsEl = () => pop.querySelector('#dsGroups');
  const currentGroup = () => pop.dataset.dsGroup || '全部';
  const paint = () => {
    const chips = chipsEl();
    const list = listEl();
    if (chips) chips.innerHTML = datasetPickerChipsHtml(currentGroup());
    if (list) list.innerHTML = datasetPickerListHtml(ch, searchEl()?.value || '', currentGroup());
    bindPicker();
  };
  const bindPicker = () => {
    listEl()?.querySelectorAll('[data-ds-id]').forEach(n => {
      n.onclick = () => {
        const next = n.dataset.dsId || null;
        close();
        applyDatasetChoice(ch, next);
      };
    });
    chipsEl()?.querySelectorAll('[data-ds-group]').forEach(n => {
      n.onclick = e => {
        e.stopPropagation();
        pop.dataset.dsGroup = n.dataset.dsGroup || '全部';
        paint();
      };
    });
  };
  const close = () => {
    if (pop._onDoc) document.removeEventListener('mousedown', pop._onDoc, true);
    if (pop._onKey) document.removeEventListener('keydown', pop._onKey, true);
    pop._onDoc = null;
    pop._onKey = null;
    trig.setAttribute('aria-expanded', 'false');
    pop.hidden = true;
    if (pop.parentElement === host) {
      el.querySelector('#dsPicker')?.appendChild(pop);
    }
  };
  const open = () => {
    closeChartTypePop();
    host.appendChild(pop);
    pop.hidden = false;
    trig.setAttribute('aria-expanded', 'true');
    pop.dataset.dsGroup = '全部';
    const q = searchEl();
    if (q) q.value = '';
    placeDatasetPop(trig, pop);
    paint();
    setTimeout(() => q?.focus(), 0);
    pop._onDoc = e => {
      if (pop.contains(e.target) || trig.contains(e.target)) return;
      close();
    };
    pop._onKey = e => {
      if (e.key === 'Escape') close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', pop._onDoc, true);
      document.addEventListener('keydown', pop._onKey, true);
    }, 0);
  };
  trig.onclick = e => {
    e.stopPropagation();
    if (pop.hidden) open();
    else close();
  };
  searchEl()?.addEventListener('input', () => paint());
  pop.querySelector('#dsRefresh')?.addEventListener('click', async e => {
    e.stopPropagation();
    const list = listEl();
    if (list) list.innerHTML = '<div class="dsp-empty">刷新中…</div>';
    try {
      await refreshProductDatasets();
      paint();
      const lab = trig.querySelector('.ds-picker-lab');
      if (lab) lab.textContent = datasetPickerLabel(ch);
      trig.title = datasetPickerLabel(ch);
      const ops = el.querySelector('.data-ops');
      const bank = ops?.querySelector('.field-bank');
      const empty = ops?.querySelector(':scope > .data-ops-empty');
      if (ds(ch.datasetId)) {
        if (bank) {
          bank.outerHTML = fieldBankHtml(ch);
          wireFieldBank(el, ch);
        } else if (empty) {
          empty.outerHTML = fieldBankHtml(ch);
          wireFieldBank(el, ch);
        }
      }
      toast('数据集已刷新', 'ok');
    } catch (err) {
      paint();
      toast(err instanceof Error ? err.message : '刷新失败', 'warn');
    }
  });
  pop.querySelector('#dsCreate')?.addEventListener('click', e => {
    e.stopPropagation();
    close();
    openDatasetManagePage();
    toast('请在新页保存数据集后，回来点「刷新」');
  });
  el.querySelector('#dsEdit')?.addEventListener('click', e => {
    e.stopPropagation();
    if (ch.datasetId) openDatasetManagePage(ch.datasetId);
  });
}

function wireChartShell(el, ch) {
  el.querySelector('#ct')?.addEventListener('change', e => {
    pushUndo(); ch.title = e.target.value;
    patchChart(ch, { inspector: false, flash: false });
  });
  wireDatasetPicker(el, ch);
}

function mountChartWork(el, ch, { leftInner, foot = '' }) {
  const bindRail = !!state.bindCollapsed;
  const opsRail = !!state.opsCollapsed;
  const workClass = [
    bindRail && opsRail ? 'dock-only' : '',
    bindRail && !opsRail ? 'bind-rail' : '',
    !bindRail && opsRail ? 'ops-rail' : ''
  ].filter(Boolean).join(' ');
  el.innerHTML = `
    <div class="data-work${workClass ? ` ${workClass}` : ''}">
      ${bindRail ? '' : `<div class="data-bind">
          <div class="data-bind-hd">
            <input id="ct" class="insp-title" value="${esc(ch.title)}" placeholder="图表标题" />
            ${paneFoldBtn('bind', '收起图表配置')}
          </div>
          ${inspModeSegHtml()}
          <div class="data-bind-body">${leftInner}</div>
          ${foot}
        </div>`}
      ${opsRail ? '' : chartOpsAsideHtml(ch)}
      ${inspDockHtml()}
    </div>`;
  wireInspMode(el);
  wirePaneFolds(el);
  wireChartShell(el, ch);
  if (!opsRail && ds(ch.datasetId)) wireFieldBank(el, ch);
}

function dataBindSlotsHtml(ch, meta) {
  const switcher = chartTypeSwitchHtml(ch);
  if (!ds(ch.datasetId)) {
    return `${switcher}<p class="data-ops-empty">请先选择数据集，再把维度、指标拖入槽位</p>`;
  }
  migrateTableEncode(ch);
  const aggFmt = ch.chartType !== 'table' ? `<div class="field inline-2"><div class="field" style="margin:0"><label>默认聚合</label>
        <select id="agg">${['SUM','COUNT','AVG','MAX','MIN'].map(a => `<option ${ (ch.encode.agg||'SUM')===a?'selected':''}>${a}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>默认数值格式</label>
        <select id="fmt">
          <option value="raw" ${ch.encode.format==='raw'?'selected':''}>智能（默认）</option>
          <option value="integer" ${ch.encode.format==='integer'?'selected':''}>整数</option>
          <option value="thousand" ${ch.encode.format==='thousand'?'selected':''}>千分位</option>
          <option value="fixed1" ${ch.encode.format==='fixed1'?'selected':''}>一位小数</option>
          <option value="fixed2" ${ch.encode.format==='fixed2'?'selected':''}>两位小数</option>
          <option value="percent" ${ch.encode.format==='percent'?'selected':''}>百分比</option>
        </select>
      </div></div>
      <p class="field-cfg-hint">未单独配置的字段沿用上方默认值。</p>` : '';
  return `
      ${switcher}
      ${ch.chartType === 'table' ? '' : encodeGuideHtml(ch)}
      ${ch.chartType === 'pivot' ? slotHtml('category', '行维度', 'dim', ch) : ''}
      ${ch.chartType === 'pivot' ? slotHtml('colDim', '列维度', 'dim', ch) : ''}
      ${ch.chartType === 'table' ? slotHtml('category', '表格列 / 维度', 'dim', ch) : ''}
      ${ch.chartType === 'table' ? slotHtml('value', '表格列 / 指标', 'quota', ch) : ''}
      ${ch.chartType === 'table' ? `<div class="slot-actions"><button type="button" class="btn ghost" id="btnFillAllCols">填入全部字段</button></div>` : ''}
      ${ch.chartType !== 'pivot' && ch.chartType !== 'table' && meta.need.includes('category') ? slotHtml('category', '维度', 'dim', ch) : ''}
      ${ch.chartType !== 'pivot' && ch.chartType !== 'table' ? slotHtml('value', '指标', 'quota', ch) : ''}
      ${meta.slots?.color && (ch.chartType === 'grouptable' || (state.phase!=='a' && !isTableType(ch.chartType))) ? slotHtml('color', ch.chartType==='grouptable' ? '二级分组（可选）' : '堆叠/拆色维（可选）', 'dim', ch) : ''}
      <p class="field-cfg-hint">从操作区拖入字段；点 pill 上的 <b>▾</b> 可设显示名、排序与格式。</p>
      ${aggFmt}
      <div class="data-sub">
        <h4>过滤与条数</h4>
        <div class="q-bind-summary">
          <div class="q-bind-summary-text" title="${esc(chartFiltersSummary(ch))}">${esc(chartFiltersSummary(ch))}</div>
          <button type="button" class="btn ghost" id="cfgChartFilters" style="height:28px;flex-shrink:0">配置过滤条件…</button>
        </div>
        <div class="field" style="margin-top:10px">
          <label>展示条数</label>
          <select id="resultLimit">
            <option value="0" ${!ensureSenior(ch).resultLimit?'selected':''}>全部</option>
            ${[5,10,20,50,100,200].map(n => `<option value="${n}" ${+ensureSenior(ch).resultLimit===n?'selected':''}>前 ${n} 条</option>`).join('')}
          </select>
        </div>
      </div>`;
}

function renderDataPanel(el, comp) {
  const ch = state.dash.charts[comp.chartId];
  const dataset = ds(ch.datasetId);
  const meta = CHART_META[ch.chartType];
  const miss = missingBind(ch);
  const pending = state.pendingPaint?.has(ch.id);
  mountChartWork(el, ch, {
    paneTitle: '数据绑定',
    leftInner: `${dataBindSlotsHtml(ch, meta)}${miss.length ? `<div class="miss"><b>缺失要素</b>${miss.map(m=>`<button data-focus="${m.key}">→ ${esc(m.label)}</button>`).join('')}</div>` : ''}`,
    foot: `<div class="data-bind-foot">
      ${pending ? '<span class="pending-hint">字段已变更，点击下方按钮刷新图表</span>' : ''}
      <button type="button" class="btn primary btn-apply-data" id="btnApplyData" ${miss.length ? 'disabled' : ''}>更新数据</button>
    </div>`
  });
  wireChartTypePicker(el, ch);
  if (dataset) {
    el.querySelector('#agg') && (el.querySelector('#agg').onchange = e => {
      pushUndo(); ch.encode.agg = e.target.value;
      markChartPending(ch.id);
      patchChart(ch, { inspector: false, flash: false, paint: false });
      renderRight(el);
    });
    el.querySelector('#fmt') && (el.querySelector('#fmt').onchange = e => {
      pushUndo(); ch.encode.format = e.target.value;
      markChartPending(ch.id);
      patchChart(ch, { inspector: false, flash: false, paint: false });
      renderRight(el);
    });
    el.querySelector('#cfgChartFilters')?.addEventListener('click', () => openChartFilterModal(ch));
    el.querySelector('#resultLimit')?.addEventListener('change', e => {
      pushUndo();
      ensureSenior(ch).resultLimit = +e.target.value || 0;
      markChartPending(ch.id);
      markDirty();
      patchChart(ch, { inspector: false, flash: false, paint: false });
    });
    el.querySelector('#btnFillAllCols')?.addEventListener('click', () => {
      pushUndo();
      fillTableColumnsFromDataset(ch, true);
      markChartPending(ch.id);
      patchChart(ch, { inspector: true, flash: false, paint: false });
    });
    wireSlots(el, ch);
  }
  el.querySelector('#btnApplyData')?.addEventListener('click', () => {
    if (missingBind(ch).length) return;
    applyChartDataUpdate(ch);
  });
}

function layoutSecHtml(comp) {
  return `
    <div class="sec">
      <h4>布局${useMobileLayout() ? ' · 移动 6 列' : ''}（X / Y / 宽 / 高）</h4>
      <div class="lay-grid">
        <div class="field"><label>X</label><input type="number" id="layX" min="0" max="${gridCols()-1}" value="${comp.x}" /></div>
        <div class="field"><label>Y</label><input type="number" id="layY" min="0" value="${comp.y}" /></div>
        <div class="field"><label>宽</label><input type="number" id="layW" min="1" max="${gridCols()}" value="${comp.w}" /></div>
        <div class="field"><label>高</label><input type="number" id="layH" min="1" value="${comp.h}" /></div>
      </div>
      <div class="preset-row" style="margin-top:8px">
        <button type="button" data-pw="${gridCols()}">整行</button>
        <button type="button" data-pw="${Math.max(1, Math.floor(gridCols()/2))}">半宽</button>
        <button type="button" data-pw="${Math.max(1, Math.floor(gridCols()/3))}">1/3</button>
      </div>
    </div>`;
}

function wireLayoutControls(el, comp) {
  const applyLay = () => {
    const min = minWH(comp);
    let x = +el.querySelector('#layX')?.value, y = +el.querySelector('#layY')?.value;
    let w = +el.querySelector('#layW')?.value, h = +el.querySelector('#layH')?.value;
    if ([x, y, w, h].some(n => Number.isNaN(n))) return;
    pushUndo();
    const cols = gridCols();
    w = Math.max(min.w, Math.min(cols, w));
    h = Math.max(min.h, h);
    x = Math.max(0, Math.min(cols - w, x));
    y = Math.max(0, y);
    let layout = tabComps().map(c => c.id === comp.id ? { ...c, x, y, w, h } : { ...c });
    if (state.layout.push) layout = pushLayout(layout, comp.id);
    commitLayout(layout);
    markDirty();
    const board = document.getElementById('board');
    paintPositions(board, layout, colW(board));
    Object.values(state.chartInst).forEach(c => { try { c.resize(); } catch (_) {} });
  };
  ['#layX', '#layY', '#layW', '#layH'].forEach(sel => {
    const node = el.querySelector(sel);
    if (node) node.onchange = applyLay;
  });
  el.querySelectorAll('[data-pw]').forEach(b => {
    b.onclick = () => {
      const w = el.querySelector('#layW');
      if (w) w.value = b.dataset.pw;
      applyLay();
    };
  });
}

function slotHtml(slot, label, accept, ch) {
  const names = encodeFields(ch.encode, slot);
  const max = slotMax(ch.chartType, slot);
  const unlimited = !Number.isFinite(max);
  const tip = slotTip(ch.chartType, slot);
  const multi = unlimited || max > 1;
  const pills = names.map((name, idx) => {
    const meta = fieldMeta(ch.datasetId, name);
    let g = accept === 'any'
      ? (meta ? fieldRole(ch, meta) : 'dim')
      : (meta ? fieldRole(ch, meta) : (accept === 'quota' ? 'quota' : 'dim'));
    const tag = meta && isFieldConverted(ch, meta) ? ' ·转' : '';
    const cfg = fieldCfgOf(ch, name);
    const badges = [];
    if (g === 'quota' && ch.chartType !== 'table' && slot !== 'columns' && (cfg.agg || ch.encode.agg)) badges.push(cfg.agg || ch.encode.agg || 'SUM');
    if (cfg.sort && cfg.sort !== 'none') badges.push(cfg.sort === 'desc' ? '↓' : cfg.sort === 'asc' ? '↑' : 'A');
    if (cfg.alias) badges.push('名');
    const badge = badges.length ? `<span class="pill-badge">${esc(badges[0])}</span>` : '';
    const kind = fieldKind(meta, g);
    return `<span class="pill ${g} axis-item" draggable="true" data-pill-idx="${idx}" data-pill-slot="${slot}" title="${esc(displayFieldLabel(ch, name))}">
      <i class="ftype kind-${kind}">${fieldKindGlyph(kind)}</i>
      <span class="pill-lab">${esc(displayFieldLabel(ch, name))}${tag}</span>${badge}
      <button type="button" class="pill-cfg" data-cfg-slot="${slot}" data-cfg-field="${esc(name)}" data-cfg-role="${g}" data-cfg-idx="${idx}" title="字段设置">▾</button>
      <button type="button" data-clear="${slot}" data-clear-idx="${idx}" title="移除">×</button>
    </span>`;
  }).join('');
  const countHint = unlimited
    ? (names.length ? `${names.length} 列` : '')
    : (multi ? `${names.length}/${max}` : (max === 1 ? '单选' : ''));
  const hint = countHint
    ? `<span class="slot-hint" title="${esc(tip)}">${esc(countHint)}</span>`
    : '';
  const ph = '拖拽字段至此处';
  const clearBtn = multi
    ? `<button type="button" class="slot-clear" data-clear="${slot}" title="清空"${names.length ? '' : ' disabled'}>清空</button>`
    : '';
  return `<div class="field slot-field">
    <div class="form-draggable-title">
      <label title="${esc(tip)}">${label}${hint ? ' ' + hint : ''}</label>
      ${clearBtn}
    </div>
    ${tip ? `<div class="slot-tip">${esc(tip)}</div>` : ''}
    <div class="slot ${multi ? 'slot-axis' : ''}" data-slot="${slot}" data-accept="${accept}" data-max="${unlimited ? 0 : max}">
      ${pills || `<span class="ph">${esc(ph)}</span>`}
    </div>
  </div>`;
}

function openFieldCfgPopover(ch, field, slot, role, idx, anchor) {
  closeFieldCfgPopover();
  const cfg = fieldCfgOf(ch, field);
  const isQuota = role === 'quota' || slot === 'value';
  const showAgg = isQuota && ch.chartType !== 'table';
  const isDim = !isQuota;
  const list = encodeFields(ch.encode, slot);
  const canMove = list.length > 1;
  const pop = document.createElement('div');
  pop.id = 'fieldCfgPop';
  pop.className = 'field-cfg-pop';
  pop.innerHTML = `
    <div class="fcp-hd">${esc(fieldLabelOf(ch.datasetId, field))} <span>${esc(slotLabel(ch.chartType, slot))}</span></div>
    <label class="fcp-row"><span>显示名</span>
      <input id="fcpAlias" value="${esc(cfg.alias || '')}" placeholder="默认字段名"/>
    </label>
    ${showAgg ? `<label class="fcp-row"><span>聚合</span>
      <select id="fcpAgg">${['SUM','COUNT','AVG','MAX','MIN'].map(a =>
        `<option value="${a}" ${(cfg.agg || ch.encode.agg || 'SUM')===a?'selected':''}>${a}</option>`).join('')}</select>
    </label>` : ''}
    ${isQuota || slot === 'columns' ? `<label class="fcp-row"><span>数值格式</span>
      <select id="fcpFmt">
        ${[['raw','智能'],['integer','整数'],['thousand','千分位'],['fixed1','一位小数'],['fixed2','两位小数'],['percent','百分比']].map(([k,lab]) =>
          `<option value="${k}" ${(cfg.format || ch.encode.format || 'raw')===k?'selected':''}>${lab}</option>`).join('')}
      </select>
    </label>` : ''}
    ${isDim || slot === 'category' || slot === 'colDim' || slot === 'columns' ? `<label class="fcp-row"><span>排序</span>
      <select id="fcpSort">
        ${[['none','默认'],['asc','按值升序'],['desc','按值降序'],['alpha','按名 A→Z'],['alpha_desc','按名 Z→A']].map(([k,lab]) =>
          `<option value="${k}" ${(cfg.sort||'none')===k?'selected':''}>${lab}</option>`).join('')}
      </select>
    </label>` : ''}
    ${canMove ? `<div class="fcp-move">
      <button type="button" id="fcpUp" ${idx<=0?'disabled':''}>上移</button>
      <button type="button" id="fcpDown" ${idx>=list.length-1?'disabled':''}>下移</button>
    </div>` : ''}
    <div class="fcp-actions">
      <button type="button" class="btn ghost" id="fcpReset">重置</button>
      <button type="button" class="btn primary" id="fcpOk">确定</button>
    </div>`;
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  const pw = 240;
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + 280 > window.innerHeight) top = Math.max(8, rect.top - 280);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const applyPending = () => {
    pushUndo();
    const next = fieldCfgOf(ch, field);
    const alias = pop.querySelector('#fcpAlias')?.value?.trim() || '';
    if (alias) next.alias = alias; else delete next.alias;
    if (pop.querySelector('#fcpAgg')) next.agg = pop.querySelector('#fcpAgg').value;
    if (pop.querySelector('#fcpFmt')) next.format = pop.querySelector('#fcpFmt').value;
    if (pop.querySelector('#fcpSort')) {
      const s = pop.querySelector('#fcpSort').value;
      if (s && s !== 'none') next.sort = s; else delete next.sort;
    }
    markChartPending(ch.id);
    markDirty();
  };

  pop.querySelector('#fcpOk').onclick = () => {
    applyPending();
    closeFieldCfgPopover();
    patchChart(ch, { inspector: true, flash: false, paint: false });
  };
  pop.querySelector('#fcpReset').onclick = () => {
    pushUndo();
    delete ensureFieldCfg(ch)[field];
    markChartPending(ch.id);
    closeFieldCfgPopover();
    patchChart(ch, { inspector: true, flash: false, paint: false });
  };
  pop.querySelector('#fcpUp')?.addEventListener('click', () => {
    if (idx <= 0) return;
    pushUndo();
    const arr = encodeFields(ch.encode, slot);
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    setEncodeFields(ch.encode, slot, arr);
    markChartPending(ch.id);
    closeFieldCfgPopover();
    patchChart(ch, { inspector: true, flash: false, paint: false });
  });
  pop.querySelector('#fcpDown')?.addEventListener('click', () => {
    const arr = encodeFields(ch.encode, slot);
    if (idx >= arr.length - 1) return;
    pushUndo();
    [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
    setEncodeFields(ch.encode, slot, arr);
    markChartPending(ch.id);
    closeFieldCfgPopover();
    patchChart(ch, { inspector: true, flash: false, paint: false });
  });

  const onDoc = (ev) => {
    if (pop.contains(ev.target) || ev.target.closest?.('.pill-cfg')) return;
    closeFieldCfgPopover();
  };
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
  pop._onDoc = onDoc;
}

function closeFieldCfgPopover() {
  const pop = document.getElementById('fieldCfgPop');
  if (!pop) return;
  if (pop._onDoc) document.removeEventListener('mousedown', pop._onDoc, true);
  pop.remove();
}

function wireFieldBank(root, ch) {
  const bank = root.querySelector('#fieldBank');
  if (!bank) return;

  root.querySelectorAll('[data-toggle-bank]').forEach(btn => {
    btn.onclick = () => {
      const g = btn.closest('.fb-group');
      g?.classList.toggle('collapsed');
    };
  });

  const search = root.querySelector('#fsearch');
  const applySearch = () => {
    const q = (search?.value || '').trim().toLowerCase();
    let dimShow = 0, quoShow = 0;
    root.querySelectorAll('.fchip').forEach(chip => {
      const hit = !q || (chip.dataset.label || '').toLowerCase().includes(q) || (chip.dataset.f || '').toLowerCase().includes(q);
      chip.style.display = hit ? '' : 'none';
      if (hit && chip.dataset.g === 'dim') dimShow++;
      if (hit && chip.dataset.g === 'quota') quoShow++;
    });
    const dimCnt = root.querySelector('#dimCnt');
    const quoCnt = root.querySelector('#quoCnt');
    if (dimCnt) dimCnt.textContent = q ? `${dimShow}/${fieldsByRole(ch, 'dim').length}` : String(fieldsByRole(ch, 'dim').length);
    if (quoCnt) quoCnt.textContent = q ? `${quoShow}/${fieldsByRole(ch, 'quota').length}` : String(fieldsByRole(ch, 'quota').length);
  };
  if (search) {
    if (state._fieldSearch) {
      search.value = state._fieldSearch;
      applySearch();
    }
    search.oninput = () => { state._fieldSearch = search.value; applySearch(); };
  }

  const doConvert = (fieldName) => {
    pushUndo();
    const before = fieldRole(ch, fieldName);
    toggleFieldRole(ch, fieldName);
    const after = fieldRole(ch, fieldName);
    toast(`「${fieldMeta(ch.datasetId, fieldName)?.label || fieldName}」已转为${after === 'dim' ? '维度' : '指标'}`, 'ok');
    patchChart(ch, { inspector: true, flash: false });
  };

  root.querySelectorAll('[data-conv]').forEach(btn => {
    btn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      doConvert(btn.dataset.conv);
    };
  });

  root.querySelectorAll('.fchip').forEach(chip => {
    chip.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      const ctx = elById('ctx');
      const role = chip.dataset.g;
      const to = role === 'dim' ? '指标' : '维度';
      ctx.style.display = 'block';
      ctx.style.left = e.clientX + 'px';
      ctx.style.top = e.clientY + 'px';
      ctx.innerHTML = `
        <button data-a="bind">绑定到槽位</button>
        <button data-a="conv">转换为${to}</button>
        <button data-a="reset">恢复物理类型</button>`;
      const close = () => { ctx.style.display = 'none'; document.removeEventListener('click', close); };
      setTimeout(() => document.addEventListener('click', close), 0);
      ctx.querySelectorAll('button').forEach(b => {
        b.onclick = ev => {
          ev.stopPropagation();
          if (b.dataset.a === 'conv') doConvert(chip.dataset.f);
          else if (b.dataset.a === 'reset') {
            pushUndo();
            if (ch.fieldRoles) delete ch.fieldRoles[chip.dataset.f];
            toast('已恢复物理类型', 'ok');
            patchChart(ch, { inspector: true, flash: false });
          } else if (b.dataset.a === 'bind') {
            const slot = resolveSlotEl(root, ch, chip.dataset.g, null);
            if (!slot) alertDialog('无可用槽位');
            else applySlotFields(ch, slot, [{ field: chip.dataset.f, group: chip.dataset.g }]);
          }
          ctx.style.display = 'none';
        };
      });
    };
  });
}

function preferSlotKey(ch, group) {
  let prefer = group === 'dim' ? 'category' : 'value';
  if (group === 'dim' && ch.chartType === 'pivot') {
    const rowN = encodeFields(ch.encode, 'category').length;
    const colN = encodeFields(ch.encode, 'colDim').length;
    if (!rowN) prefer = 'category';
    else if (!colN) prefer = 'colDim';
    else prefer = 'category';
  }
  return prefer;
}

function resolveSlotEl(root, ch, group, active) {
  const prefer = preferSlotKey(ch, group);
  return active
    || root.querySelector(`.slot[data-slot="${prefer}"]`)
    || root.querySelector(`.slot[data-accept="${group}"]`)
    || root.querySelector('.slot[data-accept="any"]');
}

function applyFieldSelect(root, chip, e) {
  const all = [...root.querySelectorAll('.fchip')];
  const bank = chip.closest('.chip-bank');
  const vis = bank
    ? [...bank.querySelectorAll('.fchip')].filter(c => c.style.display !== 'none')
    : all.filter(c => c.style.display !== 'none');
  if (e.shiftKey) {
    const anchor = all.find(c => c.classList.contains('anchor')) || chip;
    const a = vis.indexOf(anchor);
    const b = vis.indexOf(chip);
    if (a < 0 || b < 0) {
      all.forEach(c => c.classList.remove('active', 'anchor'));
      chip.classList.add('active', 'anchor');
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    all.forEach(c => c.classList.remove('active'));
    vis.slice(lo, hi + 1).forEach(c => c.classList.add('active'));
    return;
  }
  if (e.metaKey || e.ctrlKey) {
    chip.classList.toggle('active');
    all.forEach(c => c.classList.remove('anchor'));
    chip.classList.add('anchor');
    return;
  }
  const onlyThis = chip.classList.contains('active') && all.filter(c => c.classList.contains('active')).length === 1;
  all.forEach(c => c.classList.remove('active', 'anchor'));
  if (!onlyThis) chip.classList.add('active', 'anchor');
}

function selectedFieldItems(root, fallbackChip) {
  const selected = [...root.querySelectorAll('.fchip.active')];
  const chips = selected.length && (!fallbackChip || selected.some(c => c === fallbackChip))
    ? selected
    : (fallbackChip ? [fallbackChip] : []);
  return chips.map(c => ({ field: c.dataset.f, group: c.dataset.g }));
}

function wireSlots(root, ch) {
  let active = null;
  let skipClick = false;
  wireFieldBank(root, ch);
  root.querySelectorAll('.slot').forEach(slot => {
    slot.onclick = e => {
      if (e.target.closest('[data-clear]') || e.target.closest('.pill-cfg') || e.target.closest('.axis-item')) return;
      root.querySelectorAll('.slot').forEach(s => s.classList.remove('over'));
      slot.classList.add('over');
      active = slot;
    };
    slot.ondragover = e => { e.preventDefault(); slot.classList.add('over'); };
    slot.ondragleave = () => slot.classList.remove('over');
    slot.ondrop = e => {
      e.preventDefault();
      slot.classList.remove('over');
      let payload = null;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch { payload = null; }
      if (payload?.kind === 'reorder') {
        if (payload.slot !== slot.dataset.slot) {
          if (ch.chartType === 'table') {
            const fromList = encodeFields(ch.encode, payload.slot);
            const moved = fromList[+payload.idx];
            if (!moved) return;
            const group = fieldRole(ch, moved) === 'quota' ? 'quota' : 'dim';
            applySlotFields(ch, slot, [{ field: moved, group }]);
          }
          return;
        }
        const list = encodeFields(ch.encode, payload.slot);
        const from = +payload.idx;
        if (from < 0 || from >= list.length) return;
        const over = e.target.closest('.axis-item');
        let to = over ? +over.dataset.pillIdx : list.length - 1;
        if (Number.isNaN(to)) to = list.length - 1;
        if (to === from) return;
        pushUndo();
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        setEncodeFields(ch.encode, payload.slot, list);
        syncTableColumnsEncode(ch);
        markChartPending(ch.id);
        patchChart(ch, { inspector: true, flash: false, paint: false });
        return;
      }
      let items = Array.isArray(payload?.items) ? payload.items : [];
      if (!items.length) {
        const f = e.dataTransfer.getData('f');
        const g = e.dataTransfer.getData('g');
        if (f) items = [{ field: f, group: g }];
      }
      if (items.length) applySlotFields(ch, slot, items);
    };
  });
  root.querySelectorAll('.axis-item').forEach(pill => {
    pill.ondragstart = e => {
      if (e.target.closest('button')) { e.preventDefault(); return; }
      skipClick = true;
      e.dataTransfer.setData('text/plain', JSON.stringify({
        kind: 'reorder',
        slot: pill.dataset.pillSlot,
        idx: +pill.dataset.pillIdx
      }));
      e.dataTransfer.effectAllowed = 'move';
    };
  });
  root.querySelectorAll('.pill-cfg').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      openFieldCfgPopover(ch, b.dataset.cfgField, b.dataset.cfgSlot, b.dataset.cfgRole, +b.dataset.cfgIdx, b);
    };
  });
  root.querySelectorAll('[data-clear]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      if (b.disabled) return;
      pushUndo();
      const slot = b.dataset.clear;
      const idx = b.dataset.clearIdx != null ? +b.dataset.clearIdx : -1;
      const list = encodeFields(ch.encode, slot);
      if (idx >= 0 && idx < list.length) list.splice(idx, 1);
      else list.length = 0;
      setEncodeFields(ch.encode, slot, list);
      syncTableColumnsEncode(ch);
      markChartPending(ch.id);
      patchChart(ch, { inspector: true, flash: false, paint: false });
    };
  });
  root.querySelectorAll('.fchip').forEach(chip => {
    chip.ondragstart = e => {
      if (e.target.closest('[data-conv]')) { e.preventDefault(); return; }
      skipClick = true;
      if (!chip.classList.contains('active')) {
        root.querySelectorAll('.fchip').forEach(c => c.classList.remove('active', 'anchor'));
        chip.classList.add('active', 'anchor');
      }
      const items = selectedFieldItems(root, chip);
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'fields', items }));
      e.dataTransfer.setData('f', chip.dataset.f);
      e.dataTransfer.setData('g', chip.dataset.g);
    };
    chip.ondragend = () => { setTimeout(() => { skipClick = false; }, 0); };
    chip.onclick = e => {
      if (e.target.closest('[data-conv]')) return;
      if (skipClick) { skipClick = false; return; }
      applyFieldSelect(root, chip, e);
    };
    chip.ondblclick = e => {
      if (e.target.closest('[data-conv]')) return;
      const slot = resolveSlotEl(root, ch, chip.dataset.g, active);
      if (!slot) { alertDialog('无可用槽位'); return; }
      applySlotFields(ch, slot, selectedFieldItems(root, chip), { toggle: true });
    };
  });
}

function applySlot(ch, slot, field, group, opts = {}) {
  applySlotFields(ch, slot, [{ field, group }], opts);
}

function applySlotFields(ch, slot, items, opts = {}) {
  if (!items?.length) return;
  const accept = slot.dataset.accept;
  const key = slot.dataset.slot;
  const max = slotMax(ch.chartType, key);
  const next = [...encodeFields(ch.encode, key)];
  let overflow = false;
  let changed = false;
  for (const it of items) {
    const field = it.field;
    const group = it.group;
    if (!field) continue;
    if (accept && accept !== 'any' && accept !== group && !(key === 'color' && group === 'dim') && key !== 'columns') {
      alertDialog('字段类型与槽位不匹配');
      return;
    }
    if (next.includes(field)) {
      if (opts.toggle && (max > 1 || !Number.isFinite(max))) {
        const i = next.indexOf(field);
        if (i >= 0) next.splice(i, 1);
        changed = true;
      }
      continue;
    }
    if (max <= 1) {
      next.splice(0, next.length, field);
      changed = true;
    } else if (next.length >= max) {
      overflow = true;
      break;
    } else {
      next.push(field);
      changed = true;
    }
  }
  if (!changed) {
    if (overflow) alertDialog(`最多绑定 ${max} 个字段`);
    return;
  }
  pushUndo();
  setEncodeFields(ch.encode, key, next);
  if (ch.chartType === 'table' && (key === 'category' || key === 'value')) {
    const other = key === 'category' ? 'value' : 'category';
    const otherList = encodeFields(ch.encode, other).filter(n => !next.includes(n));
    setEncodeFields(ch.encode, other, otherList);
    syncTableColumnsEncode(ch);
  }
  markChartPending(ch.id);
  patchChart(ch, { inspector: true, flash: false, paint: false });
}

function styleGuideHtml(type, label) {
  const caps = styleCaps(type);
  return `<div class="style-guide">
    <b>${esc(label || type)}</b> · 按分区展示可用样式项。
    <div class="caps">${caps.map(c => `<span>${esc(c)}</span>`).join('')}</div>
  </div>`;
}

function seniorGuideHtml(type, label) {
  const caps = seniorCaps(type);
  return `<div class="senior-guide">
    <b>${esc(label || type)}</b> · 高级侧重交互与分析（联动 / 跳转 / 钻取 / 告警等），与样式解耦。
    <div class="caps">${caps.length ? caps.map(c => `<span>${esc(c)}</span>`).join('') : '<span>无</span>'}</div>
  </div>`;
}

function renderStyle(el, comp) {
  const ch = comp.type === 'chart' ? state.dash.charts[comp.chartId] : null;
  if (ch) ensureStyle(ch);
  const st = ch ? resolveCompStyle(comp) : null;
  const type = ch?.chartType || comp.type;
  const typeLabel = CHART_META[type]?.label
    || (type === 'slicer' ? '切片器' : type === 'text' ? '文本' : type === 'query' ? '查询条件' : type);
  const isChart = ['bar','hbar','line','area','pie'].includes(type);
  const isAxis = ['bar','hbar','line','area'].includes(type);
  const isTable = isTableType(type);
  const mobileOv = isMobileEdit() && !!comp._mobile;
  const styleSynced = !mobileOv || comp.styleSync !== false;

  let blocks = '';
  if (isMobileEdit()) {
    const m = ensureMobile(state.dash);
    blocks += `<div class="sec"><h4>移动端画布</h4>
      <label class="chk"><input type="checkbox" id="mobEnabled" ${m.enabled?'checked':''}/> 启用移动端</label>
      <div class="field"><label>预览机型</label>
        <select id="mobDevice">${mobileDeviceOptgroupsHtml(m.device)}</select>
      </div>
      <div class="field"><label>画布背景</label>
        <div class="color-row"><input type="color" id="mobBg" value="${m.bg || '#f0f2f5'}"/></div>
      </div>
    </div>`;
  }
  if (mobileOv) {
    blocks += `<div class="sec"><h4>样式同步</h4>
      <label class="chk"><input type="checkbox" id="stStyleSync" ${styleSynced?'checked':''}/> 与 PC 样式同步</label>
      <p style="font-size:11px;color:var(--text-3);line-height:1.45;margin-top:6px">${styleSynced ? '开启：以下修改写入 PC 样式，移动端跟随。' : '关闭：以下修改仅写入移动端覆盖，不影响 PC。'}</p>
    </div>`;
  }

  // —— 控件：切片器 / 文本 / 查询 ——
  if (type === 'slicer') {
    const p = comp.props || {};
    blocks = `
      ${styleGuideHtml(type, typeLabel)}
      <div class="sec"><h4>背景</h4>
        <div class="field"><label>背景色</label><div class="color-row"><input type="color" id="stBg" value="${p.bg || '#ffffff'}"/></div></div>
        <div class="field"><label>圆角</label>
          <select id="stRadius">${[0,6,10,16].map(n => `<option value="${n}" ${(p.radius??10)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
      </div>
      <div class="sec"><h4>文字</h4>
        <div class="field"><label>文字颜色</label><div class="color-row"><input type="color" id="stTitle" value="${p.titleColor || '#1f2329'}"/></div></div>
      </div>`;
  } else if (type === 'query') {
    const p = comp.props || {};
    const align = p.align || 'left';
    blocks = `
      ${styleGuideHtml(type, typeLabel)}
      <div class="sec"><h4>背景</h4>
        <div class="field"><label>背景色</label><div class="color-row"><input type="color" id="stBg" value="${p.bg || '#ffffff'}"/></div></div>
        <div class="field"><label>圆角</label>
          <select id="stRadius">${[0,6,10,16].map(n => `<option value="${n}" ${(p.radius??10)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
      </div>
      <div class="sec"><h4>内容分布</h4>
        <div class="field"><label>对齐方式</label>
          <div class="seg2" id="qAlign">
            <button type="button" data-qa="left" class="${align==='left'?'on':''}">靠左</button>
            <button type="button" data-qa="center" class="${align==='center'?'on':''}">居中</button>
            <button type="button" data-qa="between" class="${align==='between'?'on':''}">两端</button>
            <button type="button" data-qa="evenly" class="${align==='evenly'?'on':''}">均匀</button>
          </div>
        </div>
        <p style="font-size:11px;color:var(--text-3);line-height:1.45;margin:6px 0 0">
          居中：标题与筛选项整体居中；两端：标题靠左、筛选项铺满右侧；均匀：筛选项等距铺满整行。
        </p>
      </div>`;
  } else if (type === 'text') {
    const p = comp.props || {};
    blocks = `
      ${styleGuideHtml(type, typeLabel)}
      <div class="sec"><h4>背景</h4>
        <div class="field"><label>背景色</label><div class="color-row"><input type="color" id="stBg" value="${p.bg || '#ffffff'}"/></div></div>
        <div class="field"><label>圆角</label>
          <select id="stRadius">${[0,6,10,16].map(n => `<option value="${n}" ${(p.radius??10)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
      </div>
      <div class="sec"><h4>文字</h4>
        <div class="field"><label>字体颜色</label><div class="color-row"><input type="color" id="stTitle" value="${p.color || '#1f2329'}"/></div></div>
        <div class="field"><label>字号</label>
          <select id="stSize">${[12,14,16,20,24].map(n => `<option value="${n}" ${(p.fontSize||16)===n?'selected':''}>${n}</option>`).join('')}</select>
        </div>
        <div class="field"><label>对齐</label>
          <div class="seg2" id="txtAlign">
            <button type="button" data-ta="left" class="${(p.align||'left')==='left'?'on':''}">左</button>
            <button type="button" data-ta="center" class="${p.align==='center'?'on':''}">中</button>
          </div>
        </div>
      </div>`;
  } else if (ch && st) {
    // 卡片 + 标题（所有图表）
    blocks += styleGuideHtml(type, typeLabel);
    blocks += `
      <div class="sec"><h4>背景 / 卡片</h4>
        <div class="field"><label>背景颜色</label>
          <div class="color-row">
            <input type="color" id="stBg" value="${st.bg || '#ffffff'}"/>
            <button class="btn ghost" id="stBgReset" style="height:28px">重置白</button>
          </div>
        </div>
        <div class="field inline-2">
          <div><label>圆角</label>
            <select id="stRadius">${[0,6,10,16].map(n => `<option value="${n}" ${(+st.cardRadius||10)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
          <div><label>内边距</label>
            <select id="stPad">${[0,4,8,12,16].map(n => `<option value="${n}" ${(+st.cardPadding||8)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
        </div>
        <div class="field inline-2">
          <div><label>边框宽度</label>
            <select id="stBorderW">${[0,1,2].map(n => `<option value="${n}" ${(+st.borderWidth||1)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
          <div><label>边框颜色</label>
            <div class="color-row"><input type="color" id="stBorderC" value="${st.borderColor || '#e5e6eb'}"/></div>
          </div>
        </div>
      </div>
      <div class="sec"><h4>标题</h4>
        <label class="chk"><input type="checkbox" id="stShowTitle" ${st.showTitle!==false?'checked':''}/> 显示标题栏</label>
        <label class="chk"><input type="checkbox" id="stTitleBold" ${st.titleBold!==false?'checked':''}/> 标题加粗</label>
        <div class="field"><label>标题背景</label>
          <div class="color-row">
            <input type="color" id="stTitleBg" value="${st.titleBg || '#fafbfc'}"/>
            <button type="button" class="btn ghost" id="stTitleBiz" style="height:28px" title="蓝底白字加粗">商务蓝</button>
          </div>
        </div>
        <div class="field"><label>标题文字</label>
          <div class="color-row"><input type="color" id="stTitle" value="${st.titleColor || '#1f2329'}"/></div>
        </div>
        <div class="field inline-2">
          <div><label>字号</label>
            <select id="stTitleSize">${[11,12,13,14,16,18].map(n => `<option value="${n}" ${(+st.titleSize||12)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
          <div><label>对齐</label>
            <select id="stTitleAlign">
              <option value="left" ${st.titleAlign!=='center'?'selected':''}>左</option>
              <option value="center" ${st.titleAlign==='center'?'selected':''}>中</option>
            </select>
          </div>
        </div>
      </div>`;

    // 配色（图表类）
    if (isChart || type === 'kpi') {
      const sc = Array.isArray(st.seriesColors) ? st.seriesColors : [];
      const themeSeries = (THEMES[state.dash.theme] || THEMES.default).series;
      blocks += `
      <div class="sec"><h4>基础样式 · 配色</h4>
        <div class="field"><label>画布色板（作用于系列色）</label>
          <div class="theme-swatch" id="themes">
            ${Object.entries(THEMES).map(([k,v]) => `<button class="${state.dash.theme===k?'on':''}" data-th="${k}" style="background:${v.brand}" title="${k}"></button>`).join('')}
          </div>
        </div>
        ${isChart ? `<div class="field"><label>系列色覆盖（可选）</label>
          <div class="series-colors" id="seriesColors">
            ${[0,1,2,3].map(i => {
              const c = sc[i] || themeSeries[i] || '#3370ff';
              return `<input type="color" data-sc="${i}" value="${c}" title="系列 ${i+1}"/>`;
            }).join('')}
            <button type="button" class="btn ghost" id="stScReset" style="height:28px">重置</button>
          </div>
          <p style="font-size:10px;color:var(--text-3);margin-top:4px">可在色板之上逐系列改色。</p>
        </div>` : ''}
      </div>`;
    }

    // 图例 / 标签 / 提示（ECharts）
    if (isChart) {
      blocks += `
      <div class="sec"><h4>图例</h4>
        <label class="chk"><input type="checkbox" id="stLegend" ${st.showLegend!==false?'checked':''}/> 显示图例</label>
        <div class="field"><label>位置</label>
          <div class="seg4" id="legPos">
            ${[['top','上'],['bottom','下'],['left','左'],['right','右']].map(([k,lab]) =>
              `<button type="button" data-lp="${k}" class="${(st.legendPos||'top')===k?'on':''}">${lab}</button>`).join('')}
          </div>
        </div>
        <div class="field"><label>图例字号</label>
          <select id="stLegSize">${[10,11,12,13,14].map(n => `<option value="${n}" ${(+st.legendFontSize||11)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
      </div>
      <div class="sec"><h4>标签</h4>
        <label class="chk"><input type="checkbox" id="stLabel" ${st.showLabel?'checked':''}/> 显示标签</label>
        <div class="field inline-2">
          <div><label>字号</label>
            <select id="stLabelSize">${[9,10,11,12,14].map(n => `<option value="${n}" ${(+st.labelSize||10)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
          <div><label>颜色</label>
            <div class="color-row"><input type="color" id="stLabelColor" value="${st.labelColor || '#1f2329'}"/></div>
          </div>
        </div>
        <div class="field"><label>显示模式</label>
          <select id="stLabelMode">
            <option value="adaptive" ${(st.labelMode||'adaptive')==='adaptive'?'selected':''}>自适应（避让重叠）</option>
            <option value="all" ${st.labelMode==='all'?'selected':''}>全量显示</option>
          </select>
        </div>
        ${type === 'pie' ? `<div class="field" style="margin-top:8px">
          <label>标签内容</label>
          <label class="chk"><input type="checkbox" id="stLabelName" ${st.labelName!==false?'checked':''}/> 维度名</label>
          <label class="chk"><input type="checkbox" id="stLabelValue" ${st.labelValue!==false?'checked':''}/> 数值</label>
          <label class="chk"><input type="checkbox" id="stLabelPercent" ${st.labelPercent?'checked':''}/> 占比 %</label>
        </div>` : ''}
        ${(type === 'bar' || type === 'hbar') ? `<label class="chk"><input type="checkbox" id="stStackTotal" ${st.showStackTotal?'checked':''}/> 堆叠时显示总计标签</label>` : ''}
      </div>
      <div class="sec"><h4>提示</h4>
        <label class="chk"><input type="checkbox" id="stTooltip" ${st.showTooltip!==false?'checked':''}/> 悬停提示 Tooltip</label>
        <div class="field"><label>提示字号</label>
          <select id="stTipSize">${[11,12,13,14].map(n => `<option value="${n}" ${(+st.tooltipFontSize||12)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
        ${['bar','pie','line','area'].includes(type) ? `
        <label class="chk"><input type="checkbox" id="stTipCar" ${st.tooltipCarousel?'checked':''}/> 提示轮播（演示）</label>
        <div class="field inline-2">
          <div><label>停留(秒)</label>
            <select id="stTipStay">${[1,2,3,5].map(n => `<option value="${n}" ${(+st.tooltipStay||2)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div><label>间隔(秒)</label>
            <select id="stTipInt">${[2,3,5,8].map(n => `<option value="${n}" ${(+st.tooltipInterval||3)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>` : ''}
      </div>`;
    }

    // 坐标轴：横轴 / 纵轴（视觉方向，对应 ECharts x/y）
    if (isAxis) {
      blocks += `
      <div class="sec"><h4>横轴</h4>
        <label class="chk"><input type="checkbox" id="stXOn" ${st.showXAxis!==false?'checked':''}/> 显示横轴</label>
        <div class="field"><label>位置</label>
          <div class="seg2" id="stXPos">
            ${[['bottom','下'],['top','上']].map(([k,lab]) =>
              `<button type="button" data-xp="${k}" class="${(st.xAxisPos||'bottom')===k?'on':''}">${lab}</button>`).join('')}
          </div>
        </div>
        <label class="chk"><input type="checkbox" id="stXNameOn" ${st.showXAxisName?'checked':''}/> 轴名称显示</label>
        <div class="field"><label>名称</label>
          <input id="stXName" value="${esc(st.xAxisName||'')}" placeholder="如 地区"/>
        </div>
        <div class="field inline-2">
          <div><label>名称颜色</label>
            <div class="color-row"><input type="color" id="stXNameC" value="${st.xAxisNameColor||'#1f2329'}"/></div>
          </div>
          <div><label>名称字号</label>
            <select id="stXNameS">${[11,12,13,14,16].map(n => `<option value="${n}" ${(+st.xAxisNameSize||12)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <label class="chk"><input type="checkbox" id="stXLine" ${st.showXAxisLine!==false?'checked':''}/> 轴线显示</label>
        <div class="field inline-2">
          <div><label>轴线颜色</label>
            <div class="color-row"><input type="color" id="stXLineC" value="${st.xAxisLineColor||'#c9cdd4'}"/></div>
          </div>
          <div><label>线宽</label>
            <select id="stXLineW">${[1,2,3].map(n => `<option value="${n}" ${(+st.xAxisLineWidth||1)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>线型</label>
          <select id="stXLineT">
            <option value="solid" ${(st.xAxisLineType||'solid')==='solid'?'selected':''}>实线</option>
            <option value="dashed" ${st.xAxisLineType==='dashed'?'selected':''}>虚线</option>
            <option value="dotted" ${st.xAxisLineType==='dotted'?'selected':''}>点线</option>
          </select>
        </div>
        <label class="chk"><input type="checkbox" id="stXSplit" ${st.showXSplitLine?'checked':''}/> 网格线显示</label>
        <label class="chk"><input type="checkbox" id="stXLab" ${st.showXAxisLabel!==false?'checked':''}/> 标签显示</label>
        <div class="field inline-2">
          <div><label>标签颜色</label>
            <div class="color-row"><input type="color" id="stXLabC" value="${st.xAxisLabelColor||'#646a73'}"/></div>
          </div>
          <div><label>标签字号</label>
            <select id="stXLabS">${[10,11,12,13,14].map(n => `<option value="${n}" ${(+st.xAxisLabelSize||11)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>标签角度</label>
          <select id="stXRot">${[0,15,30,45,60,90].map(n => `<option value="${n}" ${(+st.xAxisLabelRotate||0)===n?'selected':''}>${n}°</option>`).join('')}</select>
        </div>
      </div>
      <div class="sec"><h4>纵轴</h4>
        <label class="chk"><input type="checkbox" id="stYOn" ${st.showYAxis!==false?'checked':''}/> 显示纵轴</label>
        <div class="field"><label>位置</label>
          <div class="seg2" id="stYPos">
            ${[['left','左'],['right','右']].map(([k,lab]) =>
              `<button type="button" data-yp="${k}" class="${(st.yAxisPos||'left')===k?'on':''}">${lab}</button>`).join('')}
          </div>
        </div>
        <label class="chk"><input type="checkbox" id="stYNameOn" ${st.showYAxisName?'checked':''}/> 轴名称显示</label>
        <div class="field"><label>名称</label>
          <input id="stYName" value="${esc(st.yAxisName||'')}" placeholder="如 金额"/>
        </div>
        <div class="field inline-2">
          <div><label>名称颜色</label>
            <div class="color-row"><input type="color" id="stYNameC" value="${st.yAxisNameColor||'#1f2329'}"/></div>
          </div>
          <div><label>名称字号</label>
            <select id="stYNameS">${[11,12,13,14,16].map(n => `<option value="${n}" ${(+st.yAxisNameSize||12)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <label class="chk"><input type="checkbox" id="stYLine" ${st.showYAxisLine!==false?'checked':''}/> 轴线显示</label>
        <div class="field inline-2">
          <div><label>轴线颜色</label>
            <div class="color-row"><input type="color" id="stYLineC" value="${st.yAxisLineColor||'#c9cdd4'}"/></div>
          </div>
          <div><label>线宽</label>
            <select id="stYLineW">${[1,2,3].map(n => `<option value="${n}" ${(+st.yAxisLineWidth||1)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>线型</label>
          <select id="stYLineT">
            <option value="solid" ${(st.yAxisLineType||'solid')==='solid'?'selected':''}>实线</option>
            <option value="dashed" ${st.yAxisLineType==='dashed'?'selected':''}>虚线</option>
            <option value="dotted" ${st.yAxisLineType==='dotted'?'selected':''}>点线</option>
          </select>
        </div>
        <label class="chk"><input type="checkbox" id="stYSplit" ${st.showYSplitLine!==false?'checked':''}/> 网格线显示</label>
        <label class="chk"><input type="checkbox" id="stYLab" ${st.showYAxisLabel!==false?'checked':''}/> 标签显示</label>
        <div class="field inline-2">
          <div><label>标签颜色</label>
            <div class="color-row"><input type="color" id="stYLabC" value="${st.yAxisLabelColor||'#646a73'}"/></div>
          </div>
          <div><label>标签字号</label>
            <select id="stYLabS">${[10,11,12,13,14].map(n => `<option value="${n}" ${(+st.yAxisLabelSize||11)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>数值单位</label>
          <select id="stAxisUnit">
            <option value="none" ${(st.axisUnit||'none')==='none'?'selected':''}>无</option>
            <option value="k" ${st.axisUnit==='k'?'selected':''}>千</option>
            <option value="wan" ${st.axisUnit==='wan'?'selected':''}>万</option>
            <option value="yi" ${st.axisUnit==='yi'?'selected':''}>亿</option>
          </select>
        </div>
      </div>`;
    }

    // 系列形态
    if (type === 'bar' || type === 'hbar') {
      blocks += `
      <div class="sec"><h4>${type==='hbar'?'条形':'柱形'}</h4>
        <div class="field inline-2">
          <div><label>柱圆角</label>
            <select id="stBarRadius">${[0,2,4,8].map(n => `<option value="${n}" ${(+st.barRadius||2)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
          <div><label>柱宽</label>
            <select id="stBarWidth">
              <option value="0" ${!(+st.barWidth)?'selected':''}>自动</option>
              ${[40,55,70,85].map(n => `<option value="${n}" ${(+st.barWidth)===n?'selected':''}>${n}%</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label>系列间距</label>
          <select id="stBarGap">
            ${[['20%','紧'],['30%','默认'],['50%','疏'],['80%','很疏']].map(([v,lab]) =>
              `<option value="${v}" ${(st.barGap||'30%')===v?'selected':''}>${lab}（${v}）</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>系列展示</label>
          <select id="stStackMode">
            <option value="group" ${(st.stackMode||'group')==='group'?'selected':''}>并排分组</option>
            <option value="stack" ${st.stackMode==='stack'?'selected':''}>堆叠</option>
            <option value="percent" ${st.stackMode==='percent'?'selected':''}>百分比堆叠</option>
          </select>
        </div>
        <p style="font-size:10px;color:var(--text-3);line-height:1.4;margin-top:4px">绑定「堆叠/拆色维」或多指标后堆叠生效。</p>
      </div>`;
    }
    if (type === 'line' || type === 'area') {
      blocks += `
      <div class="sec"><h4>${type==='area'?'面积':'折线'}</h4>
        <label class="chk"><input type="checkbox" id="stSmooth" ${st.smooth!==false?'checked':''}/> 平滑曲线</label>
        <label class="chk"><input type="checkbox" id="stSymbol" ${st.showSymbol!==false?'checked':''}/> 显示拐点</label>
        <div class="field inline-2">
          <div><label>线宽</label>
            <select id="stLineW">${[1,2,3,4].map(n => `<option value="${n}" ${(+st.lineWidth||2)===n?'selected':''}>${n}px</option>`).join('')}</select>
          </div>
          <div><label>拐点大小</label>
            <select id="stSymSize">${[4,6,8,10].map(n => `<option value="${n}" ${(+st.symbolSize||6)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        ${type === 'area' ? `<div class="field"><label>面积透明度</label>
          <select id="stAreaOp">
            ${[['0.15','淡'],['0.35','默认'],['0.55','浓'],['0.75','很浓']].map(([v,lab]) =>
              `<option value="${v}" ${String(st.areaOpacity ?? 0.35)===v?'selected':''}>${lab}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>`;
    }
    if (type === 'pie') {
      blocks += `
      <div class="sec"><h4>饼环</h4>
        <label class="chk"><input type="checkbox" id="stPieRose" ${st.pieRose?'checked':''}/> 玫瑰图（按半径区分）</label>
        <div class="field inline-2">
          <div><label>内径 %</label>
            <select id="stPieIn">${[0,20,35,45,55].map(n => `<option value="${n}" ${(+st.pieInner||35)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div><label>外径 %</label>
            <select id="stPieOut">${[50,60,65,75,85].map(n => `<option value="${n}" ${(+st.pieOuter||65)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>扇区间隙</label>
          <select id="stPiePad">${[0,1,2,4].map(n => `<option value="${n}" ${(+st.piePadAngle||0)===n?'selected':''}>${n}°</option>`).join('')}</select>
        </div>
      </div>`;
    }

    // KPI
    if (type === 'kpi') {
      blocks += `
      <div class="sec"><h4>数值</h4>
        <div class="field"><label>数值颜色</label>
          <div class="color-row"><input type="color" id="stValColor" value="${st.valueColor || '#1f2329'}"/></div>
        </div>
        <div class="field inline-2">
          <div><label>字号</label>
            <select id="stValSize">${[20,24,28,32,40].map(n => `<option value="${n}" ${(+st.valueSize||28)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div><label>对齐</label>
            <select id="stValAlign">
              <option value="left" ${st.valueAlign!=='center'?'selected':''}>左</option>
              <option value="center" ${st.valueAlign==='center'?'selected':''}>中</option>
            </select>
          </div>
        </div>
        <div class="field inline-2">
          <div><label>前缀</label><input id="stPrefix" value="${esc(st.valuePrefix || '')}" placeholder="如 ¥"/></div>
          <div><label>后缀</label><input id="stSuffix" value="${esc(st.valueSuffix || '')}" placeholder="如 %"/></div>
        </div>
      </div>
      <div class="sec"><h4>对比区</h4>
        <label class="chk"><input type="checkbox" id="stCompare" ${st.showCompare!==false?'checked':''}/> 显示同比/环比或行数说明</label>
        <div class="field"><label>副标题</label>
          <input id="stKpiSub" value="${esc(st.kpiSubtitle || '')}" placeholder="如 本月累计"/>
        </div>
      </div>`;
    }

    // 表格：基础样式 / 表头 / 单元格 / 冻结 / 分页 / 合计
    if (isTable) {
      const mergeDisabledStripe = !!st.mergeCells;
      const tblFields = type === 'table'
        ? tableColumnsOf(ch)
        : [...encodeFields(ch.encode, 'category'), ...encodeFields(ch.encode, 'value'), ...encodeFields(ch.encode, 'colDim')];
      const uniqTblFields = [...new Set(tblFields.filter(Boolean))];
      const editField = st.colWidthEditField && uniqTblFields.includes(st.colWidthEditField)
        ? st.colWidthEditField
        : (uniqTblFields[0] || '');
      const editPct = editField && st.colWidths?.[editField] != null ? +st.colWidths[editField] : 8;
      blocks += `
      <div class="sec"><h4>基础样式</h4>
        <div class="field inline-2">
          <div><label>边框颜色</label>
            <div class="color-row"><input type="color" id="stBorderC" value="${st.borderColor || '#e5e6eb'}"/></div>
          </div>
          <div><label>滚动条颜色</label>
            <div class="color-row"><input type="color" id="stScrollC" value="${st.scrollbarColor || '#c9cdd4'}"/></div>
          </div>
        </div>
        <div class="field"><label>不透明度</label>
          <select id="stTableOp">${[100,90,80,70,60].map(n => `<option value="${n}" ${(+st.tableOpacity||100)===n?'selected':''}>${n}%</option>`).join('')}</select>
        </div>
        <div class="field"><label>列宽调整</label>
          <div class="seg3" id="stColModeSeg">
            ${[['adaptive','自适应'],['fixed','固定列宽'],['custom','自定义']].map(([k,lab]) =>
              `<button type="button" data-cm="${k}" class="${(st.colWidthMode||'adaptive')===k?'on':''}">${lab}</button>`).join('')}
          </div>
        </div>
        ${st.colWidthMode === 'fixed' ? `<div class="field"><label>列宽 (px)</label>
          <select id="stColPx">${[80,100,120,160,200].map(n => `<option value="${n}" ${(+st.colWidthPx||120)===n?'selected':''}>${n}</option>`).join('')}</select>
        </div>` : ''}
        ${st.colWidthMode === 'custom' && uniqTblFields.length ? `
        <div class="field"><label>字段</label>
          <select id="stColField">
            ${uniqTblFields.map(f => `<option value="${esc(f)}" ${editField===f?'selected':''}>${esc(displayFieldLabel(ch, f))}</option>`).join('')}
          </select>
        </div>
        <div class="field inline-2">
          <div><label>宽度占比</label>
            <input id="stColPct" type="number" min="1" max="100" value="${editPct}"/>
          </div>
          <div><label>单位</label><input value="%" disabled/></div>
        </div>` : ''}
        <div class="field"><label>表格字号</label>
          <select id="stTableFs">${[11,12,13,14].map(n => `<option value="${n}" ${(+st.tableFontSize||12)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
        ${type !== 'pivot' ? `<label class="chk"><input type="checkbox" id="stShowIdx" ${st.showIndex?'checked':''}/> 显示序号列</label>` : ''}
      </div>`;

      if (type === 'pivot') {
        blocks += `
      <div class="sec"><h4>展示方式</h4>
        <div class="field"><label>布局</label>
          <select id="stPivotLayout">
            <option value="flat" ${(st.pivotLayout||'flat')==='flat'?'selected':''}>平铺展示</option>
            <option value="tree" ${st.pivotLayout==='tree'?'selected':''}>树形展示（行头缩进）</option>
          </select>
        </div>
        <div class="field"><label>指标位置</label>
          <select id="stPivotMeas">
            <option value="col" ${(st.pivotMeasurePos||'col')==='col'?'selected':''}>按列头</option>
            <option value="row" ${st.pivotMeasurePos==='row'?'selected':''}>按行头（简化）</option>
          </select>
        </div>
        <label class="chk"><input type="checkbox" id="stPivotMulti" ${st.pivotMultiHead!==false?'checked':''}/> 多层列头（多指标）</label>
        <div class="preset-row tight" style="margin-top:8px">
          <button type="button" id="stPivotBiz">商务蓝表头</button>
          <button type="button" id="stPivotReset">恢复默认</button>
        </div>
      </div>
      <div class="sec"><h4>列头 / 行头 / 角头</h4>
        <label class="chk"><input type="checkbox" id="stHead" ${st.showHeader!==false?'checked':''}/> 显示表头</label>
        <label class="chk"><input type="checkbox" id="stHeadBold" ${st.headerBold!==false?'checked':''}/> 列头加粗</label>
        <label class="chk"><input type="checkbox" id="stPivotMeta" ${st.pivotMeta!==false?'checked':''}/> 显示年月信息行</label>
        <div class="field inline-2">
          <div><label>信息行标签</label><input id="stPivotMetaLab" value="${esc(st.pivotMetaLabel || '当前年月')}"/></div>
          <div><label>信息行值</label><input id="stPivotMetaVal" value="${esc(st.pivotMetaValue || '')}" placeholder="空则用当月 YYYYMM"/></div>
        </div>
        <div class="field"><label>列头背景</label>
          <div class="color-row"><input type="color" id="stHeadBg" value="${st.headerBg || '#eef4ff'}"/></div>
        </div>
        <div class="field"><label>列头文字</label>
          <div class="color-row"><input type="color" id="stHeadColor" value="${st.headerColor || '#1f2329'}"/></div>
        </div>
        <div class="field"><label>行头背景</label>
          <div class="color-row"><input type="color" id="stRowHeadBg" value="${st.rowHeadBg || '#f7f8fa'}"/></div>
        </div>
        <div class="field"><label>行头文字</label>
          <div class="color-row"><input type="color" id="stRowHeadColor" value="${st.rowHeadColor || '#1f2329'}"/></div>
        </div>
        <label class="chk"><input type="checkbox" id="stRowHeadBold" ${st.rowHeadBold!==false?'checked':''}/> 行头加粗</label>
        <div class="field"><label>角头背景</label>
          <div class="color-row"><input type="color" id="stCornerBg" value="${st.cornerBg || '#e8f0ff'}"/></div>
        </div>
        <div class="field"><label>角头文字</label>
          <div class="color-row"><input type="color" id="stCornerColor" value="${st.cornerColor || '#1f2329'}"/></div>
        </div>
      </div>`;
      } else {
        blocks += `
      <div class="sec"><h4>表头</h4>
        <label class="chk"><input type="checkbox" id="stHead" ${st.showHeader!==false?'checked':''}/> 显示表头</label>
        <label class="chk"><input type="checkbox" id="stHeadBold" ${st.headerBold!==false?'checked':''}/> 表头加粗</label>
        <div class="field"><label>表头字号</label>
          <select id="stHeadSize">${[11,12,13,14].map(n => `<option value="${n}" ${(+st.headerSize||12)===n?'selected':''}>${n}px</option>`).join('')}</select>
        </div>
        <div class="field"><label>表头背景</label>
          <div class="color-row"><input type="color" id="stHeadBg" value="${st.headerBg || '#f5f6f7'}"/></div>
        </div>
        <div class="field"><label>表头文字</label>
          <div class="color-row"><input type="color" id="stHeadColor" value="${st.headerColor || '#1f2329'}"/></div>
        </div>
      </div>`;
      }

      blocks += `
      <div class="sec"><h4>单元格</h4>
        <div class="field"><label>背景</label>
          <div class="color-row"><input type="color" id="stCellBg" value="${st.cellBg || '#ffffff'}"/></div>
        </div>
        <label class="chk" title="${mergeDisabledStripe ? '合并单元格后，不支持斑马纹' : ''}">
          <input type="checkbox" id="stStripe" ${st.stripe!==false && !mergeDisabledStripe?'checked':''} ${mergeDisabledStripe?'disabled':''}/> 斑马纹
        </label>
        ${!mergeDisabledStripe ? `<div class="field"><label>斑马纹底色</label>
          <div class="color-row"><input type="color" id="stStripeBg" value="${st.stripeBg || '#fafbfc'}"/></div>
        </div>` : `<p class="hint-warn">合并单元格后，不支持斑马纹</p>`}
        <div class="field"><label>文本</label>
          <div class="text-style-row">
            <input type="color" id="stCellColor" value="${st.cellColor || '#1f2329'}" title="文字颜色"/>
            <select id="stTableFs2">${[11,12,13,14].map(n => `<option value="${n}" ${(+st.tableFontSize||12)===n?'selected':''}>${n}</option>`).join('')}</select>
            <button type="button" class="mini-btn ${(st.cellBold?'on':'')}" id="stCellBold" title="加粗"><b>B</b></button>
            <button type="button" class="mini-btn ${(st.cellItalic?'on':'')}" id="stCellItalic" title="斜体"><i>I</i></button>
          </div>
        </div>
        <div class="field"><label>水平对齐</label>
          <div class="seg3" id="stHAlign">
            ${[['left','左'],['center','中'],['right','右']].map(([k,lab]) =>
              `<button type="button" data-ha="${k}" class="${(st.cellAlign||'left')===k?'on':''}">${lab}</button>`).join('')}
          </div>
        </div>
        <div class="field"><label>垂直对齐</label>
          <div class="seg3" id="stVAlign">
            ${[['top','上'],['middle','中'],['bottom','下']].map(([k,lab]) =>
              `<button type="button" data-va="${k}" class="${(st.cellVAlign||'middle')===k?'on':''}">${lab}</button>`).join('')}
          </div>
        </div>
        <div class="field"><label>行高</label>
          <input id="stRowH" type="number" min="24" max="80" value="${+st.rowHeight||36}"/>
        </div>
        ${type !== 'pivot' ? `
        <label class="chk"><input type="checkbox" id="stFreezeOn" ${(+st.freezeLeft||0)>0||(+st.freezeTop||0)>0?'checked':''}/> 冻结</label>
        <div class="field inline-2">
          <div><label>冻结前 n 列</label>
            <select id="stFreeze" ${(+st.freezeLeft||0)===0&&(+st.freezeTop||0)===0?'disabled':''}>${[0,1,2,3].map(n => `<option value="${n}" ${(+st.freezeLeft||0)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div><label>冻结前 n 行</label>
            <select id="stFreezeTop" ${(+st.freezeLeft||0)===0&&(+st.freezeTop||0)===0?'disabled':''}>${[0,1,2,3,5].map(n => `<option value="${n}" ${(+st.freezeTop||0)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>
        <label class="chk"><input type="checkbox" id="stMerge" ${st.mergeCells?'checked':''}/> 合并单元格</label>
        <label class="chk"><input type="checkbox" id="stHBorder" ${st.showHBorder!==false?'checked':''}/> 单元格横边框线</label>
        <label class="chk"><input type="checkbox" id="stVBorder" ${st.showVBorder!==false?'checked':''}/> 单元格纵边框线</label>
        <label class="chk"><input type="checkbox" id="stAutoWrap" ${st.autoWrap?'checked':''}/> 自动换行</label>
        <p class="hint-muted">开启合并后斑马纹不可用；开启换行后表头行高随内容变化。</p>` : ''}
      </div>`;

      if (type !== 'pivot') {
        blocks += `
      <div class="sec"><h4>分页</h4>
        <div class="field"><label>分页模式</label>
          <select id="stPageMode">
            <option value="page" ${(st.pageMode||'page')==='page'?'selected':''}>翻页</option>
            <option value="scroll" ${st.pageMode==='scroll'?'selected':''}>自动滚动</option>
          </select>
        </div>
        ${(st.pageMode||'page')==='page' ? `<div class="field"><label>每页行数</label>
          <select id="stPage">${[3,5,10,20,50].map(n => `<option value="${n}" ${(+st.pageSize||5)===n?'selected':''}>${n} 行 / 页</option>`).join('')}</select>
        </div>` : `<div class="field inline-2">
          <div><label>可视行数</label>
            <select id="stScrollRows">${[3,5,8,10].map(n => `<option value="${n}" ${(+st.scrollRows||3)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div><label>间隔(秒)</label>
            <select id="stScrollInt">${[1,2,3,5].map(n => `<option value="${n}" ${(+st.scrollInterval||2)===n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
        </div>`}
      </div>`;
      }

      if (type === 'grouptable' || type === 'pivot') {
        blocks += `
      <div class="sec"><h4>合计 / 汇总</h4>
        ${type === 'grouptable' ? `<label class="chk"><input type="checkbox" id="stRowTotal" ${st.showRowTotal!==false?'checked':''}/> 显示合计行</label>` : `
        <label class="chk"><input type="checkbox" id="stRowTotal" ${st.showRowTotal?'checked':''}/> 显示行合计</label>
        <label class="chk"><input type="checkbox" id="stColTotal" ${st.showColTotal?'checked':''}/> 显示列合计</label>`}
        <div class="field"><label>合计背景</label>
          <div class="color-row"><input type="color" id="stTotalBg" value="${st.totalBg || '#f0f4ff'}"/></div>
        </div>
        <div class="field"><label>合计文字</label>
          <div class="color-row"><input type="color" id="stTotalColor" value="${st.totalColor || '#1f2329'}"/></div>
        </div>
      </div>`;
      }

      const uniqFields = uniqTblFields;
      blocks += `
      <div class="sec"><h4>空值与条件样式</h4>
        <div class="field"><label>空值显示为</label>
          <select id="stEmpty">
            ${[['-','-'],['—','—'],['(空)','(空)'],['0','0'],['','（空白）']].map(([v,lab]) =>
              `<option value="${esc(v)}" ${(st.emptyValue ?? '-')===v?'selected':''}>${esc(lab)}</option>`).join('')}
          </select>
        </div>
        <label class="chk"><input type="checkbox" id="stCondOn" ${st.condEnabled?'checked':''}/> 启用条件样式</label>
        ${st.condEnabled ? `
        <div class="field"><label>作用字段</label>
          <select id="stCondField">
            <option value="">请选择</option>
            ${uniqFields.map(f => `<option value="${esc(f)}" ${st.condField===f?'selected':''}>${esc(displayFieldLabel(ch, f))}</option>`).join('')}
          </select>
        </div>
        <div class="field inline-2">
          <div><label>条件</label>
            <select id="stCondOp">
              ${[['gt','>'],['gte','≥'],['lt','<'],['lte','≤'],['eq','='],['ne','≠'],['contains','包含'],['empty','为空'],['not_empty','非空']].map(([k,lab]) =>
                `<option value="${k}" ${(st.condOp||'gt')===k?'selected':''}>${lab}</option>`).join('')}
            </select>
          </div>
          <div><label>值</label><input id="stCondVal" value="${esc(st.condValue || '')}" placeholder="阈值"/></div>
        </div>
        <div class="field"><label>高亮背景</label>
          <div class="color-row"><input type="color" id="stCondBg" value="${st.condBg || '#fff1f0'}"/></div>
        </div>
        <div class="field"><label>高亮文字</label>
          <div class="color-row"><input type="color" id="stCondColor" value="${st.condColor || '#cf1322'}"/></div>
        </div>` : ''}
        <p class="hint-muted">当前支持单条规则；多规则与动态值可后续扩展。</p>
      </div>`;
    }
  }

  blocks += layoutSecHtml(comp);
  if (comp.type === 'chart' && ch) {
    mountChartWork(el, ch, { paneTitle: '样式', leftInner: blocks || `<p style="font-size:12px;color:var(--text-3)">请选择组件</p>` });
  } else {
    el.innerHTML = `${inspModeSegHtml()}<div class="insp-scroll">${blocks || `<p style="font-size:12px;color:var(--text-3)">请选择组件</p>`}</div>`;
    wireInspMode(el);
  }
  wireLayoutControls(el, comp);

  const softStyle = () => {
    markDirty();
    if (ch) patchChart(ch, { inspector: false, flash: false });
    else replaceWidget(comp);
  };
  const bag = () => styleWriteBag(comp, ch);

  const bindStyle = (id, fn, { live = false } = {}) => {
    const node = el.querySelector(id);
    if (!node) return;
    if (live || node.type === 'color') {
      node.oninput = () => { fn(node); softStyle(); };
      node.onchange = () => { pushUndo(); fn(node); softStyle(); };
    } else if (node.tagName === 'INPUT' && node.type === 'text') {
      node.onchange = () => { pushUndo(); fn(node); softStyle(); };
    } else {
      node.onchange = () => { pushUndo(); fn(node); softStyle(); };
    }
  };

  el.querySelector('#mobEnabled')?.addEventListener('change', e => {
    pushUndo(); ensureMobile(state.dash).enabled = e.target.checked; markDirty(); render();
  });
  el.querySelector('#mobDevice')?.addEventListener('change', e => {
    if (setMobileDevice(e.target.value)) render();
  });
  el.querySelector('#mobBg')?.addEventListener('input', e => {
    ensureMobile(state.dash).bg = e.target.value; markDirty();
    const shell = document.getElementById('phoneShell');
    const board = document.getElementById('board');
    if (shell) shell.style.background = e.target.value;
    if (board && isMobileEdit()) board.style.background = e.target.value;
  });
  el.querySelector('#stStyleSync')?.addEventListener('change', e => {
    pushUndo();
    const m = ensureMobile(state.dash).components.find(c => c.id === comp.id);
    if (m) {
      m.styleSync = e.target.checked;
      if (e.target.checked) m.style = null;
      else m.style = m.style || {};
    }
    markDirty(); render();
  });

  el.querySelectorAll('[data-th]').forEach(b => b.onclick = () => {
    pushUndo();
    state.dash.theme = b.dataset.th;
    markDirty();
    el.querySelectorAll('[data-th]').forEach(x => x.classList.toggle('on', x.dataset.th === state.dash.theme));
    repaintAllCharts();
    toast('色板已应用', 'ok');
  });

  if (ch && st) {
    bindStyle('#stShowTitle', n => { bag().showTitle = n.checked; });
    bindStyle('#stTitleBold', n => { bag().titleBold = n.checked; });
    bindStyle('#stBg', n => { bag().bg = n.value; }, { live: true });
    el.querySelector('#stBgReset')?.addEventListener('click', () => {
      pushUndo(); bag().bg = '#ffffff'; softStyle();
      const bg = el.querySelector('#stBg'); if (bg) bg.value = '#ffffff';
    });
    el.querySelector('#stTitleBiz')?.addEventListener('click', () => {
      pushUndo();
      const b = bag();
      b.titleBg = '#1677ff';
      b.titleColor = '#ffffff';
      b.titleBold = true;
      softStyle();
      const bg = el.querySelector('#stTitleBg'); if (bg) bg.value = '#1677ff';
      const tc = el.querySelector('#stTitle'); if (tc) tc.value = '#ffffff';
      const tb = el.querySelector('#stTitleBold'); if (tb) tb.checked = true;
      toast('已应用商务蓝标题', 'ok');
    });
    bindStyle('#stTitleBg', n => { bag().titleBg = n.value; }, { live: true });
    bindStyle('#stTitle', n => { bag().titleColor = n.value; }, { live: true });
    bindStyle('#stTitleSize', n => { bag().titleSize = +n.value; });
    bindStyle('#stTitleAlign', n => { bag().titleAlign = n.value; });
    bindStyle('#stRadius', n => { bag().cardRadius = +n.value; });
    bindStyle('#stPad', n => { bag().cardPadding = +n.value; });
    bindStyle('#stBorderW', n => { bag().borderWidth = +n.value; });
    bindStyle('#stBorderC', n => { bag().borderColor = n.value; }, { live: true });
    bindStyle('#stLegend', n => { bag().showLegend = n.checked; });
    bindStyle('#stLegSize', n => { bag().legendFontSize = +n.value; });
    bindStyle('#stLabel', n => { bag().showLabel = n.checked; });
    bindStyle('#stLabelSize', n => { bag().labelSize = +n.value; });
    bindStyle('#stLabelColor', n => { bag().labelColor = n.value; }, { live: true });
    bindStyle('#stLabelMode', n => { bag().labelMode = n.value; });
    bindStyle('#stLabelName', n => { bag().labelName = n.checked; });
    bindStyle('#stLabelValue', n => { bag().labelValue = n.checked; });
    bindStyle('#stLabelPercent', n => { bag().labelPercent = n.checked; });
    bindStyle('#stStackTotal', n => { bag().showStackTotal = n.checked; });
    bindStyle('#stTooltip', n => { bag().showTooltip = n.checked; });
    bindStyle('#stTipSize', n => { bag().tooltipFontSize = +n.value; });
    bindStyle('#stTipCar', n => { bag().tooltipCarousel = n.checked; });
    bindStyle('#stTipStay', n => { bag().tooltipStay = +n.value; });
    bindStyle('#stTipInt', n => { bag().tooltipInterval = +n.value; });
    bindStyle('#stAxisUnit', n => { bag().axisUnit = n.value; });
    bindStyle('#stXOn', n => { bag().showXAxis = n.checked; });
    bindStyle('#stXNameOn', n => { bag().showXAxisName = n.checked; });
    bindStyle('#stXName', n => { bag().xAxisName = n.value; });
    bindStyle('#stXNameC', n => { bag().xAxisNameColor = n.value; }, { live: true });
    bindStyle('#stXNameS', n => { bag().xAxisNameSize = +n.value; });
    bindStyle('#stXLine', n => { bag().showXAxisLine = n.checked; });
    bindStyle('#stXLineC', n => { bag().xAxisLineColor = n.value; }, { live: true });
    bindStyle('#stXLineW', n => { bag().xAxisLineWidth = +n.value; });
    bindStyle('#stXLineT', n => { bag().xAxisLineType = n.value; });
    bindStyle('#stXSplit', n => { bag().showXSplitLine = n.checked; });
    bindStyle('#stXLab', n => { bag().showXAxisLabel = n.checked; });
    bindStyle('#stXLabC', n => { bag().xAxisLabelColor = n.value; }, { live: true });
    bindStyle('#stXLabS', n => { bag().xAxisLabelSize = +n.value; });
    bindStyle('#stXRot', n => { bag().xAxisLabelRotate = +n.value; });
    bindStyle('#stYOn', n => { bag().showYAxis = n.checked; });
    bindStyle('#stYNameOn', n => { bag().showYAxisName = n.checked; });
    bindStyle('#stYName', n => { bag().yAxisName = n.value; });
    bindStyle('#stYNameC', n => { bag().yAxisNameColor = n.value; }, { live: true });
    bindStyle('#stYNameS', n => { bag().yAxisNameSize = +n.value; });
    bindStyle('#stYLine', n => { bag().showYAxisLine = n.checked; });
    bindStyle('#stYLineC', n => { bag().yAxisLineColor = n.value; }, { live: true });
    bindStyle('#stYLineW', n => { bag().yAxisLineWidth = +n.value; });
    bindStyle('#stYLineT', n => { bag().yAxisLineType = n.value; });
    bindStyle('#stYSplit', n => { bag().showYSplitLine = n.checked; });
    bindStyle('#stYLab', n => { bag().showYAxisLabel = n.checked; });
    bindStyle('#stYLabC', n => { bag().yAxisLabelColor = n.value; }, { live: true });
    bindStyle('#stYLabS', n => { bag().yAxisLabelSize = +n.value; });
    el.querySelectorAll('#stXPos [data-xp]').forEach(b => {
      b.onclick = () => {
        pushUndo(); bag().xAxisPos = b.dataset.xp;
        el.querySelectorAll('#stXPos [data-xp]').forEach(x => x.classList.toggle('on', x.dataset.xp === bag().xAxisPos));
        softStyle();
      };
    });
    el.querySelectorAll('#stYPos [data-yp]').forEach(b => {
      b.onclick = () => {
        pushUndo(); bag().yAxisPos = b.dataset.yp;
        el.querySelectorAll('#stYPos [data-yp]').forEach(x => x.classList.toggle('on', x.dataset.yp === bag().yAxisPos));
        softStyle();
      };
    });
    bindStyle('#stBarRadius', n => { bag().barRadius = +n.value; });
    bindStyle('#stBarWidth', n => { bag().barWidth = +n.value; });
    bindStyle('#stBarGap', n => { bag().barGap = n.value; });
    bindStyle('#stStackMode', n => { bag().stackMode = n.value; });
    bindStyle('#stSmooth', n => { bag().smooth = n.checked; });
    bindStyle('#stSymbol', n => { bag().showSymbol = n.checked; });
    bindStyle('#stLineW', n => { bag().lineWidth = +n.value; });
    bindStyle('#stSymSize', n => { bag().symbolSize = +n.value; });
    bindStyle('#stAreaOp', n => { bag().areaOpacity = +n.value; });
    bindStyle('#stPieRose', n => { bag().pieRose = n.checked; });
    bindStyle('#stPieIn', n => { bag().pieInner = +n.value; });
    bindStyle('#stPieOut', n => { bag().pieOuter = +n.value; });
    bindStyle('#stPiePad', n => { bag().piePadAngle = +n.value; });
    bindStyle('#stValColor', n => { bag().valueColor = n.value; }, { live: true });
    bindStyle('#stValSize', n => { bag().valueSize = +n.value; });
    bindStyle('#stValAlign', n => { bag().valueAlign = n.value; });
    bindStyle('#stPrefix', n => { bag().valuePrefix = n.value; });
    bindStyle('#stSuffix', n => { bag().valueSuffix = n.value; });
    bindStyle('#stCompare', n => { bag().showCompare = n.checked; });
    bindStyle('#stKpiSub', n => { bag().kpiSubtitle = n.value; });
    bindStyle('#stEmpty', n => { bag().emptyValue = n.value; });
    bindStyle('#stCondOn', n => { bag().condEnabled = n.checked; });
    bindStyle('#stCondField', n => { bag().condField = n.value; });
    bindStyle('#stCondOp', n => { bag().condOp = n.value; });
    bindStyle('#stCondVal', n => { bag().condValue = n.value; });
    bindStyle('#stCondBg', n => { bag().condBg = n.value; }, { live: true });
    bindStyle('#stCondColor', n => { bag().condColor = n.value; }, { live: true });
    el.querySelectorAll('[data-sc]').forEach(inp => {
      inp.oninput = () => {
        const bagStyle = bag();
        const arr = Array.isArray(bagStyle.seriesColors) ? bagStyle.seriesColors.slice() : [];
        arr[+inp.dataset.sc] = inp.value;
        bagStyle.seriesColors = arr;
        softStyle();
      };
      inp.onchange = () => { pushUndo(); };
    });
    el.querySelector('#stScReset')?.addEventListener('click', () => {
      pushUndo();
      bag().seriesColors = [];
      softStyle();
      if (ch) patchChart(ch, { inspector: true, flash: false });
    });
    bindStyle('#stTableFs', n => { bag().tableFontSize = +n.value; });
    bindStyle('#stTableFs2', n => { bag().tableFontSize = +n.value; });
    bindStyle('#stColPx', n => { bag().colWidthPx = +n.value; });
    bindStyle('#stScrollC', n => { bag().scrollbarColor = n.value; }, { live: true });
    bindStyle('#stTableOp', n => { bag().tableOpacity = +n.value; });
    bindStyle('#stColField', n => {
      bag().colWidthEditField = n.value;
      if (ch) patchChart(ch, { inspector: true, flash: false });
    });
    bindStyle('#stColPct', n => {
      const f = bag().colWidthEditField || el.querySelector('#stColField')?.value;
      if (!f) return;
      bag().colWidths = { ...(bag().colWidths || {}), [f]: Math.max(1, Math.min(100, +n.value || 8)) };
      bag().colWidthEditField = f;
    });
    bindStyle('#stShowIdx', n => { bag().showIndex = n.checked; });
    bindStyle('#stHeadSize', n => { bag().headerSize = +n.value; });
    bindStyle('#stPage', n => { bag().pageSize = +n.value; });
    bindStyle('#stPageMode', n => { bag().pageMode = n.value; });
    bindStyle('#stScrollRows', n => { bag().scrollRows = +n.value; });
    bindStyle('#stScrollInt', n => { bag().scrollInterval = +n.value; });
    bindStyle('#stFreeze', n => { bag().freezeLeft = +n.value; });
    bindStyle('#stFreezeTop', n => { bag().freezeTop = +n.value; });
    bindStyle('#stFreezeOn', n => {
      if (n.checked) {
        if (!(+bag().freezeLeft || 0) && !(+bag().freezeTop || 0)) bag().freezeLeft = 1;
      } else {
        bag().freezeLeft = 0;
        bag().freezeTop = 0;
      }
      if (ch) patchChart(ch, { inspector: true, flash: false });
    });
    bindStyle('#stHead', n => { bag().showHeader = n.checked; });
    bindStyle('#stHeadBold', n => { bag().headerBold = n.checked; });
    bindStyle('#stStripe', n => { bag().stripe = n.checked; });
    bindStyle('#stStripeBg', n => { bag().stripeBg = n.value; }, { live: true });
    bindStyle('#stCellBg', n => { bag().cellBg = n.value; }, { live: true });
    bindStyle('#stCellColor', n => { bag().cellColor = n.value; }, { live: true });
    bindStyle('#stRowH', n => { bag().rowHeight = +n.value; });
    bindStyle('#stHBorder', n => { bag().showHBorder = n.checked; });
    bindStyle('#stVBorder', n => { bag().showVBorder = n.checked; });
    bindStyle('#stAutoWrap', n => { bag().autoWrap = n.checked; });
    bindStyle('#stMerge', n => {
      bag().mergeCells = n.checked;
      if (n.checked) bag().stripe = false;
    });
    bindStyle('#stHeadBg', n => { bag().headerBg = n.value; }, { live: true });
    bindStyle('#stHeadColor', n => { bag().headerColor = n.value; }, { live: true });
    bindStyle('#stRowHeadBg', n => { bag().rowHeadBg = n.value; }, { live: true });
    bindStyle('#stRowHeadColor', n => { bag().rowHeadColor = n.value; }, { live: true });
    bindStyle('#stRowHeadBold', n => { bag().rowHeadBold = n.checked; });
    bindStyle('#stCornerBg', n => { bag().cornerBg = n.value; }, { live: true });
    bindStyle('#stCornerColor', n => { bag().cornerColor = n.value; }, { live: true });
    bindStyle('#stPivotMulti', n => { bag().pivotMultiHead = n.checked; });
    bindStyle('#stPivotLayout', n => { bag().pivotLayout = n.value; });
    bindStyle('#stPivotMeas', n => { bag().pivotMeasurePos = n.value; });
    bindStyle('#stRowTotal', n => { bag().showRowTotal = n.checked; });
    bindStyle('#stColTotal', n => { bag().showColTotal = n.checked; });
    bindStyle('#stTotalBg', n => { bag().totalBg = n.value; }, { live: true });
    bindStyle('#stTotalColor', n => { bag().totalColor = n.value; }, { live: true });
    el.querySelectorAll('#stColModeSeg [data-cm]').forEach(b => {
      b.onclick = () => {
        pushUndo(); bag().colWidthMode = b.dataset.cm;
        if (ch) patchChart(ch, { inspector: true, flash: false });
        else softStyle();
      };
    });
    el.querySelectorAll('#stHAlign [data-ha]').forEach(b => {
      b.onclick = () => {
        pushUndo(); bag().cellAlign = b.dataset.ha;
        el.querySelectorAll('#stHAlign [data-ha]').forEach(x => x.classList.toggle('on', x.dataset.ha === bag().cellAlign));
        softStyle();
      };
    });
    el.querySelectorAll('#stVAlign [data-va]').forEach(b => {
      b.onclick = () => {
        pushUndo(); bag().cellVAlign = b.dataset.va;
        el.querySelectorAll('#stVAlign [data-va]').forEach(x => x.classList.toggle('on', x.dataset.va === bag().cellVAlign));
        softStyle();
      };
    });
    el.querySelector('#stCellBold')?.addEventListener('click', () => {
      pushUndo(); bag().cellBold = !bag().cellBold;
      softStyle();
      if (ch) patchChart(ch, { inspector: true, flash: false });
    });
    el.querySelector('#stCellItalic')?.addEventListener('click', () => {
      pushUndo(); bag().cellItalic = !bag().cellItalic;
      softStyle();
      if (ch) patchChart(ch, { inspector: true, flash: false });
    });
    // 切换模式后需重绘面板
    ['#stPageMode', '#stMerge', '#stCondOn', '#stColField'].forEach((sel) => {
      el.querySelector(sel)?.addEventListener('change', () => {
        if (ch) patchChart(ch, { inspector: true, flash: false });
      });
    });
    el.querySelector('#stPivotBiz')?.addEventListener('click', () => {
      pushUndo();
      Object.assign(bag(), defaultPivotStyle());
      toast('已应用商务蓝透视表样式', 'ok');
      patchChart(ch, { inspector: true, flash: false });
    });
    el.querySelector('#stPivotReset')?.addEventListener('click', () => {
      pushUndo();
      Object.assign(bag(), defaultPivotStyle());
      toast('已恢复默认表头', 'ok');
      patchChart(ch, { inspector: true, flash: false });
    });
    bindStyle('#stPivotMeta', n => { bag().pivotMeta = n.checked; });
    bindStyle('#stPivotMetaLab', n => { bag().pivotMetaLabel = n.value; });
    bindStyle('#stPivotMetaVal', n => { bag().pivotMetaValue = n.value; });
    el.querySelectorAll('[data-lp]').forEach(b => {
      b.onclick = () => {
        pushUndo(); bag().legendPos = b.dataset.lp;
        el.querySelectorAll('[data-lp]').forEach(x => x.classList.toggle('on', x.dataset.lp === bag().legendPos || x.dataset.lp === resolveCompStyle(comp).legendPos));
        softStyle();
      };
    });
  }
  if (comp.type === 'slicer' || comp.type === 'text' || comp.type === 'query') {
    bindStyle('#stBg', n => { comp.props = comp.props || {}; comp.props.bg = n.value; }, { live: true });
    bindStyle('#stRadius', n => { comp.props = comp.props || {}; comp.props.radius = +n.value; });
    bindStyle('#stTitle', n => {
      comp.props = comp.props || {};
      if (comp.type === 'text') comp.props.color = n.value;
      else comp.props.titleColor = n.value;
    }, { live: true });
    bindStyle('#stSize', n => { comp.props = comp.props || {}; comp.props.fontSize = +n.value; });
    el.querySelectorAll('[data-ta]').forEach(b => {
      b.onclick = () => {
        pushUndo();
        comp.props = comp.props || {};
        comp.props.align = b.dataset.ta;
        el.querySelectorAll('[data-ta]').forEach(x => x.classList.toggle('on', x.dataset.ta === comp.props.align));
        softStyle();
      };
    });
    el.querySelectorAll('[data-qa]').forEach(b => {
      b.onclick = () => {
        pushUndo();
        comp.props = comp.props || {};
        comp.props.align = b.dataset.qa;
        el.querySelectorAll('[data-qa]').forEach(x => x.classList.toggle('on', x.dataset.qa === comp.props.align));
        softStyle();
      };
    });
  }
}

function renderSenior(el, comp) {
  const ch = comp.type === 'chart' ? state.dash.charts[comp.chartId] : null;
  const type = ch?.chartType || comp.type;
  const typeLabel = CHART_META[type]?.label || (type === 'slicer' ? '切片器' : type === 'text' ? '文本' : type);
  const sn = ch ? ensureSenior(ch) : null;
  const isChart = ['bar','hbar','line','area','pie'].includes(type);
  const isAxis = ['bar','hbar','line','area'].includes(type);
  const canLink = isChart || type === 'grouptable';
  const canJump = !!ch && type !== 'kpi';
  const canDrill = isAxis;
  const canCalc = type === 'kpi' || isChart;
  const canAlert = type === 'kpi';
  const canTopN = type === 'pie';
  const canAux = isAxis;
  const canLimit = isAxis || type === 'grouptable' || type === 'pie' || type === 'pivot' || type === 'table';

  let html = seniorGuideHtml(type, typeLabel);

  if (comp.type === 'slicer' || comp.type === 'query') {
    html += `
      <div class="sec"><h4>筛选作用域</h4>
        <p style="font-size:11px;color:var(--text-3);line-height:1.5">
          ${comp.type === 'query' ? '查询条件' : '切片器'}按字段写入页面筛选状态，默认作用于<strong>同页所有含该字段的图表</strong>，无需配置目标图。<br/>
          「图间联动」（点图过滤其它图）请选中源图表 → 高级 → 配置图间联动。
        </p>
      </div>`;
  } else if (comp.type === 'text') {
    html += `
      <div class="sec"><h4>说明</h4>
        <p style="font-size:11px;color:var(--text-3);line-height:1.5">文本组件无联动 / 跳转 / 告警等分析能力，样式请在「样式」中调整。</p>
      </div>`;
  } else if (ch && sn) {
    if (canLink) {
      const linkN = state.dash.linkages.filter(l => l.sourceChartId === ch.id && l.enabled).length;
      html += `
      <div class="sec"><h4>联动</h4>
        <p style="font-size:11px;color:var(--text-3);margin-bottom:8px">点击维值过滤目标图。已启用 ${linkN} 条。</p>
        <button class="btn" style="width:100%;justify-content:center" id="cfgLink">配置图间联动…</button>
      </div>`;
    }
    if (canJump) {
      html += `
      <div class="sec"><h4>跳转</h4>
        <p style="font-size:11px;color:var(--text-3);margin-bottom:8px">点击后跳转 URL 或其它仪表盘，支持 {value} 占位。</p>
        <button class="btn" style="width:100%;justify-content:center" id="cfgJump">配置跳转…</button>
      </div>`;
    }
    if (canDrill) {
      html += `
      <div class="sec"><h4>下钻 ${state.phase==='a'?'· Phase B+':''}</h4>
        <label class="chk"><input type="checkbox" id="snDrill" ${sn.drillEnabled!==false?'checked':''} ${state.phase==='a'?'disabled':''}/> 启用下钻（区域 → 产品）</label>
        <p style="font-size:10px;color:var(--text-3);margin-top:4px">需维度为区域时点击触发；与联动并存时按下方「点击动作」。</p>
      </div>`;
    }
    if (canLink || canJump || canDrill) {
      html += `
      <div class="sec"><h4>点击动作</h4>
        <div class="field"><label>同时配置多项时</label>
          <select id="snClick">
            <option value="auto" ${sn.clickAction==='auto'?'selected':''}>自动（有联动先联动）</option>
            <option value="linkage" ${sn.clickAction==='linkage'?'selected':''}>优先联动</option>
            <option value="drill" ${sn.clickAction==='drill'?'selected':''}>优先下钻</option>
            <option value="jump" ${sn.clickAction==='jump'?'selected':''}>优先跳转</option>
          </select>
        </div>
      </div>`;
    }
    if (canCalc) {
      html += `
      <div class="sec"><h4>快速计算</h4>
        <div class="field"><label>同比 / 环比</label>
          <select id="calc">
            <option value="none">无</option>
            <option value="yoy">同比 YoY</option>
            <option value="mom">环比 MoM</option>
          </select>
        </div>
        <p style="font-size:10px;color:var(--text-3)">KPI 显示涨跌幅；其它图在提示中标注（演示数据）。</p>
      </div>`;
    }
    if (canAlert) {
      html += `
      <div class="sec"><h4>阈值告警</h4>
        <p style="font-size:11px;color:var(--text-3);margin-bottom:8px">指标超出阈值时高亮卡片。</p>
        <button class="btn" style="width:100%;justify-content:center" id="cfgAlert">配置阈值告警…</button>
      </div>`;
    }
    if (canAux) {
      html += `
      <div class="sec"><h4>辅助线</h4>
        <label class="chk"><input type="checkbox" id="snAux" ${sn.auxEnabled?'checked':''}/> 显示辅助线</label>
        <div class="field"><label>阈值</label><input id="snAuxVal" type="number" value="${sn.auxValue || 0}"/></div>
        <div class="field"><label>名称</label><input id="snAuxLab" value="${esc(sn.auxLabel || '辅助线')}"/></div>
      </div>`;
    }
    if (canTopN) {
      html += `
      <div class="sec"><h4>TopN</h4>
        <div class="field"><label>仅展示前 N 项（其余合并为「其他」）</label>
          <select id="snTopN">
            <option value="0" ${!sn.topN?'selected':''}>关闭</option>
            ${[3,5,8,10].map(n => `<option value="${n}" ${+sn.topN===n?'selected':''}>Top ${n}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }
    if (canLimit && !canTopN) {
      html += `
      <div class="sec"><h4>结果条数</h4>
        <div class="field"><label>最多展示</label>
          <select id="snLimit">
            <option value="0" ${!sn.resultLimit?'selected':''}>全部</option>
            ${[5,10,20,50,100,200].map(n => `<option value="${n}" ${+sn.resultLimit===n?'selected':''}>前 ${n} 条</option>`).join('')}
          </select>
        </div>
        <p style="font-size:10px;color:var(--text-3);margin-top:6px">也可在「数据」面板「过滤与条数」中配置。</p>
      </div>`;
    }
  }

  html += `
    <div class="sec"><h4>嵌入 SDK</h4>
      <div class="code" id="embedBox">加载中…</div>
    </div>
    <div class="sec"><h4>调试</h4>
      <p style="font-size:11px;color:var(--text-3)">contentId=${state.dash.contentId} · version=${state.dash.version}${ch ? ` · chart=${ch.id}` : ''}</p>
    </div>`;

  if (comp.type === 'chart' && ch) {
    mountChartWork(el, ch, { paneTitle: '高级', leftInner: html });
  } else {
    el.innerHTML = `${inspModeSegHtml()}<div class="insp-scroll">${html}</div>`;
    wireInspMode(el);
  }

  const soft = () => { markDirty(); if (ch) patchChart(ch, { inspector: false, flash: false }); };

  if (ch && sn) {
    const calc = el.querySelector('#calc');
    if (calc) {
      calc.value = ch.encode.calc || 'none';
      calc.onchange = e => { pushUndo(); ch.encode.calc = e.target.value; soft(); };
    }
    el.querySelector('#cfgLink')?.addEventListener('click', () => openLinkageModal(ch));
    el.querySelector('#cfgJump')?.addEventListener('click', () => openJumpModal(ch));
    el.querySelector('#cfgAlert')?.addEventListener('click', () => openAlertModal(ch));
    el.querySelector('#snDrill')?.addEventListener('change', e => { pushUndo(); sn.drillEnabled = e.target.checked; soft(); });
    el.querySelector('#snClick')?.addEventListener('change', e => { pushUndo(); sn.clickAction = e.target.value; soft(); });
    el.querySelector('#snAux')?.addEventListener('change', e => { pushUndo(); sn.auxEnabled = e.target.checked; soft(); });
    const bindNum = (sel, key) => {
      const node = el.querySelector(sel);
      if (!node) return;
      const apply = () => { pushUndo(); sn[key] = +node.value || 0; soft(); };
      node.addEventListener('change', apply);
      node.addEventListener('blur', apply);
    };
    bindNum('#snAuxVal', 'auxValue');
    el.querySelector('#snAuxLab')?.addEventListener('change', e => { pushUndo(); sn.auxLabel = e.target.value; soft(); });
    bindNum('#snTopN', 'topN');
    bindNum('#snLimit', 'resultLimit');
  }

  const token = state.dash.share?.token || 'YOUR_TOKEN';
  const box = el.querySelector('#embedBox');
  if (box) {
    box.textContent =
`<iframe src="/embed/${token}" width="100%" height="480" frameborder="0"></iframe>

// SDK
DashboardEmbed.mount('#el', { token: '${token}', theme: '${state.dash.theme}' })`;
  }
}

function leavePreview() {
  state.mobile = false;
  state.module = 'dashboard';
  state.screen = state.previewFrom === 'editor' ? 'editor' : 'list';
  render();
}

/** 列表 / 编辑器共用：打开已发布只读预览 */
function openPublishedPreview(from) {
  state.module = 'dashboard';
  const d = state.dash || currentDash();
  if (!d) { toast('未选择仪表盘', 'warn'); return; }
  if (d.status === 'draft') {
    toast('当前是草稿，请先点「发布」后再预览已发布版', 'warn');
    return;
  }
  state.previewFrom = from === 'editor' ? 'editor' : 'list';
  state.screen = 'preview';
  render();
}

function isShareViewer() {
  return !!state.shareViewer || __productOpts?.mode === 'share';
}

function renderPreview(app) {
  const d = state.dash;
  const shareViewer = isShareViewer();
  if (!d || d.status === 'draft') {
    if (shareViewer) {
      app.innerHTML = `<div class="empty" style="position:relative;margin:40px"><p>分享内容不可用</p></div>`;
      return;
    }
    app.innerHTML = `<div class="bar"><button type="button" class="btn ghost" id="back">← 返回</button><b>尚未发布</b></div>
      <div class="empty" style="position:relative;margin:40px">
        <p>草稿没有已发布版本可预览</p>
        <button type="button" class="btn primary" id="pub">发布并预览</button>
      </div>`;
    app.querySelector('#back').onclick = leavePreview;
    app.querySelector('#pub').onclick = () => {
      d.status = 'published';
      toast('已发布', 'ok');
      state.screen = 'preview';
      render();
    };
    return;
  }
  const backLabel = state.previewFrom === 'editor' ? '← 返回编辑' : '← 返回列表';
  const mob = ensureMobile(d);
  const narrow = shareViewer ? false : isNarrowPreview();
  const useMobLay = useMobileLayout();
  const adapted = narrow && !useMobLay;
  // 分享访客：仅看板内容 + 查询条件，无管理工具栏
  const barHtml = shareViewer
    ? ''
    : `<div class="bar">
      <button type="button" class="btn ghost" id="back">${backLabel}</button>
      <b>${esc(d.name)}</b>
      <span class="tag pub">已发布只读</span>
      ${narrow ? '<span class="tag mob">手机预览</span>' : ''}
      ${mob.enabled && mob.components.length ? '<span class="tag mob">专属移动布局</span>' : ''}
      <div class="spacer"></div>
      ${state.phase!=='a'?`<button type="button" class="btn ghost" id="mob" title="在手机机框中预览窄屏效果">${narrow?'桌面预览':'手机预览'}</button>`:''}
      <button type="button" class="btn" id="dl">下载数据</button>
      <button type="button" class="btn" id="sh">分享</button>
    </div>`;
  app.innerHTML = `
    ${barHtml}
    <div class="canvas-wrap ${narrow?'mobile-edit':''}" id="cwrap" style="flex:1;min-height:0">
      ${narrow
        ? phoneShellHtml(mob, { mode: 'preview' })
        : `<div class="tab-strip" id="tabStrip"></div><div class="board" id="board"></div>`}
    </div>`;
  if (!shareViewer) {
    app.querySelector('#back').onclick = leavePreview;
    app.querySelector('#sh').onclick = () => openShareModal();
    app.querySelector('#dl')?.addEventListener('click', () => exportCsv());
    app.querySelector('#mob')?.addEventListener('click', () => {
      state.mobile = !state.mobile;
      if (state.mobile) {
        const m = ensureMobile(d);
        if (!m.enabled || !m.components.length) {
          toast('未配置专属移动布局：已将组件竖排适配手机预览', 'ok');
        } else {
          toast('已切换手机预览（专属移动布局）', 'ok');
        }
      }
      render();
    });
  }
  if (app.querySelector('#tabStrip')) renderTabStrip(app.querySelector('#tabStrip'));
  if (narrow) {
    if (useMobLay) ensureMobileKpiRoom();
    if (adapted) {
      // 机框内提示条：说明当前是 PC 布局适配，非编辑器「移动布局」
      const body = app.querySelector('.phone-body');
      if (body && !body.querySelector('.mob-adapt-tip')) {
        const tip = document.createElement('div');
        tip.className = 'mob-adapt-tip';
        tip.textContent = '竖排适配预览 · 可在编辑器「移动布局」配置专属排版';
        body.insertBefore(tip, body.firstChild);
      }
    }
    fitMobilePhone();
    wirePhoneDeviceSwitch(app);
  }
  renderBoard(app.querySelector('#board'));
}

/* ---------- modals ---------- */
function showModal(html, opts = {}) {
  const mask = elById('mask');
  if (!mask) return;
  mask.classList.add('show');
  mask.classList.toggle('studio-mode', !!opts.studio);
  mask.classList.toggle('alert-mode', !!opts.alert);
  const cls = ['modal', opts.studio ? 'ds-studio-shell' : '', opts.wide ? 'wide' : '', opts.wizard ? 'wizard' : '', opts.alert ? 'alert' : ''].filter(Boolean).join(' ');
  mask.innerHTML = `<div class="${cls}">${html}</div>`;
  mask.onclick = e => { if (e.target === mask) hideModal(); };
}
function hideModal() {
  disposeOneChart('rpt_preview');
  disposeOneChart('rpt_ref_preview');
  const mask = elById('mask');
  if (!mask) return;
  mask.classList.remove('show', 'studio-mode', 'alert-mode');
  mask.innerHTML = '';
}

function openPublishModal() {
  const d = state.dash;
  if (!d) { toast('未选择仪表盘', 'warn'); return; }
  const charts = Object.values(d.charts || {});
  const comps = (d.components || []).filter(c => c.type === 'chart');
  const bound = comps.filter(c => {
    const ch = d.charts[c.chartId];
    return ch && !missingBind(ch).length;
  }).length;
  const pending = state.pendingPaint?.size || 0;
  const isRepub = d.status === 'published' || d.status === 'publishedWithDraft';

  showModal(`
    <h3>${isRepub ? '确认发布更新' : '发布仪表盘'}</h3>
    <p style="font-size:12px;color:var(--text-2);margin:-4px 0 14px;line-height:1.5">
      发布前请确认名称与基础信息。发布后可预览、分享已发布版本。
    </p>
    <div class="field"><label>仪表盘名称 <span style="color:var(--danger)">*</span></label>
      <input id="pubName" maxlength="64" value="${esc(d.name || '')}" placeholder="请输入仪表盘名称" />
    </div>
    <div class="field"><label>分组</label>
      <input id="pubFolder" maxlength="32" value="${esc(d.folder || '未分组')}" placeholder="如：销售分析" />
    </div>
    <div class="field"><label>描述</label>
      <textarea id="pubDesc" rows="3" maxlength="200" placeholder="可选，简要说明用途与受众">${esc(d.desc || '')}</textarea>
    </div>
    <div class="pub-summary">
      <div><span>图表组件</span><b>${comps.length}</b></div>
      <div><span>已配置</span><b>${bound}</b></div>
      <div><span>待更新数据</span><b>${pending}</b></div>
      <div><span>当前版本</span><b>v${d.version || 1}</b></div>
    </div>
    ${pending ? '<p class="pub-warn">有图表字段已改但未点「更新数据」，发布后仍以当前出图为准。</p>' : ''}
    <div class="actions">
      <button type="button" class="btn ghost" id="pubCancel">取消</button>
      <button type="button" class="btn primary" id="pubOk">${isRepub ? '确认发布' : '发布'}</button>
    </div>
  `);

  const nameEl = document.getElementById('pubName');
  nameEl?.focus();
  nameEl?.select?.();
  document.getElementById('pubCancel').onclick = hideModal;
  document.getElementById('pubOk').onclick = async () => {
    const name = (document.getElementById('pubName')?.value || '').trim();
    if (!name) {
      toast('请填写仪表盘名称', 'warn');
      nameEl?.focus();
      return;
    }
    const folder = (document.getElementById('pubFolder')?.value || '').trim() || '未分组';
    const desc = (document.getElementById('pubDesc')?.value || '').trim();
    const okBtn = document.getElementById('pubOk');
    if (okBtn) {
      okBtn.disabled = true;
      okBtn.textContent = '发布中…';
    }
    pushUndo();
    d.name = name;
    d.folder = folder;
    d.desc = desc;
    markDirty();

    const opts = __productOpts || {};
    try {
      if (opts.onPublish) {
        await opts.onPublish(clone(d));
      } else {
        d.version = (d.version || 1) + 1;
      }
      d.status = 'published';
      hideModal();
      toast(isRepub ? '已发布更新' : '已发布', 'ok');
      render();
    } catch (e) {
      if (okBtn) {
        okBtn.disabled = false;
        okBtn.textContent = isRepub ? '确认发布' : '发布';
      }
      toast(e?.message || '发布失败', 'warn');
    }
  };
}

function openShareModal() {
  if (state.dash.status === 'draft') { toast('请先发布再分享', 'warn'); return; }
  const existing = state.dash.share;
  const origin = location.origin;
  showModal(`
    <h3>分享仪表盘</h3>
    <p style="font-size:12px;color:var(--text-2);margin:-4px 0 14px;line-height:1.5">
      生成专属访问地址，他人打开即可只读查看已发布版本。分享关系由后端记录。
    </p>
    <div class="field"><label>可见性</label>
      <select id="vis"><option value="public">公开链接</option><option value="org">组织内</option></select>
    </div>
    <div class="field"><label>权限</label>
      <select id="perm"><option value="view">仅查看</option></select>
    </div>
    <div class="field"><label>专属链接</label>
      <input id="url" readonly value="${existing?.token ? origin + '/share/' + existing.token : '创建后生成'}" />
    </div>
    <div class="actions">
      <button class="btn ghost" id="c">取消</button>
      <button class="btn" id="copy" ${existing?.token ? '' : 'disabled'}>复制链接</button>
      <button class="btn primary" id="ok">${existing?.token ? '更新分享' : '创建分享'}</button>
    </div>`);
  if (existing) {
    if (existing.visibility) document.getElementById('vis').value = existing.visibility;
    if (existing.perm || existing.permission) {
      document.getElementById('perm').value = existing.perm || existing.permission;
    }
  }
  document.getElementById('c').onclick = hideModal;
  document.getElementById('ok').onclick = async () => {
    const visibility = document.getElementById('vis').value;
    const perm = document.getElementById('perm').value;
    const okBtn = document.getElementById('ok');
    okBtn.disabled = true;
    okBtn.textContent = '处理中…';
    try {
      const opts = __productOpts || {};
      let share;
      if (opts.onShare) {
        share = await opts.onShare({ visibility, perm });
      } else {
        const token = 'sh_' + String(state.dash.id).slice(-4) + '_' + Math.random().toString(36).slice(2, 8);
        share = { token, visibility, perm, enabled: true, dashboardId: state.dash.id };
      }
      const token = share.token;
      state.dash.share = {
        token,
        visibility: share.visibility || visibility,
        perm: share.perm || perm,
        url: '/share/' + token
      };
      document.getElementById('url').value = origin + '/share/' + token;
      document.getElementById('copy').disabled = false;
      okBtn.textContent = '更新分享';
      toast('分享已创建，可复制专属链接', 'ok');
    } catch (e) {
      toast(e?.message || '分享失败', 'warn');
    } finally {
      okBtn.disabled = false;
      if (!okBtn.textContent.includes('更新')) okBtn.textContent = '创建分享';
    }
  };
  document.getElementById('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('url').value);
      toast('已复制链接', 'ok');
    } catch { toast(document.getElementById('url').value); }
  };
}

function liveRowsForChart(ch) {
  const cache = state._chartQueryCache || {};
  const hit = cache[ch.id];
  if (hit && hit.status === 'ok' && hit.payload?.rows) return hit.payload.rows;
  if (isProductLive()) return [];
  return filteredRows(ch);
}

function exportCsv() {
  const comp = state.dash.components.find(c => c.id === state.selectedId && c.type === 'chart');
  const ch = comp ? state.dash.charts[comp.chartId] : Object.values(state.dash.charts)[0];
  if (!ch || missingBind(ch).length) { toast('请先选中已配置的图表', 'warn'); return; }
  const opts = __productOpts || {};
  if (opts.onExportChart) {
    Promise.resolve(opts.onExportChart(ch.id, ch))
      .then(() => toast('已导出 CSV', 'ok'))
      .catch((e) => toast(e?.message || '导出失败', 'warn'));
    return;
  }
  const rows = liveRowsForChart(ch);
  const catFields = encodeFields(ch.encode, 'category');
  const colFields = encodeFields(ch.encode, 'colDim');
  const valFields = encodeFields(ch.encode, 'value');
  let csv;
  if (ch.chartType === 'pivot' && catFields.length && colFields.length && valFields.length) {
    const piv = pivotAggregate(rows, catFields, colFields, valFields, ch.encode.agg || 'SUM', ch.datasetId);
    csv = ['row_dim', ...piv.colKeys, 'row_total'].join(',') + '\n' +
      piv.matrix.map(r => [JSON.stringify(r.row), ...r.vals, r.total].join(',')).join('\n');
  } else if (ch.chartType === 'table') {
    const cols = Object.keys(rows[0] || {});
    csv = cols.join(',') + '\n' + rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(',')).join('\n');
  } else if (ch.chartType === 'grouptable' || valFields.length > 1) {
    const pack = aggregateSeries(rows, catFields, valFields, ch.encode.agg || 'SUM', ch.datasetId);
    csv = ['name', ...pack.series.map(s => s.field)].join(',') + '\n' +
      pack.categories.map((name, i) => [JSON.stringify(name), ...pack.series.map(s => s.data[i])].join(',')).join('\n');
  } else {
    const data = aggregate(rows, catFields, valFields[0], ch.encode.agg);
    csv = 'name,value\n' + data.map(r => `${JSON.stringify(r.name)},${r.value}`).join('\n');
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${ch.title || ch.id}.csv`;
  a.click();
  toast('已导出 CSV', 'ok');
}

function openDataModal(comp) {
  if (comp.type !== 'chart') { toast('仅图表支持查看数据', 'warn'); return; }
  const ch = state.dash.charts[comp.chartId];
  const rows = liveRowsForChart(ch);
  showModal(`<h3>查看数据 · ${esc(ch.title)}</h3>
    <div class="table-wrap" style="max-height:360px">
      <table class="dt"><thead><tr>${Object.keys(rows[0]||{empty:1}).map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0,50).map(r => `<tr>${Object.values(r).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </div>
    <div class="actions"><button class="btn primary" id="c">关闭</button></div>`);
  document.getElementById('c').onclick = hideModal;
}

function openSqlModal(comp) {
  const ch = state.dash.charts[comp.chartId];
  if (!ch?.datasetId) { toast('未绑定数据集', 'warn'); return; }
  const agg = ch.encode.agg || 'SUM';
  const cats = encodeFields(ch.encode, 'category');
  const cols = encodeFields(ch.encode, 'colDim');
  const vals = encodeFields(ch.encode, 'value');
  const dimExpr = cats.length ? cats.join(', ') : null;
  const measureExpr = vals.map((f, i) => `${agg}(${f}) AS measure${vals.length > 1 ? i + 1 : ''}`).join(', ');
  let sql;
  if (ch.chartType === 'pivot') {
    const colExpr = cols.join(', ');
    sql = `SELECT ${dimExpr} AS row_dim, ${colExpr} AS col_dim, ${measureExpr}\nFROM dataset_${ch.datasetId}\nGROUP BY ${dimExpr}, ${colExpr}\nORDER BY row_dim, col_dim`;
  } else if (ch.chartType === 'table') {
    sql = `SELECT *\nFROM dataset_${ch.datasetId}\n/* 明细表：应用页面筛选后返回原始行 */\nLIMIT ${ch.style?.pageSize || 100}`;
  } else if (dimExpr) {
    sql = `SELECT ${dimExpr}${vals.length === 1 ? ' AS dim' : ''}, ${measureExpr}\nFROM dataset_${ch.datasetId}\nGROUP BY ${dimExpr}\nORDER BY ${vals.length === 1 ? 'measure' : vals[0]} DESC`;
  } else {
    sql = `SELECT ${measureExpr || `${agg}(*) AS measure`}\nFROM dataset_${ch.datasetId}`;
  }
  showModal(`<h3>查看 SQL</h3><div class="code">${esc(sql)}</div>
    <div class="actions"><button class="btn primary" id="c">关闭</button></div>`);
  document.getElementById('c').onclick = hideModal;
}

function openLinkageModal(ch) {
  const others = Object.values(state.dash.charts).filter(c => c.id !== ch.id);
  const cur = state.dash.linkages.filter(l => l.sourceChartId === ch.id);
  const rows = others.map(o => {
    const on = cur.find(l => l.targetChartId === o.id);
    const fields = ds(o.datasetId)?.fields || [{ name: 'region', label: 'region' }];
    return `<label style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:12px;flex-wrap:wrap">
      <input type="checkbox" data-t="${o.id}" ${on ? 'checked' : ''}/> ${esc(o.title)}
      <select data-tf="${o.id}" style="margin-left:auto;height:28px">
        ${fields.map(f => `<option value="${f.name}" ${on?.targetField === f.name ? 'selected' : ''}>${esc(f.label || f.name)}</option>`).join('')}
      </select>
    </label>`;
  }).join('') || '<p style="font-size:12px;color:var(--text-3)">请先添加其他图表</p>';
  showModal(`<h3>联动配置 · ${esc(ch.title)}</h3>
    <p style="font-size:12px;color:var(--text-2);margin-bottom:10px">勾选目标图并映射字段（同/跨数据集）</p>
    ${rows}
    <div class="field" style="margin-top:10px"><label>源字段</label>
      <select id="sf">${(ds(ch.datasetId)?.fields || []).map(f => `<option value="${f.name}">${esc(f.label)}</option>`).join('')}</select>
    </div>
    <div class="actions">
      <button class="btn ghost" id="c">取消</button>
      <button class="btn primary" id="ok">保存</button>
    </div>`);
  const srcField = cur[0]?.sourceField || encodePrimary(ch.encode, 'category') || 'region';
  const sf = document.getElementById('sf');
  if (sf) sf.value = srcField;
  document.getElementById('c').onclick = hideModal;
  document.getElementById('ok').onclick = () => {
    pushUndo();
    state.dash.linkages = state.dash.linkages.filter(l => l.sourceChartId !== ch.id);
    document.querySelectorAll('[data-t]').forEach(cb => {
      if (!cb.checked) return;
      const tid = cb.dataset.t;
      const tf = document.querySelector(`[data-tf="${tid}"]`).value;
      state.dash.linkages.push({
        id: uid('l'), sourceChartId: ch.id, sourceField: sf?.value || 'region',
        targetChartId: tid, targetField: tf, enabled: true
      });
    });
    markDirty();
    hideModal();
    toast('联动已保存', 'ok');
  };
}

function openAlertModal(ch) {
  if (!ch || ch.chartType !== 'kpi') { toast('请选择 KPI 图', 'warn'); return; }
  const cur = state.dash.alerts.find(a => a.chartId === ch.id) || { operator: 'lt', threshold: 300, enabled: true };
  showModal(`<h3>KPI 阈值告警 · ${esc(ch.title)}</h3>
    <div class="field"><label>条件</label>
      <select id="op"><option value="lt">小于</option><option value="gt">大于</option><option value="lte">小于等于</option><option value="gte">大于等于</option></select>
    </div>
    <div class="field"><label>阈值</label><input id="th" type="number" value="${cur.threshold}" /></div>
    <div class="field"><label><input type="checkbox" id="en" ${cur.enabled ? 'checked' : ''}/> 启用</label></div>
    <div class="actions"><button class="btn ghost" id="c">取消</button><button class="btn primary" id="ok">保存</button></div>`);
  document.getElementById('op').value = cur.operator;
  document.getElementById('c').onclick = hideModal;
  document.getElementById('ok').onclick = () => {
    pushUndo();
    state.dash.alerts = state.dash.alerts.filter(a => a.chartId !== ch.id);
    state.dash.alerts.push({
      id: uid('a'), chartId: ch.id, metricField: encodePrimary(ch.encode, 'value'),
      operator: document.getElementById('op').value,
      threshold: +document.getElementById('th').value,
      enabled: document.getElementById('en').checked
    });
    markDirty(); hideModal(); toast('告警已保存', 'ok'); render();
  };
}

function openJumpModal(ch) {
  if (!ch) return;
  const cur = state.dash.jumps.find(j => j.sourceChartId === ch.id) || {
    targetType: 'url', target: 'https://example.com/detail?region={value}', triggerField: encodePrimary(ch.encode, 'category') || 'region'
  };
  showModal(`<h3>跳转配置 · ${esc(ch.title)}</h3>
    <div class="field"><label>目标类型</label>
      <select id="jt"><option value="url">URL</option><option value="dashboard">另一仪表盘</option></select>
    </div>
    <div class="field"><label>目标</label><input id="tg" value="${esc(cur.target)}" /></div>
    <div class="field"><label>触发字段</label><input id="tf" value="${esc(cur.triggerField)}" /></div>
    <p style="font-size:11px;color:var(--text-3)">URL 中可用 {value} 占位点击维值</p>
    <div class="actions"><button class="btn ghost" id="c">取消</button><button class="btn primary" id="ok">保存</button></div>`);
  document.getElementById('jt').value = cur.targetType;
  document.getElementById('c').onclick = hideModal;
  document.getElementById('ok').onclick = () => {
    pushUndo();
    state.dash.jumps = state.dash.jumps.filter(j => j.sourceChartId !== ch.id);
    state.dash.jumps.push({
      id: uid('j'), sourceChartId: ch.id,
      targetType: document.getElementById('jt').value,
      target: document.getElementById('tg').value,
      triggerField: document.getElementById('tf').value
    });
    markDirty(); hideModal(); toast('跳转已保存', 'ok');
  };
}

const __phaseTabs = typeof document !== 'undefined' ? document.getElementById('phaseTabs') : null;
if (__phaseTabs) {
  __phaseTabs.onclick = e => {
    if (__productOpts) return;
    const b = e.target.closest('button[data-phase]');
    if (!b) return;
    state.phase = b.dataset.phase;
    if (state.phase === 'a') state.mobile = false;
    toast(`已切换 ${b.textContent}`, 'ok');
    render();
  };
}

const __modNav = typeof document !== 'undefined' ? document.getElementById('modNav') : null;
if (__modNav) {
  __modNav.onclick = e => {
    const b = e.target.closest('button[data-mod]');
    if (!b) return;
    const mod = b.dataset.mod;
    if (mod === state.module && ((mod !== 'dashboard' && mod !== 'report') || state.screen === 'list')) {
      syncRoute();
      return;
    }
    state.search = '';
    if (mod !== 'dashboard' && mod !== 'report') state.folderFilter = 'all';
    gotoModule(mod);
  };
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && state.selectedId && state.screen === 'editor') {
      const comp = findComp(state.selectedId);
      if (comp && !comp._mobile) {
        state.clipboard = clone(comp);
        if (comp.chartId) state.clipboard._chart = clone(state.dash.charts[comp.chartId]);
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v' && state.screen === 'editor') {
      if (isMobileEdit()) toast('移动布局不支持粘贴新建，请从组件池勾选', 'warn');
      else pasteComp();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.screen !== 'editor' || !state.selectedId) return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const comp = findComp(state.selectedId);
      if (!comp) return;
      pushUndo();
      deleteSelectedComp(comp);
      markDirty();
      render();
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (state.screen === 'editor' || state.screen === 'preview') {
      if (useMobileLayout()) fitMobilePhone();
      else reflowBoardLayout();
    }
  });
}


