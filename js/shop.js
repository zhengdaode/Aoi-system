// Aoi-system — C 端商城（F12，v3.22.0）：买家自助下单，独立入口 shop.html
// 登录 = Supabase Auth 邮箱验证码（取消密钥发放）；订单直接并入管理端同一份 blob
// （shopOrders 订单头 + 逐商品 orders 行，服务端 RPC：supabase-schema.sql F12 节）。
// 本模块同时在管理端 harness（index.html）中加载——全部 DOM 访问做了空值保护，
// 仅当页面存在 #shop-root（即 shop.html）时才启动 UI。
window.Aoi = window.Aoi || {};
Aoi.shop = {};

/* ================= 纯函数（vitest 直接覆盖） ================= */

// 金额尾数拆分：paidTotal - total 的分位整数（订单指纹展示用）
Aoi.shop.splitTail = function (total, paidTotal) {
  return Math.round((Number(paidTotal) - Number(total)) * 100);
};

// 订单展示状态：shopOrders.status（待付款/已付款）+ orders 行进度推导
Aoi.shop.statusMeta = function (o) {
  var p = o.progress || {};
  if (o.status === '待付款') return { key: 'unpaid', text: '待付款', cls: 'amber' };
  if ((p.lines || 0) > 0 && p.received === p.lines) return { key: 'done', text: '已完成', cls: 'gray' };
  if ((p.shipped || 0) >= (p.lines || 0) && p.lines > 0) return { key: 'shipped', text: '已发货', cls: 'green' };
  if ((p.shipped || 0) > 0) return { key: 'partial', text: '部分发货', cls: 'blue' };
  if ((p.arrived || 0) > 0) return { key: 'arrived', text: '已到货', cls: 'blue' };
  return { key: 'paid', text: '已付款', cls: 'blue' };
};

// 进度文案（订单详情用）
Aoi.shop.progressText = function (o) {
  var p = o.progress || {};
  if (!p.lines) return '';
  return '到货 ' + (p.arrived || 0) + '/' + p.lines + ' · 发货 ' + (p.shipped || 0) + '/' + p.lines
    + ' · 收货 ' + (p.received || 0) + '/' + p.lines;
};

// 购物车加项：同商品合并数量，超出限购夹紧；返回 {cart, clamped, item}
Aoi.shop.cartAdd = function (cart, p, qty) {
  qty = Math.max(1, parseInt(qty, 10) || 1);
  var limit = (p && p.limit != null) ? p.limit : 99;
  var found = null;
  cart.forEach(function (c) { if (c.pid === p.id) found = c; });
  if (found) {
    var sum = found.qty + qty;
    var next = Math.min(limit, sum);
    found.qty = next;
    return { cart: cart, clamped: next !== sum, item: found };
  }
  var add = Math.min(limit, qty);
  var item = { pid: p.id, qty: add, checked: true };
  cart.push(item);
  return { cart: cart, clamped: add < qty, item: item };
};

// 购物车合计（金额/件数），按 pid→商品表查价
Aoi.shop.cartTotal = function (cart, byId) {
  var total = 0, count = 0;
  cart.forEach(function (c) {
    if (!c.checked) return;
    var p = byId[c.pid];
    if (!p) return;
    total += (p.price || 0) * c.qty;
    count += c.qty;
  });
  return { total: Math.round(total * 100) / 100, count: count };
};

/* ================= 运行时状态 ================= */

Aoi.shop.state = {
  me: null,        // shop_me() 结果 {bound, cn, email, teamName, pay}
  catalog: null,   // shop_get_catalog() 结果 {teamName, activities, products, pay}
  byId: {},        // pid → product
  cart: [],        // [{pid, qty, checked}]
  orders: [],      // shop_get_my_orders().orders
  orderTab: 'all',
  currentAct: null, currentProd: null, currentOrder: null,
  lastAddr: '',
  view: 'auth', stack: []
};

(function () {
  var CART_KEY = 'aoi_shop_cart';
  Aoi.shop.loadCart = function () {
    try { Aoi.shop.state.cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch (e) { Aoi.shop.state.cart = []; }
  };
  Aoi.shop.saveCart = function () {
    localStorage.setItem(CART_KEY, JSON.stringify(Aoi.shop.state.cart));
  };
})();

/* ================= 工具 ================= */

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(n) { return Number(n || 0).toFixed(2); }
function money(n) { return '<span class="price"><span class="rmb">¥</span><span class="num">' + fmt(n) + '</span></span>'; }
function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }

var toastTimer = null;
Aoi.shop.toast = function (msg) {
  var t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
};

Aoi.shop.loading = function (show) {
  var el = $('loading');
  if (el) el.classList.toggle('hidden', !show);
};

// RPC 统一封装：错误 toast 并抛出（调用方决定是否吞掉）；会话过期回登录页
Aoi.shop.rpc = async function (name, params) {
  var r = await Aoi.db.rpc(name, params || {});
  if (r.error) {
    var msg = r.error.message || '请求失败';
    if (/JWT|expired|Invalid Refresh Token|session/i.test(msg)) {
      msg = '登录已过期，请重新登录';
      try { await Aoi.db.auth.signOut(); } catch (e) { /* 本地清理即可 */ }
      Aoi.shop.state.me = null;
      Aoi.shop.showAuth('email');
    }
    throw new Error(msg);
  }
  return r.data;
};

// 商品图：有参考图用图，否则按 id 哈希取渐变占位 + 制品 emoji
var TYPE_EMOJI = { '吧唧': '🎗️', '亚克力': '🔷', '亚克力立牌': '🧍', '亚克力块': '🔷', '色纸': '🎨', '卡套': '🃏', '拍立得': '📸', '立牌': '🧍' };
Aoi.shop.imgBg = function (p) {
  if (p && p.refImage) return 'background-image:url("' + esc(p.refImage).replace(/"/g, '%22') + '")';
  var g = ['#ffb03a,#ff6b6b', '#7b4bc8,#4a2c82', '#0abde3,#1f3c88', '#10ac84,#1dd1a1', '#ee5253,#ff9f43', '#f6b93b,#e58e26'];
  var h = 0, s = (p ? p.id : '') + '';
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'background:linear-gradient(135deg,' + g[h % g.length].split(',').join(' 22%,') + ' 44)';
};
Aoi.shop.prodEmoji = function (p) { return TYPE_EMOJI[p.type] || '🎁'; };

