// 谷谷商城 · C 端购物演示（F12 demo）——纯前端 mock，无真实后端/支付。
// 数据全部为演示合成值；购物车/订单/资料存 localStorage（键前缀 sd_）。
// 对应计划：docs/PLAN-F12-CEND-SHOP.md（本 demo 仅表达交互形态，不代表最终实现）。
(function () {
'use strict';

/* ================= mock 数据（演示合成值） ================= */

var DB = {
  activities: [
    {
      id: 'act-halloween', name: '宝可梦 · 万圣节 2026', ip: '宝可梦', emoji: '🎃',
      g: ['#5b2a86', '#ff7a45'], deadline: '2026-10-08', status: 'on',
      shipEst: '截团后日本采购，预计 12 月中旬到货分批发货',
      intlNote: '国际运费按到货批次实重分摊（下单时按 ¥5/件 预估，多退少补）',
      postFee: 12, freeOver: 299,
      rule: '1. 本团期为官方预售商品，截团后统一向日本渠道下单；\n2. 谷子为预售定制，截团后不支持取消/退换（缺货除外）；\n3. 到货后按批次分摊国际运费，发货前结清；\n4. 国内快递默认中通/韵达，满 ¥299 包邮。'
    },
    {
      id: 'act-ta', name: '宝可梦 · Timeless Adventure', ip: '宝可梦', emoji: '⚡',
      g: ['#1f3c88', '#00b4d8'], deadline: '2026-10-15', status: 'on',
      shipEst: '截团后日本采购，预计 1 月到货分批发货',
      intlNote: '国际运费按到货批次实重分摊（下单时按 ¥5/件 预估，多退少补）',
      postFee: 12, freeOver: 299,
      rule: '1. TM 系列官方周边，截团后统一向日本渠道下单；\n2. 预售定制，截团后不支持取消/退换（缺货除外）；\n3. 卡套/收藏类限购严格，超量订单将被截单退款。'
    },
    {
      id: 'act-miku', name: '术力口 · 初音未来 17周年', ip: '术力口', emoji: '🎵',
      g: ['#0aa5a5', '#39c5bb'], deadline: '2026-08-30', status: 'closed',
      shipEst: '已于 9 月到货，国内段已发货',
      intlNote: '国际运费已按批次结清',
      postFee: 12, freeOver: 199,
      rule: '1. 本团期已截团；\n2. 到货批次已于 9 月 26 日发出。'
    }
  ],
  products: [
    { id: 'p1', actId: 'act-halloween', type: '亚克力立牌', model: '皮卡丘 万圣节 夜灯款', jp: 'ピカチュウ ハロウィン アクリルスタンド', price: 39, orig: 748, cur: 'JPY', limit: 4, sold: 23, total: 60, emoji: '🎃', g: ['#ffb03a', '#ff6b6b'] },
    { id: 'p2', actId: 'act-halloween', type: '吧唧', model: '耿鬼 万圣节 缶バッジ', jp: 'ゲンガー ハロウィン 缶バッジ', price: 22, orig: 440, cur: 'JPY', limit: 6, sold: 41, total: 80, emoji: '👻', g: ['#7b4bc8', '#4a2c82'] },
    { id: 'p3', actId: 'act-halloween', type: '色纸', model: '喷火龙 万圣节 色纸', jp: 'リザードン ハロウィン 色紙', price: 55, orig: 1100, cur: 'JPY', limit: 2, sold: 9, total: 30, emoji: '🐉', g: ['#ff6034', '#c0392b'] },
    { id: 'p4', actId: 'act-ta', type: '亚克力块', model: '皮卡丘 TM 亚克力块', jp: 'ピカチュウ Timeless アクリルブロック', price: 68, orig: 1320, cur: 'JPY', limit: 3, sold: 15, total: 50, emoji: '🟨', g: ['#f6b93b', '#e58e26'] },
    { id: 'p5', actId: 'act-ta', type: '吧唧', model: '莉可&罗伊 吧唧套装', jp: 'リコ＆ロイ 缶バッジセット', price: 45, orig: 880, cur: 'JPY', limit: 4, sold: 28, total: 60, emoji: '🧢', g: ['#0abde3', '#1f3c88'] },
    { id: 'p6', actId: 'act-ta', type: '卡套', model: '古代球 收藏卡套', jp: 'Ancient カードスリーブ', price: 18, orig: 330, cur: 'JPY', limit: 10, sold: 66, total: 100, emoji: '🃏', g: ['#10ac84', '#1dd1a1'] },
    { id: 'p7', actId: 'act-ta', type: '拍立得', model: '拍立得 随机 6 张', jp: 'チェキランダム 6枚', price: 88, orig: 1760, cur: 'JPY', limit: 2, sold: 7, total: 25, emoji: '📸', g: ['#ee5253', '#ff9f43'] },
    { id: 'p8', actId: 'act-miku', type: '吧唧', model: '初音 17周年 缶バッジ', jp: '初音ミク 17th 缶バッジ', price: 26, orig: 495, cur: 'JPY', limit: 5, sold: 60, total: 60, emoji: '🎵', g: ['#39c5bb', '#0aa5a5'] }
  ]
};

var actById = function (id) { for (var i = 0; i < DB.activities.length; i++) if (DB.activities[i].id === id) return DB.activities[i]; return null; };
var prodById = function (id) { for (var i = 0; i < DB.products.length; i++) if (DB.products[i].id === id) return DB.products[i]; return null; };

/* ================= 本地状态（localStorage mock） ================= */

function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

var state = {
  user: load('sd_user', null),           // { key, cn }
  profile: load('sd_profile', {
    cn: '糯米团子', qq: '1234567890', phone: '13800001234',
    addresses: [
      { id: 'a1', name: '小鹿', phone: '13800001234', text: '浙江省杭州市西湖区文三路 138 号某某小区 3 栋 2 单元 401（演示地址）', isDefault: true },
      { id: 'a2', name: '学校代收', phone: '13900005678', text: '江苏省南京市栖霞区文苑路 1 号某某大学菜鸟驿站（演示地址）', isDefault: false }
    ]
  }),
  cart: load('sd_cart', []),             // [{ pid, qty, checked }]
  orders: null,                          // load below (with seed)
  orderTab: 'all',
  currentAct: null, currentProd: null, currentOrder: null,
  stack: []                              // 返回栈
};

// 预置订单（演示合成数据：让订单/物流页一进来就有内容）
if (!localStorage.getItem('sd_orders')) {
  state.orders = [
    {
      id: 'o-seed-1', no: 'GD20260926-58231', status: 'shipped', channel: 'alipay', remark: '',
      createdAt: '2026-09-14 20:31', addr: state.profile.addresses[0],
      items: [{ pid: 'p8', qty: 3 }],
      goods: 78, intl: 15, post: 0, total: 93, paidTotal: 93.47,
      tracking: 'SF145 8866 3312', carrier: '顺丰速运',
      logistics: [
        { t: '09-28 14:32', x: '【杭州市】快件已签收，感谢使用顺丰速运（演示数据）' },
        { t: '09-28 08:10', x: '【杭州市】快件交付配送，快递员小哥正在派送途中' },
        { t: '09-27 21:45', x: '【杭州转运中心】快件已到达杭州转运中心' },
        { t: '09-26 18:02', x: '【义乌市】团长已打包发出，内含合照与防撞气泡袋' }
      ]
    },
    {
      id: 'o-seed-2', no: 'GD20260818-11027', status: 'done', channel: 'alipay', remark: '',
      createdAt: '2026-08-12 12:03', addr: state.profile.addresses[0],
      items: [{ pid: 'p8', qty: 1 }],
      goods: 26, intl: 5, post: 12, total: 43, paidTotal: 43.83,
      tracking: 'YT7388 2210 5566', carrier: '圆通速递',
      logistics: [{ t: '08-22 11:20', x: '【南京市】快件已签收（演示数据）' }]
    }
  ];
  save('sd_orders', state.orders);
} else {
  state.orders = load('sd_orders', []);
}

/* ================= 工具 ================= */

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(n) { return n.toFixed(2); }
function money(n) { return '<span class="price"><span class="rmb">¥</span><span class="num">' + fmt(n) + '</span></span>'; }
function maskPhone(p) { p = String(p || ''); return p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : p; }

var toastTimer = null;
function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
}

var STATUS = {
  unpaid: { text: '待付款', cls: 'amber' },
  paid: { text: '已付款', cls: 'blue' },
  shipped: { text: '已发货', cls: 'green' },
  done: { text: '已完成', cls: 'gray' },
  closed: { text: '已关闭', cls: 'gray' }
};
function statusBadge(s) { var m = STATUS[s] || STATUS.closed; return '<span class="tag ' + m.cls + '">' + m.text + '</span>'; }

// 状态时间线（正式版口径对齐团员端 Aoi.member.progressChain）
function timeline(status) {
  var steps = [
    { t: '已下单', d: '订单已提交，等待付款' },
    { t: '已付款', d: '收款已确认，进入排单' },
    { t: '采购中', d: '截团后日本渠道统一采购' },
    { t: '国际到货', d: '到达囤货地，待分摊国际运费' },
    { t: '国内发货', d: '打包发出，可查看物流' },
    { t: '已完成', d: '买家确认收货' }
  ];
  var cur = { unpaid: 0, paid: 1, shipped: 4, done: 5, closed: -1 }[status];
  if (status === 'closed') return '<p style="font-size:12.5px;color:var(--sub)">订单已关闭（超时未付款或手动取消）</p>';
  return '<div class="timeline">' + steps.map(function (s, i) {
    return '<div class="tl-node' + (i <= cur ? ' done' : '') + '">'
      + '<span class="tl-dot"></span>'
      + '<div class="tl-body"><div class="t1">' + s.t + '</div>'
      + '<div class="t2">' + (i <= cur ? s.d : '待进行') + '</div></div></div>';
  }).join('') + '</div>';
}

// 假二维码（演示占位，非真实收款码）
function fakeQr(seedStr) {
  var seed = 0;
  for (var i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  function rnd() { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  var N = 21, cells = '';
  function finder(cx, cy) {
    for (var y = 0; y < 7; y++) for (var x = 0; x < 7; x++) {
      var edge = x === 0 || y === 0 || x === 6 || y === 6;
      var core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (edge || core) cells += '<rect x="' + (cx + x) + '" y="' + (cy + y) + '" width="1" height="1"/>';
    }
  }
  finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
  for (var y2 = 0; y2 < N; y2++) for (var x2 = 0; x2 < N; x2++) {
    var inFinder = (x2 < 8 && y2 < 8) || (x2 >= N - 8 && y2 < 8) || (x2 < 8 && y2 >= N - 8);
    if (!inFinder && rnd() > 0.52) cells += '<rect x="' + x2 + '" y="' + y2 + '" width="1" height="1"/>';
  }
  return '<svg viewBox="0 0 ' + N + ' ' + N + '" fill="#1f2329" shape-rendering="crispEdges">' + cells + '</svg>';
}

/* ================= 路由 ================= */

var TAB_VIEWS = { home: 1, cart: 1, orders: 1, profile: 1 };
var TITLES = { activity: '团期详情', product: '商品详情', checkout: '确认订单', order: '订单详情' };

function show(view, push) {
  var views = ['login', 'home', 'activity', 'product', 'cart', 'checkout', 'orders', 'order', 'profile'];
  if (push !== false && state.current && state.current !== view) state.stack.push(state.current);
  state.current = view;
  views.forEach(function (v) { $('view-' + v).classList.toggle('hidden', v !== view); });
  var isTab = !!TAB_VIEWS[view];
  $('tabbar').classList.toggle('hidden', !isTab && view !== 'login');
  document.querySelectorAll('#tabbar .tab').forEach(function (t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === view);
  });
  var needTop = !isTab && view !== 'login';
  $('topbar').classList.toggle('hidden', !needTop);
  if (needTop) {
    var title = TITLES[view] || '';
    if (view === 'activity' && state.currentAct) title = state.currentAct.name;
    if (view === 'order' && state.currentOrder) title = '订单 ' + state.currentOrder.no;
    $('topbarTitle').textContent = title;
  }
  var el = $('view-' + view);
  if (el) el.scrollTop = 0;
  updateCartBubble();
}
function back() {
  var prev = state.stack.pop() || 'home';
  if (prev === 'cart') renderCart();
  if (prev === 'orders') renderOrders();
  if (prev === 'home') renderHome();
  show(prev, false);
}
function goTab(tab) {
  state.stack = [];
  if (tab === 'home') renderHome();
  if (tab === 'cart') renderCart();
  if (tab === 'orders') renderOrders();
  if (tab === 'profile') renderProfile();
  show(tab, false);
}

/* ================= 渲染：首页 ================= */

function actCard(a) {
  var prods = DB.products.filter(function (p) { return p.actId === a.id; });
  var on = a.status === 'on';
  var left = Math.max(0, Math.ceil((new Date(a.deadline + ' 23:59:59') - new Date('2026-09-30')) / 86400000));
  return '<div class="act-card" data-act="' + a.id + '">'
    + '<div class="act-cover" style="background:linear-gradient(120deg,' + a.g[0] + ',' + a.g[1] + ')">'
    + '<span class="ip-tag">' + esc(a.ip) + '</span><span class="emoji">' + a.emoji + '</span>'
    + '<h4>' + esc(a.name) + '</h4></div>'
    + '<div class="act-body">'
    + '<div class="act-meta"><span class="tag ' + (on ? '' : 'gray') + '">' + (on ? '进行中' : '已截团') + '</span>'
    + (on ? '<span>⏳ 截团还剩 <b style="color:var(--brand)">' + left + '</b> 天（' + esc(a.deadline) + '）</span>' : '<span>已于 ' + esc(a.deadline) + ' 截团</span>')
    + '</div>'
    + '<div class="act-foot"><span class="act-count">在售 <b>' + (on ? prods.length : 0) + '</b> 件商品</span>'
    + '<button class="btn-main" style="height:32px;padding:0 16px;font-size:12.5px">' + (on ? '去选购' : '看看物流') + '</button></div>'
    + '</div></div>';
}

function renderHome(kw) {
  kw = (kw || '').trim();
  var html = '';
  if (!kw) {
    html += '<div class="banner"><h2>万圣节团期热团中 🎃</h2><p>满 ¥299 包邮 · 截团后统一日本采购 · 到货自动分摊国际费</p></div>';
    var types = ['吧唧', '亚克力', '色纸', '卡套', '拍立得', '立牌'];
    var icons = { '吧唧': '🎗️', '亚克力': '🔷', '色纸': '🎨', '卡套': '🃏', '拍立得': '📸', '立牌': '🧍' };
    html += '<div class="quick-types">' + types.map(function (t) {
      return '<button class="qtype" data-qtype="' + t + '"><div class="qi">' + icons[t] + '</div><div class="qt">' + t + '</div></button>';
    }).join('') + '</div>';
    html += '<div class="sec-head"><h3>进行中团期</h3><span>按团期选购</span></div>';
    html += DB.activities.map(actCard).join('');
  } else {
    var k = kw.toLowerCase();
    var acts = DB.activities.filter(function (a) {
      return (a.name + a.ip).toLowerCase().indexOf(k) >= 0;
    });
    var prods = DB.products.filter(function (p) {
      return (p.model + p.jp + p.type).toLowerCase().indexOf(k) >= 0;
    });
    html += '<div class="sec-head"><h3>搜索「' + esc(kw) + '」</h3><span>' + (acts.length + prods.length) + ' 个结果</span></div>';
    html += acts.map(actCard).join('');
    if (prods.length) html += '<div class="sec-head"><h3>相关商品</h3></div><div class="grid">' + prods.map(prodCard).join('') + '</div>';
    if (!acts.length && !prods.length) html += '<div class="empty"><div class="e">🔍</div><p>没有找到相关团期或商品<br>换个关键词试试，比如「万圣节」「吧唧」「ピカチュウ」</p></div>';
  }
  $('homeBody').innerHTML = html;
}

/* ================= 渲染：团期详情 ================= */

function prodCard(p) {
  var a = actById(p.actId);
  var on = a && a.status === 'on';
  var pct = Math.min(100, Math.round(p.sold / p.total * 100));
  return '<div class="p-card" data-prod="' + p.id + '">'
    + '<div class="p-img" style="background:linear-gradient(135deg,' + p.g[0] + '22,' + p.g[1] + '44)">'
    + (p.limit ? '<span class="limit-badge">限购 ' + p.limit + ' 件</span>' : '')
    + '<span>' + p.emoji + '</span></div>'
    + '<div class="p-info">'
    + '<div class="p-name">' + esc(p.model) + '</div>'
    + '<div class="p-jp">' + esc(p.jp) + '</div>'
    + '<div class="p-row">' + money(p.price) + '<span class="p-sold">已订 ' + p.sold + '/' + p.total + '</span></div>'
    + '<div class="bar"><i style="width:' + pct + '%"></i></div>'
    + (on ? '' : '<div class="p-jp" style="color:#ff2e63;margin-top:4px">该团期已截团</div>')
    + '</div></div>';
}

function renderActivity() {
  var a = state.currentAct;
  if (!a) return;
  var prods = DB.products.filter(function (p) { return p.actId === a.id; });
  var on = a.status === 'on';
  var left = Math.max(0, Math.ceil((new Date(a.deadline + ' 23:59:59') - new Date('2026-09-30')) / 86400000));
  var html = '<div class="act-hero" style="background:linear-gradient(140deg,' + a.g[0] + ',' + a.g[1] + ')">'
    + '<h2>' + esc(a.name) + '</h2>'
    + '<div class="sub">' + esc(a.shipEst) + '</div>'
    + '<div class="countdown"><span>' + (on ? '⏳ 距截团（' + esc(a.deadline) + '）' : '🔒 已于 ' + esc(a.deadline) + ' 截团') + '</span>'
    + (on ? '<b>' + left + ' 天</b>' : '<span class="tag gray">已截团</span>') + '</div></div>';
  html += '<div class="card rule-card"><h5>📋 团购规则</h5><p style="white-space:pre-wrap">' + esc(a.rule) + '</p>'
    + '<p style="margin-top:8px">✈️ ' + esc(a.intlNote) + '</p>'
    + '<p>📦 国内邮费 ¥' + a.postFee + '，满 ¥' + a.freeOver + ' 包邮</p></div>';
  html += '<div class="sec-head"><h3>商品清单</h3><span>' + (on ? prods.length : 0) + ' 件在售</span></div>';
  html += '<div class="grid">' + (on ? prods.map(prodCard).join('') : '') + '</div>';
  if (!on) html += '<div class="empty"><div class="e">🔒</div><p>该团期已截团<br>可在「订单」查看本团期历史订单与物流</p></div>';
  $('activityBody').innerHTML = html;
}

/* ================= 渲染：商品详情 ================= */

function renderProduct() {
  var p = state.currentProd;
  if (!p) return;
  var a = actById(p.actId);
  var on = a && a.status === 'on';
  var pct = Math.min(100, Math.round(p.sold / p.total * 100));
  var inCart = cartQty(p.id);
  $('productBody').innerHTML =
    '<div class="pd-img" style="background:linear-gradient(135deg,' + p.g[0] + '33,' + p.g[1] + '55)">'
    + p.emoji + '<div class="dots"><i class="on"></i><i></i><i></i><i></i><i></i></div></div>'
    + '<div class="pd-head">'
    + '<div class="pd-price-row">' + money(p.price)
    + '<span class="orig">' + (p.cur === 'JPY' ? '¥' : '$') + p.orig + ' ' + p.cur.toUpperCase() + ' 原价</span>'
    + (p.limit ? '<span class="tag" style="margin-left:auto">限购 ' + p.limit + ' 件/人</span>' : '') + '</div>'
    + '<div class="pd-name">' + esc(p.model) + '</div>'
    + '<div class="pd-jp">' + esc(p.jp) + '</div>'
    + '<div class="pd-sell"><span>已订 ' + p.sold + ' / ' + p.total + ' 件</span><span>' + esc(a.ip) + ' · ' + esc(p.type) + '</span></div>'
    + '<div class="bar" style="margin-top:8px"><i style="width:' + pct + '%"></i></div>'
    + '</div>'
    + '<div class="pd-block">'
    + '<div class="spec-row"><span class="k">所属团期</span><span style="color:var(--blue)">' + esc(a.name) + '</span></div>'
    + '<div class="spec-row"><span class="k">制品类型</span><span>' + esc(p.type) + '</span></div>'
    + '<div class="spec-row"><span class="k">发货预估</span><span>' + esc(a.shipEst) + '</span></div>'
    + '</div>'
    + '<div class="pd-block"><div class="sec-title">🛒 购买须知</div>'
    + '<p class="notice"><b>预售说明：</b>' + esc(a.rule) + '<br><b>国际运费：</b>' + esc(a.intlNote) + '<br>'
    + '<b>支付方式：</b>下单后生成唯一尾数金额，转账后自动核销（无需上传付款截图）</p></div>';
  $('pdBar').innerHTML =
    '<button class="mini" data-pd="home"><i>🏠</i>首页</button>'
    + '<button class="mini" data-pd="cart"><i>🛒</i>购物车' + (inCart ? '<b style="color:var(--brand)">' + inCart + '</b>' : '') + '</button>'
    + '<span class="spacer"></span>'
    + (on
      ? '<button class="btn-ghost" data-pd="addCart">加入购物车</button>'
      : '<button class="btn-ghost" disabled style="opacity:.5">已截团</button>')
    + (on ? '<button class="btn-buy" data-pd="buyNow">立即购买</button>' : '');
}

/* ================= 购物车 ================= */

function cartQty(pid) {
  var it = state.cart.filter(function (c) { return c.pid === pid; })[0];
  return it ? it.qty : 0;
}
function addToCart(pid, qty) {
  var it = state.cart.filter(function (c) { return c.pid === pid; })[0];
  var p = prodById(pid);
  var limit = p.limit || 99;
  if (it) it.qty = Math.min(limit, it.qty + qty);
  else state.cart.push({ pid: pid, qty: Math.min(limit, qty), checked: true });
  save('sd_cart', state.cart);
  updateCartBubble();
}
function updateCartBubble() {
  var n = state.cart.reduce(function (s, c) { return s + c.qty; }, 0);
  $('cartBubble').textContent = n;
  $('cartBubble').classList.toggle('hidden', !n);
}
function cartItemDead(c) {
  var p = prodById(c.pid);
  var a = p && actById(p.actId);
  return !p || !a || a.status !== 'on';
}
function cartSelected() {
  return state.cart.filter(function (c) { return c.checked && !cartItemDead(c); });
}

function renderCart() {
  var body = $('cartBody');
  if (!state.cart.length) {
    body.innerHTML = '<div class="empty"><div class="e">🛒</div><p>购物车还是空的<br>去团期页逛逛吧</p>'
      + '<button class="btn-main" style="margin-top:14px" data-go-home>去逛团期</button></div>';
    $('cartBar').innerHTML = '';
    return;
  }
  // 按团期分组
  var groups = {};
  state.cart.forEach(function (c) {
    var p = prodById(c.pid);
    var a = p ? actById(p.actId) : null;
    var key = a ? a.id : 'unknown';
    (groups[key] = groups[key] || { act: a, items: [] }).items.push(c);
  });
  var html = Object.keys(groups).map(function (k) {
    var g = groups[k];
    return '<div class="cart-group">'
      + '<div class="cart-group-head">🛍️ ' + esc(g.act ? g.act.name : '失效商品') + '</div>'
      + g.items.map(function (c) {
        var p = prodById(c.pid);
        var dead = cartItemDead(c);
        if (dead) {
          return '<div class="cart-item dead"><div class="check on">✓</div>'
            + '<div class="ci-img" style="background:#f2f3f5">❌</div>'
            + '<div class="ci-info"><div class="ci-name">' + esc(p ? p.model : '商品已失效') + '</div>'
            + '<div class="ci-dead">该团期已截团或商品已下架，不可结算</div></div>'
            + '<button class="btn-ghost" style="height:26px;font-size:11px" data-cart-del="' + c.pid + '">删除</button></div>';
        }
        return '<div class="cart-item">'
          + '<div class="check' + (c.checked ? ' on' : '') + '" data-cart-check="' + c.pid + '">✓</div>'
          + '<div class="ci-img" style="background:linear-gradient(135deg,' + p.g[0] + '22,' + p.g[1] + '44)">' + p.emoji + '</div>'
          + '<div class="ci-info"><div class="ci-name">' + esc(p.model) + '</div>'
          + '<div class="ci-price">' + money(p.price)
          + '<span class="stepper"><button data-cart-dec="' + c.pid + '">−</button><span>' + c.qty + '</span><button data-cart-inc="' + c.pid + '">+</button></span></div>'
          + (p.limit ? '<div class="ci-dead">限购 ' + p.limit + ' 件</div>' : '')
          + '</div></div>';
      }).join('') + '</div>';
  }).join('');
  body.innerHTML = html;
  // 结算条
  var sel = cartSelected();
  var sum = 0, cnt = 0;
  sel.forEach(function (c) { sum += prodById(c.pid).price * c.qty; cnt += c.qty; });
  $('cartBar').innerHTML = sel.length
    ? '<span class="total">共 ' + cnt + ' 件，合计 ' + money(sum) + '</span>'
    + '<button class="btn-main" id="btnCheckout">去结算（' + cnt + '）</button>'
    : '<span class="total" style="color:var(--sub)">勾选商品后结算</span>';
}

/* ================= 下单确认 ================= */

var checkoutCtx = null; // { items:[{pid,qty}], from, channel, _calc }

function calcFee(act, count, goods) {
  var intl = count * 5; // 演示：¥5/件 预估
  var post = goods >= act.freeOver ? 0 : act.postFee;
  return { intl: intl, post: post };
}

function renderCheckout() {
  if (!checkoutCtx || !checkoutCtx.items.length) { back(); return; }
  var first = prodById(checkoutCtx.items[0].pid);
  var act = actById(first.actId);
  var goods = 0, count = 0;
  checkoutCtx.items.forEach(function (it) { goods += prodById(it.pid).price * it.qty; count += it.qty; });
  var fee = calcFee(act, count, goods);
  var addr = state.profile.addresses.filter(function (x) { return x.isDefault; })[0] || state.profile.addresses[0];
  checkoutCtx._calc = { goods: goods, intl: fee.intl, post: fee.post, count: count, actId: act.id };
  if (checkoutCtx.channel == null) checkoutCtx.channel = 'alipay';

  var html = '<div style="height:10px"></div>'
    + '<div class="card addr-card" id="addrPick"><span class="ai">📍</span><span>'
    + (addr
      ? '<span class="a1">' + esc(addr.name) + ' ' + maskPhone(addr.phone) + '</span>'
      + '<span class="a2">' + esc(addr.text) + '</span>'
      : '<span class="a1">请添加收货地址</span>')
    + '</span><span class="arrow">›</span></div>';
  html += '<div class="card"><div class="sec-title" style="color:var(--sub);font-size:12px">' + esc(act.name) + '</div>'
    + checkoutCtx.items.map(function (it) {
      var p = prodById(it.pid);
      return '<div class="co-item"><div class="ci-img" style="width:56px;height:56px;flex:0 0 56px;font-size:24px;'
        + 'background:linear-gradient(135deg,' + p.g[0] + '22,' + p.g[1] + '44)">' + p.emoji + '</div>'
        + '<div class="ci-info"><div class="ci-name">' + esc(p.model) + '</div>'
        + '<div class="p-jp">' + esc(p.jp) + '</div></div>'
        + '<div style="text-align:right">' + money(p.price) + '<div style="font-size:11px;color:var(--sub)">×' + it.qty + '</div></div></div>';
    }).join('') + '</div>';
  html += '<div class="card"><div class="fee-row"><span>商品总额</span><span class="v">' + money(goods) + '</span></div>'
    + '<div class="fee-row"><span>预估国际运费（¥5/件 × ' + count + '）</span><span class="v">' + money(fee.intl) + '</span></div>'
    + '<div class="fee-row"><span>国内邮费' + (fee.post === 0 ? '（已满 ¥' + act.freeOver + ' 包邮）' : '') + '</span><span class="v">' + (fee.post === 0 ? '<span class="tag green">包邮</span>' : money(fee.post)) + '</span></div>'
    + '<div class="fee-row total"><span>合计</span><span>' + money(goods + fee.intl + fee.post) + '</span></div>'
    + '<p style="font-size:11px;color:var(--sub);margin-top:8px">* 国际运费为预估，到货后按批次实重分摊，多退少补（与现有「我的国际费」口径一致）</p></div>';
  html += '<div class="card"><div class="sec-title">支付方式</div>'
    + '<div class="pay-channel"><span class="pi" style="background:#1677ff">支</span>'
    + '<span class="pn">支付宝<small>推荐：唯一尾数金额 · 到账自动核销</small></span>'
    + '<div class="check' + (checkoutCtx.channel === 'alipay' ? ' on' : '') + '" data-channel="alipay">✓</div></div>'
    + '<div class="pay-channel"><span class="pi" style="background:#07c160">微</span>'
    + '<span class="pn">微信支付<small>需个体户+备案后可跳转（V3），当前走转账核销</small></span>'
    + '<div class="check' + (checkoutCtx.channel === 'wechat' ? ' on' : '') + '" data-channel="wechat">✓</div></div></div>';
  html += '<div class="card"><div class="sec-title">订单备注</div>'
    + '<textarea class="remark-input" id="coRemark" rows="2" placeholder="选填：拼盒要求、代写贺卡等"></textarea></div>';
  html += '<div style="margin:4px 12px 20px"><button class="btn-main" style="width:100%;height:46px;border-radius:23px;font-size:16px" id="btnSubmitOrder">提交订单</button></div>';
  $('checkoutBody').innerHTML = html;
}

function submitOrder() {
  var calc = checkoutCtx._calc;
  var addr = state.profile.addresses.filter(function (x) { return x.isDefault; })[0] || state.profile.addresses[0];
  if (!addr) { toast('请先添加收货地址'); return; }
  var tail = 1 + Math.floor(Math.random() * 98); // 0.01–0.99 唯一尾数（订单指纹）
  var base = calc.goods + calc.intl + calc.post;
  var no = 'GD20260930-' + String(10000 + Math.floor(Math.random() * 89999));
  var order = {
    id: 'o' + Date.now(), no: no, status: 'unpaid', channel: checkoutCtx.channel,
    remark: ($('coRemark') && $('coRemark').value.trim()) || '',
    createdAt: '2026-09-30 ' + new Date().toTimeString().slice(0, 5),
    addr: addr, items: checkoutCtx.items.map(function (it) { return { pid: it.pid, qty: it.qty }; }),
    goods: calc.goods, intl: calc.intl, post: calc.post, total: base, paidTotal: base + tail / 100
  };
  state.orders.unshift(order);
  save('sd_orders', state.orders);
  // 从购物车移除已下单项
  if (checkoutCtx.from === 'cart') {
    state.cart = state.cart.filter(function (c) { return !c.checked || cartItemDead(c); });
    save('sd_cart', state.cart);
  }
  checkoutCtx = null;
  toast('订单已提交（演示）');
  state.currentOrder = order;
  renderOrders();
  renderOrder();
  show('order');
  openPayModal(order);
}

/* ================= 支付弹层（V1/V2/V3 三形态示意） ================= */

function openPayModal(order) {
  var chanName = order.channel === 'alipay' ? '支付宝' : '微信';
  var tailCents = Math.round((order.paidTotal - order.total) * 100);
  $('modalSheet').innerHTML =
    '<div class="sheet-head"><h4>收银台（演示）</h4><button class="close" data-modal-close>×</button></div>'
    + '<div class="pay-amount">' + money(order.paidTotal)
    + '<div class="tail">应付款 <b>¥' + fmt(order.paidTotal) + '</b>（商品 ' + fmt(order.total) + ' + 识别尾数 <b>.' + tailCents + '</b>）<br>'
    + '尾数是这笔订单的唯一指纹——按此金额转账，到账即<b>自动核销</b>，无需上传付款截图</div></div>'
    + '<div class="qr-box">' + fakeQr(order.no + order.channel) + '</div>'
    + '<div class="pay-tip">📲 长按识别 / 扫一扫 向「' + chanName + '」转账<br>'
    + '<b style="color:var(--text)">V1 现实方案：</b>固定收款码 + 唯一尾数，管理端上传账单 CSV 自动匹配核销<br>'
    + '<b style="color:var(--text)">V2 升级：</b>支付宝当面付动态码，支付回调自动核销（个人可申请）<br>'
    + '<b style="color:var(--text)">V3 升级：</b>微信/支付宝收银台直接跳起（需个体户 + 备案域名）</div>'
    + '<button class="btn-main" id="btnPaid">我已付款（模拟支付成功）</button>';
  $('modalRoot').classList.add('open');
  $('btnPaid').onclick = function () {
    order.status = 'paid';
    save('sd_orders', state.orders);
    closeModal();
    toast('支付成功（演示）：订单已自动核销');
    state.currentOrder = order;
    renderOrder();
    state.stack = ['orders']; // 支付完成后返回应回订单列表，而非过期的下单确认页
    show('order');
  };
}
function closeModal() { $('modalRoot').classList.remove('open'); }

/* ================= 订单列表 / 详情 ================= */

var ORDER_TABS = [['all', '全部'], ['unpaid', '待付款'], ['paid', '已付款'], ['shipped', '已发货'], ['done', '已完成']];
function renderOrders() {
  $('orderTabs').innerHTML = ORDER_TABS.map(function (t) {
    return '<div class="o-tab' + (state.orderTab === t[0] ? ' active' : '') + '" data-otab="' + t[0] + '">' + t[1] + '</div>';
  }).join('');
  var list = state.orders.filter(function (o) {
    return state.orderTab === 'all' ? o.status !== 'closed' : o.status === state.orderTab;
  });
  $('ordersBody').innerHTML = list.length ? list.map(function (o) {
    var thumbs = o.items.slice(0, 3).map(function (it) {
      var p = prodById(it.pid);
      return '<div class="o-thumb" style="background:linear-gradient(135deg,' + (p ? p.g[0] : '#eee') + '22,' + (p ? p.g[1] : '#ddd') + '44)">' + (p ? p.emoji : '❓') + '</div>';
    }).join('');
    if (o.items.length > 3) thumbs += '<div class="o-more">+' + (o.items.length - 3) + '</div>';
    var cnt = o.items.reduce(function (s, i) { return s + i.qty; }, 0);
    var foot = '';
    if (o.status === 'unpaid') foot = '<button class="btn-ghost" data-order-cancel="' + o.id + '">取消订单</button>'
      + '<button class="btn-main" data-order-pay="' + o.id + '">去支付</button>';
    if (o.status === 'shipped') foot = '<button class="btn-ghost" data-order-detail="' + o.id + '">查看物流</button>'
      + '<button class="btn-main" data-order-receive="' + o.id + '">确认收货</button>';
    if (o.status === 'paid') foot = '<button class="btn-ghost" data-order-detail="' + o.id + '">详情</button>';
    if (o.status === 'done') foot = '<button class="btn-ghost" data-order-detail="' + o.id + '">再次查看</button>';
    return '<div class="o-card">'
      + '<div class="o-head"><span>' + esc(o.no) + ' · ' + esc(o.createdAt) + '</span>' + statusBadge(o.status) + '</div>'
      + '<div class="o-items" data-order-detail="' + o.id + '">' + thumbs + '</div>'
      + '<div class="o-sum"><span>共 ' + cnt + ' 件</span><span>实付 ' + money(o.paidTotal) + '</span></div>'
      + '<div class="o-foot">' + foot + '</div></div>';
  }).join('') : '<div class="empty"><div class="e">📭</div><p>这里还没有订单</p></div>';
}

function renderOrder() {
  var o = state.currentOrder;
  if (!o) return;
  var feeRows = '<div class="fee-row"><span>商品总额</span><span class="v">' + money(o.goods) + '</span></div>'
    + '<div class="fee-row"><span>预估国际运费</span><span class="v">' + money(o.intl) + '</span></div>'
    + '<div class="fee-row"><span>国内邮费</span><span class="v">' + (o.post === 0 ? '包邮' : money(o.post)) + '</span></div>'
    + '<div class="fee-row"><span>识别尾数</span><span class="v">+' + fmt(o.paidTotal - o.total) + '</span></div>'
    + '<div class="fee-row total"><span>实付</span><span>' + money(o.paidTotal) + '</span></div>';
  var logi = o.logistics && o.logistics.length
    ? '<div class="card"><div class="sec-title">🚚 物流跟踪 <span class="copy-track" style="font-weight:400">' + esc(o.carrier) + ' ' + esc(o.tracking) + '</span></div>'
      + o.logistics.map(function (l, i) {
        return '<div class="logi-node' + (i === 0 ? ' latest' : '') + '"><span class="dot"></span>'
          + '<div><div>' + esc(l.x) + '</div><div class="lt">' + esc(l.t) + '</div></div></div>';
      }).join('') + '</div>'
    : '';
  var actions = '';
  if (o.status === 'unpaid') actions = '<div style="display:flex;gap:10px;margin:0 12px 20px">'
    + '<button class="btn-ghost" style="flex:1" data-order-cancel="' + o.id + '">取消订单</button>'
    + '<button class="btn-main" style="flex:2" id="btnPayNow">去支付</button></div>';
  if (o.status === 'shipped') actions = '<div style="margin:0 12px 20px"><button class="btn-main" style="width:100%" data-order-receive="' + o.id + '">确认收货</button></div>';

  $('orderBody').innerHTML =
    '<div class="card">' + timeline(o.status) + '</div>'
    + '<div class="card"><div class="addr-card"><span class="ai">📍</span><span>'
    + '<span class="a1">' + esc(o.addr.name) + ' ' + maskPhone(o.addr.phone) + '</span>'
    + '<span class="a2">' + esc(o.addr.text) + '</span></span></div></div>'
    + '<div class="card">' + o.items.map(function (it) {
      var p = prodById(it.pid);
      return '<div class="co-item"><div class="ci-img" style="width:52px;height:52px;flex:0 0 52px;font-size:22px;'
        + 'background:linear-gradient(135deg,' + (p ? p.g[0] : '#eee') + '22,' + (p ? p.g[1] : '#ddd') + '44)">' + (p ? p.emoji : '❓') + '</div>'
        + '<div class="ci-info"><div class="ci-name">' + esc(p ? p.model : '') + '</div>'
        + '<div class="p-jp">' + esc(p ? p.jp : '') + '</div></div>'
        + '<div style="text-align:right;font-size:12px;color:var(--sub)">×' + it.qty + '</div></div>';
    }).join('') + '<div style="border-top:1px solid var(--line);margin-top:6px"></div>' + feeRows + '</div>'
    + logi
    + '<div class="card"><div class="sec-title">ℹ️ 订单信息</div>'
    + '<p class="notice">订单号：' + esc(o.no) + '<br>下单时间：' + esc(o.createdAt) + '（演示数据）<br>'
    + (o.remark ? '备注：' + esc(o.remark) + '<br>' : '')
    + '售后：如需换囤货地/售后，联系客服转人工（对接现有工单台）</p></div>'
    + actions;
}

/* ================= 我的 ================= */

function renderProfile() {
  var p = state.profile;
  var cnt = function (s) { return state.orders.filter(function (o) { return o.status === s; }).length; };
  $('profileBody').innerHTML =
    '<div class="me-head"><div class="avatar">🦊</div><div>'
    + '<div class="mn">' + esc(p.cn) + '</div>'
    + '<div class="ms">QQ ' + esc(p.qq || '未绑定') + ' · 手机 ' + (p.phone ? maskPhone(p.phone) : '未填写') + '</div></div></div>'
    + '<div class="me-stats">'
    + '<div class="me-stat" data-otab-go="unpaid"><div class="n">' + cnt('unpaid') + '</div><div class="l">待付款</div></div>'
    + '<div class="me-stat" data-otab-go="paid"><div class="n">' + cnt('paid') + '</div><div class="l">已付款</div></div>'
    + '<div class="me-stat" data-otab-go="shipped"><div class="n">' + cnt('shipped') + '</div><div class="l">已发货</div></div>'
    + '<div class="me-stat" data-otab-go="all"><div class="n">' + state.orders.filter(function (o) { return o.status !== 'closed'; }).length + '</div><div class="l">全部订单</div></div>'
    + '</div>'
    + '<div class="me-group">'
    + '<div class="me-row" data-me="editProfile"><span class="mi">👤</span>个人资料<small>CN / QQ / 手机号</small><span class="arrow">›</span></div>'
    + '<div class="me-row" data-me="addrBook"><span class="mi">📮</span>收货地址簿<small>' + p.addresses.length + ' 条</small><span class="arrow">›</span></div>'
    + '<div class="me-row" data-me="orders"><span class="mi">📋</span>全部订单<span class="arrow">›</span></div>'
    + '</div>'
    + '<div class="me-group">'
    + '<div class="me-row" data-me="service"><span class="mi">💬</span>联系客服<small>转人工 · 对接工单台</small><span class="arrow">›</span></div>'
    + '<div class="me-row" data-me="about"><span class="mi">🧩</span>关于演示<small>F12</small><span class="arrow">›</span></div>'
    + '<div class="me-row" data-me="logout"><span class="mi">🚪</span>退出登录</div>'
    + '</div>';
}

/* ================= 弹层：资料 / 地址簿 / 关于 ================= */

function openSheet(html) {
  $('modalSheet').innerHTML = '<div class="sheet-head"><h4></h4><button class="close" data-modal-close>×</button></div>' + html;
  $('modalRoot').classList.add('open');
}

function openProfileEdit() {
  var p = state.profile;
  openSheet(
    '<div class="form-item"><label>圈名 CN（如需修改请提交改圈名申请，走现有审核流）</label><input value="' + esc(p.cn) + '" disabled style="opacity:.6"></div>'
    + '<div class="form-item"><label>QQ 号（绑定后机器人可私聊推送）</label><input id="fQq" value="' + esc(p.qq) + '" placeholder="QQ 号"></div>'
    + '<div class="form-item"><label>手机号（选填，仅用于重要订单联系；展示一律脱敏）</label><input id="fPhone" value="' + esc(p.phone) + '" placeholder="手机号"></div>'
    + '<button class="btn-main" style="width:100%" id="btnSaveProfile">保存</button>');
  $('btnSaveProfile').onclick = function () {
    p.qq = $('fQq').value.trim();
    p.phone = $('fPhone').value.trim();
    save('sd_profile', p);
    closeModal();
    toast('资料已保存（演示）');
    renderProfile();
  };
}

function openAddrBook(pickMode) {
  var p = state.profile;
  var html = p.addresses.map(function (a) {
    return '<div class="addr-card-pick' + (a.isDefault ? ' on' : '') + '" data-addr="' + a.id + '">'
      + '<div class="ap1">' + esc(a.name) + ' ' + maskPhone(a.phone)
      + (a.isDefault ? '<span class="default-chip">默认</span>' : '') + '</div>'
      + '<div class="ap2">' + esc(a.text) + '</div>'
      + '<div style="margin-top:8px;display:flex;gap:14px;font-size:12px;color:var(--blue)">'
      + (!a.isDefault && !pickMode ? '<span data-addr-default="' + a.id + '">设为默认</span>' : '')
      + '<span data-addr-del="' + a.id + '" style="color:var(--sub)">删除</span></div></div>';
  }).join('');
  html += '<div class="form-item" style="margin-top:14px"><label>新增地址</label>'
    + '<input id="naName" placeholder="收件人" style="margin-bottom:8px">'
    + '<input id="naPhone" placeholder="手机号" style="margin-bottom:8px">'
    + '<input id="naText" placeholder="省市区 街道 门牌号"></div>'
    + '<button class="btn-main" style="width:100%" id="btnAddAddr">添加地址</button>';
  openSheet(html);

  $('btnAddAddr').onclick = function () {
    var name = $('naName').value.trim(), phone = $('naPhone').value.trim(), text = $('naText').value.trim();
    if (!name || !phone || !text) { toast('请填写完整'); return; }
    p.addresses.push({ id: 'a' + Date.now(), name: name, phone: phone, text: text, isDefault: p.addresses.length === 0 });
    save('sd_profile', p);
    openAddrBook(pickMode);
    toast('地址已添加（演示）');
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-addr-default]'), function (el) {
    el.onclick = function (e) {
      e.stopPropagation();
      p.addresses.forEach(function (a) { a.isDefault = a.id === el.getAttribute('data-addr-default'); });
      save('sd_profile', p);
      openAddrBook(pickMode);
      toast('已设为默认');
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-addr-del]'), function (el) {
    el.onclick = function (e) {
      e.stopPropagation();
      var id = el.getAttribute('data-addr-del');
      p.addresses = p.addresses.filter(function (a) { return a.id !== id; });
      if (!p.addresses.some(function (a) { return a.isDefault; }) && p.addresses[0]) p.addresses[0].isDefault = true;
      save('sd_profile', p);
      openAddrBook(pickMode);
      toast('已删除');
    };
  });
  if (pickMode) {
    Array.prototype.forEach.call(document.querySelectorAll('.addr-card-pick'), function (el) {
      el.onclick = function () {
        p.addresses.forEach(function (a) { a.isDefault = a.id === el.getAttribute('data-addr'); });
        save('sd_profile', p);
        closeModal();
        renderCheckout();
        toast('已选择地址');
      };
    });
  }
}

