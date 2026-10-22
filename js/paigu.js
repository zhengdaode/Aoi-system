// Aoi-system — 排谷表 · 按活动排队表格（v3.27.0）
// 与订单管理平行的排队台账：每个活动一张表，商品按类型分 sheet（位次×商品列矩阵，格=买家排位，
// 底色=付款状态），点按/右键排位改状态、插排/撤排、上移下移，导出 xlsx（每类型一个 Sheet + 排谷日志）。
// 状态口径（对齐谷圈排谷表惯例图例）：未付款(黄) → 已下定(绿) → 已付款(蓝) → 已付尾款(粉) → 已发货(青)；
// 超排 = 排位数超出限购计划 limits['type|model'] 的部分，标红可一键删除（图中「删除超排」）。
// 术语对照（参考图 → 本系统）：未交肾→未付款 / 已下定→已下定 / 已交肾→已付款 / 二次已付→已付尾款 /
//   已发货→已发货（不回写订单 shipped，发货仍走发货管理）/ 种类→商品（type+model 主档）/ 单价→price/priceOrig。
// 数据：blob 新键 d.paigu[activity] = { slots: {'type|model': [slot]}, log: [{at,text}] }（零 schema 改动）。
// 排位两种来源：勾选已有订单入排（记 orderId，一单只入一个排位）与手动排位（仅队列虚拟排位，不建订单）。
// 状态独立不联动：与交费审批（批次×买家级）互不影响；后续 QQ 小程序账号系统接入后买家信息弹窗补联系方式。
window.Aoi = window.Aoi || {};
Aoi.paigu = {};

// —— 常量 ——

Aoi.paigu.STATUSES = ['未付款', '已下定', '已付款', '已付尾款', '已发货'];
// 状态 → 底色 class（页面）与填充色（导出 hex，一一对应）
Aoi.paigu.STATUS_CLS = {
  '未付款': 'pq-st-unpaid', '已下定': 'pq-st-ordered', '已付款': 'pq-st-paid',
  '已付尾款': 'pq-st-final', '已发货': 'pq-st-shipped'
};
Aoi.paigu.STATUS_FILL = {
  '未付款': 'FEF3C7', '已下定': 'BBF7D0', '已付款': 'BFDBFE',
  '已付尾款': 'FBCFE8', '已发货': 'A5F3FC'
};
Aoi.paigu.UNTYPED = '未分类';
Aoi.paigu.MIN_ROWS = 10;   // 位次行最少渲染 10 行（排谷表惯例），排满自动增长
Aoi.paigu.LOG_CAP = 300;   // 每活动日志条数上限（新的在前）

// —— 数据骨架 ——

Aoi.paigu.ensure = function () {
  var d = Aoi.state.data;
  if (!d) return null;
  if (!d.paigu || typeof d.paigu !== 'object') d.paigu = {};
  return d;
};
function pqData() { return Aoi.paigu.ensure(); }
function pqTable(d, activity) {
  var t = d.paigu[activity];
  if (!t || typeof t !== 'object') t = d.paigu[activity] = {};
  if (!t.slots || typeof t.slots !== 'object') t.slots = {};
  if (!Array.isArray(t.log)) t.log = [];
  return t;
}
function pqSlotById(d, activity, slotId) {
  var t = pqTable(d, activity);
  var keys = Object.keys(t.slots);
  for (var i = 0; i < keys.length; i++) {
    var arr = t.slots[keys[i]] || [];
    for (var j = 0; j < arr.length; j++) {
      if (arr[j].id === slotId) return { key: keys[i], idx: j, slot: arr[j] };
    }
  }
  return null;
}
function pqLimit(d, activity, key) {
  var plan = d.limitPlans && d.limitPlans[activity];
  if (!plan || !plan.limits || plan.limits[key] == null) return null;
  return plan.limits[key];
}
Aoi.paigu.limitOf = pqLimit;
Aoi.paigu.orderById = function (d, id) {
  return (d.orders || []).find(function (o) { return o.id === id; }) || null;
};

function pqNow() {
  var n = new Date();
  function p2(x) { return (x < 10 ? '0' : '') + x; }
  return p2(n.getMonth() + 1) + '-' + p2(n.getDate()) + ' ' + p2(n.getHours()) + ':' + p2(n.getMinutes());
}
function pqPushLog(t, text) {
  t.log.unshift({ at: pqNow(), text: text });
  if (t.log.length > Aoi.paigu.LOG_CAP) t.log.length = Aoi.paigu.LOG_CAP;
}

// —— 纯计算（不碰 DOM / 不落库）——

// 活动商品列：主档 products ∪ 该活动订单 ∪ 已有排位（主档顺序优先，其余按 type|model 字典序补尾）
Aoi.paigu.activityProducts = function (d, activity) {
  var meta = d.activityMeta && d.activityMeta[activity] ? d.activityMeta[activity] : {};
  var agg = {};
  function put(key, patch) {
    if (!agg[key]) {
      agg[key] = { key: key, type: '', model: '', refImage: '', refUrl: '', price: null, priceOrig: null, currency: null, master: false };
    }
    Object.keys(patch).forEach(function (k) {
      if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') agg[key][k] = patch[k];
    });
  }
  (meta.products || []).forEach(function (p) {
    put(p.type + '|' + p.model, {
      type: p.type, model: p.model, refImage: p.refImage || '', refUrl: p.refUrl || '',
      price: p.price != null ? p.price : null,
      priceOrig: p.priceOrig != null ? p.priceOrig : null,
      currency: p.currency || null, master: true
    });
  });
  (d.orders || []).forEach(function (o) {
    if (o.activity !== activity) return;
    var key = o.type + '|' + o.model;
    put(key, { type: o.type, model: o.model });
    if (o.price != null && agg[key].price == null) agg[key].price = o.price; // 主档缺价时以订单价兜底
  });
  var t = pqTable(d, activity);
  Object.keys(t.slots).forEach(function (key) {
    if (!(t.slots[key] || []).length) return; // 全撤光的历史键不留列
    var parts = key.split('|');
    put(key, { type: parts[0], model: parts[1] });
  });
  var cols = [], extra = [];
  Object.keys(agg).forEach(function (key) { (agg[key].master ? cols : extra).push(agg[key]); });
  extra.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  return cols.concat(extra);
};