/* ================= 视图路由 ================= */

var TAB_VIEWS = { home: 1, cart: 1, orders: 1, profile: 1 };
var TITLES = { activity: '团期详情', product: '商品详情', checkout: '确认订单', order: '订单详情' };

Aoi.shop.show = function (view, push) {
  var views = ['auth', 'home', 'activity', 'product', 'cart', 'checkout', 'orders', 'order', 'profile'];
  if (push !== false && Aoi.shop.state.view && Aoi.shop.state.view !== view) Aoi.shop.state.stack.push(Aoi.shop.state.view);
  Aoi.shop.state.view = view;
  views.forEach(function (v) { var el = $('view-' + v); if (el) el.classList.toggle('hidden', v !== view); });
  var isTab = !!TAB_VIEWS[view];
  var tb = $('tabbar');
  if (tb) tb.classList.toggle('hidden', !isTab || view === 'auth');
  document.querySelectorAll('#tabbar .tab').forEach(function (t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === view);
  });
  var needTop = !isTab && view !== 'auth';
  var top = $('topbar');
  if (top) top.classList.toggle('hidden', !needTop);
  if (needTop) {
    var title = TITLES[view] || '';
    if (view === 'activity' && Aoi.shop.state.currentAct) title = Aoi.shop.state.currentAct.name;
    if (view === 'order' && Aoi.shop.state.currentOrder) title = '订单 ' + Aoi.shop.state.currentOrder.no;
    var tt = $('topbarTitle');
    if (tt) tt.textContent = title;
  }
  var el = $('view-' + view);
  if (el) el.scrollTop = 0;
  Aoi.shop.updateBubble();
};
Aoi.shop.back = function () {
  var prev = Aoi.shop.state.stack.pop() || 'home';
  if (prev === 'cart') Aoi.shop.renderCart();
  if (prev === 'orders') Aoi.shop.renderOrders();
  if (prev === 'home') Aoi.shop.renderHome();
  Aoi.shop.show(prev, false);
};
Aoi.shop.goTab = function (tab) {
  Aoi.shop.state.stack = [];
  if (tab === 'home') Aoi.shop.renderHome();
  if (tab === 'cart') Aoi.shop.renderCart();
  if (tab === 'orders') Aoi.shop.renderOrders();
  if (tab === 'profile') Aoi.shop.renderProfile();
  Aoi.shop.show(tab, false);
};
Aoi.shop.updateBubble = function () {
  var b = $('cartBubble');
  if (!b) return;
  var n = Aoi.shop.state.cart.reduce(function (s, c) { return s + c.qty; }, 0);
  b.textContent = n;
  b.classList.toggle('hidden', !n);
};

/* ================= 登录 / 绑定 ================= */

Aoi.shop.showAuth = function (step) {
  ['Email', 'Code', 'Bind'].forEach(function (s) {
    var el = $('authStep' + s);
    if (el) el.classList.toggle('hidden', s.toLowerCase() !== step);
  });
  Aoi.shop.show('auth', false);
};

Aoi.shop.sendCode = async function () {
  var email = ($('authEmail') && $('authEmail').value.trim()) || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { Aoi.shop.toast('请输入正确的邮箱地址'); return; }
  Aoi.shop.loading(true);
  try {
    var r = await Aoi.db.auth.signInWithOtp({
      email: email,
      options: { shouldCreateUser: true }
    });
    if (r.error) throw new Error(r.error.message);
    var echo = $('authEmailEcho'); if (echo) echo.textContent = email;
    Aoi.shop.showAuth('code');
    Aoi.shop.toast('验证码已发送，请查收邮箱（注意垃圾箱）');
  } catch (e) {
    Aoi.shop.toast('发送失败：' + (e.message || e));
  }
  Aoi.shop.loading(false);
};

Aoi.shop.verify = async function () {
  var email = ($('authEmail') && $('authEmail').value.trim()) || '';
  var token = ($('authCode') && $('authCode').value.trim()) || '';
  if (!token) { Aoi.shop.toast('请输入验证码'); return; }
  Aoi.shop.loading(true);
  try {
    var r = await Aoi.db.auth.verifyOtp({ email: email, token: token, type: 'email' });
    if (r.error) throw new Error(r.error.message);
    await Aoi.shop.afterAuth();
  } catch (e) {
    Aoi.shop.toast('登录失败：' + (e.message || e));
  }
  Aoi.shop.loading(false);
};

// 登录态就绪后：已绑定 → 进商城；未绑定 → 绑定步骤
Aoi.shop.afterAuth = async function () {
  Aoi.shop.state.me = await Aoi.shop.rpc('shop_me');
  if (Aoi.shop.state.me.bound) {
    await Aoi.shop.enter();
  } else {
    var sub = $('authSub');
    if (sub && Aoi.shop.state.me.teamName) sub.textContent = Aoi.shop.state.me.teamName + ' · 团购自助下单';
    var cn = $('bindCn');
    if (cn && !cn.value) cn.value = Aoi.shop.state.me.cn || '';
    Aoi.shop.showAuth('bind');
    Aoi.shop.loading(false);
  }
};

Aoi.shop.bind = async function () {
  var cn = ($('bindCn') && $('bindCn').value.trim()) || '';
  if (!cn) { Aoi.shop.toast('请输入圈名（CN）'); return; }
  Aoi.shop.loading(true);
  try {
    await Aoi.shop.rpc('shop_bind_cn', { p_cn: cn });
    Aoi.shop.state.me = await Aoi.shop.rpc('shop_me');
    Aoi.shop.toast('已绑定圈名：' + Aoi.shop.state.me.cn);
    await Aoi.shop.enter();
  } catch (e) {
    Aoi.shop.toast(e.message || e);
  }
  Aoi.shop.loading(false);
};

Aoi.shop.logout = async function () {
  try { await Aoi.db.auth.signOut(); } catch (e) { /* 本地清理即可 */ }
  Aoi.shop.state.me = null;
  Aoi.shop.state.catalog = null;
  Aoi.shop.state.orders = [];
  Aoi.shop.state.cart = [];
  Aoi.shop.saveCart();
  var em = $('authEmail'); if (em) em.value = '';
  var cd = $('authCode'); if (cd) cd.value = '';
  Aoi.shop.showAuth('email');
};

