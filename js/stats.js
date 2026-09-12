// Aoi-system — 复盘统计（F6，v3.5.0）：按团期聚合订单/金额/币种/买家/交费回收/发货时效
// 只读统计：不改任何业务数据；口径见 view-stats 页脚注与 docs/PLAN-F6-STATS.md
window.Aoi = window.Aoi || {};
Aoi.stats = {};

Aoi.stats.PAY_STATUSES = ['已交', '待审核', '待交', '已驳回'];

// 排行口径状态（渲染用）
Aoi.stats.ipMetric = 'amount';    // amount | count | qty
Aoi.stats.buyerMetric = 'amount'; // amount | qty

// —— 口径计算（纯函数，不碰 DOM）——

// '2026-09-01' → '2026-09'；非法返回 ''
Aoi.stats.monthKey = function (dateStr) {
  var m = /^(\d{4})-(\d{2})/.exec(String(dateStr || ''));
  return m ? m[1] + '-' + m[2] : '';
};

// 团期下拉数据：all + 月份（活动购买时间 ∪ 批次到货日期，降序）+ unknown
Aoi.stats.termOptions = function (d) {
  var set = {};
  (d.activities || []).forEach(function (a) {
    var meta = (d.activityMeta && d.activityMeta[a]) || {};
    var k = Aoi.stats.monthKey(meta.buyDate || '');
    if (k) set[k] = 1;
  });
  (d.batches || []).forEach(function (b) {
    var k = Aoi.stats.monthKey(b.date);
    if (k) set[k] = 1;
  });
  var months = Object.keys(set).sort().reverse();
  var opts = [{ value: 'all', label: '全部时间段' }];
  months.forEach(function (m) { opts.push({ value: m, label: m }); });
  opts.push({ value: 'unknown', label: '未记录购买时间' });
  return opts;
};

// 单价折合人民币：优先已生成的人民币价；缺失时按当前计算器汇率估算（est 标记）
Aoi.stats.orderRmb = function (o) {
  if (o.price != null && !isNaN(o.price)) return { rmb: Number(o.price), est: false };
  if (o.priceOrig != null && !isNaN(o.priceOrig)) return { rmb: Aoi.calc.toRmb(Number(o.priceOrig), o.currency), est: true };
  return { rmb: 0, est: false };
};

Aoi.stats.orderAmount = function (o) {
  return Aoi.stats.orderRmb(o).rmb * (o.count || 0);
};

// 订单按活动购买时间月份过滤；unknown = 活动未记录购买时间
Aoi.stats.ordersInTerm = function (d, term) {
  if (term === 'all') return d.orders;
  return d.orders.filter(function (o) {
    var meta = (d.activityMeta && d.activityMeta[o.activity]) || {};
    var k = Aoi.stats.monthKey(meta.buyDate || '');
    return term === 'unknown' ? !k : k === term;
  });
};

Aoi.stats.ordersInIp = function (orders, ip) {
  return ip ? orders.filter(function (o) { return (o.ip || '') === ip; }) : orders;
};

// 批次按到货日期月份过滤（unknown 不含批次——批次必有日期）
Aoi.stats.batchesInTerm = function (d, term) {
  if (term === 'unknown') return [];
  if (term === 'all') return d.batches || [];
  return (d.batches || []).filter(function (b) { return Aoi.stats.monthKey(b.date) === term; });
};

// 批次 × 买家交费汇总（与审批页同源），供 payRows / buyerRows 复用
Aoi.stats.batchSummaries = function (d, term) {
  return Aoi.stats.batchesInTerm(d, term).map(function (b) {
    return { batch: b, rows: Aoi.approval.buyerSummary(b.id) };
  });
};

// 交费汇总（金额口径）：{已交:{cnt,fee}, 待审核:…, 待交:…, 已驳回:…}
Aoi.stats.payRows = function (d, term, summaries) {
  summaries = summaries || Aoi.stats.batchSummaries(d, term);
  var out = {};
  Aoi.stats.PAY_STATUSES.forEach(function (s) { out[s] = { cnt: 0, fee: 0 }; });
  summaries.forEach(function (s) {
    s.rows.forEach(function (r) {
      var st = Aoi.stats.PAY_STATUSES.indexOf(r.status) >= 0 ? r.status : '待交';
      out[st].cnt++;
      out[st].fee += (r.intlFee != null && !isNaN(r.intlFee)) ? r.intlFee : 0;
    });
  });
  return out;
};

