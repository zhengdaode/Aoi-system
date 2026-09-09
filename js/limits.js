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
  Aoi.limits.renderSaved(activity); // 已有计划则展示（双向同步入口）
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

// 计算购买计划（v3.6.0 S3：结果入库 d.limitPlans 并与活动管理侧双向同步）
Aoi.limits.plan = async function () {
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

  // 计划入库：同名 (账号,商品) 保留既有购买状态，其余重置为待购买
  var d = Aoi.orders.ensure();
  if (!d.limitPlans) d.limitPlans = {};
  var prevStatus = {};
  ((d.limitPlans[activity] || {}).items || []).forEach(function (a) {
    (a.items || []).forEach(function (it) { prevStatus[a.index + '|' + it.type + '|' + it.model] = it.status; });
  });
  var stored = {
    activity: activity,
    freeShip: freeShip, freeShipRmb: freeShipRmb, freeCur: freeCur,
    accountsCount: accounts, maxTypes: maxTypes, limits: limits,
    items: result.accounts.map(function (a) {
      return {
        index: a.index, total: a.total, diff: a.diff, reached: a.reached,
        items: a.items.map(function (it) {
          return {
            type: it.type, model: it.model, qty: it.qty,
            price: it.qty ? Math.round(it.amount / it.qty * 100) / 100 : 0,
            amount: it.amount,
            status: prevStatus[a.index + '|' + it.type + '|' + it.model] || '待购买'
          };
        })
      };
    }),
    remaining: result.remaining,
    updatedAt: new Date().toISOString()
  };
  d.limitPlans[activity] = stored;
  Aoi.limits.renderPlan(stored);
  var box = document.getElementById('limResultBox');
  if (box) box.classList.remove('hidden');
  Aoi.orders.renderActivities(); // 活动行「计划」按钮同步账号数
  await Aoi.saveTeamData(d);
};

// 币种符号（与订单表 formatOrig 同规则）
Aoi.limits.currencySymbol = function (currency) {
  return Aoi.currencySymbol(currency);
};

// 每账号外币原价合计：与商品表同源（priceOrig 均价口径），逐件累加后按币种分组；
// 缺原价数据的商品不计入，无任何原价时返回空数组（渲染为「—」）
Aoi.limits.origTotals = function (items, meta) {
  var groups = {};
  items.forEach(function (it) {
    var m = meta[it.type + '|' + it.model];
    if (!m || m.origAvg == null) return;
    var cur = m.origCurrency;
    groups[cur] = Math.round(((groups[cur] || 0) + it.qty * m.origAvg) * 100) / 100;
  });
  return Object.keys(groups).map(function (cur) {
    return Aoi.limits.currencySymbol(cur) + groups[cur].toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  });
};

// —— 购买计划双向同步（v3.6.0 S3）——

// 购买状态与配色
Aoi.limits.STATUS_OPTIONS = ['待购买', '已购买', '购买失败'];
Aoi.limits.statusCls = function (s) {
  return s === '已购买' ? 'text-green-600' : (s === '购买失败' ? 'text-red-500' : 'text-gray-500');
};

// 在已存计划中定位 (账号 idx, 商品 key)
Aoi.limits.findItem = function (stored, idx, key) {
  var acc = null;
  (stored.items || []).forEach(function (a) { if (a.index === idx) acc = a; });
  if (!acc) return null;
  var found = null;
  (acc.items || []).forEach(function (it) { if (it.type + '|' + it.model === key) found = it; });
  return found;
};

// 重算某账号的金额 / 差额 / 包邮状态（件数或内容变化后）
Aoi.limits.recomputeAccount = function (stored, acc) {
  var total = 0;
  (acc.items || []).forEach(function (it) { total += it.amount || 0; });
  acc.total = Math.round(total * 100) / 100;
  var free = stored.freeShipRmb || 0;
  acc.diff = Math.round(Math.max(0, free - acc.total) * 100) / 100;
  acc.reached = free <= 0 || acc.total >= free - 1e-6;
};

