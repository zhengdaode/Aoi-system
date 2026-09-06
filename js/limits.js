// Aoi-system — 限购购买计划计算器（工具页，与计算器并列）
// 输入：活动 + 商品限购数 + 每单包邮金额 + 可用账号数 + 每账号最大购买种类数
// 输出：每个账号在最大限度凑满包邮前提下的购买内容（可导出表格/图片）
window.Aoi = window.Aoi || {};
Aoi.limits = {};

// 核心分配算法（纯函数，供单测）：
// products: [{ type, model, qty, price, limit }] —— limit 为单账号限购（null/<=0 = 不限）
// opts: { freeShip: 每单包邮金额, accounts: 账号数, maxTypes: 每账号最大购买种类（<=0 = 不限） }
// 策略：贪心——商品按单价降序，逐账号装箱；每账号优先买贵的、
// 恰好凑到包邮线即止（最大限度包邮），受限购数与种类数约束。
Aoi.limits.planCore = function (products, opts) {
  var free = opts.freeShip || 0;
  var maxTypes = opts.maxTypes || 0;
  var result = { accounts: [], remaining: [] };

  var pool = products.map(function (p) {
    return {
      type: p.type, model: p.model, price: p.price || 0, left: p.qty,
      limit: (p.limit != null && p.limit > 0) ? p.limit : Infinity
    };
  }).sort(function (a, b) { return b.price - a.price; });

  var anyLeft = pool.some(function (p) { return p.left > 0; });
  for (var i = 0; i < opts.accounts && anyLeft; i++) {
    var cart = [], total = 0, types = 0;
    for (var j = 0; j < pool.length; j++) {
      var p = pool[j];
      if (p.left <= 0) continue;
      if (maxTypes > 0 && types >= maxTypes) break;      // 种类数已满
      if (free > 0 && total >= free) break;               // 已达包邮线
      var cap = Math.min(p.left, p.limit);
      if (cap <= 0) continue;                              // 该账号此商品受限购
      var take = cap;
      if (free > 0) {
        var need = free - total;
        var maxTake = p.price > 0 ? Math.ceil(need / p.price) : cap;
        take = Math.min(cap, Math.max(1, maxTake));       // 恰好凑到包邮所需
      }
      cart.push({ type: p.type, model: p.model, qty: take, amount: Math.round(take * p.price * 100) / 100 });
      total += take * p.price;
      p.left -= take;
      types++;
      if (p.left <= 0) anyLeft = pool.some(function (q) { return q.left > 0; });
    }
    if (cart.length) {
      result.accounts.push({
        index: i + 1,
        items: cart,
        total: Math.round(total * 100) / 100,
        diff: Math.round(Math.max(0, free - total) * 100) / 100,
        reached: free <= 0 || total >= free
      });
    }
  }

  result.remaining = pool.filter(function (p) { return p.left > 0; })
    .map(function (p) { return { type: p.type, model: p.model, qty: p.left }; });
  return result;
};

// 汇总某活动的商品（种类×型号 排单数量 + 均价 + 外币原价均价）
Aoi.limits.productsForActivity = function (activity) {
  var d = Aoi.orders.ensure();
  var map = {};
  d.orders.forEach(function (o) {
    if (o.activity !== activity) return;
    var key = o.type + '|' + o.model;
    if (!map[key]) map[key] = { type: o.type, model: o.model, qty: 0, prices: [], origs: [] };
    map[key].qty += o.count;
    if (o.price != null) map[key].prices.push(o.price);
    if (o.priceOrig != null && o.currency && o.currency !== 'cny') map[key].origs.push({ currency: o.currency, value: o.priceOrig });
  });
  return Object.keys(map).map(function (k) {
    var m = map[k];
    m.price = m.prices.length ? m.prices.reduce(function (a, b) { return a + b; }, 0) / m.prices.length : 0;
    // 外币原价：同键可能混多种币种，取出现最多的币种求均价
    if (m.origs.length) {
      var groups = {};
      m.origs.forEach(function (g) { (groups[g.currency] = groups[g.currency] || []).push(g.value); });
      var main = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; })[0];
      m.origCurrency = main;
      m.origAvg = groups[main].reduce(function (a, b) { return a + b; }, 0) / groups[main].length;
    }
    delete m.prices;
    delete m.origs;
    return m;
  });
};

// 外币原价展示（与订单表 formatOrig 同符号规则）
Aoi.limits.origText = function (p) {
  if (p.origAvg == null) return '—';
  var sym = p.origCurrency === 'jpy' ? 'JP¥' : (p.origCurrency === 'krw' ? '₩' : p.origCurrency);
  return sym + p.origAvg.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};