// 绑定完成后加载橱窗进入首页
Aoi.shop.enter = async function () {
  Aoi.shop.loading(true);
  try {
    var cat = await Aoi.shop.rpc('shop_get_catalog');
    Aoi.shop.state.catalog = cat;
    Aoi.shop.state.byId = {};
    cat.products.forEach(function (p) { Aoi.shop.state.byId[p.id] = p; });
    Aoi.shop.loadCart();
    // 预填上次下单地址（本人数据，服务端返回）
    var mine = await Aoi.shop.rpc('shop_get_my_orders');
    Aoi.shop.state.orders = mine.orders || [];
    if (mine.orders && mine.orders.length) Aoi.shop.state.lastAddr = mine.orders[0].addr || '';
    Aoi.shop.goTab('home');
  } catch (e) {
    Aoi.shop.toast(e.message || e);
    Aoi.shop.showAuth('bind');
  }
  Aoi.shop.loading(false);
};

/* ================= 渲染：首页（团期流 + 搜索） ================= */

Aoi.shop.actCard = function (a) {
  var prods = Aoi.shop.state.catalog.products.filter(function (p) { return p.act === a.name; });
  var ship = a.shipEst || (a.shipDate ? '预计 ' + a.shipDate + ' 发货' : (a.shipDateFuzzy ? '预计 ' + a.shipDateFuzzy + ' 发货' : '发货时间以团公告为准'));
  return '<div class="act-card" data-act="' + esc(a.name) + '">'
    + '<div class="act-cover" style="' + Aoi.shop.imgBg({ id: a.name }) + '">'
    + (a.ip ? '<span class="ip-tag">' + esc(a.ip) + '</span>' : '')
    + '<h4>' + esc(a.name) + '</h4></div>'
    + '<div class="act-body">'
    + '<div class="act-meta"><span class="tag">' + esc(a.status || '进行中') + '</span>'
    + '<span>🚚 ' + esc(ship.slice(0, 18)) + (ship.length > 18 ? '…' : '') + '</span></div>'
    + '<div class="act-foot"><span class="act-count">在售 <b>' + prods.length + '</b> 件商品</span>'
    + '<button class="btn-main" style="height:32px;padding:0 16px;font-size:12.5px">去选购</button></div>'
    + '</div></div>';
};

Aoi.shop.prodCard = function (p) {
  var pct = Math.min(100, Math.round((p.sold || 0) / Math.max(1, (p.sold || 0) + 20) * 100));
  return '<div class="p-card" data-prod="' + esc(p.id) + '">'
    + '<div class="p-img prod-thumb" style="' + Aoi.shop.imgBg(p) + '">'
    + (p.limit ? '<span class="limit-badge">限购 ' + p.limit + ' 件</span>' : '')
    + '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:46px;opacity:.92">' + Aoi.shop.prodEmoji(p) + '</span></div>'
    + '<div class="p-info">'
    + '<div class="p-name">' + esc(p.model) + '</div>'
    + (p.nameOrig ? '<div class="p-jp">' + esc(p.nameOrig) + '</div>' : '')
    + '<div class="p-row">' + money(p.price) + '<span class="p-sold">已订 ' + (p.sold || 0) + '</span></div>'
    + '<div class="bar"><i style="width:' + pct + '%"></i></div>'
    + '</div></div>';
};

Aoi.shop.renderHome = function (kw) {
  var cat = Aoi.shop.state.catalog;
  if (!cat) return;
  var body = $('homeBody');
  if (!body) return;
  kw = (kw == null ? ($('searchInput') ? $('searchInput').value : '') : kw).trim();
  var html = '<div class="banner"><h2>' + esc(cat.teamName || '谷谷商城') + '</h2>'
    + '<p>截团后统一采购 · 到货自动分摊国际费 · 支付到账自动核销</p></div>';
  if (!kw) {
    html += '<div class="sec-head"><h3>进行中团期</h3><span>按团期选购</span></div>';
    html += cat.activities.length ? cat.activities.map(Aoi.shop.actCard).join('')
      : '<div class="empty"><div class="e">🗓️</div><p>暂无开放选购的团期<br>等团长上架后再来逛吧</p></div>';
    if (cat.products.length) {
      html += '<div class="sec-head"><h3>全部商品</h3><span>' + cat.products.length + ' 件</span></div>';
      html += '<div class="grid">' + cat.products.map(Aoi.shop.prodCard).join('') + '</div>';
    }
  } else {
    var k = kw.toLowerCase();
    var acts = cat.activities.filter(function (a) { return (a.name + a.ip).toLowerCase().indexOf(k) >= 0; });
    var prods = cat.products.filter(function (p) {
      return ((p.model || '') + (p.nameOrig || '') + (p.type || '') + (p.act || '') + (p.ip || '')).toLowerCase().indexOf(k) >= 0;
    });
    html += '<div class="sec-head"><h3>搜索「' + esc(kw) + '」</h3><span>' + (acts.length + prods.length) + ' 个结果</span></div>';
    html += acts.map(Aoi.shop.actCard).join('');
    if (prods.length) html += '<div class="sec-head"><h3>相关商品</h3></div><div class="grid">' + prods.map(Aoi.shop.prodCard).join('') + '</div>';
    if (!acts.length && !prods.length) html += '<div class="empty"><div class="e">🔍</div><p>没有找到相关团期或商品</p></div>';
  }
  body.innerHTML = html;
};

/* ================= 渲染：团期详情 / 商品详情 ================= */