function openAbout() {
  openSheet('<p class="notice">谷谷商城 · F12 C 端购物演示（2026-09-30）<br><br>'
    + '本页为<b>纯前端交互演示</b>：数据是写死的 mock，支付/登录均不会真实发生。<br><br>'
    + '对应计划文档 <b>docs/PLAN-F12-CEND-SHOP.md</b>：<br>'
    + '· 商品橱窗复用管理端商品主档 activityMeta[].products<br>'
    + '· 下单直落现有 orders（到货分批/国际费/发货零改造）<br>'
    + '· 支付 V1 尾数+账单核销 → V2 当面付回调 → V3 微信跳转<br>'
    + '· 登录 V1 个人 token → V3 手机号/QQ 登录<br><br>'
    + '购物车与演示订单存在 localStorage，可随时清掉重来。</p>');
}

/* ================= 事件绑定 ================= */

$('btnLogin').onclick = function () {
  var key = $('loginKey').value.trim(), id = $('loginId').value.trim();
  if (!key || !id) { toast('演示：两项任意输入即可进入'); return; }
  state.user = { key: key, cn: id };
  state.profile.cn = id;
  save('sd_user', state.user);
  save('sd_profile', state.profile);
  toast('欢迎，' + id + '（演示登录）');
  goTab('home');
};