// 类型 tab 列表（列出现的顺序；空类型 → 「未分类」）
Aoi.paigu.sheetTypes = function (d, activity) {
  var seen = {}, list = [];
  Aoi.paigu.activityProducts(d, activity).forEach(function (c) {
    if (!seen[c.type]) { seen[c.type] = 1; list.push(c.type); }
  });
  return list;
};
Aoi.paigu.productsOfType = function (d, activity, type) {
  return Aoi.paigu.activityProducts(d, activity).filter(function (c) { return c.type === type; });
};

// orderId → 排位归属（跨活动；添加订单防重用；手动排位无 orderId 不入 map）
Aoi.paigu.membership = function (d) {
  var map = {};
  Object.keys(d.paigu || {}).forEach(function (activity) {
    var t = d.paigu[activity];
    Object.keys(t.slots || {}).forEach(function (key) {
      (t.slots[key] || []).forEach(function (s, idx) {
        if (s.orderId && !map[s.orderId]) map[s.orderId] = { activity: activity, key: key, idx: idx, slot: s };
      });
    });
  });
  return map;
};

// 活动统计（列表页卡片）：排位总数 / 超排数
Aoi.paigu.activityStats = function (d, activity) {
  var t = (d.paigu && d.paigu[activity]) || {};
  var slots = 0, over = 0;
  Object.keys(t.slots || {}).forEach(function (key) {
    var arr = t.slots[key] || [];
    slots += arr.length;
    var limit = pqLimit(d, activity, key);
    if (limit != null && arr.length > limit) over += arr.length - limit;
  });
  return { slots: slots, over: over };
};

// 买家信息（现状库内字段：圈名 / memberMeta.qq / addresses；QQ 小程序账号系统接入后在此补联系方式）
Aoi.paigu.buyerInfo = function (d, activity, buyer) {
  var mm = (d.memberMeta && d.memberMeta[buyer]) || {};
  return {
    buyer: buyer,
    qq: mm.qq || '',
    address: (d.addresses && d.addresses[buyer]) || '',
    orders: (d.orders || []).filter(function (o) { return o.activity === activity && o.buyer === buyer; })
  };
};

// —— 数据动作（undo 快照 + saveTeamData + 重渲染）——

// 勾选已有订单入排（按商品列追加队尾；一单只入一个排位，已在排的跳过）
Aoi.paigu.enqueueOrders = async function (activity, orderIds) {
  var d = pqData();
  if (!d) return { added: 0, skipped: 0 };
  var t = pqTable(d, activity);
  var mem = Aoi.paigu.membership(d);
  var fresh = [];
  ((orderIds || [])).forEach(function (oid) {
    if (mem[oid]) return;
    var o = Aoi.paigu.orderById(d, oid);
    if (o) fresh.push(o);
  });
  var skipped = (orderIds || []).length - fresh.length;
  if (!fresh.length) { Aoi.toast('勾选订单都已入排，无需重复添加', 'warning'); return { added: 0, skipped: skipped }; }
  Aoi.undo.arm('排谷表添加订单', d);
  fresh.forEach(function (o) {
    var key = o.type + '|' + o.model;
    (t.slots[key] = t.slots[key] || []).push({
      id: Aoi.genId(), orderId: o.id, buyer: o.buyer || '未名',
      status: Aoi.paigu.STATUSES[0], addedAt: pqNow()
    });
  });
  pqPushLog(t, '添加 ' + fresh.length + ' 笔订单入排' + (skipped ? '，跳过 ' + skipped + ' 笔已排' : ''));
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  Aoi.toast('已添加 ' + fresh.length + ' 笔入排（30 秒内可撤销）', 'success');
  return { added: fresh.length, skipped: skipped };
};

// 插排：手动买家名（仅队列虚拟排位，不建订单）与/或未入排订单，插到第 idx 位（1 基），后续顺延
Aoi.paigu.insertSlot = async function (activity, key, buyer, idx, orderIds) {
  var d = pqData();
  if (!d) return 0;
  var t = pqTable(d, activity);
  var mem = Aoi.paigu.membership(d);
  var news = [];
  (orderIds || []).forEach(function (oid) {
    if (mem[oid]) return;
    var o = Aoi.paigu.orderById(d, oid);
    if (o) news.push({ id: Aoi.genId(), orderId: o.id, buyer: o.buyer || '未名', status: Aoi.paigu.STATUSES[0], addedAt: pqNow() });
  });
  if (buyer) news.push({ id: Aoi.genId(), buyer: buyer, status: Aoi.paigu.STATUSES[0], addedAt: pqNow() });
  if (!news.length) { Aoi.toast('勾选订单或填写买家名', 'warning'); return 0; }
  Aoi.undo.arm('排谷表插排', d);
  var arr = t.slots[key] = t.slots[key] || [];
  var at = Math.max(0, Math.min((parseInt(idx, 10) || arr.length + 1) - 1, arr.length));
  news.forEach(function (s, i) { arr.splice(at + i, 0, s); });
  pqPushLog(t, '插排 ' + news.length + ' 笔至「' + key.replace('|', ' / ') + '」第 ' + (at + 1) + ' 位'
    + (buyer ? '（含手动排位 ' + buyer + '）' : ''));
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  Aoi.toast('已插入 ' + news.length + ' 笔，后续位次顺延（30 秒内可撤销）', 'success');
  return news.length;
};