Aoi.shop.renderActivity = function () {
  var a = Aoi.shop.state.currentAct;
  var body = $('activityBody');
  if (!a || !body) return;
  var prods = Aoi.shop.state.catalog.products.filter(function (p) { return p.act === a.name; });
  var ship = a.shipEst || (a.shipDate ? '预计 ' + a.shipDate + ' 发货' : (a.shipDateFuzzy ? '预计 ' + a.shipDateFuzzy + ' 发货' : ''));
  var html = '<div class="act-hero" style="' + Aoi.shop.imgBg({ id: a.name }) + '">'
    + '<h2>' + esc(a.name) + '</h2>'
    + (ship ? '<div class="sub">' + esc(ship) + '</div>' : '')
    + '<div class="countdown"><span>' + esc(a.status || '进行中') + (a.ip ? ' · ' + esc(a.ip) : '') + '</span>'
    + '<b>' + prods.length + ' 件在售</b></div></div>'
    + (a.blurb ? '<div class="card rule-card"><h5>📋 团购说明</h5><p style="white-space:pre-wrap">' + esc(a.blurb) + '</p></div>' : '')
    + '<div class="sec-head"><h3>商品清单</h3><span>' + prods.length + ' 件</span></div>'
    + '<div class="grid">' + (prods.length ? prods.map(Aoi.shop.prodCard).join('') : '') + '</div>'
    + (prods.length ? '' : '<div class="empty"><div class="e">🛒</div><p>该团期暂无上架商品</p></div>');
  body.innerHTML = html;
};

Aoi.shop.renderProduct = function () {
  var p = Aoi.shop.state.currentProd;
  if (!p) return;
  var bar = $('pdBar'), body = $('productBody');
  if (!body) return;
  var orig = (p.priceOrig != null && p.currency && p.currency !== 'cny')
    ? '<span class="orig">' + esc(p.currency.toUpperCase()) + ' ' + esc(p.priceOrig) + ' 原价</span>' : '';
  body.innerHTML =
    '<div class="pd-img prod-thumb" style="' + Aoi.shop.imgBg(p) + '">'
    + '<span style="opacity:.92">' + Aoi.shop.prodEmoji(p) + '</span></div>'
    + '<div class="pd-head">'
    + '<div class="pd-price-row">' + money(p.price) + orig
    + (p.limit ? '<span class="tag" style="margin-left:auto">限购 ' + p.limit + ' 件/人</span>' : '') + '</div>'
    + '<div class="pd-name">' + esc(p.model) + '</div>'
    + (p.nameOrig ? '<div class="pd-jp">' + esc(p.nameOrig) + '</div>' : '')
    + '<div class="pd-sell"><span>已订 ' + (p.sold || 0) + '</span><span>' + esc(p.act) + ' · ' + esc(p.type) + '</span></div>'
    + '</div>'
    + '<div class="pd-block">'
    + '<div class="spec-row"><span class="k">所属团期</span><span style="color:var(--blue)">' + esc(p.act) + '</span></div>'
    + '<div class="spec-row"><span class="k">制品类型</span><span>' + esc(p.type) + '</span></div>'
    + '<div class="spec-row"><span class="k">发货说明</span><span>截团后统一采购，到货按批次分摊国际运费</span></div>'
    + '</div>'
    + '<div class="pd-block"><div class="sec-title">🛒 购买须知</div>'
    + '<p class="notice"><b>支付方式：</b>下单后生成带唯一尾数的应付款金额，按金额转账即完成支付（无需上传截图），团长对账核销后订单生效；<br>'
    + '<b>预售说明：</b>谷子为预售定制，截团后不可取消/退换（缺货除外）；<br>'
    + (p.refUrl ? '<b>商品参考：</b><a href="' + esc(p.refUrl) + '" target="_blank" style="color:var(--blue)">查看商品链接</a>' : '') + '</p></div>';
  if (bar) {
    bar.innerHTML =
      '<button class="mini" data-pd="home"><i>🏠</i>首页</button>'
      + '<button class="mini" data-pd="cart"><i>🛒</i>购物车</button>'
      + '<span class="spacer"></span>'
      + '<button class="btn-ghost" data-pd="addCart">加入购物车</button>'
      + '<button class="btn-buy" data-pd="buyNow">立即购买</button>';
  }
};

/* ================= 购物车 ================= */

Aoi.shop.addToCart = function (p, qty) {
  var r = Aoi.shop.cartAdd(Aoi.shop.state.cart, p, qty || 1);
  Aoi.shop.state.cart = r.cart;
  Aoi.shop.saveCart();
  Aoi.shop.updateBubble();
  if (r.clamped && p.limit) Aoi.shop.toast('已达限购上限 ' + p.limit + ' 件（下单时服务端还会复核）');
  else Aoi.shop.toast('已加入购物车');
};

Aoi.shop.renderCart = function () {
  var body = $('cartBody'), bar = $('cartBar');
  if (!body) return;
  var byId = Aoi.shop.state.byId;
  if (!Aoi.shop.state.cart.length) {
    body.innerHTML = '<div class="empty"><div class="e">🛒</div><p>购物车还是空的<br>去团期页逛逛吧</p>'
      + '<button class="btn-main" style="margin-top:14px" data-go-home>去逛团期</button></div>';
    if (bar) bar.innerHTML = '';
    return;
  }
  var groups = {};
  Aoi.shop.state.cart.forEach(function (c) {
    var p = byId[c.pid];
    if (!p) return; // 橱窗已无此商品（下架）——忽略，服务端下单时还会校验
    (groups[p.act] = groups[p.act] || { items: [] }).items.push({ c: c, p: p });
  });
  var keys = Object.keys(groups);
  var html = keys.length ? keys.map(function (act) {
    return '<div class="cart-group">'
      + '<div class="cart-group-head">🛍️ ' + esc(act) + '</div>'
      + groups[act].items.map(function (x) {
        return '<div class="cart-item">'
          + '<div class="check' + (x.c.checked ? ' on' : '') + '" data-cart-check="' + x.p.id + '">✓</div>'
          + '<div class="ci-img prod-thumb" style="' + Aoi.shop.imgBg(x.p) + '"></div>'
          + '<div class="ci-info"><div class="ci-name">' + esc(x.p.model) + '</div>'
          + '<div class="ci-price">' + money(x.p.price)
          + '<span class="stepper"><button data-cart-dec="' + x.p.id + '">−</button><span>' + x.c.qty + '</span><button data-cart-inc="' + x.p.id + '">+</button></span></div>'
          + (x.p.limit ? '<div class="ci-dead">限购 ' + x.p.limit + ' 件</div>' : '')
          + '</div></div>';
      }).join('') + '</div>';
  }).join('') : '<div class="empty"><div class="e">🛒</div><p>购物车商品已失效</p></div>';
  body.innerHTML = html;
  var sel = Aoi.shop.state.cart.filter(function (c) { return c.checked && byId[c.pid]; });
  var t = Aoi.shop.cartTotal(Aoi.shop.state.cart, byId);
  if (bar) {
    bar.innerHTML = sel.length
      ? '<span class="total">共 ' + t.count + ' 件，合计 ' + money(t.total) + '</span>'
      + '<button class="btn-main" id="btnCheckout">去结算（' + t.count + '）</button>'
      : '<span class="total" style="color:var(--sub)">勾选商品后结算</span>';
  }
};