$('btnBack').onclick = back;
$('modalMask').onclick = closeModal;
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-modal-close]')) closeModal();
});

Array.prototype.forEach.call(document.querySelectorAll('#tabbar .tab'), function (t) {
  t.onclick = function () { goTab(t.getAttribute('data-tab')); };
});

$('btnSearch').onclick = function () { renderHome($('searchInput').value); };
$('searchInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') renderHome(this.value);
});

// 首页 / 团期 / 搜索结果：卡片点击
$('homeBody').addEventListener('click', function (e) {
  var q = e.target.closest('[data-qtype]');
  if (q) { $('searchInput').value = q.getAttribute('data-qtype'); renderHome(q.getAttribute('data-qtype')); return; }
  var a = e.target.closest('[data-act]');
  if (a) { state.currentAct = actById(a.getAttribute('data-act')); renderActivity(); show('activity'); return; }
  var p = e.target.closest('[data-prod]');
  if (p) { state.currentProd = prodById(p.getAttribute('data-prod')); renderProduct(); show('product'); }
});

$('activityBody').addEventListener('click', function (e) {
  var p = e.target.closest('[data-prod]');
  if (p) { state.currentProd = prodById(p.getAttribute('data-prod')); renderProduct(); show('product'); }
});

// 商品详情底栏
$('pdBar').addEventListener('click', function (e) {
  var b = e.target.closest('[data-pd]');
  if (!b) return;
  var act = b.getAttribute('data-pd');
  var p = state.currentProd;
  if (act === 'home') { goTab('home'); return; }
  if (act === 'cart') { goTab('cart'); return; }
  if (act === 'addCart') {
    addToCart(p.id, 1);
    toast('已加入购物车');
    renderProduct();
    return;
  }
  if (act === 'buyNow') {
    checkoutCtx = { items: [{ pid: p.id, qty: 1 }], from: 'buy' };
    renderCheckout();
    show('checkout');
  }
});