// 改状态（点按/右键菜单；状态独立不回写订单与审批）
Aoi.paigu.setStatus = async function (activity, slotId, status) {
  var d = pqData();
  if (!d) return null;
  if (Aoi.paigu.STATUSES.indexOf(status) < 0) { Aoi.toast('未知状态：' + status, 'warning'); return null; }
  var loc = pqSlotById(d, activity, slotId);
  if (!loc) return null;
  if ((loc.slot.status || Aoi.paigu.STATUSES[0]) === status) return loc.slot;
  Aoi.undo.arm('排谷表改状态', d);
  var from = loc.slot.status || Aoi.paigu.STATUSES[0];
  loc.slot.status = status;
  var t = pqTable(d, activity);
  pqPushLog(t, '「' + (loc.slot.buyer || '未名') + '」' + loc.key.replace('|', ' / ') + '：' + from + ' → ' + status);
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  Aoi.toast('已标记「' + (loc.slot.buyer || '未名') + '」为 ' + status + '（30 秒内可撤销）', 'success');
  return loc.slot;
};

// 上移/下移一位（同商品列内交换）
Aoi.paigu.moveSlot = async function (activity, slotId, delta) {
  var d = pqData();
  if (!d) return false;
  var loc = pqSlotById(d, activity, slotId);
  if (!loc) return false;
  var arr = pqTable(d, activity).slots[loc.key];
  var to = loc.idx + (delta < 0 ? -1 : 1);
  if (to < 0 || to >= arr.length) return false;
  Aoi.undo.arm('排谷表调序', d);
  var tmp = arr[loc.idx]; arr[loc.idx] = arr[to]; arr[to] = tmp;
  var t = pqTable(d, activity);
  pqPushLog(t, '「' + (loc.slot.buyer || '未名') + '」调序：第 ' + (loc.idx + 1) + ' 位 → 第 ' + (to + 1) + ' 位');
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  return true;
};

// 撤排：移出队列（订单本身不动，30 秒撤销）
Aoi.paigu.removeSlot = async function (activity, slotId) {
  var d = pqData();
  if (!d) return;
  var loc = pqSlotById(d, activity, slotId);
  if (!loc) return;
  Aoi.undo.arm('排谷表撤排', d);
  pqTable(d, activity).slots[loc.key].splice(loc.idx, 1);
  var t = pqTable(d, activity);
  pqPushLog(t, '「' + (loc.slot.buyer || '未名') + '」撤排（' + loc.key.replace('|', ' / ') + '，订单本身不动）');
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  Aoi.toast('已撤排（订单本身不受影响，30 秒内可撤销）', 'success');
};

// 原订单已被删除的排位 → 转为手动排位（去 orderId，保留买家名）
Aoi.paigu.unlinkSlot = async function (activity, slotId) {
  var d = pqData();
  if (!d) return;
  var loc = pqSlotById(d, activity, slotId);
  if (!loc || !loc.slot.orderId) return;
  Aoi.undo.arm('排谷表转手动排位', d);
  delete loc.slot.orderId;
  var t = pqTable(d, activity);
  pqPushLog(t, '「' + (loc.slot.buyer || '未名') + '」原订单已删除，转为手动排位');
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  Aoi.toast('已转为手动排位（30 秒内可撤销）', 'success');
};

// 删除超排：每个限购键超出 limits 的尾部排位一并撤排（图中「删除超排」）
Aoi.paigu.purgeOver = async function (activity) {
  var d = pqData();
  if (!d) return 0;
  var t = pqTable(d, activity);
  var plan = [];
  Object.keys(t.slots).forEach(function (key) {
    var limit = pqLimit(d, activity, key);
    if (limit == null) return;
    var arr = t.slots[key] || [];
    if (arr.length > limit) plan.push({ key: key, limit: limit, count: arr.length - limit });
  });
  var total = plan.reduce(function (s, p) { return s + p.count; }, 0);
  if (!total) { Aoi.toast('当前没有超排位', 'info'); return 0; }
  if (!(await Aoi.confirm('删除 ' + total + ' 个超排位？（撤排出队，订单本身保留；30 秒内可撤销）'))) return 0;
  Aoi.undo.arm('排谷表删除超排', d);
  plan.forEach(function (p) { t.slots[p.key] = t.slots[p.key].slice(0, p.limit); });
  pqPushLog(t, '删除超排 ' + total + ' 个（' + plan.map(function (p) {
    return p.key.replace('|', ' / ') + ' 限 ' + p.limit;
  }).join('、') + '）');
  t.updatedAt = new Date().toISOString();
  await Aoi.saveTeamData(d);
  Aoi.paigu.renderAll();
  Aoi.toast('已删除 ' + total + ' 个超排位（30 秒内可撤销）', 'success');
  return total;
};

// —— 视图状态与渲染（view-paigu；由 Aoi.nav 进入时调用）——

var pqView = { activity: null, type: null, legendOpen: false };

Aoi.paigu.openActivity = function (activity) {
  pqView.activity = activity; pqView.type = null;
  Aoi.paigu.renderAll();
};
Aoi.paigu.backToList = function () {
  pqView.activity = null; pqView.type = null;
  Aoi.paigu.renderAll();
};
Aoi.paigu.setType = function (type) { pqView.type = type; Aoi.paigu.renderAll(); };