// 按活动聚合（金额降序）：{ name, ip, status, count, qty, amount, cur{cny,jpy,krw 原币}, arrived }
Aoi.stats.activityRows = function (d, term, ip) {
  var orders = Aoi.stats.ordersInIp(Aoi.stats.ordersInTerm(d, term), ip);
  var map = {};
  orders.forEach(function (o) {
    var meta = (d.activityMeta && d.activityMeta[o.activity]) || {};
    if (!map[o.activity]) {
      map[o.activity] = {
        name: o.activity, ip: meta.ip || o.ip || '', status: meta.status || '未开始',
        count: 0, qty: 0, amount: 0, cur: { cny: 0, jpy: 0, krw: 0 }, arrived: 0
      };
    }
    var m = map[o.activity];
    var c = o.currency || 'cny';
    var qty = o.count || 0;
    m.count++;
    m.qty += qty;
    m.amount += Aoi.stats.orderAmount(o);
    m.cur[c] = (m.cur[c] || 0) + (c === 'cny' ? (o.price || 0) : (o.priceOrig || 0)) * qty;
    if ((o.status || '未到货') === '已到货') m.arrived++;
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.amount - a.amount; });
};

// 按 IP 聚合：{ ip, count, qty, amount }（金额降序）
Aoi.stats.ipRows = function (d, term, ip) {
  var orders = Aoi.stats.ordersInIp(Aoi.stats.ordersInTerm(d, term), ip);
  var map = {};
  orders.forEach(function (o) {
    var k = o.ip || '';
    if (!map[k]) map[k] = { ip: k, count: 0, qty: 0, amount: 0 };
    map[k].count++;
    map[k].qty += o.count || 0;
    map[k].amount += Aoi.stats.orderAmount(o);
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.amount - a.amount; });
};