// 购物车
$('cartBody').addEventListener('click', function (e) {
  if (e.target.closest('[data-go-home]')) { goTab('home'); return; }
  var chk = e.target.closest('[data-cart-check]');
  if (chk) {
    var pid = chk.getAttribute('data-cart-check');
    state.cart.forEach(function (c) { if (c.pid === pid) c.checked = !c.checked; });
    save('sd_cart', state.cart);
    renderCart();
    return;
  }
  var del = e.target.closest('[data-cart-del]');
  if (del) {
    var dp = del.getAttribute('data-cart-del');
    state.cart = state.cart.filter(function (c) { return c.pid !== dp; });
    save('sd_cart', state.cart);
    renderCart();
    return;
  }
  var inc = e.target.closest('[data-cart-inc]');
  var dec = e.target.closest('[data-cart-dec]');
  if (inc || dec) {
    var cpid = (inc || dec).getAttribute(inc ? 'data-cart-inc' : 'data-cart-dec');
    var p = prodById(cpid);
    state.cart.forEach(function (c) {
      if (c.pid !== cpid) return;
      c.qty = inc ? Math.min(p.limit || 99, c.qty + 1) : Math.max(1, c.qty - 1);
    });
    var it = state.cart.filter(function (c) { return c.pid === cpid; })[0];
    if (inc && p.limit && it && it.qty >= p.limit) toast('已达限购上限 ' + p.limit + ' 件（下单时服务端还会复核）');
    save('sd_cart', state.cart);
    renderCart();
  }
});
$('cartBar').addEventListener('click', function (e) {
  if (!e.target.closest('#btnCheckout')) return;
  var sel = cartSelected();
  if (!sel.length) { toast('请先勾选商品'); return; }
  checkoutCtx = { items: sel.map(function (c) { return { pid: c.pid, qty: c.qty }; }), from: 'cart' };
  renderCheckout();
  show('checkout');
});

