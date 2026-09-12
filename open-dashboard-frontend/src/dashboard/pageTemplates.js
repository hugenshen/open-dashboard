/* P013 · 模板市场封面 SVG（从 hi-fi page-templates.js 抽出，供 TemplateMarket 使用） */
const FAMILY_BY_ID = {
  blank: 'blank',
  exec: 'kpi-wall',
  'kpi-wall': 'kpi-wall',
  hr: 'kpi-wall',
  sales: 'sales',
  region: 'region',
  channel: 'sales',
  product: 'region',
  ops: 'ops',
  promo: 'promo',
  funnel: 'ops',
  traffic: 'ops',
  sla: 'ops',
  finance: 'finance',
  cash: 'finance',
  cost: 'finance',
  gmv: 'sales',
  store: 'sales',
  crm: 'crm',
  cohort: 'crm',
  nps: 'crm',
  inventory: 'inventory',
  supply: 'inventory',
  quality: 'inventory'
}

function escMini(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  let shotSeq = 0;
  function shot(inner, opt) {
    opt = opt || {};
    const id = 't' + (++shotSeq);
    inner = String(inner)
      .replace(/url\(#gHero\)/g, `url(#${id}Hero)`)
      .replace(/url\(#gWarm\)/g, `url(#${id}Warm)`)
      .replace(/url\(#gCool\)/g, `url(#${id}Cool)`);
    const dark = !!opt.dark;
    const bg = opt.bg || (dark ? '#0b1220' : '#e8edf4');
    const title = opt.title || '';
    const bar = dark ? '#101827' : '#ffffff';
    const ink = dark ? '#94a3b8' : '#8f959e';
    const defs = `<defs>
      <linearGradient id="${id}Hero" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6d5efc"/><stop offset="48%" stop-color="#ff7a59"/><stop offset="100%" stop-color="#3ec8ff"/>
      </linearGradient>
      <linearGradient id="${id}Warm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff9a56"/><stop offset="100%" stop-color="#ff5d8a"/>
      </linearGradient>
      <linearGradient id="${id}Cool" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3370ff"/><stop offset="100%" stop-color="#67b8ff"/>
      </linearGradient>
    </defs>`;
    return `<svg class="tpl-shot" viewBox="0 0 320 194" width="320" height="194" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${defs}<rect width="320" height="194" rx="0" fill="${bg}"/><rect width="320" height="18" fill="${bar}"/><circle cx="12" cy="9" r="2.6" fill="#ff5f57"/><circle cx="22" cy="9" r="2.6" fill="#febc2e"/><circle cx="32" cy="9" r="2.6" fill="#28c840"/>${title ? `<text x="44" y="13" fill="${ink}" font-size="8" font-weight="600" font-family="PingFang SC,Hiragino Sans GB,sans-serif">${escMini(title)}</text>` : ''}<g transform="translate(0,18)">${inner}</g></svg>`;
  }
  function box(x, y, w, h, fill, rx) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx == null ? 5 : rx}" fill="${fill}"/>`;
  }
  function tx(x, y, s, fill, size, weight) {
    return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight || 600}" font-family="PingFang SC,Hiragino Sans GB,sans-serif">${escMini(s)}</text>`;
  }
  function kpi(x, y, w, label, val, delta, accent, fill, h) {
    h = h == null ? 48 : h;
    const f = fill || '#fff';
    const dark = String(f).indexOf('url(') === 0;
    const dc = String(delta || '').charAt(0) === '-' ? (dark ? '#ffb4b4' : '#f53f3f') : (dark ? '#9affc2' : '#00b42a');
    const vy = h >= 46 ? y + 34 : y + h - 8;
    return box(x, y, w, h, f)
      + tx(x + 8, y + 14, label, dark ? 'rgba(255,255,255,.78)' : '#86909c', 8, 500)
      + tx(x + 8, vy, val, dark ? '#fff' : (accent || '#1d2129'), h >= 46 ? 14 : 13, 700)
      + (delta ? `<text x="${x + w - 8}" y="${y + 14}" fill="${dc}" font-size="8" font-weight="600" text-anchor="end" font-family="PingFang SC,Hiragino Sans GB,sans-serif">${escMini(delta)}</text>` : '');
  }
  /** 封面底栏与应用后 extraTrio 对齐：排行 / 趋势 / 结构，不用仪表盘/地图/热力 */
  function trio(y, color) {
    color = color || '#3370ff';
    const pal = [color, '#69b1ff', '#adc6ff', '#e5e6eb'];
    return hbarChart(8, y, 100, 50, [82, 64, 48], color, '排行')
      + lineChart(112, y, 100, 50, [18, 28, 22, 36, 30], color, '趋势')
      + pieChart(216, y, 96, 50, [44, 28, 18, 10], pal, '结构');
  }
  function heroBanner(x, y, w, h, label, val, delta) {
    const compact = h < 48;
    return box(x, y, w, h, 'url(#gHero)', 8)
      + `<circle cx="${x + w - 26}" cy="${y + 16}" r="18" fill="#fff" opacity=".18"/>`
      + `<circle cx="${x + w - 8}" cy="${y + h - 8}" r="22" fill="#fff" opacity=".1"/>`
      + tx(x + 12, y + (compact ? 14 : 16), label, 'rgba(255,255,255,.88)', 8, 500)
      + tx(x + 12, y + (compact ? 32 : 38), val, '#fff', compact ? 14 : 16, 700)
      + (delta
        ? (compact
          ? `<text x="${x + w - 12}" y="${y + 32}" fill="rgba(255,255,255,.92)" font-size="8" font-weight="600" text-anchor="end" font-family="PingFang SC,Hiragino Sans GB,sans-serif">${escMini(delta)}</text>`
          : tx(x + 12, y + h - 8, delta, 'rgba(255,255,255,.9)', 8, 600))
        : '');
  }
  function barChart(x, y, w, h, vals, color, title) {
    const max = Math.max.apply(null, vals.concat(1));
    const gap = 3;
    const bw = (w - 16 - gap * (vals.length - 1)) / vals.length;
    const bars = vals.map((v, i) => {
      const bh = Math.max(4, (v / max) * (h - 28));
      return `<rect x="${x + 8 + i * (bw + gap)}" y="${y + h - 10 - bh}" width="${Math.max(2, bw - 1)}" height="${bh}" rx="2" fill="${color}"/>`;
    }).join('');
    return box(x, y, w, h, '#fff') + (title ? tx(x + 8, y + 14, title, '#86909c', 8, 500) : '') + bars;
  }
  function lineChart(x, y, w, h, pts, color, title) {
    const xs = pts.map((_, i) => x + 10 + (i / (pts.length - 1)) * (w - 20));
    const min = Math.min.apply(null, pts);
    const max = Math.max.apply(null, pts);
    const ys = pts.map((p) => y + h - 12 - ((p - min) / (max - min || 1)) * (h - 30));
    const d = xs.map((xx, i) => (i ? 'L' : 'M') + xx + ',' + ys[i]).join(' ');
    const area = d + ` L${x + w - 10},${y + h - 8} L${x + 10},${y + h - 8} Z`;
    return box(x, y, w, h, '#fff')
      + (title ? tx(x + 8, y + 14, title, '#86909c', 8, 500) : '')
      + `<path d="${area}" fill="${color}" opacity=".16"/>`
      + `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }
  function pieChart(x, y, w, h, segs, colors, title) {
    colors = colors || ['#3370ff', '#00b578', '#ff8800', '#f54a45'];
    const cx = x + w / 2;
    const cy = y + h / 2 + 4;
    const R = Math.min(w, h) / 2 - 14;
    const r = R * 0.58;
    let a = -Math.PI / 2;
    const total = segs.reduce((s, v) => s + v, 0);
    const paths = segs.map((v, i) => {
      const da = (v / total) * Math.PI * 2;
      const a2 = a + da;
      const large = da > Math.PI ? 1 : 0;
      const p = `<path d="M${cx + R * Math.cos(a)},${cy + R * Math.sin(a)} A${R},${R} 0 ${large} 1 ${cx + R * Math.cos(a2)},${cy + R * Math.sin(a2)} L${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} A${r},${r} 0 ${large} 0 ${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} Z" fill="${colors[i]}"/>`;
      a = a2;
      return p;
    }).join('');
    return box(x, y, w, h, '#fff') + (title ? tx(x + 8, y + 14, title, '#86909c', 8, 500) : '') + paths;
  }
  function hbarChart(x, y, w, h, vals, color, title) {
    const max = Math.max.apply(null, vals.concat(1));
    const gap = 6;
    const bh = (h - 24 - gap * (vals.length - 1)) / vals.length;
    const bars = vals.map((v, i) => {
      const bw = Math.max(8, (v / max) * (w - 20));
      return `<rect x="${x + 8}" y="${y + 20 + i * (bh + gap)}" width="${bw}" height="${Math.max(4, bh - 1)}" rx="2" fill="${color}" opacity="${0.45 + (v / max) * 0.55}"/>`;
    }).join('');
    return box(x, y, w, h, '#fff') + (title ? tx(x + 8, y + 14, title, '#86909c', 8, 500) : '') + bars;
  }
  function heatChart(x, y, w, h, title, color) {
    const op = [0.2, 0.35, 0.6, 0.85, 0.4, 0.25, 0.7, 0.95, 0.3, 0.5, 0.22, 0.75, 0.45, 0.18, 0.62, 0.88, 0.33, 0.52, 0.78, 0.28, 0.58, 0.4, 0.82, 0.48];
    const cols = 6;
    const cw = (w - 16 - 5) / cols;
    const rh = (h - 28 - 5) / 4;
    const cells = op.map((o, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return `<rect x="${x + 8 + c * (cw + 1)}" y="${y + 20 + r * (rh + 1)}" width="${cw - 1}" height="${rh - 1}" rx="1" fill="${color}" opacity="${o}"/>`;
    }).join('');
    return box(x, y, w, h, '#fff') + tx(x + 8, y + 14, title, '#86909c', 8, 500) + cells;
  }
  function funnelChart(x, y, w, h, color, title) {
    const widths = [1, 0.76, 0.5, 0.28];
    const bh = (h - 28) / 4 - 3;
    const bars = widths.map((p, i) => {
      const bw = (w - 16) * p;
      return `<rect x="${x + 8 + (w - 16 - bw) / 2}" y="${y + 20 + i * (bh + 4)}" width="${bw}" height="${bh}" rx="2" fill="${color}" opacity="${1 - i * 0.18}"/>`;
    }).join('');
    return box(x, y, w, h, '#fff') + tx(x + 8, y + 14, title, '#86909c', 8, 500) + bars;
  }
  function gaugeChart(x, y, w, h, n, color, title) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 8;
    const R = Math.min(32, w / 3);
    return box(x, y, w, h, '#fff')
      + tx(x + 8, y + 14, title, '#86909c', 8, 500)
      + `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#e5e6eb" stroke-width="8"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(n / 100) * 150} 200" transform="rotate(-90 ${cx} ${cy})"/>`
      + tx(cx, cy + 5, String(n), color, 16, 700).replace(`x="${cx}"`, `x="${cx}" text-anchor="middle"`);
  }
  function mapChart(x, y, w, h, color, title) {
    const cx = x + w / 2;
    const cy = y + h / 2 + 8;
    return box(x, y, w, h, '#fff')
      + tx(x + 8, y + 14, title, '#86909c', 8, 500)
      + `<ellipse cx="${cx - 18}" cy="${cy - 8}" rx="28" ry="22" fill="${color}" opacity=".28"/>`
      + `<ellipse cx="${cx + 22}" cy="${cy + 4}" rx="34" ry="20" fill="${color}" opacity=".4"/>`
      + `<ellipse cx="${cx - 4}" cy="${cy + 10}" rx="20" ry="16" fill="${color}" opacity=".78"/>`
      + `<circle cx="${cx + 8}" cy="${cy - 12}" r="5" fill="${color}"/>`
      + `<circle cx="${cx - 26}" cy="${cy + 6}" r="4" fill="${color}" opacity=".7"/>`
      + `<circle cx="${cx + 30}" cy="${cy + 14}" r="4" fill="${color}" opacity=".55"/>`;
  }

  const MINIS = {
    blank: () => '<div class="tpl-shot tpl-shot-blank">从空白开始</div>',
    exec: () => shot(
      kpi(8, 4, 74, '收入', '3,286万', '+8.2%', '#fff', 'url(#gCool)', 40)
      + kpi(86, 4, 74, '利润', '612万', '+3.1%', '', '', 40)
      + kpi(164, 4, 74, '订单', '18.4万', '+5.0%', '', '', 40)
      + kpi(242, 4, 70, '履约', '97.2%', '+0.4pp', '', '', 40)
      + lineChart(8, 48, 196, 66, [22, 28, 24, 36, 32, 44, 48], '#818cf8', '收入趋势')
      + barChart(212, 48, 100, 66, [40, 72, 55, 88, 48], '#a5b4fc', '区域')
      + trio(118, '#818cf8'),
      { bg: '#0b1220', dark: true, title: '经营驾驶舱' }
    ),
    'kpi-wall': () => shot(
      kpi(8, 4, 74, 'GMV', '1,286万', '+12%', '#fff', 'url(#gCool)', 32)
      + kpi(86, 4, 74, '销量', '8.6万', '+4.8%', '#4f46e5', '#eef2ff', 32)
      + kpi(164, 4, 74, '利润', '186万', '+2.1%', '#059669', '#ecfdf5', 32)
      + kpi(242, 4, 70, '客单', '¥148', '-1.2%', '#b45309', '#fff7ed', 32)
      + kpi(8, 40, 74, 'UV', '42.1万', '+6%', '#7c3aed', '#f5f3ff', 32)
      + kpi(86, 40, 74, '转化', '3.8%', '+0.3pp', '', '', 32)
      + kpi(164, 40, 74, '复购', '28%', '+1.1pp', '', '', 32)
      + kpi(242, 40, 70, 'NPS', '62', '+4', '', '', 32)
      + barChart(8, 76, 304, 38, [30, 55, 40, 80, 62, 90, 48, 70], '#4f46e5', '')
      + trio(118, '#4f46e5'),
      { bg: '#e8edf4', title: 'KPI 墙' }
    ),
    hr: () => shot(
      kpi(8, 4, 98, '编制', '1,286', '', '#7c3aed', '', 40)
      + kpi(112, 4, 98, '在岗', '1,142', '-2.1%', '', '', 40)
      + kpi(216, 4, 96, '流失', '3.4%', '+0.4pp', '', '', 40)
      + barChart(8, 48, 196, 66, [70, 88, 54, 92, 40, 63], '#7c3aed', '部门编制')
      + pieChart(212, 48, 100, 66, [48, 28, 16, 8], ['#7c3aed', '#a78bfa', '#ddd6fe', '#e5e6eb'], '流失')
      + trio(118, '#7c3aed'),
      { bg: '#e8edf4', title: '人力编制' }
    ),
    sales: () => shot(
      kpi(8, 4, 74, '本月 GMV', '1,286万', '+12.6%', '#fff', 'url(#gCool)', 40)
      + kpi(86, 4, 74, '销量', '8.62万', '+4.8%', '', '', 40)
      + kpi(164, 4, 74, '利润', '186万', '+2.1%', '', '', 40)
      + kpi(242, 4, 70, '订单', '3.1万', '+6.4%', '', '', 40)
      + barChart(8, 48, 150, 66, [55, 82, 48, 90, 36, 70], '#3370ff', '区域销售额')
      + pieChart(166, 48, 70, 66, [40, 28, 20, 12], ['#3370ff', '#69b1ff', '#adc6ff', '#e5e6eb'], '渠道')
      + hbarChart(244, 48, 68, 66, [86, 72, 61], '#69b1ff', '销售员')
      + trio(118, '#3370ff'),
      { bg: '#e8edf4', title: '销售分析' }
    ),
    region: () => shot(
      kpi(8, 4, 74, '华东', '428万', '+18%', '#0d7a4f', '', 40)
      + kpi(86, 4, 74, '华北', '312万', '+6%', '', '', 40)
      + kpi(164, 4, 74, '华南', '276万', '-2%', '', '', 40)
      + kpi(242, 4, 70, '西南', '188万', '+4%', '', '', 40)
      + barChart(8, 48, 196, 66, [70, 88, 54, 92, 40], '#0d7a4f', '城市销售')
      + pieChart(212, 48, 100, 66, [40, 28, 20, 12], ['#0d7a4f', '#34c77b', '#86efac', '#e5e6eb'], '客户等级')
      + trio(118, '#0d7a4f'),
      { bg: '#e8edf4', title: '区域作战' }
    ),
    channel: () => shot(
      kpi(8, 4, 74, '线上', '786万', '+15%', '#3370ff', '', 40)
      + kpi(86, 4, 74, '线下', '500万', '+4%', '', '', 40)
      + kpi(164, 4, 74, '经销', '186万', '-3%', '', '', 40)
      + kpi(242, 4, 70, '其他', '42万', '+1%', '', '', 40)
      + barChart(8, 48, 196, 66, [90, 62, 40, 28, 18, 12], '#3370ff', '渠道成交')
      + pieChart(212, 48, 100, 66, [52, 30, 12, 6], ['#3370ff', '#69b1ff', '#adc6ff', '#e5e6eb'], '结构')
      + trio(118, '#3370ff'),
      { bg: '#e8edf4', title: '渠道对比' }
    ),
    product: () => shot(
      kpi(8, 4, 98, 'SKU 贡献', '1,020万', '+7%', '#0891b2', '', 40)
      + kpi(112, 4, 98, '爆款', '38 个', '+4', '', '', 40)
      + kpi(216, 4, 96, '滞销', '12 个', '-3', '', '', 40)
      + hbarChart(8, 48, 196, 66, [92, 76, 58, 44, 28], '#0891b2', '品类贡献')
      + lineChart(212, 48, 100, 66, [22, 18, 26, 12, 20, 8], '#22d3ee', '趋势')
      + trio(118, '#0891b2'),
      { bg: '#e8edf4', title: '产品贡献' }
    ),
    ops: () => shot(
      kpi(8, 4, 74, '周 UV', '42.1万', '+6.2%', '#0d9488', '', 40)
      + kpi(86, 4, 74, '周 PV', '186万', '+3.1%', '', '', 40)
      + kpi(164, 4, 74, '停留', '186s', '-4s', '', '', 40)
      + kpi(242, 4, 70, '跳出', '38%', '-1.2pp', '', '', 40)
      + lineChart(8, 48, 196, 66, [28, 22, 18, 24, 12, 16, 10], '#0d9488', '每日 UV')
      + pieChart(212, 48, 100, 66, [36, 28, 22, 14], ['#0d9488', '#2dd4bf', '#99f6e4', '#e5e6eb'], '来源')
      + trio(118, '#0d9488'),
      { bg: '#e8edf4', title: '运营看板' }
    ),
    promo: () => shot(
      kpi(8, 4, 74, '活动 GMV', '860万', '+22%', '#ea580c', '', 40)
      + kpi(86, 4, 74, '折扣额', '96万', '', '', '', 40)
      + kpi(164, 4, 74, 'ROI', '4.2', '+0.3', '', '', 40)
      + kpi(242, 4, 70, '转化', '5.1%', '+0.8pp', '', '', 40)
      + hbarChart(8, 48, 150, 66, [95, 78, 64, 50, 36], '#ea580c', '冲刺榜')
      + barChart(166, 48, 146, 66, [30, 44, 70, 92, 80, 58, 40], '#fb923c', '分时')
      + trio(118, '#ea580c'),
      { bg: '#e8edf4', title: '促销监控' }
    ),
    funnel: () => shot(
      kpi(8, 4, 74, '曝光', '128万', '', '#0d9488', '', 40)
      + kpi(86, 4, 74, '点击', '42万', '32.8%', '', '', 40)
      + kpi(164, 4, 74, '加购', '9.6万', '22.9%', '', '', 40)
      + kpi(242, 4, 70, '下单', '3.1万', '32.3%', '', '', 40)
      + barChart(8, 48, 196, 66, [96, 72, 48, 28], '#0d9488', '转化漏斗')
      + barChart(212, 48, 100, 66, [88, 62, 40, 28], '#2dd4bf', '转化率')
      + trio(118, '#0d9488'),
      { bg: '#e8edf4', title: '转化漏斗' }
    ),
    traffic: () => shot(
      kpi(8, 4, 74, '自然', '18.6万', '+4%', '#0284c7', '', 40)
      + kpi(86, 4, 74, '付费', '12.4万', '+11%', '', '', 40)
      + kpi(164, 4, 74, '社交', '6.2万', '-2%', '', '', 40)
      + kpi(242, 4, 70, '其他', '4.9万', '+1%', '', '', 40)
      + pieChart(8, 48, 120, 66, [40, 28, 18, 14], ['#0284c7', '#38bdf8', '#bae6fd', '#e5e6eb'], '来源结构')
      + barChart(136, 48, 176, 66, [88, 62, 40, 28, 18], '#38bdf8', '端 UV')
      + trio(118, '#0284c7'),
      { bg: '#e8edf4', title: '流量获客' }
    ),
    sla: () => shot(
      kpi(8, 4, 98, '按时率', '96.4%', '+0.8pp', '#475569', '', 40)
      + kpi(112, 4, 98, '均响应', '8.6min', '-1.2', '', '', 40)
      + kpi(216, 4, 96, '满意', '4.7', '+0.1', '', '', 40)
      + lineChart(8, 48, 196, 66, [30, 26, 28, 18, 22, 14, 16], '#475569', '时效走势')
      + barChart(212, 48, 100, 66, [70, 50, 88, 36, 60], '#94a3b8', '工单类型')
      + trio(118, '#475569'),
      { bg: '#f1f5f9', title: '服务时效' }
    ),
    finance: () => shot(
      kpi(8, 4, 98, '收入', '2,860万', '+6.4%', '#fff', 'url(#gWarm)', 40)
      + kpi(112, 4, 98, '支出', '1,940万', '+2.1%', '', '', 40)
      + kpi(216, 4, 96, '利润', '920万', '+11%', '', '', 40)
      + lineChart(8, 48, 196, 66, [26, 22, 28, 16, 20, 12], '#b45309', '月度收支')
      + pieChart(212, 48, 100, 66, [42, 33, 25], ['#b45309', '#f59e0b', '#fde68a'], '科目')
      + trio(118, '#b45309'),
      { bg: '#e8edf4', title: '财务概览' }
    ),
    cash: () => shot(
      kpi(8, 4, 98, '回款', '1,120万', '+9%', '#b45309', '', 40)
      + kpi(112, 4, 98, '支出', '860万', '+3%', '', '', 40)
      + kpi(216, 4, 96, '净现金', '260万', '+18%', '', '', 40)
      + barChart(8, 48, 196, 66, [40, 55, 38, 72, 48, 80, 62], '#f59e0b', '现金流')
      + hbarChart(212, 48, 100, 66, [86, 64, 50, 32], '#b45309', '科目')
      + trio(118, '#f59e0b'),
      { bg: '#e8edf4', title: '现金流' }
    ),
    cost: () => shot(
      kpi(8, 4, 98, '费用', '486万', '-4%', '#d97706', '', 40)
      + kpi(112, 4, 98, '预算执行', '78%', '', '', '', 40)
      + kpi(216, 4, 96, '超支部门', '2', '', '', '', 40)
      + hbarChart(8, 48, 196, 66, [90, 72, 58, 40, 28], '#d97706', '部门费用')
      + pieChart(212, 48, 100, 66, [38, 30, 20, 12], ['#d97706', '#fbbf24', '#fde68a', '#e5e6eb'], '结构')
      + trio(118, '#d97706'),
      { bg: '#e8edf4', title: '费用管控' }
    ),
    gmv: () => shot(
      kpi(8, 4, 74, '入账', '1,640万', '+8%', '#3370ff', '', 40)
      + kpi(86, 4, 74, '待结算', '216万', '', '', '', 40)
      + kpi(164, 4, 74, '失败', '1.2%', '-0.3pp', '', '', 40)
      + kpi(242, 4, 70, '商户', '428', '+12', '', '', 40)
      + pieChart(8, 48, 120, 66, [70, 22, 8], ['#3370ff', '#fbbf24', '#f53f3f'], '支付状态')
      + barChart(136, 48, 176, 66, [75, 60, 88, 42, 55, 30], '#69b1ff', '商户类型')
      + trio(118, '#3370ff'),
      { bg: '#e8edf4', title: '商户入账' }
    ),
    store: () => shot(
      kpi(8, 4, 74, '日销', '86.2万', '+5.4%', '#fff', 'url(#gWarm)', 40)
      + kpi(86, 4, 74, '客单', '¥68', '+¥2', '', '', 40)
      + kpi(164, 4, 74, '连带', '2.4', '+0.1', '', '', 40)
      + kpi(242, 4, 70, '进店', '1.8万', '+3%', '', '', 40)
      + hbarChart(8, 48, 150, 66, [92, 80, 68, 52, 40], '#e11d48', '门店排行')
      + barChart(166, 48, 146, 66, [28, 36, 70, 90, 84, 50, 32], '#fb7185', '时段')
      + trio(118, '#e11d48'),
      { bg: '#e8edf4', title: '门店零售' }
    ),
    crm: () => shot(
      kpi(8, 4, 98, '客户', '18,640', '+3%', '#e11d48', '', 40)
      + kpi(112, 4, 98, '贡献 GMV', '2,186万', '+7%', '', '', 40)
      + kpi(216, 4, 96, '复购', '28.4%', '+1.1pp', '', '', 40)
      + barChart(8, 48, 196, 66, [90, 62, 38], '#e11d48', '等级贡献')
      + pieChart(212, 48, 100, 66, [34, 28, 22, 16], ['#e11d48', '#fb7185', '#fecdd3', '#e5e6eb'], '行业')
      + trio(118, '#e11d48'),
      { bg: '#e8edf4', title: '客户分层' }
    ),
    cohort: () => shot(
      kpi(8, 4, 98, 'M1 留存', '42%', '-2pp', '#7c3aed', '', 40)
      + kpi(112, 4, 98, 'M3 留存', '21%', '+1pp', '', '', 40)
      + kpi(216, 4, 96, '复购周期', '46天', '-3天', '', '', 40)
      + barChart(8, 48, 196, 66, [90, 62, 38, 24], '#7c3aed', '来源留存')
      + lineChart(212, 48, 100, 66, [42, 34, 28, 24, 21, 18], '#a78bfa', '留存曲线')
      + trio(118, '#7c3aed'),
      { bg: '#e8edf4', title: '留存分析' }
    ),
    nps: () => shot(
      kpi(8, 4, 98, 'NPS', '62', '+4', '#16a34a', '', 40)
      + kpi(112, 4, 98, '好评', '71%', '+2pp', '', '', 40)
      + kpi(216, 4, 96, '差评', '8%', '-1pp', '', '', 40)
      + pieChart(8, 48, 150, 66, [62, 24, 14], ['#16a34a', '#86efac', '#e5e6eb'], '评价结构')
      + barChart(166, 48, 146, 66, [20, 28, 40, 70, 90], '#4ade80', '差评分布')
      + trio(118, '#16a34a'),
      { bg: '#e8edf4', title: '满意度' }
    ),
    inventory: () => shot(
      kpi(8, 4, 98, '库存金额', '3,420万', '-2%', '#475569', '', 40)
      + kpi(112, 4, 98, '周转天', '28.6', '-1.4', '', '', 40)
      + kpi(216, 4, 96, '缺货 SKU', '46', '+8', '', '', 40)
      + hbarChart(8, 48, 196, 66, [88, 70, 54, 40], '#475569', '仓周转')
      + pieChart(212, 48, 100, 66, [50, 28, 14, 8], ['#475569', '#94a3b8', '#f59e0b', '#f53f3f'], '状态')
      + trio(118, '#475569'),
      { bg: '#f1f5f9', title: '库存周转' }
    ),
    supply: () => shot(
      kpi(8, 4, 98, '履约率', '97.1%', '+0.6pp', '#4d7c0f', '', 40)
      + kpi(112, 4, 98, '缺货', '1.8%', '-0.3pp', '', '', 40)
      + kpi(216, 4, 96, '在途', '186万', '', '', '', 40)
      + lineChart(8, 48, 196, 66, [18, 22, 16, 20, 14, 12], '#4d7c0f', '履约走势')
      + barChart(212, 48, 100, 66, [80, 64, 50, 36, 22], '#84cc16', '供应商')
      + trio(118, '#4d7c0f'),
      { bg: '#e8edf4', title: '供应履约' }
    ),
    quality: () => shot(
      kpi(8, 4, 98, '来料不良', '0.62%', '-0.08pp', '#dc2626', '', 40)
      + kpi(112, 4, 98, '退货', '1.4%', '+0.1pp', '', '', 40)
      + kpi(216, 4, 96, '客诉', '28', '-6', '', '', 40)
      + barChart(8, 48, 196, 66, [88, 60, 42, 28, 18], '#dc2626', '缺陷类型')
      + lineChart(212, 48, 100, 66, [12, 18, 14, 22, 16, 10], '#f87171', '趋势')
      + trio(118, '#dc2626'),
      { bg: '#e8edf4', title: '质量缺陷' }
    )
  };

export function templateSketchHtml(id) {
  const key = String(id || '')
  const fn = MINIS[key] || MINIS[FAMILY_BY_ID[key]] || MINIS.sales
  return fn()
}

export function templateHeat(id) {
  let n = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) * (i + 2)
  return { views: ((8 + (n % 90)) / 10).toFixed(1) + '万', uses: 36 + (n % 420) }
}