/* ================= 下单确认 / 收银台 ================= */

Aoi.shop.checkoutCtx = null;

Aoi.shop.renderCheckout = function () {
  var byId = Aoi.shop.state.byId;
  var sel = Aoi.shop.state.cart.filter(function (c) { return c.checked && byId[c.pid]; });
  if (!sel.length) { Aoi.shop.back(); return; }
  var t = Aoi.shop.cartTotal(Aoi.shop.state.cart, byId);
  var body = $('checkoutBody');
  if (!body) return;
  Aoi.shop.checkoutCtx = { sel: sel };
  body.innerHTML =
    '<div style="height:10px"></div>'
    + '<div class="card"><div class="sec-title">📍 收货地址</div>'
    + '<textarea id="coAddr" class="addr-text" rows="3" maxlength="300" placeholder="省市区 街道 门牌号 + 收件人 + 手机号（发货按此寄出）">' + esc(Aoi.shop.state.lastAddr) + '</textarea>'
    + '<p style="font-size:11px;color:var(--sub);margin-top:6px">地址仅团长发货可见；与上次不同会自动更新</p></div>'
    + '<div class="card"><div class="sec-title" style="color:var(--sub);font-size:12px">商品清单</div>'
    + sel.map(function (c) {
      var p = byId[c.pid];
      return '<div class="co-item"><div class="ci-img prod-thumb" style="width:52px;height:52px;flex:0 0 52px;' + Aoi.shop.imgBg(p) + '"></div>'
        + '<div class="ci-info"><div class="ci-name">' + esc(p.model) + '</div>'
        + '<div class="p-jp">' + esc(p.act) + '</div></div>'
        + '<div style="text-align:right">' + money(p.price) + '<div style="font-size:11px;color:var(--sub)">×' + c.qty + '</div></div></div>';
    }).join('')
    + '<div style="border-top:1px solid var(--line);margin-top:6px"></div>'
    + '<div class="fee-row"><span>商品总额</span><span class="v">' + money(t.total) + '</span></div>'
    + '<div class="fee-row"><span>国际运费</span><span class="v" style="font-size:12px;color:var(--sub)">到货后按批次分摊，另行通知</span></div>'
    + '<div class="fee-row total"><span>本次应付</span><span>' + money(t.total) + '</span></div>'
    + '<p style="font-size:11px;color:var(--sub);margin-top:8px">* 实付金额将在提交时加上唯一识别尾数（用于到账自动核销，免上传付款截图）</p></div>'
    + '<div class="card"><div class="sec-title">订单备注</div>'
    + '<textarea id="coRemark" class="remark-input" rows="2" maxlength="200" placeholder="选填：拼盒要求、代写贺卡等"></textarea></div>'
    + '<div style="margin:4px 12px 20px"><button class="btn-main" style="width:100%;height:46px;border-radius:23px;font-size:16px" id="btnSubmitOrder">提交订单</button></div>';
};

Aoi.shop.submitOrder = async function () {
  var addr = ($('coAddr') && $('coAddr').value.trim()) || '';
  var remark = ($('coRemark') && $('coRemark').value.trim()) || '';
  if (!addr) { Aoi.shop.toast('请填写收货地址'); return; }
  var items = Aoi.shop.checkoutCtx.sel.map(function (c) { return { pid: c.pid, qty: c.qty }; });
  Aoi.shop.loading(true);
  try {
    var r = await Aoi.shop.rpc('shop_place_order', { p_items: items, p_addr: addr, p_remark: remark });
    Aoi.shop.state.cart = Aoi.shop.state.cart.filter(function (c) { return !c.checked; });
    Aoi.shop.saveCart();
    Aoi.shop.state.lastAddr = addr;
    Aoi.shop.toast('订单已提交');
    await Aoi.shop.refreshOrders();
    Aoi.shop.openPay(r);
    Aoi.shop.state.stack = [];
    Aoi.shop.renderOrders();
    Aoi.shop.show('orders');
  } catch (e) {
    Aoi.shop.toast(e.message || e);
    if (/绑定圈名|未登录/.test(e.message || '')) Aoi.shop.showAuth('bind');
  }
  Aoi.shop.loading(false);
};

// 收银台（V1）：唯一尾数金额 + 团长收款码 + 转账指引
Aoi.shop.openPay = function (r) {
  var sheet = $('modalSheet'), root = $('modalRoot');
  if (!sheet || !root) return;
  var pay = (Aoi.shop.state.me && Aoi.shop.state.me.pay) || (Aoi.shop.state.catalog && Aoi.shop.state.catalog.pay) || null;
  var qr = pay && pay.qr
    ? '<div class="pay-qr-img"><img src="' + esc(pay.qr) + '" alt="收款码"></div>'
    : '<div class="pay-qr-img" style="color:var(--sub);font-size:12px;text-align:center">团长尚未配置收款码<br>请按订单金额直接转账</div>';
  sheet.innerHTML =
    '<div class="sheet-head"><h4>收银台</h4><button class="close" data-modal-close>×</button></div>'
    + '<div class="pay-amount">' + money(r.paidTotal)
    + '<div class="tail">请按 <b>¥' + fmt(r.paidTotal) + '</b> 精确转账（商品 ¥' + fmt(r.total) + ' + 识别尾数 <b>.' + r.tail + '</b>）<br>'
    + '尾数是本单唯一指纹——到账即自动对账核销，<b>无需上传付款截图</b></div></div>'
    + qr
    + '<div class="pay-tip">📲 扫码或长按识别向团长转账（' + esc(pay && pay.name ? pay.name : '团长收款') + '）<br>'
    + '支付确认后订单状态变为「已付款」，可在「订单」页跟踪进度</div>'
    + '<button class="btn-main" id="btnPaidClose" style="width:100%;margin-top:14px;height:44px;border-radius:22px">我已转账</button>';
  root.classList.add('open');
  var btn = $('btnPaidClose');
  if (btn) btn.onclick = function () { Aoi.shop.closeModal(); };
};