Aoi.paigu.renderAll = function () {
  var body = document.getElementById('paiguBody');
  if (!body) return;
  var d = pqData();
  if (!d) { body.innerHTML = ''; return; }
  body.innerHTML = pqView.activity ? pqDetailHtml(d, pqView.activity) : pqListHtml(d);
  // 买家名候选（datalist）：memberMeta 圈名 ∪ 全部订单买家
  var dl = document.getElementById('paiguBuyerOptions');
  if (dl) {
    var set = {};
    Object.keys(d.memberMeta || {}).forEach(function (cn) { set[cn] = 1; });
    (d.orders || []).forEach(function (o) { if (o.buyer) set[o.buyer] = 1; });
    dl.innerHTML = Object.keys(set).sort().map(function (n) {
      return '<option value="' + Aoi.escapeHtml(n) + '">';
    }).join('');
  }
};

function pqListHtml(d) {
  var acts = (d.activities || []).slice();
  Object.keys(d.paigu).forEach(function (a) { if (acts.indexOf(a) < 0) acts.push(a); });
  if (!acts.length) {
    return '<div class="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-500">还没有活动。先到「信息录入」登记活动商品或到「订单管理」导入订单，再来排谷。</div>';
  }
  return '<div class="grid gap-3 md:grid-cols-2">' + acts.map(function (a) {
    var st = Aoi.paigu.activityStats(d, a);
    var meta = d.activityMeta && d.activityMeta[a] ? d.activityMeta[a] : {};
    return '<div class="bg-white rounded-lg border border-gray-200 p-4">'
      + '<div class="flex flex-wrap justify-between items-start gap-2">'
      + '<div class="min-w-0"><div class="font-bold">' + Aoi.escapeHtml(a) + '</div>'
      + '<div class="text-xs text-gray-400 mt-0.5">' + Aoi.escapeHtml(meta.status || '未开始')
      + ' · 排位 ' + st.slots + ' 个'
      + (st.over ? ' · <span class="text-red-500 font-semibold">超排 ' + st.over + '</span>' : '') + '</div></div>'
      + '<div class="flex gap-2 shrink-0">'
      + '<button class="px-3 py-1.5 btn-primary rounded text-xs font-bold" data-pact="open" data-activity="' + Aoi.escapeHtml(a) + '">打开排谷表</button>'
      + '<button class="px-3 py-1.5 btn-outline rounded text-xs font-bold" data-pact="export" data-activity="' + Aoi.escapeHtml(a) + '">导出</button>'
      + '</div></div></div>';
  }).join('') + '</div>';
}

function pqLegendHtml() {
  return '<div class="flex flex-wrap items-center gap-2 mt-3 text-[11px] text-gray-500">'
    + '<button class="text-gray-400 hover:underline" data-pact="legend-toggle">图例</button>'
    + '<span class="' + (pqView.legendOpen ? '' : 'hidden') + ' flex flex-wrap items-center gap-2" id="paiguLegend">'
    + Aoi.paigu.STATUSES.map(function (s) {
      return '<span class="inline-flex items-center gap-1"><i class="pq-swatch ' + Aoi.paigu.STATUS_CLS[s] + '"></i>' + s + '</span>';
    }).join('')
    + '<span class="inline-flex items-center gap-1"><i class="pq-swatch pq-over"></i>超排（可删除）</span>'
    + '</span>'
    + '<span class="text-gray-300">·</span>'
    + '<span>点排位（电脑可右键）改状态 / 调序 / 撤排；点空格插排</span>'
    + '</div>';
}