// 买家排行 + 交费金额汇总（批次范围 = 团期；交费不受 IP 筛选影响，但只列范围内有订单的买家）
Aoi.stats.buyerRows = function (d, term, ip, summaries) {
  var orders = Aoi.stats.ordersInIp(Aoi.stats.ordersInTerm(d, term), ip);
  summaries = summaries || Aoi.stats.batchSummaries(d, term);
  var map = {};
  orders.forEach(function (o) {
    if (!map[o.buyer]) {
      map[o.buyer] = {
        buyer: o.buyer, qty: 0, amount: 0,
        pay: { '已交': 0, '待审核': 0, '待交': 0, '已驳回': 0 }
      };
    }
    map[o.buyer].qty += o.count || 0;
    map[o.buyer].amount += Aoi.stats.orderAmount(o);
  });
  summaries.forEach(function (s) {
    s.rows.forEach(function (r) {
      if (!map[r.buyer]) return;
      var st = Aoi.stats.PAY_STATUSES.indexOf(r.status) >= 0 ? r.status : '待交';
      map[r.buyer].pay[st] += (r.intlFee != null && !isNaN(r.intlFee)) ? r.intlFee : 0;
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.amount - a.amount; });
};

// 币种分布：{ cur, count(条), orig(原币), rmb(折合) }（折合降序）
Aoi.stats.currencyRows = function (d, term, ip) {
  var orders = Aoi.stats.ordersInIp(Aoi.stats.ordersInTerm(d, term), ip);
  var map = {};
  orders.forEach(function (o) {
    var c = o.currency || 'cny';
    if (!map[c]) map[c] = { cur: c, count: 0, orig: 0, rmb: 0 };
    map[c].count++;
    map[c].orig += (c === 'cny' ? (o.price || 0) : (o.priceOrig || 0)) * (o.count || 0);
    map[c].rmb += Aoi.stats.orderAmount(o);
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.rmb - a.rmb; });
};

// 发货时效（按批次）：仅统计 已发 且有 shippedAt 的订单；天 = shippedAt − 批次到货日期
Aoi.stats.shipAgingRows = function (d, term) {
  return Aoi.stats.batchesInTerm(d, term).map(function (b) {
    var rows = d.orders.filter(function (o) { return o.batchId === b.id; });
    var sum = 0, n = 0;
    rows.forEach(function (o) {
      if ((o.shipped || '未发') !== '已发' || !o.shippedAt) return;
      var ms = Date.parse(o.shippedAt) - Date.parse(b.date + 'T00:00:00Z');
      if (!isNaN(ms) && ms >= 0) { sum += ms / 86400000; n++; }
    });
    return {
      label: Aoi.orders.batchLabel(b), date: b.date,
      total: rows.length,
      shipped: rows.filter(function (o) { return (o.shipped || '未发') === '已发'; }).length,
      sum: sum, n: n,
      avgDays: n ? sum / n : null
    };
  });
};

// KPI：订单/件数、折合金额、买家、人均、应收/已收/未收国际费、发货时效、到货比例
// v3.15.0 S8：summaries/aging 可由调用方传入（单次渲染内只算一遍），缺省时自行计算（向后兼容）
Aoi.stats.kpis = function (d, term, ip, summaries, aging) {
  var orders = Aoi.stats.ordersInIp(Aoi.stats.ordersInTerm(d, term), ip);
  summaries = summaries || Aoi.stats.batchSummaries(d, term);
  var pay = Aoi.stats.payRows(d, term, summaries);
  var amount = 0, est = false, qty = 0, buyers = {}, arrived = 0;
  orders.forEach(function (o) {
    var r = Aoi.stats.orderRmb(o);
    amount += r.rmb * (o.count || 0);
    if (r.est) est = true;
    qty += o.count || 0;
    buyers[o.buyer] = 1;
    if ((o.status || '未到货') === '已到货') arrived++;
  });
  var buyerCount = Object.keys(buyers).length;
  var receivable = pay['已交'].fee + pay['待审核'].fee + pay['待交'].fee + pay['已驳回'].fee;
  aging = aging || Aoi.stats.shipAgingRows(d, term);
  var agingSum = 0, agingN = 0;
  aging.forEach(function (b) { agingSum += b.sum; agingN += b.n; });
  return {
    orderCount: orders.length, qty: qty, amount: amount, est: est,
    buyerCount: buyerCount, perBuyer: buyerCount ? amount / buyerCount : 0,
    receivable: receivable,
    paidFee: pay['已交'].fee, paidCnt: pay['已交'].cnt,
    paidPct: receivable > 0 ? pay['已交'].fee / receivable * 100 : null,
    unpaidFee: pay['待交'].fee + pay['已驳回'].fee,
    pendingFee: pay['待审核'].fee,
    arrived: arrived,
    arrivedPct: orders.length ? arrived / orders.length * 100 : null,
    agingDays: agingN ? agingSum / agingN : null
  };
};

// —— 渲染 ——

Aoi.stats.fmtInt = function (n) { return Math.round(n || 0).toLocaleString('zh-CN'); };
Aoi.stats.fmt2 = function (n) { return (n || 0).toFixed(2); };
Aoi.stats.fmt1 = function (n) { return (Math.round((n || 0) * 10) / 10).toLocaleString('zh-CN'); };

// 重建团期 / IP 下拉（保持当前选择）
Aoi.stats.refill = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('statsTermSel');
  if (sel) {
    var cur = sel.value;
    sel.innerHTML = Aoi.stats.termOptions(d).map(function (o) {
      return '<option value="' + o.value + '">' + Aoi.escapeHtml(o.label) + '</option>';
    }).join('');
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
  }
  var ipSel = document.getElementById('statsIpSel');
  if (ipSel) {
    var curIp = ipSel.value;
    ipSel.innerHTML = '<option value="">全部 IP</option>' + Aoi.orders.collectIps(d).map(function (ip) {
      return '<option value="' + Aoi.escapeHtml(ip) + '">' + Aoi.escapeHtml(ip) + '</option>';
    }).join('');
    if (curIp && ipSel.querySelector('option[value="' + curIp + '"]')) ipSel.value = curIp;
  }
};

Aoi.stats.kpiHtml = function (label, value, note) {
  return '<div class="bg-white rounded-lg border border-gray-200 p-4">'
    + '<p class="text-xs text-gray-500 mb-1">' + label + '</p>'
    + '<p class="font-serif text-2xl font-bold">' + value + '</p>'
    + '<p class="text-[11px] text-gray-400 mt-1">' + note + '</p></div>';
};

Aoi.stats.barHtml = function (name, val, max, valText, subText) {
  var w = max > 0 ? Math.max(2, Math.round(val / max * 100)) : 0;
  return '<div class="flex items-center gap-3 mb-2">'
    + '<div class="w-24 shrink-0 truncate text-sm" title="' + Aoi.escapeHtml(name) + '">' + Aoi.escapeHtml(name) + '</div>'
    + '<div class="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden"><div class="h-full bg-blue-500 rounded-full" style="width:' + w + '%"></div></div>'
    + '<div class="w-36 shrink-0 text-right text-xs text-gray-500">' + valText
    + (subText ? '<div class="text-[10px] text-gray-400 mt-0.5">' + subText + '</div>' : '')
    + '</div></div>';
};

Aoi.stats.swHtml = function (kind, key, label, cur) {
  var on = cur === key;
  return '<button data-stats-sw="' + kind + ':' + key + '" class="px-3 py-1 rounded-full text-xs border '
    + (on ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100')
    + '">' + label + '</button>';
};

Aoi.stats.render = function () {
  var kpiBox = document.getElementById('statsKpis');
  if (!kpiBox) return;
  Aoi.stats.refill();
  var d = Aoi.orders.ensure();
  var term = document.getElementById('statsTermSel').value || 'all';
  var ip = document.getElementById('statsIpSel').value || '';
  // v3.15.0 S8：聚合结果按（数据信号+团期+IP+口径）记忆化——重复进入总览不再全量重算，
  // DOM 渲染每次照常执行（字符串拼装开销可忽略）。此前单次渲染内 batchSummaries/shipAging
  // 各算两遍、且与 overview/notify 三方重复，是「总览常需一段时间加载」的视图级根因。
  var key = Aoi.dataSig(d) + '|' + term + '|' + ip + '|' + Aoi.stats.ipMetric + '|' + Aoi.stats.buyerMetric;
  var c = Aoi.stats._renderCache;
  if (!c || c.key !== key) {
    var summaries = Aoi.stats.batchSummaries(d, term);
    var aging = Aoi.stats.shipAgingRows(d, term);
    c = Aoi.stats._renderCache = {
      key: key,
      k: Aoi.stats.kpis(d, term, ip, summaries, aging),
      acts: Aoi.stats.activityRows(d, term, ip),
      ips: Aoi.stats.ipRows(d, term, ip),
      buyers: Aoi.stats.buyerRows(d, term, ip, summaries),
      curs: Aoi.stats.currencyRows(d, term, ip),
      pay: Aoi.stats.payRows(d, term, summaries),
      aging: aging
    };
  }
  var k = c.k;

  kpiBox.innerHTML =
    Aoi.stats.kpiHtml('订单总数', Aoi.stats.fmtInt(k.orderCount) + ' 条', '共 ' + Aoi.stats.fmtInt(k.qty) + ' 件') +
    Aoi.stats.kpiHtml('折合总金额', '¥' + Aoi.stats.fmtInt(k.amount), (k.est ? '外币缺失价按当前汇率估算' : '全部为已确认人民币价')) +
    Aoi.stats.kpiHtml('参与买家', Aoi.stats.fmtInt(k.buyerCount) + ' 人', '按购买者去重') +
    Aoi.stats.kpiHtml('人均消费', '¥' + Aoi.stats.fmtInt(k.perBuyer), '折合金额 ÷ 买家数') +
    Aoi.stats.kpiHtml('应收国际费', '¥' + Aoi.stats.fmtInt(k.receivable), '范围内到货批次合计') +
    Aoi.stats.kpiHtml('已收国际费', '¥' + Aoi.stats.fmtInt(k.paidFee), k.paidPct == null ? '暂无应收' : '回收率 ' + Math.round(k.paidPct) + '%（金额口径）') +
    Aoi.stats.kpiHtml('未收国际费', '¥' + Aoi.stats.fmtInt(k.unpaidFee), '待审核在途 ¥' + Aoi.stats.fmtInt(k.pendingFee)) +
    Aoi.stats.kpiHtml('平均发货时效', k.agingDays == null ? '—' : Aoi.stats.fmt1(k.agingDays) + ' 天', '到货 → 发货（有发货时间戳的订单）') +
    Aoi.stats.kpiHtml('到货比例', k.arrivedPct == null ? '—' : Math.round(k.arrivedPct) + '%', '已到货 ' + k.arrived + ' / ' + k.orderCount + ' 条');

  // 按活动聚合
  var acts = c.acts;
  var actTbody = document.getElementById('statsActTbody');
  if (actTbody) {
    actTbody.innerHTML = acts.length ? acts.map(function (a, i) {
      var cur = [];
      if (a.cur.cny) cur.push('¥');
      if (a.cur.jpy) cur.push('JP¥');
      if (a.cur.krw) cur.push('₩');
      return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
        + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
        + '<td class="px-3 py-2">' + Aoi.escapeHtml(a.name) + '</td>'
        + '<td class="px-3 py-2">' + Aoi.escapeHtml(a.ip || '—') + '</td>'
        + '<td class="px-3 py-2">' + Aoi.escapeHtml(a.status) + '</td>'
        + '<td class="px-3 py-2 text-right">' + a.count + '</td>'
        + '<td class="px-3 py-2 text-right">' + a.qty + '</td>'
        + '<td class="px-3 py-2 text-right">' + Aoi.stats.fmt2(a.amount) + '</td>'
        + '<td class="px-3 py-2">' + Aoi.escapeHtml(cur.join(' + ') || '—') + '</td>'
        + '<td class="px-3 py-2 text-right">' + (a.count ? Math.round(a.arrived / a.count * 100) + '%' : '—') + '</td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="9" class="px-3 py-2 text-gray-400">该范围内暂无订单</td></tr>';
  }

  // IP 排行（口径切换）
  var ips = c.ips;
  var ipSw = document.getElementById('statsIpSw');
  if (ipSw) {
    ipSw.innerHTML =
      Aoi.stats.swHtml('ip', 'amount', '按金额', Aoi.stats.ipMetric) +
      Aoi.stats.swHtml('ip', 'count', '按订单数', Aoi.stats.ipMetric) +
      Aoi.stats.swHtml('ip', 'qty', '按件数', Aoi.stats.ipMetric);
  }
  var ipMetric = Aoi.stats.ipMetric;
  var ipSorted = ips.slice().sort(function (a, b) { return b[ipMetric] - a[ipMetric]; });
  var ipBox = document.getElementById('statsIpBars');
  if (ipBox) {
    ipBox.innerHTML = ipSorted.length ? ipSorted.map(function (r) {
      var val = ipMetric === 'amount' ? '¥' + Aoi.stats.fmt2(r.amount) : Aoi.stats.fmtInt(r[ipMetric]) + (ipMetric === 'count' ? ' 条' : ' 件');
      return Aoi.stats.barHtml(r.ip || '（未分类）', r[ipMetric], ipSorted[0][ipMetric], val, '');
    }).join('') : '<p class="text-sm text-gray-400">暂无数据</p>';
  }

  // 买家排行（口径切换 + 交费状态下钻）
  var buyers = c.buyers;
  var buyerSw = document.getElementById('statsBuyerSw');
  if (buyerSw) {
    buyerSw.innerHTML =
      Aoi.stats.swHtml('buyer', 'amount', '按金额', Aoi.stats.buyerMetric) +
      Aoi.stats.swHtml('buyer', 'qty', '按件数', Aoi.stats.buyerMetric);
  }
  var bMetric = Aoi.stats.buyerMetric;
  var bSorted = buyers.slice(0, 10).sort(function (a, b) { return b[bMetric] - a[bMetric]; });
  var bBox = document.getElementById('statsBuyerBars');
  if (bBox) {
    bBox.innerHTML = bSorted.length ? bSorted.map(function (b) {
      var recv = b.pay['已交'] + b.pay['待审核'] + b.pay['待交'] + b.pay['已驳回'];
      var sub = recv
        ? (b.pay['已交'] ? '<span class="text-green-600">已交 ¥' + Aoi.stats.fmtInt(b.pay['已交']) + '</span> ' : '')
          + (b.pay['待审核'] ? '<span class="text-amber-500">待审核 ¥' + Aoi.stats.fmtInt(b.pay['待审核']) + '</span> ' : '')
          + (b.pay['待交'] ? '<span class="text-gray-500">待交 ¥' + Aoi.stats.fmtInt(b.pay['待交']) + '</span> ' : '')
          + (b.pay['已驳回'] ? '<span class="text-red-500">驳回 ¥' + Aoi.stats.fmtInt(b.pay['已驳回']) + '</span>' : '')
        : '无到货批次应收';
      var val = bMetric === 'amount' ? '¥' + Aoi.stats.fmt2(b.amount) : Aoi.stats.fmtInt(b.qty) + ' 件';
      return Aoi.stats.barHtml(b.buyer, b[bMetric], bSorted[0][bMetric], val, sub);
    }).join('') : '<p class="text-sm text-gray-400">暂无数据</p>';
  }

  // 币种分布（条形长度按折合金额）
  var curs = c.curs;
  var curBox = document.getElementById('statsCurBars');
  if (curBox) {
    var curMax = curs.length ? Math.max.apply(null, curs.map(function (r) { return r.rmb; })) : 0;
    curBox.innerHTML = curs.length ? curs.map(function (r) {
      var sym = Aoi.currencySymbol(r.cur);
      return Aoi.stats.barHtml(sym, r.rmb, curMax, '¥' + Aoi.stats.fmt2(r.rmb),
        r.count + ' 条 · 原币 ' + Aoi.stats.fmtInt(r.orig));
    }).join('') : '<p class="text-sm text-gray-400">暂无数据</p>';
  }

  // 交费回收（金额口径）
  var pay = c.pay;
  var payBox = document.getElementById('statsPayBars');
  if (payBox) {
    var payMax = Math.max(pay['已交'].fee, pay['待审核'].fee, pay['待交'].fee, pay['已驳回'].fee);
    payBox.innerHTML =
      Aoi.stats.barHtml('已交', pay['已交'].fee, payMax, '¥' + Aoi.stats.fmt2(pay['已交'].fee),
        k.paidPct == null ? '—' : Math.round(k.paidPct) + '% · ' + pay['已交'].cnt + ' 笔') +
      Aoi.stats.barHtml('待审核（在途）', pay['待审核'].fee, payMax, '¥' + Aoi.stats.fmt2(pay['待审核'].fee), pay['待审核'].cnt + ' 笔') +
      Aoi.stats.barHtml('待交', pay['待交'].fee, payMax, '¥' + Aoi.stats.fmt2(pay['待交'].fee), pay['待交'].cnt + ' 笔') +
      Aoi.stats.barHtml('已驳回', pay['已驳回'].fee, payMax, '¥' + Aoi.stats.fmt2(pay['已驳回'].fee), pay['已驳回'].cnt + ' 笔');
  }

  // 发货时效
  var aging = c.aging;
  var agingTbody = document.getElementById('statsAgingTbody');
  if (agingTbody) {
    agingTbody.innerHTML = aging.length ? aging.map(function (b, i) {
      return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
        + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
        + '<td class="px-3 py-2">' + Aoi.escapeHtml(b.label) + '（' + Aoi.escapeHtml(b.date || '—') + '）</td>'
        + '<td class="px-3 py-2 text-right">' + b.total + '</td>'
        + '<td class="px-3 py-2 text-right">' + b.shipped + '</td>'
        + '<td class="px-3 py-2 text-right">' + (b.avgDays == null ? '—' : Aoi.stats.fmt1(b.avgDays) + ' 天') + '</td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">该范围内暂无批次</td></tr>';
  }
};

// 口径切换按钮（事件委托；key 为内部常量，无注入面）
document.addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-stats-sw]');
  if (!btn) return;
  var parts = btn.getAttribute('data-stats-sw').split(':');
  if (parts[0] === 'ip') Aoi.stats.ipMetric = parts[1];
  else Aoi.stats.buyerMetric = parts[1];
  Aoi.stats.render();
});