// 失败重分配（纯函数）：把 (账号 idx, 商品 key) 整项移出，按「原计算器阶段一」同款贪心
// （逐件分给金额最低的可收账号）分配给其余账号；受 plan.limits 单账号限购与
// plan.maxTypes 种类上限约束，装不下的余量计入 plan.remaining。返回深拷贝新 plan，不改入参。
Aoi.limits.reallocateCore = function (stored, idx, key) {
  var plan = JSON.parse(JSON.stringify(stored));
  var out = { plan: plan, moved: [], remaining: 0 };
  var from = null;
  (plan.items || []).forEach(function (a) { if (a.index === idx) from = a; });
  if (!from) return out;
  var fi = -1, item = null;
  (from.items || []).forEach(function (it, i) { if (it.type + '|' + it.model === key) { item = it; fi = i; } });
  if (!item) return out;
  from.items.splice(fi, 1);
  from.total = Math.round((from.total - (item.amount || 0)) * 100) / 100;

  var limit = (plan.limits && plan.limits[key]) || 0;   // 0/缺失 = 不限
  var movedMap = {};
  var left = item.qty;
  while (left > 0) {
    var best = null;
    (plan.items || []).forEach(function (a) {
      if (a.index === idx) return;                       // 失败账号不再接收该商品
      var held = 0, hasKey = false;
      (a.items || []).forEach(function (it) { if (it.type + '|' + it.model === key) { held = it.qty; hasKey = true; } });
      if (limit > 0 && held + 1 > limit) return;         // 单账号限购
      if (plan.maxTypes > 0 && !hasKey && a.items.length >= plan.maxTypes) return; // 种类上限
      if (!best || a.total < best.total - 1e-6) best = a;
    });
    if (!best) break;
    var ex = null;
    (best.items || []).forEach(function (it) { if (it.type + '|' + it.model === key) ex = it; });
    if (ex) { ex.qty += 1; ex.amount = Math.round((ex.amount + (item.price || 0)) * 100) / 100; }
    else (best.items = best.items || []).push({ type: item.type, model: item.model, qty: 1, price: item.price || 0, amount: Math.round((item.price || 0) * 100) / 100, status: '待购买' });
    best.total = Math.round((best.total + (item.price || 0)) * 100) / 100;
    movedMap[best.index] = (movedMap[best.index] || 0) + 1;
    left--;
  }
  out.moved = Object.keys(movedMap).map(function (i) { return { index: parseInt(i, 10), qty: movedMap[i] }; });
  out.remaining = left;
  if (left > 0) {
    plan.remaining = plan.remaining || [];
    var found = null;
    plan.remaining.forEach(function (r) { if (r.type === item.type && r.model === item.model) found = r; });
    if (found) found.qty += left; else plan.remaining.push({ type: item.type, model: item.model, qty: left });
  }
  plan.items.forEach(function (a) { Aoi.limits.recomputeAccount(plan, a); });
  return out;
};

// 账号槽位对应的购买人标签（v3.7.0 S3）：取活动购买人列表的第 idx-1 行（名称+账号）
Aoi.limits.purchaserLabel = function (activity, idx) {
  var d = Aoi.orders.ensure();
  var m = d.activityMeta && d.activityMeta[activity];
  var b = ((m && m.buyers) || [])[idx - 1];
  if (!b || (!b.buyer && !b.account)) return '';
  return (b.buyer || '账号' + idx) + (b.account ? '（' + b.account + '）' : '');
};