Aoi.shop.closeModal = function () {
  var root = $('modalRoot');
  if (root) root.classList.remove('open');
};

/* ================= 订单列表 / 详情 ================= */

var ORDER_TABS = [['all', '全部'], ['unpaid', '待付款'], ['paid', '已付款'], ['shipped', '已发货'], ['done', '已完成']];
Aoi.shop.orderVmKey = function (o) {
  var m = Aoi.shop.statusMeta(o);
  if (m.key === 'arrived' || m.key === 'partial') return 'paid'; // 归入「已付款」tab
  return m.key;
};

Aoi.shop.refreshOrders = async function () {
  var mine = await Aoi.shop.rpc('shop_get_my_orders');
  Aoi.shop.state.orders = mine.orders || [];
};

Aoi.shop.renderOrders = function () {
  var tabs = $('orderTabs'), body = $('ordersBody');
  if (!tabs || !body) return;
  tabs.innerHTML = ORDER_TABS.map(function (t) {
    return '<div class="o-tab' + (Aoi.shop.state.orderTab === t[0] ? ' active' : '') + '" data-otab="' + t[0] + '">' + t[1] + '</div>';
  }).join('');
  var list = Aoi.shop.state.orders.filter(function (o) {
    return Aoi.shop.state.orderTab === 'all' ? true : Aoi.shop.orderVmKey(o) === Aoi.shop.state.orderTab;
  });
  body.innerHTML = list.length ? list.map(function (o) {
    var m = Aoi.shop.statusMeta(o);
    var thumbs = o.items.slice(0, 3).map(function (it) {
      return '<div class="o-thumb prod-thumb" style="' + Aoi.shop.imgBg({ id: it.type + it.model }) + '"></div>';
    }).join('');
    if (o.items.length > 3) thumbs += '<div class="o-more">+' + (o.items.length - 3) + '</div>';
    var cnt = o.items.reduce(function (s, i) { return s + (i.qty || 0); }, 0);
    var foot = '';
    if (m.key === 'unpaid') foot = '<button class="btn-ghost" data-order-cancel="' + esc(o.no) + '">取消订单</button>'
      + '<button class="btn-main" data-order-pay="' + esc(o.no) + '">去支付</button>';
    else foot = '<button class="btn-ghost" data-order-detail="' + esc(o.no) + '">查看详情</button>';
    return '<div class="o-card">'
      + '<div class="o-head"><span>' + esc(o.no) + ' · ' + esc(o.createdAt || '') + '</span>'
      + '<span class="o-status tag ' + m.cls + '">' + m.text + '</span></div>'
      + '<div class="o-items" data-order-detail="' + esc(o.no) + '">' + thumbs + '</div>'
      + '<div class="o-sum"><span>共 ' + cnt + ' 件</span><span>实付 ' + money(o.paidTotal) + '</span></div>'
      + '<div class="o-foot">' + foot + '</div></div>';
  }).join('') : '<div class="empty"><div class="e">📭</div><p>这里还没有订单</p></div>';
};

Aoi.shop.renderOrder = function () {
  var o = Aoi.shop.state.currentOrder;
  var body = $('orderBody');
  if (!o || !body) return;
  var m = Aoi.shop.statusMeta(o);
  var steps = [
    { t: '已下单', d: '订单已提交' },
    { t: '已付款', d: '团长已确认收款，进入排单' },
    { t: '采购中', d: '截团后统一采购' },
    { t: '国际到货', d: '到囤货地，待分摊国际运费' },
    { t: '国内发货', d: '打包发出' },
    { t: '已完成', d: '确认收货' }
  ];
  var curMap = { unpaid: 0, paid: 1, arrived: 3, partial: 4, shipped: 4, done: 5 };
  var cur = curMap[m.key] !== undefined ? curMap[m.key] : 1;
  var timeline = '<div class="timeline">' + steps.map(function (s, i) {
    return '<div class="tl-node' + (i <= cur ? ' done' : '') + '"><span class="tl-dot"></span>'
      + '<div class="tl-body"><div class="t1">' + s.t + '</div>'
      + '<div class="t2">' + (i <= cur ? s.d : '待进行') + '</div></div></div>';
  }).join('') + '</div>';

  var actions = '';
  if (m.key === 'unpaid') actions = '<div style="display:flex;gap:10px;margin:0 12px 20px">'
    + '<button class="btn-ghost" style="flex:1" data-order-cancel="' + esc(o.no) + '">取消订单</button>'
    + '<button class="btn-main" style="flex:2" id="btnPayNow">去支付</button></div>';

  body.innerHTML =
    '<div class="card">' + timeline + '</div>'
    + '<div class="card"><div class="addr-card"><span class="ai">📍</span><span>'
    + '<span class="a1">收货地址</span><span class="a2">' + esc(o.addr || '') + '</span></span></div></div>'
    + '<div class="card">' + o.items.map(function (it) {
      return '<div class="co-item"><div class="ci-img prod-thumb" style="width:52px;height:52px;flex:0 0 52px;'
        + Aoi.shop.imgBg({ id: it.type + it.model }) + '"></div>'
        + '<div class="ci-info"><div class="ci-name">' + esc(it.model) + '</div>'
        + '<div class="p-jp">' + esc(it.type) + '</div></div>'
        + '<div style="text-align:right">' + money(it.price) + '<div style="font-size:11px;color:var(--sub)">×' + it.qty + '</div></div></div>';
    }).join('')
    + '<div style="border-top:1px solid var(--line);margin-top:6px"></div>'
    + '<div class="fee-row"><span>商品总额</span><span class="v">' + money(o.total) + '</span></div>'
    + '<div class="fee-row"><span>识别尾数</span><span class="v">+' + fmt((o.paidTotal || 0) - (o.total || 0)) + '</span></div>'
    + '<div class="fee-row total"><span>实付</span><span>' + money(o.paidTotal) + '</span></div>'
    + (o.remark ? '<p class="notice" style="margin-top:8px">备注：' + esc(o.remark) + '</p>' : '')
    + '</div>'
    + ((o.progress && o.progress.trackings && o.progress.trackings.length)
      ? '<div class="card"><div class="sec-title">🚚 快递单号</div>'
        + o.progress.trackings.map(function (t) {
          return '<p class="notice" style="padding:4px 0">' + esc(t) + '</p>';
        }).join('') + '<p style="font-size:11px;color:var(--sub)">单号可在快递官网/APP 查询轨迹</p></div>'
      : '')
    + '<div class="card"><div class="sec-title">ℹ️ 进度</div>'
    + '<p class="notice">' + (Aoi.shop.progressText(o) || '待团长确认收款') + '<br>'
    + '售后/换囤货地：联系客服转人工</p></div>'
    + actions;
};