function pqDetailHtml(d, activity) {
  var types = Aoi.paigu.sheetTypes(d, activity);
  // 注意 pqView.type 可为 ''（未分类），不能用真值判断
  var type = pqView.type != null && types.indexOf(pqView.type) >= 0 ? pqView.type : (types[0] || Aoi.paigu.UNTYPED);
  pqView.type = type;
  var st = Aoi.paigu.activityStats(d, activity);
  var html = '<div class="bg-white rounded-lg border border-gray-200 p-4">'
    + '<div class="flex flex-wrap items-center gap-2">'
    + '<button class="px-2.5 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-pact="back">‹ 返回</button>'
    + '<h3 class="font-bold">' + Aoi.escapeHtml(activity) + '</h3>'
    + (st.over ? '<span class="px-2 py-0.5 rounded-full text-[11px] bg-red-50 text-red-600 border border-red-200">超排 ' + st.over + '</span>' : '')
    + '<span class="flex-1"></span>'
    + '<button class="px-3 py-1.5 btn-primary rounded text-xs font-bold" data-pact="add-orders">添加订单</button>'
    + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-pact="log">排谷日志</button>'
    + (st.over ? '<button class="px-3 py-1.5 border border-red-200 rounded text-xs text-red-600 hover:bg-red-50" data-pact="purge-over">删除超排</button>' : '')
    + '<button class="px-3 py-1.5 btn-outline rounded text-xs font-bold" data-pact="export" data-activity="' + Aoi.escapeHtml(activity) + '">导出表格</button>'
    + '</div>'
    + pqLegendHtml()
    + '<div class="flex gap-1.5 overflow-x-auto pb-1 mt-3 border-b border-gray-100">'
    + types.map(function (tp) {
      var active = tp === type;
      return '<button data-pact="switch-type" data-type="' + Aoi.escapeHtml(tp) + '" class="px-3 py-1.5 rounded-t text-xs font-bold whitespace-nowrap '
        + (active ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200') + '">'
        + Aoi.escapeHtml(tp || Aoi.paigu.UNTYPED) + '</button>';
    }).join('')
    + '</div>'
    + pqSheetHtml(d, activity, type)
    + '</div>';
  return html;
}

function pqSheetHtml(d, activity, type) {
  var t = pqTable(d, activity);
  var cols = Aoi.paigu.productsOfType(d, activity, type);
  if (!cols.length) return '<div class="mt-3 text-sm text-gray-400">该类型暂无商品与排位。</div>';
  var maxLen = Aoi.paigu.MIN_ROWS;
  cols.forEach(function (c) { maxLen = Math.max(maxLen, (t.slots[c.key] || []).length); });
  var html = '<div class="overflow-x-auto mt-3"><table class="paigu-sheet text-sm"><thead>';
  // 表头行 1：商品（参考图 + 型号）
  html += '<tr><th class="pq-pos">种类</th>';
  cols.forEach(function (c) {
    var img = c.refImage
      ? '<img src="' + Aoi.escapeHtml(c.refImage) + '" alt="" class="pq-img" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<span class="pq-img pq-img-empty">无图</span>';
    html += '<th class="paigu-head"><div class="pq-head-img">' + img + '</div>'
      + '<div class="pq-head-model" title="' + Aoi.escapeHtml(c.model) + '">' + Aoi.escapeHtml(c.model) + '</div></th>';
  });
  html += '</tr>';
  // 表头行 2：单价（人民币价优先，缺则外币原价+币种符号）
  html += '<tr><th class="pq-pos">单价</th>';
  cols.forEach(function (c) {
    var price = c.price != null ? '¥' + c.price
      : (c.priceOrig != null ? Aoi.currencySymbol(c.currency || 'cny') + c.priceOrig : '—');
    html += '<th class="paigu-head paigu-head-price">' + Aoi.escapeHtml(price) + '</th>';
  });
  html += '</tr></thead><tbody>';
  for (var i = 1; i <= maxLen; i++) {
    html += '<tr><td class="pq-pos">' + i + '</td>';
    cols.forEach(function (c) {
      var arr = t.slots[c.key] || [];
      var limit = pqLimit(d, activity, c.key);
      var over = limit != null && i > limit;
      var s = arr[i - 1];
      if (s) {
        var dangling = s.orderId && !Aoi.paigu.orderById(d, s.orderId);
        html += '<td class="paigu-cell ' + Aoi.paigu.STATUS_CLS[s.status || Aoi.paigu.STATUSES[0]] + (over ? ' pq-over' : '')
          + '" data-pact="slot" data-activity="' + Aoi.escapeHtml(activity) + '" data-slot="' + s.id
          + '" title="' + Aoi.escapeHtml((s.buyer || '未名') + ' · ' + (s.status || Aoi.paigu.STATUSES[0]) + (dangling ? ' · 订单已删除' : '')) + '">'
          + '<span class="pq-avatar">' + Aoi.escapeHtml((s.buyer || '?').charAt(0)) + '</span>'
          + '<span class="pq-name">' + Aoi.escapeHtml(s.buyer || '未名') + '</span>'
          + (dangling ? '<span class="pq-warn" title="原订单已被删除">⚠</span>' : '')
          + '</td>';
      } else {
        html += '<td class="paigu-cell pq-empty' + (over ? ' pq-over' : '')
          + '" data-pact="insert" data-activity="' + Aoi.escapeHtml(activity) + '" data-key="' + Aoi.escapeHtml(c.key)
          + '" data-idx="' + i + '" title="点击插入排位">＋</td>';
      }
    });
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

// —— 弹层（排位操作菜单 / 添加订单 / 插排 / 买家信息 / 排谷日志）——

function pqOpenModal(html) {
  var box = document.getElementById('paiguModalBox');
  var modal = document.getElementById('paiguModal');
  if (!box || !modal) return;
  box.innerHTML = html;
  modal.classList.remove('hidden');
}
function pqCloseModal() {
  var modal = document.getElementById('paiguModal');
  if (modal) modal.classList.add('hidden');
  var box = document.getElementById('paiguModalBox');
  if (box) box.innerHTML = '';
}

// 排位操作菜单：状态即点即改 + 调序 / 买家信息 / 转手动 / 撤排
Aoi.paigu.modalSlotMenu = function (activity, slotId) {
  var d = pqData();
  var loc = pqSlotById(d, activity, slotId);
  if (!loc) return;
  var s = loc.slot;
  var o = s.orderId ? Aoi.paigu.orderById(d, s.orderId) : null;
  var dangling = !!s.orderId && !o;
  var head = '<h3 class="font-bold mb-1">' + Aoi.escapeHtml(s.buyer || '未名') + ' · 第 ' + (loc.idx + 1) + ' 位</h3>'
    + '<p class="text-xs text-gray-400 mb-3">' + Aoi.escapeHtml(loc.key.replace('|', ' / '))
    + (s.orderId ? (dangling ? ' · <span class="text-red-500">订单已删除</span>' : '') : ' · 手动排位') + '</p>';
  var statusBtns = Aoi.paigu.STATUSES.map(function (st) {
    var cur = (s.status || Aoi.paigu.STATUSES[0]) === st;
    return '<button data-pact="set-status" data-activity="' + Aoi.escapeHtml(activity) + '" data-slot="' + s.id + '" data-status="' + st
      + '" class="pq-status-btn ' + Aoi.paigu.STATUS_CLS[st] + (cur ? ' pq-status-cur' : '') + '">' + st + (cur ? ' ✓' : '') + '</button>';
  }).join('');
  var ops = '<div class="flex flex-wrap gap-2 mt-4">'
    + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-pact="slot-up" data-activity="' + Aoi.escapeHtml(activity) + '" data-slot="' + s.id + '">↑ 上移一位</button>'
    + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-pact="slot-down" data-activity="' + Aoi.escapeHtml(activity) + '" data-slot="' + s.id + '">↓ 下移一位</button>'
    + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-pact="buyer-info" data-activity="' + Aoi.escapeHtml(activity) + '" data-buyer="' + Aoi.escapeHtml(s.buyer || '') + '">查看买家信息</button>'
    + (dangling ? '<button class="px-3 py-1.5 border border-amber-200 rounded text-xs text-amber-700 hover:bg-amber-50" data-pact="slot-unlink" data-activity="' + Aoi.escapeHtml(activity) + '" data-slot="' + s.id + '">转为手动排位</button>' : '')
    + '<button class="px-3 py-1.5 border border-red-200 rounded text-xs text-red-600 hover:bg-red-50" data-pact="slot-remove" data-activity="' + Aoi.escapeHtml(activity) + '" data-slot="' + s.id + '">撤排（订单不动）</button>'
    + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-pact="modal-close">关闭</button>'
    + '</div>';
  pqOpenModal(head + '<div class="grid grid-cols-5 gap-1.5">' + statusBtns + '</div>' + ops);
};

// 添加订单入排：该活动全部订单，未排的勾选（确认后按商品列追加队尾），已排的置灰
Aoi.paigu.modalAddOrders = function (activity) {
  var d = pqData();
  var mem = Aoi.paigu.membership(d);
  var orders = (d.orders || []).filter(function (o) { return o.activity === activity; });
  var html = '<h3 class="font-bold mb-1">添加订单入排（' + Aoi.escapeHtml(activity) + '）</h3>'
    + '<p class="text-xs text-gray-400 mb-3">勾选未入排的订单，确认后按其商品列追加队尾；已在排的置灰。手动排位请点表格空格插入。</p>';
  if (!orders.length) {
    html += '<p class="text-sm text-gray-400 mb-3">该活动还没有订单。可到「订单管理」录入/导入，或点表格空格手动排位。</p>';
  } else {
    html += '<div class="max-h-72 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100 mb-3">';
    orders.forEach(function (o) {
      var inq = !!mem[o.id];
      html += '<label class="flex items-center gap-2 px-3 py-2 text-sm ' + (inq ? 'opacity-40' : 'hover:bg-gray-50') + '">'
        + '<input type="checkbox" class="pq-add-check" data-order="' + o.id + '"' + (inq ? ' disabled' : '') + '>'
        + '<span class="flex-1 min-w-0">' + Aoi.escapeHtml(o.type + ' / ' + o.model) + '</span>'
        + '<span class="text-xs text-gray-400">' + Aoi.escapeHtml(o.buyer || '未名') + '</span>'
        + (inq ? '<span class="px-1.5 rounded-full text-[10px] bg-green-50 text-green-700 border border-green-200">已排</span>' : '')
        + '</label>';
    });
    html += '</div>';
  }
  html += '<div class="flex justify-end gap-3"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-pact="modal-close">取消</button>'
    + '<button class="px-4 py-2 btn-primary text-sm font-bold rounded" data-pact="add-orders-save" data-activity="' + Aoi.escapeHtml(activity) + '">添加入排</button></div>';
  pqOpenModal(html);
};

// 插排：某商品列第 idx 位——勾选该列未入排订单和/或手动填买家名，插入后续顺延
Aoi.paigu.modalInsert = function (activity, key, idx) {
  var d = pqData();
  var mem = Aoi.paigu.membership(d);
  var parts = key.split('|');
  var orders = (d.orders || []).filter(function (o) {
    return o.activity === activity && o.type + '|' + o.model === key && !mem[o.id];
  });
  var html = '<h3 class="font-bold mb-1">插排（' + Aoi.escapeHtml(parts[0] || Aoi.paigu.UNTYPED) + ' / ' + Aoi.escapeHtml(parts[1]) + ' · 第 ' + Aoi.escapeHtml(idx) + ' 位）</h3>'
    + '<p class="text-xs text-gray-400 mb-3">新排位插入后，后续位次自动顺延。</p>';
  if (orders.length) {
    html += '<p class="text-xs font-semibold text-gray-500 mb-1">① 从该商品未入排订单勾选：</p>'
      + '<div class="max-h-48 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100 mb-3">';
    orders.forEach(function (o) {
      html += '<label class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">'
        + '<input type="checkbox" class="pq-ins-check" data-order="' + o.id + '">'
        + '<span class="flex-1">' + Aoi.escapeHtml(o.buyer || '未名') + '</span>'
        + '<span class="text-xs text-gray-400">×' + (o.count || 1) + '</span></label>';
    });
    html += '</div>';
  }
  html += '<p class="text-xs font-semibold text-gray-500 mb-1">' + (orders.length ? '② ' : '') + '或手动排位（仅排谷表虚拟排位，不建订单）：</p>'
    + '<input id="paiguInsBuyer" list="paiguBuyerOptions" placeholder="买家圈名，如：一枚小混子" class="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3">'
    + '<div class="flex justify-end gap-3"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-pact="modal-close">取消</button>'
    + '<button class="px-4 py-2 btn-primary text-sm font-bold rounded" data-pact="insert-save" data-activity="' + Aoi.escapeHtml(activity) + '" data-key="' + Aoi.escapeHtml(key) + '" data-idx="' + Aoi.escapeHtml(idx) + '">插入</button></div>';
  pqOpenModal(html);
};

// 买家信息（现状库内字段；QQ 小程序账号系统接入后在此补联系方式等细致信息）
Aoi.paigu.modalBuyer = function (activity, buyer) {
  var d = pqData();
  var b = Aoi.paigu.buyerInfo(d, activity, buyer);
  var html = '<div class="flex items-center gap-3 mb-3">'
    + '<span class="pq-avatar pq-avatar-lg">' + Aoi.escapeHtml((buyer || '?').charAt(0)) + '</span>'
    + '<div><h3 class="font-bold">' + Aoi.escapeHtml(buyer || '未名') + '</h3>'
    + '<p class="text-xs text-gray-400">' + Aoi.escapeHtml(activity) + '</p></div></div>'
    + '<div class="text-sm space-y-1 mb-3">'
    + '<div><span class="text-gray-400 text-xs">QQ：</span>' + (b.qq ? Aoi.escapeHtml(b.qq) : '<span class="text-gray-300">未绑定</span>') + '</div>'
    + '<div><span class="text-gray-400 text-xs">送达地址：</span>' + (b.address ? Aoi.escapeHtml(b.address) : '<span class="text-gray-300">未登记</span>') + '</div>'
    + '</div>';
  if (b.orders.length) {
    html += '<p class="text-xs font-semibold text-gray-500 mb-1">该活动订单（' + b.orders.length + '）：</p>'
      + '<div class="max-h-56 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">'
      + b.orders.map(function (o) {
        return '<div class="flex items-center gap-2 px-3 py-2 text-sm"><span class="flex-1 min-w-0">' + Aoi.escapeHtml(o.type + ' / ' + o.model) + '</span>'
          + '<span class="text-xs text-gray-400">×' + (o.count || 1) + '</span>'
          + '<span class="text-xs">' + (o.price != null ? '¥' + o.price : (o.priceOrig != null ? Aoi.currencySymbol(o.currency || 'cny') + o.priceOrig : '—')) + '</span>'
          + '<span class="text-xs text-gray-400">' + Aoi.escapeHtml((o.status || '未到货') + ' · ' + (o.shipped || '未发')) + '</span></div>';
      }).join('') + '</div>';
  } else {
    html += '<p class="text-xs text-gray-400">该买家在本活动暂无正式订单（可能是手动排位）。</p>';
  }
  html += '<div class="flex justify-end mt-4"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-pact="modal-close">关闭</button></div>';
  pqOpenModal(html);
};

Aoi.paigu.modalLog = function (activity) {
  var d = pqData();
  var t = pqTable(d, activity);
  var html = '<h3 class="font-bold mb-3">排谷日志（' + Aoi.escapeHtml(activity) + '）</h3>';
  html += (t.log || []).length
    ? '<div class="max-h-80 overflow-y-auto text-sm divide-y divide-gray-100 border border-gray-200 rounded">'
      + t.log.map(function (l) {
        return '<div class="px-3 py-2 flex gap-3"><span class="text-xs text-gray-400 whitespace-nowrap">' + Aoi.escapeHtml(l.at) + '</span><span class="flex-1">' + Aoi.escapeHtml(l.text) + '</span></div>';
      }).join('') + '</div>'
    : '<p class="text-sm text-gray-400 mb-3">暂无记录。改状态/插排/撤排等操作都会留痕。</p>';
  html += '<div class="flex justify-end mt-4"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-pact="modal-close">关闭</button></div>';
  pqOpenModal(html);
};

// —— 导出（复用汇总表的描述符与渲染层：每类型一个 Sheet + 排谷日志）——

Aoi.paigu.buildWorkbook = function (d, activity) {
  var t = (d.paigu && d.paigu[activity]) || null;
  var types = t ? Aoi.paigu.sheetTypes(d, activity) : [];
  if (!types.length) return { sheets: [], notes: [] };
  var usedNames = {};
  function sheetName(raw) {
    var n = String(raw).replace(/[\\/:*?[\]]/g, '-').substring(0, 31) || 'Sheet';
    if (usedNames[n]) { var i = 2; while (usedNames[n + '_' + i]) i++; n = n + '_' + i; }
    usedNames[n] = 1;
    return n;
  }
  function Sheet(name) {
    this.name = name; this.rows = []; this.merges = []; this.cols = []; this.freeze = null; this.rowHeights = {};
    this.put = function (r, col, cell) {
      while (this.rows.length <= r) this.rows.push([]);
      var row = this.rows[r];
      while (row.length <= col) row.push(null);
      row[col] = cell;
    };
  }
  function c(v, s) { return s ? { v: v, s: s } : { v: v }; }
  function imgCell(sheet, r, col, url) {
    var u = Aoi.exportSummary.absUrl(url);
    sheet.put(r, col, c('图片链接', { link: u, img: u, color: '0000FF' }));
    sheet.rowHeights[r] = 90;
  }
  var HEAD_FILL = 'F3EFE7';
  var sheets = [];
  types.forEach(function (type) {
    var cols = Aoi.paigu.productsOfType(d, activity, type);
    var sh = new Sheet(sheetName(type || Aoi.paigu.UNTYPED));
    sh.cols = [{ w: 6 }];
    cols.forEach(function () { sh.cols.push({ w: 18 }); });
    sh.freeze = { r: 3, c: 1 };
    sh.put(0, 0, c('种类', { bold: true, center: true, fill: HEAD_FILL }));
    sh.put(1, 0, c('参考图', { bold: true, center: true }));
    sh.put(2, 0, c('单价', { bold: true, center: true, fill: HEAD_FILL }));
    cols.forEach(function (col, ci) {
      sh.put(0, ci + 1, c(col.model, { bold: true, center: true, wrap: true, fill: HEAD_FILL }));
      if (col.refImage) imgCell(sh, 1, ci + 1, col.refImage);
      var label = col.price != null ? '¥' + col.price
        : (col.priceOrig != null ? Aoi.currencySymbol(col.currency || 'cny') + col.priceOrig : '');
      sh.put(2, ci + 1, c(label, { center: true }));
    });
    var maxLen = Aoi.paigu.MIN_ROWS;
    cols.forEach(function (col) { maxLen = Math.max(maxLen, (t.slots[col.key] || []).length); });
    for (var i = 1; i <= maxLen; i++) {
      sh.put(i + 2, 0, c(i, { center: true }));
      cols.forEach(function (col, ci) {
        var s = (t.slots[col.key] || [])[i - 1];
        if (!s) return;
        sh.put(i + 2, ci + 1, c(s.buyer || '未名', {
          fill: Aoi.paigu.STATUS_FILL[s.status || Aoi.paigu.STATUSES[0]] || 'FFFFFF',
          center: true, border: true
        }));
      });
    }
    sheets.push(sh);
  });
  var lg = new Sheet(sheetName('排谷日志'));
  lg.cols = [{ w: 14 }, { w: 80 }];
  lg.put(0, 0, c('时间', { bold: true, center: true, fill: HEAD_FILL }));
  lg.put(0, 1, c('操作', { bold: true, center: true, fill: HEAD_FILL }));
  (t.log || []).forEach(function (l, i) {
    lg.put(i + 1, 0, c(l.at));
    lg.put(i + 1, 1, c(l.text));
  });
  sheets.push(lg);
  return { sheets: sheets, notes: [] };
};

Aoi.paigu.exportActivity = function (activity) {
  var d = pqData();
  var desc = Aoi.paigu.buildWorkbook(d, activity);
  if (!desc.sheets.length) { Aoi.toast('该活动还没有可导出的排谷表（先添加排位）', 'warning'); return; }
  var base = String(activity).replace(/[\\/:*?"<>|]/g, '-') + '-排谷表';
  Aoi.showLoading('正在生成排谷表…');
  if (typeof window.ExcelJS === 'object' && window.ExcelJS.Workbook) {
    Aoi.exportSummary.renderExcelJS(desc, base).then(Aoi.hideLoading, Aoi.hideLoading);
  } else if (typeof XLSX === 'object' && XLSX.utils) {
    Aoi.exportSummary.renderPlain(desc, base);
    Aoi.hideLoading();
  } else {
    Aoi.hideLoading();
    Aoi.toast('表格组件未加载，无法导出', 'error');
  }
};

// —— 事件（统一委托 [data-pact]；弹层遮罩捕获关层 + Esc，v3.25.2 弹层纪律）——

document.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('[data-pact]') : null;
  if (!el) return;
  var act = el.getAttribute('data-pact');
  var activity = el.getAttribute('data-activity');
  var slotId = el.getAttribute('data-slot');
  if (act === 'modal-close') { pqCloseModal(); }
  else if (act === 'open') { Aoi.paigu.openActivity(activity); }
  else if (act === 'back') { Aoi.paigu.backToList(); }
  else if (act === 'switch-type') { Aoi.paigu.setType(el.getAttribute('data-type')); }
  else if (act === 'legend-toggle') { pqView.legendOpen = !pqView.legendOpen; Aoi.paigu.renderAll(); }
  else if (act === 'slot') { Aoi.paigu.modalSlotMenu(activity, slotId); }
  else if (act === 'insert') { Aoi.paigu.modalInsert(activity, el.getAttribute('data-key'), el.getAttribute('data-idx')); }
  else if (act === 'add-orders') { Aoi.paigu.modalAddOrders(activity || pqView.activity); }
  else if (act === 'add-orders-save') {
    var ids = Array.prototype.map.call(
      document.querySelectorAll('.pq-add-check:checked'),
      function (c) { return c.getAttribute('data-order'); }
    );
    if (!ids.length) { Aoi.toast('先勾选要入排的订单', 'warning'); return; }
    Aoi.paigu.enqueueOrders(activity, ids).then(function (r) { if (r && r.added) pqCloseModal(); });
  }
  else if (act === 'insert-save') {
    var insIds = Array.prototype.map.call(
      document.querySelectorAll('.pq-ins-check:checked'),
      function (c) { return c.getAttribute('data-order'); }
    );
    var inp = document.getElementById('paiguInsBuyer');
    var buyer = (inp && inp.value ? inp.value : '').trim();
    Aoi.paigu.insertSlot(activity, el.getAttribute('data-key'), buyer, el.getAttribute('data-idx'), insIds)
      .then(function (n) { if (n) pqCloseModal(); });
  }
  else if (act === 'set-status') {
    Aoi.paigu.setStatus(activity, slotId, el.getAttribute('data-status')).then(function (s) { if (s) pqCloseModal(); });
  }
  else if (act === 'slot-up') { Aoi.paigu.moveSlot(activity, slotId, -1).then(function (ok) { if (ok) pqCloseModal(); }); }
  else if (act === 'slot-down') { Aoi.paigu.moveSlot(activity, slotId, 1).then(function (ok) { if (ok) pqCloseModal(); }); }
  else if (act === 'slot-remove') { Aoi.paigu.removeSlot(activity, slotId).then(function () { pqCloseModal(); }); }
  else if (act === 'slot-unlink') { Aoi.paigu.unlinkSlot(activity, slotId).then(function () { pqCloseModal(); }); }
  else if (act === 'buyer-info') { Aoi.paigu.modalBuyer(activity, el.getAttribute('data-buyer')); }
  else if (act === 'log') { Aoi.paigu.modalLog(activity || pqView.activity); }
  else if (act === 'purge-over') { Aoi.paigu.purgeOver(activity || pqView.activity); }
  else if (act === 'export') { Aoi.paigu.exportActivity(activity || pqView.activity); }
});

// 桌面端右键排位 → 同一操作菜单（移动端点按即可）
document.addEventListener('contextmenu', function (e) {
  var el = e.target.closest ? e.target.closest('[data-pact="slot"]') : null;
  if (!el) return;
  e.preventDefault();
  Aoi.paigu.modalSlotMenu(el.getAttribute('data-activity'), el.getAttribute('data-slot'));
});

// Esc 关闭弹层
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') pqCloseModal();
});

// 弹层遮罩点击关闭（捕获阶段，避免被内部 stopPropagation 干扰）
document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'paiguModal') pqCloseModal();
}, true);