// 渲染商品表（种类/排单数量/参考单价/外币原价/限购输入）
Aoi.limits.load = function () {
  var activity = document.getElementById('limActivity').value;
  var tbody = document.getElementById('limProductTbody');
  if (!tbody) return;
  if (!activity) { tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-2 text-gray-400">请先选择活动</td></tr>'; return; }
  var products = Aoi.limits.productsForActivity(activity);
  tbody.innerHTML = products.length ? products.map(function (p, i) {
    var key = Aoi.escapeHtml(p.type + '|' + p.model);
    return '<tr class="border-b border-gray-100">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(p.type) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(p.model) + '</td>'
      + '<td class="px-3 py-2 text-right">' + p.qty + '</td>'
      + '<td class="px-3 py-2 text-right">' + (p.price ? p.price.toFixed(2) : '—') + '</td>'
      + '<td class="px-3 py-2 text-right">' + Aoi.limits.origText(p) + '</td>'
      + '<td class="px-3 py-2"><input type="number" step="1" min="0" placeholder="不限" data-lim="' + key + '" class="w-20 border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="7" class="px-3 py-2 text-gray-400">该活动暂无订单</td></tr>';
  document.getElementById('limResultBox').classList.add('hidden');
};

// 批量设置限购数：应用到全部商品行
Aoi.limits.applyBulkLimit = function () {
  var v = document.getElementById('limBulk').value;
  document.querySelectorAll('#limProductTbody input[data-lim]').forEach(function (el) { el.value = v; });
};

// 刷新活动下拉
Aoi.limits.refillActivities = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('limActivity');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">选择活动…</option>' + d.activities.map(function (a) {
    return '<option value="' + Aoi.escapeHtml(a) + '">' + Aoi.escapeHtml(a) + '</option>';
  }).join('');
  if (cur && d.activities.indexOf(cur) >= 0) sel.value = cur;
  Aoi.limits.load();
};

// 计算购买计划
Aoi.limits.plan = function () {
  var activity = document.getElementById('limActivity').value;
  if (!activity) { Aoi.toast('请先选择活动', 'warning'); return; }
  var products = Aoi.limits.productsForActivity(activity);
  if (!products.length) { Aoi.toast('该活动暂无订单', 'warning'); return; }
  // 读限购输入
  var limits = {};
  document.querySelectorAll('#limProductTbody input[data-lim]').forEach(function (el) {
    if (el.value !== '') limits[el.getAttribute('data-lim')] = parseInt(el.value, 10);
  });
  products.forEach(function (p) { p.limit = limits[p.type + '|' + p.model]; });

  var freeShip = parseFloat(document.getElementById('limFreeShip').value) || 0;
  var curEl = document.getElementById('limFreeShipCurrency');
  var freeCur = curEl ? curEl.value : 'cny';
  var freeShipRmb = freeCur === 'cny' ? freeShip : Aoi.calc.toRmb(freeShip, freeCur);
  var accounts = parseInt(document.getElementById('limAccounts').value, 10);
  var maxTypes = parseInt(document.getElementById('limMaxTypes').value, 10) || 0;
  if (isNaN(accounts) || accounts <= 0) { Aoi.toast('请填写可使用的账号数量', 'warning'); return; }

  var result = Aoi.limits.planCore(products, { freeShip: freeShipRmb, accounts: accounts, maxTypes: maxTypes });
  Aoi.limits.renderResult(activity, result, freeShip, freeShipRmb, freeCur);
};

// 币种符号（与订单表 formatOrig 同规则）
Aoi.limits.currencySymbol = function (currency) {
  return currency === 'jpy' ? 'JP¥' : (currency === 'krw' ? '₩' : '¥');
};

// 渲染结果表（freeShip = 所选币种金额；freeShipRmb = 换算后人民币包邮线）
Aoi.limits.renderResult = function (activity, result, freeShip, freeShipRmb, freeCur) {
  if (freeShipRmb == null) { freeShipRmb = freeShip; freeCur = 'cny'; }
  var tbody = document.getElementById('limResultTbody');
  var stat = document.getElementById('limResultStat');
  var box = document.getElementById('limResultBox');
  tbody.innerHTML = result.accounts.length ? result.accounts.map(function (a, i) {
    var content = a.items.map(function (it) { return it.type + '-' + it.model + ' ×' + it.qty; }).join('，');
    return '<tr class="border-b border-gray-100 align-top">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 wrap">账号 ' + a.index + '</td>'
      + '<td class="px-3 py-2 wrap">' + Aoi.escapeHtml(content) + '</td>'
      + '<td class="px-3 py-2 text-right">' + a.total.toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right">' + (a.reached ? '<span class="text-green-600">已达包邮</span>' : '<span class="text-amber-500">差 ' + a.diff.toFixed(2) + '</span>') + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">无可分配内容</td></tr>';

  var remainText = result.remaining.length
    ? '⚠️ 剩余未分配：' + result.remaining.map(function (r) { return r.type + '-' + r.model + ' ×' + r.qty; }).join('，')
    : '全部排单数量已分配完毕';
  var curSym = Aoi.limits.currencySymbol(freeCur);
  var freeShipText = freeCur === 'cny'
    ? '包邮线 ¥' + freeShipRmb.toFixed(2)
    : '包邮线 ' + curSym + freeShip + '（≈ ¥' + freeShipRmb.toFixed(2) + '）';
  stat.textContent = '活动「' + activity + '」· ' + freeShipText + ' · 用 ' + result.accounts.length + ' 个账号 · ' + remainText;
  box.classList.remove('hidden');
};

// 刷新（视图切换 / 数据变化后）
Aoi.limits.render = function () {
  Aoi.limits.refillActivities();
};