/* ================= 我的 ================= */

Aoi.shop.renderProfile = function () {
  var me = Aoi.shop.state.me || {};
  var body = $('profileBody');
  if (!body) return;
  var cnt = function (key) {
    return Aoi.shop.state.orders.filter(function (o) { return Aoi.shop.orderVmKey(o) === key; }).length;
  };
  body.innerHTML =
    '<div class="me-head"><div class="avatar">🦊</div><div>'
    + '<div class="mn">' + esc(me.cn || '') + '</div>'
    + '<div class="ms">' + esc(me.teamName || '') + ' · ' + esc(me.email || '') + '</div></div></div>'
    + '<div class="me-stats">'
    + '<div class="me-stat" data-otab-go="unpaid"><div class="n">' + cnt('unpaid') + '</div><div class="l">待付款</div></div>'
    + '<div class="me-stat" data-otab-go="paid"><div class="n">' + cnt('paid') + '</div><div class="l">已付款</div></div>'
    + '<div class="me-stat" data-otab-go="shipped"><div class="n">' + cnt('shipped') + '</div><div class="l">已发货</div></div>'
    + '<div class="me-stat" data-otab-go="all"><div class="n">' + Aoi.shop.state.orders.length + '</div><div class="l">全部订单</div></div>'
    + '</div>'
    + '<div class="me-group">'
    + '<div class="me-row" data-me="orders"><span class="mi">📋</span>全部订单<span class="arrow">›</span></div>'
    + '</div>'
    + '<div class="me-group">'
    + '<div class="me-row" data-me="about"><span class="mi">🧩</span>关于商城<span class="arrow">›</span></div>'
    + '<div class="me-row" data-me="logout"><span class="mi">🚪</span>退出登录</div>'
    + '</div>'
    + '<div class="me-note">登录方式：邮箱验证码 · 密钥登录已取消<br>后续支持 QQ 登录（备案后）与手机验证码</div>';
};

Aoi.shop.openAbout = function () {
  var sheet = $('modalSheet'), root = $('modalRoot');
  if (!sheet || !root) return;
  sheet.innerHTML = '<div class="sheet-head"><h4>关于商城</h4><button class="close" data-modal-close>×</button></div>'
    + '<p class="notice">谷谷商城 · F12 C 端（v3.22.0）<br><br>'
    + '· 商品与订单与管理端同一份数据实时同步<br>'
    + '· 支付：唯一尾数金额 + 转账自动核销（V1）<br>'
    + '· 国际运费到货后按批次分摊，另行通知缴费<br><br>'
    + '计划文档：docs/PLAN-F12-CEND-SHOP.md</p>';
  root.classList.add('open');
};

/* ================= 事件绑定（全部空值保护，harness 下静默跳过） ================= */

function cancelOrder(no) {
  Aoi.shop.loading(true);
  Aoi.shop.rpc('shop_cancel_order', { p_no: no }).then(async function () {
    Aoi.shop.toast('订单已取消');
    await Aoi.shop.refreshOrders();
    Aoi.shop.loading(false);
    if (Aoi.shop.state.view === 'order') { Aoi.shop.state.currentOrder = null; Aoi.shop.back(); }
    else Aoi.shop.renderOrders();
  }).catch(function (e) {
    Aoi.shop.loading(false);
    Aoi.shop.toast(e.message || e);
  });
}

// 容器内事件委托（容器不存在则跳过——管理端 harness 下 shop.js 静默待命）
function delegateClick(containerId, rules) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    for (var i = 0; i < rules.length; i++) {
      var m = e.target.closest(rules[i][0]);
      if (m && el.contains(m)) { rules[i][1](m, e); return; }
    }
  });
}

