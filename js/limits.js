// Aoi-system — 限购购买计划计算器（工具页，与计算器并列）
// 输入：活动 + 商品限购数 + 每单包邮金额 + 可用账号数 + 每账号最大购买种类数
// 逻辑（两阶段，v3.4.1 修订）：
//   阶段一·全量分配 —— 全部排单数量必须分配到账号（不管最终有没有包邮），
//     受「单账号单品限购 + 每账号最大种类数」约束；每件分给当前金额最低的
//     账号，各账号金额天然均衡；仅当约束真装不下时才计入剩余未分配。
//   阶段二·包邮调剂 —— 在账号间挪货让尽可能多的账号达到包邮线：
//     a) 已达标账号在不跌破包邮线的前提下向未达标账号补差（先一步达标、再部分补差）；
//     b) 总货值不足以全员包邮时，牺牲金额最低的账号，把最接近包邮线的账号
//        逐个顶过线（已达标账号绝不动）。
// 输出：每个账号的购买内容 + 金额 + 距包邮差额（可导出表格/图片）
window.Aoi = window.Aoi || {};
Aoi.limits = {};

// 核心分配算法（纯函数，供单测）：
// products: [{ type, model, qty, price, limit }] —— limit 为单账号限购（null/<=0 = 不限）
// opts: { freeShip: 每单包邮金额, accounts: 账号数, maxTypes: 每账号最大购买种类（<=0 = 不限） }
Aoi.limits.planCore = function (products, opts) {
  var free = opts.freeShip || 0;
  var maxTypes = opts.maxTypes || 0;
  var n = Math.max(1, opts.accounts || 1);
  var EPS = 1e-6;
  var result = { accounts: [], remaining: [] };

  var pool = products.map(function (p) {
    return {
      type: p.type, model: p.model, price: p.price || 0,
      left: p.qty,
      limit: (p.limit != null && p.limit > 0) ? p.limit : Infinity,
      key: p.type + '|' + p.model
    };
  }).sort(function (a, b) { return b.price - a.price; });

  // 账号内部状态：items[key] = { key, type, model, price, limit, qty }，total 为当前金额
  var accs = [];
  for (var i = 0; i < n; i++) accs.push({ items: {}, total: 0 });

  function qtyOf(a, key) { return a.items[key] ? a.items[key].qty : 0; }
  function canRecv(a, it, d) {
    if (qtyOf(a, it.key) + d > it.limit) return false;                    // 单账号单品限购
    if (!a.items[it.key] && maxTypes > 0 && Object.keys(a.items).length >= maxTypes) return false; // 种类数已满
    return true;
  }
  function give(a, it, d) {
    a.items[it.key].qty -= d;
    a.total = Math.round((a.total - d * it.price) * 100) / 100;
    if (a.items[it.key].qty <= 0) delete a.items[it.key];
  }
  function recv(a, it, d) {
    if (!a.items[it.key]) a.items[it.key] = { key: it.key, type: it.type, model: it.model, price: it.price, limit: it.limit, qty: 0 };
    a.items[it.key].qty += d;
    a.total = Math.round((a.total + d * it.price) * 100) / 100;
  }

  // ── 阶段一：全量分配 ── 每件给当前金额最低的可收账号（均衡 + 全部分完）
  pool.forEach(function (p) {
    while (p.left > 0) {
      var best = -1;
      for (var j = 0; j < n; j++) {
        if (!canRecv(accs[j], p, 1)) continue;
        if (best < 0 || accs[j].total < accs[best].total - EPS) best = j;
      }
      if (best < 0) break;                        // 所有账号此商品均已到限购/种类上限
      recv(accs[best], p, 1);
      p.left--;
    }
  });
  result.remaining = pool.filter(function (p) { return p.left > 0; })
    .map(function (p) { return { type: p.type, model: p.model, qty: p.left }; });

  // ── 阶段二：包邮调剂 ──
  if (free > 0) {
    function reached(a) { return a.total >= free - EPS; }
    // 找一次挪动 donors→receiver：优先「一步达标」中挪动金额最小者；
    // 无一步达标时给「部分补差」中金额最大者（不超差额，不浪费）。
    // strictDonor = donor 挪出后不得跌破包邮线。
    function findMove(targets, donors, strictDonor) {
      var cross = null, part = null;
      targets.forEach(function (t) {
        var need = free - t.total;
        if (need <= EPS) return;
        donors.forEach(function (d) {
          if (d === t) return;
          Object.keys(d.items).forEach(function (k) {
            var it = d.items[k];
            if (it.price <= 0) return;            // 无价商品不参与包邮计算
            var dCap = strictDonor ? Math.floor((d.total - free + EPS) / it.price) : it.qty;
            var cap = Math.min(it.qty, it.limit - qtyOf(t, it.key), dCap);
            if (cap <= 0 || !canRecv(t, it, 1)) return;
            var qMin = Math.ceil((need - EPS) / it.price);   // 一步达标最少件数
            if (qMin <= cap && canRecv(t, it, qMin)) {
              var val = Math.round(qMin * it.price * 100) / 100;
              if (!cross || val < cross.val - EPS) cross = { from: d, to: t, it: it, qty: qMin, val: val };
            } else {
              var q = Math.min(cap, qMin - 1);
              if (q >= 1) {
                var v2 = Math.round(q * it.price * 100) / 100;
                if (!part || v2 > part.val + EPS) part = { from: d, to: t, it: it, qty: q, val: v2 };
              }
            }
          });
        });
      });
      return { cross: cross, part: part };
    }
    function applyMove(mv) { give(mv.from, mv.it, mv.qty); recv(mv.to, mv.it, mv.qty); }

    // 换货口径的收货判定：outItem/outQty 先移出（可能腾出种类名额），再收 it×q
    function recvOk(a, it, q, outItem, outQty) {
      if (qtyOf(a, it.key) + q > it.limit) return false;
      if (!a.items[it.key] && maxTypes > 0) {
        var types = Object.keys(a.items).length;
        if (a.items[outItem.key] && a.items[outItem.key].qty - outQty <= 0) types--;
        if (types >= maxTypes) return false;
      }
      return true;
    }
    // 等价交换：d 换出 out×q1、回接 back×q2，净额 nv = q1*out价 − q2*back价。
    // nv ∈ [need, surplus] 则一步达标（取 nv 最小者）；nv ∈ (0, need) 则部分补差（取 nv 最大者）。
    function findSwap(targets, donors) {
      var cross = null, part = null;
      targets.forEach(function (t) {
        var need = free - t.total;
        if (need <= EPS) return;
        donors.forEach(function (d) {
          if (d === t) return;
          var surplus = d.total - free;
          if (surplus <= EPS) return;           // 无盈余无从交换
          Object.keys(d.items).forEach(function (k1) {
            var out = d.items[k1];
            if (out.price <= 0) return;
            Object.keys(t.items).forEach(function (k2) {
              if (k2 === k1) return;            // 同种商品用普通挪动即可
              var back = t.items[k2];
              if (back.price <= 0) return;
              for (var q1 = 1; q1 <= out.qty; q1++) {
                if (!recvOk(t, out, q1, back, 0)) break;   // 约束随 q1 收紧，后面更不行
                var v1 = Math.round(q1 * out.price * 100) / 100;
                if (v1 <= need + EPS) continue;
                var q2Lo = Math.max(1, Math.ceil((v1 - surplus - EPS) / back.price));
                var q2Hi = Math.floor((v1 - need + EPS) / back.price);  // nv ≥ need 的最大 q2
                if (q2Hi >= q2Lo && q2Hi <= back.qty && recvOk(d, back, q2Hi, out, q1)) {
                  var nv = Math.round((v1 - q2Hi * back.price) * 100) / 100;
                  if (nv > EPS && (!cross || nv < cross.val - EPS))
                    cross = { from: d, to: t, out: out, q1: q1, back: back, q2: q2Hi, val: nv };
                }
                var q2 = q2Hi + 1;              // nv 恰落到 need 之下、尽量接近
                if (q2 >= q2Lo && q2 <= back.qty && recvOk(d, back, q2, out, q1)) {
                  var nv2 = Math.round((v1 - q2 * back.price) * 100) / 100;
                  if (nv2 > EPS && (!part || nv2 > part.val + EPS))
                    part = { from: d, to: t, out: out, q1: q1, back: back, q2: q2, val: nv2 };
                }
              }
            });
          });
        });
      });
      return { cross: cross, part: part };
    }
    function applySwap(s) {
      give(s.from, s.out, s.q1); give(s.to, s.back, s.q2);
      recv(s.to, s.out, s.q1); recv(s.from, s.back, s.q2);
    }

    // a) 达标账号不跌破线地给未达标账号补差（普通挪动优先，无解再等价交换），直到无可改善
    for (;;) {
      var below = accs.filter(function (a) { return !reached(a); });
      if (!below.length) break;
      var donors = accs.filter(reached);
      var mv = findMove(below, donors, true);
      if (mv.cross) { applyMove(mv.cross); continue; }
      if (mv.part) { applyMove(mv.part); continue; }
      var sw = findSwap(below, donors);
      if (sw.cross) { applySwap(sw.cross); continue; }
      if (sw.part) { applySwap(sw.part); continue; }
      break;
    }
    // b) 货值不足全员包邮：牺牲未达标账号，把最接近线的逐个顶过线
    for (;;) {
      var rest = accs.filter(function (a) { return !reached(a); })
        .sort(function (x, y) { return y.total - x.total; });
      if (rest.length < 2) break;
      var mv2 = findMove([rest[0]], rest.slice(1), false);
      if (mv2.cross) { applyMove(mv2.cross); continue; }
      if (mv2.part) { applyMove(mv2.part); continue; }
      break;
    }
  }

  result.accounts = accs.map(function (a, i) { return { slot: i + 1, a: a }; })
    .filter(function (x) { return Object.keys(x.a.items).length > 0; })
    .map(function (x) {
      var items = Object.keys(x.a.items).map(function (k) { return x.a.items[k]; })
        .sort(function (p, q) { return q.price - p.price; })
        .map(function (it) {
          return { type: it.type, model: it.model, qty: it.qty, amount: Math.round(it.qty * it.price * 100) / 100 };
        });
      return {
        index: x.slot,
        items: items,
        total: Math.round(x.a.total * 100) / 100,
        diff: Math.round(Math.max(0, free - x.a.total) * 100) / 100,
        reached: free <= 0 || x.a.total >= free - EPS
      };
    });
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
  var sym = Aoi.currencySymbol(p.origCurrency);
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
  return Aoi.currencySymbol(currency);
};