// 下单确认：地址 / 支付渠道 / 提交
$('checkoutBody').addEventListener('click', function (e) {
  if (e.target.closest('#addrPick')) { openAddrBook(true); return; }
  var ch = e.target.closest('[data-channel]');
  if (ch) {
    checkoutCtx.channel = ch.getAttribute('data-channel');
    Array.prototype.forEach.call(document.querySelectorAll('[data-channel]'), function (x) {
      x.classList.toggle('on', x === ch);
    });
    return;
  }
  if (e.target.closest('#btnSubmitOrder')) submitOrder();
});

// 订单列表 / 详情
function orderAction(root) {
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-otab]');
    if (t) { state.orderTab = t.getAttribute('data-otab'); renderOrders(); return; }
    var d = e.target.closest('[data-order-detail]');
    if (d) {
      var od = state.orders.filter(function (o) { return o.id === d.getAttribute('data-order-detail'); })[0];
      if (od) { state.currentOrder = od; renderOrder(); show('order'); }
      return;
    }
    var pay = e.target.closest('[data-order-pay]');
    if (pay) {
      var op = state.orders.filter(function (o) { return o.id === pay.getAttribute('data-order-pay'); })[0];
      if (op) openPayModal(op);
      return;
    }
    var cancel = e.target.closest('[data-order-cancel]');
    if (cancel) {
      var oc = state.orders.filter(function (o) { return o.id === cancel.getAttribute('data-order-cancel'); })[0];
      if (oc) { oc.status = 'closed'; save('sd_orders', state.orders); toast('订单已取消（演示）'); renderOrders(); }
      return;
    }
    var rcv = e.target.closest('[data-order-receive]');
    if (rcv) {
      var or = state.orders.filter(function (o) { return o.id === rcv.getAttribute('data-order-receive'); })[0];
      if (or) {
        or.status = 'done';
        save('sd_orders', state.orders);
        toast('已确认收货（演示）');
        renderOrders();
        if (state.current === 'order') { state.currentOrder = or; renderOrder(); }
      }
      return;
    }
  });
}
orderAction($('ordersBody'));
orderAction($('orderBody'));

// 订单详情底部的「去支付」（btnPayNow 无 data 属性，单独绑定入口）
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('#btnPayNow') && state.currentOrder) openPayModal(state.currentOrder);
});

$('profileBody').addEventListener('click', function (e) {
  var go = e.target.closest('[data-otab-go]');
  if (go) { state.orderTab = go.getAttribute('data-otab-go'); renderOrders(); show('orders'); return; }
  var m = e.target.closest('[data-me]');
  if (!m) return;
  var act = m.getAttribute('data-me');
  if (act === 'editProfile') openProfileEdit();
  if (act === 'addrBook') openAddrBook(false);
  if (act === 'orders') { state.orderTab = 'all'; renderOrders(); show('orders'); }
  if (act === 'service') toast('演示：转人工将对接现有 QQ 工单台（v3.21.0）');
  if (act === 'about') openAbout();
  if (act === 'logout') {
    localStorage.removeItem('sd_user');
    state.user = null;
    show('login');
  }
});

/* ================= 启动 ================= */

updateCartBubble();
if (state.user) { goTab('home'); } else { show('login'); }

})();