function initEvents() {
  on('btnSendCode', 'click', function () { Aoi.shop.sendCode(); });
  on('btnVerifyCode', 'click', function () { Aoi.shop.verify(); });
  on('btnResend', 'click', function () { Aoi.shop.sendCode(); });
  on('btnBind', 'click', function () { Aoi.shop.bind(); });
  on('btnLogoutBind', 'click', function () { Aoi.shop.logout(); });
  on('authCode', 'keydown', function (e) { if (e.key === 'Enter') Aoi.shop.verify(); });

  on('btnBack', 'click', function () { Aoi.shop.back(); });
  on('modalMask', 'click', function () { Aoi.shop.closeModal(); });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest) {
      if (e.target.closest('[data-modal-close]')) Aoi.shop.closeModal();
      if (e.target.closest('#btnPayNow') && Aoi.shop.state.currentOrder) {
        var o = Aoi.shop.state.currentOrder;
        Aoi.shop.openPay({ no: o.no, total: o.total, paidTotal: o.paidTotal, tail: Aoi.shop.splitTail(o.total, o.paidTotal) });
      }
    }
  });

  document.querySelectorAll('#tabbar .tab').forEach(function (t) {
    t.addEventListener('click', function () { Aoi.shop.goTab(t.getAttribute('data-tab')); });
  });

  on('btnSearch', 'click', function () { Aoi.shop.renderHome(); });
  on('searchInput', 'keydown', function (e) { if (e.key === 'Enter') Aoi.shop.renderHome(); });

  delegateClick('homeBody', [
    ['[data-act]', function (el) {
      var name = el.getAttribute('data-act');
      Aoi.shop.state.currentAct = Aoi.shop.state.catalog.activities.filter(function (a) { return a.name === name; })[0];
      if (Aoi.shop.state.currentAct) { Aoi.shop.renderActivity(); Aoi.shop.show('activity'); }
    }],
    ['[data-prod]', function (el) {
      var p = Aoi.shop.state.byId[el.getAttribute('data-prod')];
      if (p) { Aoi.shop.state.currentProd = p; Aoi.shop.renderProduct(); Aoi.shop.show('product'); }
    }]
  ]);
  delegateClick('activityBody', [
    ['[data-prod]', function (el) {
      var p = Aoi.shop.state.byId[el.getAttribute('data-prod')];
      if (p) { Aoi.shop.state.currentProd = p; Aoi.shop.renderProduct(); Aoi.shop.show('product'); }
    }]
  ]);
  delegateClick('pdBar', [
    ['[data-pd="home"]', function () { Aoi.shop.goTab('home'); }],
    ['[data-pd="cart"]', function () { Aoi.shop.goTab('cart'); }],
    ['[data-pd="addCart"]', function () {
      if (Aoi.shop.state.currentProd) { Aoi.shop.addToCart(Aoi.shop.state.currentProd, 1); Aoi.shop.renderProduct(); }
    }],
    ['[data-pd="buyNow"]', function () {
      var p = Aoi.shop.state.currentProd;
      if (!p) return;
      // 立即购买 = 单品结算：临时购物车只留本商品
      Aoi.shop.checkoutCtxBuy = true;
      Aoi.shop.state.cart = Aoi.shop.state.cart.filter(function (c) { return c.pid !== p.id; });
      var r = Aoi.shop.cartAdd(Aoi.shop.state.cart, p, 1);
      r.item.checked = true;
      Aoi.shop.saveCart();
      Aoi.shop.renderCheckout();
      Aoi.shop.show('checkout');
    }]
  ]);
  delegateClick('cartBody', [
    ['[data-go-home]', function () { Aoi.shop.goTab('home'); }],
    ['[data-cart-check]', function (el) {
      var pid = el.getAttribute('data-cart-check');
      Aoi.shop.state.cart.forEach(function (c) { if (c.pid === pid) c.checked = !c.checked; });
      Aoi.shop.saveCart();
      Aoi.shop.renderCart();
    }],
    ['[data-cart-inc]', function (el) {
      var pid = el.getAttribute('data-cart-inc');
      var p = Aoi.shop.state.byId[pid];
      if (!p) return;
      var rest = Aoi.shop.state.cart.filter(function (x) { return x.pid !== pid; });
      var cur = null;
      Aoi.shop.state.cart.forEach(function (c) { if (c.pid === pid) cur = c; });
      if (!cur) return;
      var r = Aoi.shop.cartAdd(rest, p, cur.qty + 1);
      r.item.checked = cur.checked;
      Aoi.shop.state.cart = r.cart;
      if (r.clamped && p.limit) Aoi.shop.toast('已达限购上限 ' + p.limit + ' 件');
      Aoi.shop.saveCart();
      Aoi.shop.renderCart();
    }],
    ['[data-cart-dec]', function (el) {
      var pid = el.getAttribute('data-cart-dec');
      Aoi.shop.state.cart.forEach(function (c) { if (c.pid === pid) c.qty = Math.max(1, c.qty - 1); });
      Aoi.shop.saveCart();
      Aoi.shop.renderCart();
    }]
  ]);
  delegateClick('cartBar', [
    ['#btnCheckout', function () {
      var sel = Aoi.shop.state.cart.filter(function (c) { return c.checked && Aoi.shop.state.byId[c.pid]; });
      if (!sel.length) { Aoi.shop.toast('请先勾选商品'); return; }
      Aoi.shop.renderCheckout();
      Aoi.shop.show('checkout');
    }]
  ]);
  delegateClick('checkoutBody', [
    ['#btnSubmitOrder', function () { Aoi.shop.submitOrder(); }]
  ]);

  // 订单列表/详情：tab、去支付、取消、详情
  ['ordersBody', 'orderBody'].forEach(function (cid) {
    delegateClick(cid, [
      ['[data-otab]', function (el) {
        Aoi.shop.state.orderTab = el.getAttribute('data-otab');
        Aoi.shop.renderOrders();
      }],
      ['[data-order-detail]', function (el) {
        var no = el.getAttribute('data-order-detail');
        var o = Aoi.shop.state.orders.filter(function (x) { return x.no === no; })[0];
        if (o) { Aoi.shop.state.currentOrder = o; Aoi.shop.renderOrder(); Aoi.shop.show('order'); }
      }],
      ['[data-order-pay]', function (el) {
        var no = el.getAttribute('data-order-pay');
        var o = Aoi.shop.state.orders.filter(function (x) { return x.no === no; })[0];
        if (o) Aoi.shop.openPay({ no: o.no, total: o.total, paidTotal: o.paidTotal, tail: Aoi.shop.splitTail(o.total, o.paidTotal) });
      }],
      ['[data-order-cancel]', function (el) { cancelOrder(el.getAttribute('data-order-cancel')); }]
    ]);
  });

  delegateClick('profileBody', [
    ['[data-otab-go]', function (el) {
      Aoi.shop.state.orderTab = el.getAttribute('data-otab-go');
      Aoi.shop.renderOrders();
      Aoi.shop.show('orders');
    }],
    ['[data-me="orders"]', function () { Aoi.shop.state.orderTab = 'all'; Aoi.shop.renderOrders(); Aoi.shop.show('orders'); }],
    ['[data-me="about"]', function () { Aoi.shop.openAbout(); }],
    ['[data-me="logout"]', function () { Aoi.shop.logout(); }]
  ]);
}

/* ================= 启动 ================= */

Aoi.shop.init = async function () {
  initEvents();
  Aoi.shop.loading(true);
  try {
    var s = await Aoi.db.auth.getSession();
    if (s && s.data && s.data.session) {
      await Aoi.shop.afterAuth();
      return;
    }
  } catch (e) { /* 未登录/网络异常 → 登录页 */ }
  Aoi.shop.loading(false);
  Aoi.shop.showAuth('email');
};

// 仅在 shop.html（存在 #shop-root）时启动；管理端 harness 加载本模块时不做任何事
if (typeof document !== 'undefined' && document.getElementById('shop-root')) {
  Aoi.shop.init();
}