// 渲染结果表（freeShip = 所选币种金额；freeShipRmb = 换算后人民币包邮线）
Aoi.limits.renderResult = function (activity, result, freeShip, freeShipRmb, freeCur) {
  if (freeShipRmb == null) { freeShipRmb = freeShip; freeCur = 'cny'; }
  var tbody = document.getElementById('limResultTbody');
  var stat = document.getElementById('limResultStat');
  var box = document.getElementById('limResultBox');
  var hasFree = freeShipRmb > 0;
  tbody.innerHTML = result.accounts.length ? result.accounts.map(function (a, i) {
    var content = a.items.map(function (it) { return it.type + '-' + it.model + ' ×' + it.qty; }).join('，');
    var shipCell = !hasFree ? '—'
      : (a.reached ? '<span class="text-green-600">已达包邮</span>' : '<span class="text-amber-500">差 ' + a.diff.toFixed(2) + '</span>');
    return '<tr class="border-b border-gray-100 align-top">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 wrap">账号 ' + a.index + '</td>'
      + '<td class="px-3 py-2 wrap">' + Aoi.escapeHtml(content) + '</td>'
      + '<td class="px-3 py-2 text-right">' + a.total.toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right">' + shipCell + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">无可分配内容</td></tr>';

  var remainText = result.remaining.length
    ? '⚠️ 剩余未分配（限购/种类数装不下，需加账号或放宽限购）：' + result.remaining.map(function (r) { return r.type + '-' + r.model + ' ×' + r.qty; }).join('，')
    : '全部排单数量已分配完毕';
  var reachedCnt = result.accounts.filter(function (a) { return a.reached; }).length;
  var reachText = hasFree ? '，' + reachedCnt + ' 个达标包邮' : '';
  var curSym = Aoi.limits.currencySymbol(freeCur);
  var freeShipText = freeCur === 'cny'
    ? '包邮线 ¥' + freeShipRmb.toFixed(2)
    : '包邮线 ' + curSym + freeShip + '（≈ ¥' + freeShipRmb.toFixed(2) + '）';
  stat.textContent = '活动「' + activity + '」· ' + freeShipText + ' · 分配 ' + result.accounts.length + ' 个账号' + reachText + ' · ' + remainText;
  box.classList.remove('hidden');
};

// 刷新（视图切换 / 数据变化后）
Aoi.limits.render = function () {
  Aoi.limits.refillActivities();
};