// 渲染已存计划（限购计划结果表 / 活动管理计划弹窗共用；8 列，件数与购买状态可编辑）
Aoi.limits.renderPlan = function (stored, tbodyId, statId) {
  var tbody = document.getElementById(tbodyId || 'limResultTbody');
  var stat = document.getElementById(statId || 'limResultStat');
  if (!tbody) return;
  var meta = {};
  Aoi.limits.productsForActivity(stored.activity).forEach(function (p) { meta[p.type + '|' + p.model] = p; });
  var hasFree = (stored.freeShipRmb || 0) > 0;
  var rows = (stored.items || []).filter(function (a) { return a.items && a.items.length; });
  tbody.innerHTML = rows.length ? rows.map(function (a, i) {
    var content = a.items.map(function (it) {
      return '<div class="flex items-center gap-1 flex-wrap mb-0.5">'
        + '<span>' + Aoi.escapeHtml(it.type + '-' + it.model) + '</span>'
        + '<input type="number" min="0" step="1" value="' + it.qty + '" data-plan-qty data-activity="' + Aoi.escapeHtml(stored.activity) + '" data-idx="' + a.index + '" data-key="' + Aoi.escapeHtml(it.type + '|' + it.model) + '" title="修改件数后自动重算并同步到另一侧" class="w-14 border border-gray-300 rounded px-1 py-0.5 text-xs">'
        + '<span class="text-xs text-gray-400">件</span></div>';
    }).join('');
    var pieces = a.items.reduce(function (s, it) { return s + it.qty; }, 0);
    var origs = Aoi.limits.origTotals(a.items, meta);
    var shipCell = !hasFree ? '—'
      : (a.reached ? '<span class="text-green-600">已达包邮</span>' : '<span class="text-amber-500">差 ' + (a.diff == null ? 0 : a.diff).toFixed(2) + '</span>');
    var statusCell = a.items.map(function (it) {
      return '<div class="mb-0.5"><select data-plan-status data-activity="' + Aoi.escapeHtml(stored.activity) + '" data-idx="' + a.index + '" data-key="' + Aoi.escapeHtml(it.type + '|' + it.model) + '" class="border border-gray-300 rounded px-1 py-0.5 text-xs ' + Aoi.limits.statusCls(it.status) + '">'
        + Aoi.limits.STATUS_OPTIONS.map(function (s) {
          return '<option value="' + s + '"' + (s === it.status ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>';
    }).join('');
    return '<tr class="border-b border-gray-100 align-top">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 wrap">账号 ' + a.index
      + (function () {
          var label = Aoi.limits.purchaserLabel(stored.activity, a.index);
          return label ? '<div class="text-xs text-gray-500">' + Aoi.escapeHtml(label) + '</div>' : '';
        })()
      + '</td>'
      + '<td class="px-3 py-2 wrap">' + content + '</td>'
      + '<td class="px-3 py-2 text-right">' + pieces + '</td>'
      + '<td class="px-3 py-2 text-right">' + (a.total == null ? 0 : a.total).toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right">' + (origs.length ? Aoi.escapeHtml(origs.join(' + ')) : '—') + '</td>'
      + '<td class="px-3 py-2 text-right">' + shipCell + '</td>'
      + '<td class="px-3 py-2">' + statusCell + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="8" class="px-3 py-2 text-gray-400">无可分配内容</td></tr>';

  if (stat) {
    var remainText = (stored.remaining || []).length
      ? '⚠️ 剩余未分配（限购/种类数装不下，需加账号或放宽限购）：' + stored.remaining.map(function (r) { return r.type + '-' + r.model + ' ×' + r.qty; }).join('，')
      : '全部排单数量已分配完毕';
    var reachedCnt = rows.filter(function (a) { return a.reached; }).length;
    var reachText = hasFree ? '，' + reachedCnt + ' 个达标包邮' : '';
    var curSym = Aoi.limits.currencySymbol(stored.freeCur || 'cny');
    var freeShipText = (stored.freeCur || 'cny') === 'cny'
      ? '包邮线 ¥' + (stored.freeShipRmb || 0).toFixed(2)
      : '包邮线 ' + curSym + stored.freeShip + '（≈ ¥' + (stored.freeShipRmb || 0).toFixed(2) + '）';
    stat.textContent = '活动「' + stored.activity + '」· ' + freeShipText + ' · 分配 ' + rows.length + ' 个账号' + reachText + ' · ' + remainText;
  }
};

// 限购计划页：按已存计划渲染结果区（无计划时收起）
Aoi.limits.renderSaved = function (activity) {
  var d = Aoi.orders.ensure();
  var stored = (d.limitPlans || {})[activity];
  var box = document.getElementById('limResultBox');
  if (!stored) { if (box) box.classList.add('hidden'); return; }
  Aoi.limits.renderPlan(stored);
  if (box) box.classList.remove('hidden');
};

// 活动管理侧：购买计划弹窗
Aoi.limits.actTarget = null;

Aoi.limits.openActPlan = function (name) {
  Aoi.limits.actTarget = name;
  var t = document.getElementById('actPlanTitle');
  if (t) t.textContent = '活动：' + name;
  Aoi.limits.renderActPlan();
  document.getElementById('actPlanModal').classList.remove('hidden');
};

Aoi.limits.closeActPlan = function () {
  document.getElementById('actPlanModal').classList.add('hidden');
  Aoi.limits.actTarget = null;
};

Aoi.limits.renderActPlan = function () {
  var body = document.getElementById('actPlanBody');
  if (!body) return;
  var d = Aoi.orders.ensure();
  var stored = Aoi.limits.actTarget && d.limitPlans && d.limitPlans[Aoi.limits.actTarget];
  if (!stored) {
    body.innerHTML = '<p class="text-sm text-gray-400 py-3">该活动还没有购买计划——到「工具 → 限购计划」选择本活动、设置限购与账号数后点「计算购买计划」，结果会自动同步到这里</p>';
    return;
  }
  body.innerHTML = '<p id="actPlanStat" class="text-xs text-gray-500 mb-2"></p>'
    + '<table class="w-full text-sm data-table"><thead><tr class="text-left text-gray-500 border-b border-gray-200">'
    + '<th class="px-2 py-2 text-right w-8">行号</th><th class="px-3 py-2">账号</th><th class="px-3 py-2">购买内容</th>'
    + '<th class="px-3 py-2 text-right">件数</th><th class="px-3 py-2 text-right">金额(¥)</th><th class="px-3 py-2 text-right">外币原价</th>'
    + '<th class="px-3 py-2 text-right">包邮状态</th><th class="px-3 py-2">购买状态</th>'
    + '</tr></thead><tbody id="actPlanTbody"></tbody></table>';
  Aoi.limits.renderPlan(stored, 'actPlanTbody', 'actPlanStat');
};

// 双侧重渲染：限购计划结果表（若正选着该活动）+ 活动计划弹窗（若开着）+ 活动行按钮文案
Aoi.limits.rerenderAll = function (activity) {
  var d = Aoi.orders.ensure();
  var stored = (d.limitPlans || {})[activity];
  if (!stored) return;
  var limSel = document.getElementById('limActivity');
  if (limSel && limSel.value === activity) {
    Aoi.limits.renderPlan(stored, 'limResultTbody', 'limResultStat');
    var box = document.getElementById('limResultBox');
    if (box) box.classList.remove('hidden');
  }
  var modal = document.getElementById('actPlanModal');
  if (Aoi.limits.actTarget === activity && modal && !modal.classList.contains('hidden')) Aoi.limits.renderActPlan();
  var activeCount = stored.items.filter(function (a) { return a.items.length; }).length;
  document.querySelectorAll('button[data-act-plan]').forEach(function (b) {
    if (b.getAttribute('data-act-plan') === activity) b.textContent = activeCount ? '计划·' + activeCount + '账号' : '计划';
  });
};

// 件数编辑：重算金额与包邮状态后保存并双侧同步
Aoi.limits.setItemQty = async function (activity, idx, key, qty) {
  var d = Aoi.orders.ensure();
  if (!d.limitPlans || !d.limitPlans[activity]) return;
  var stored = d.limitPlans[activity];
  var item = Aoi.limits.findItem(stored, idx, key);
  if (!item) return;
  qty = Math.max(0, isNaN(qty) ? 0 : qty);
  item.qty = qty;
  item.amount = Math.round(qty * (item.price || 0) * 100) / 100;
  var acc = null;
  (stored.items || []).forEach(function (a) { if (a.index === idx) acc = a; });
  if (acc) Aoi.limits.recomputeAccount(stored, acc);
  await Aoi.saveTeamData(d);
  Aoi.limits.rerenderAll(activity);
};

// 购买状态确认；切到「购买失败」时二次确认并自动重分配给剩余账号
Aoi.limits.setItemStatus = async function (activity, idx, key, status) {
  var d = Aoi.orders.ensure();
  if (!d.limitPlans || !d.limitPlans[activity]) return;
  var stored = d.limitPlans[activity];
  var item = Aoi.limits.findItem(stored, idx, key);
  if (!item) return;
  if (status === '购买失败' && item.status !== '购买失败') {
    var ok = await Aoi.confirm(
      '确认账号 ' + idx + ' 的「' + key.replace('|', '-') + '」购买失败？将把 ' + item.qty + ' 件按原计算器规则重新分配给其余账号（受限购/种类上限约束，30 秒内可撤销）',
      { title: '购买失败 · 自动重分配', okText: '确认失败并重分配', danger: true });
    if (!ok) return 'cancel';
    Aoi.undo.arm('购买失败重分配', d);
    var r = Aoi.limits.reallocateCore(stored, idx, key);
    d.limitPlans[activity] = r.plan;
    await Aoi.saveTeamData(d);
    Aoi.limits.rerenderAll(activity);
    Aoi.toast(r.remaining
      ? ('已重分配 ' + (item.qty - r.remaining) + ' 件；' + r.remaining + ' 件受限购/种类上限无处安放，计入剩余未分配')
      : ('已把 ' + item.qty + ' 件重新分配给其余账号'), r.remaining ? 'warning' : 'success');
    return;
  }
  item.status = status;
  await Aoi.saveTeamData(d);
  Aoi.limits.rerenderAll(activity);
};

// 计划表格内控件的事件委托（限购结果表与活动计划弹窗共用）
Aoi.limits.onPlanStatus = function (sel) {
  var p = Aoi.limits.setItemStatus(
    sel.getAttribute('data-activity'),
    parseInt(sel.getAttribute('data-idx'), 10),
    sel.getAttribute('data-key'),
    sel.value
  );
  p.then(function (r) { if (r === 'cancel') Aoi.limits.rerenderAll(sel.getAttribute('data-activity')); });
};

Aoi.limits.onPlanQty = function (input) {
  Aoi.limits.setItemQty(
    input.getAttribute('data-activity'),
    parseInt(input.getAttribute('data-idx'), 10),
    input.getAttribute('data-key'),
    parseInt(input.value, 10)
  );
};

document.addEventListener('change', function (e) {
  var sel = e.target.closest ? e.target.closest('select[data-plan-status]') : null;
  if (sel) { Aoi.limits.onPlanStatus(sel); return; }
  var qty = e.target.closest ? e.target.closest('input[data-plan-qty]') : null;
  if (qty) Aoi.limits.onPlanQty(qty);
});

// 刷新（视图切换 / 数据变化后）
Aoi.limits.render = function () {
  Aoi.limits.refillActivities();
};
