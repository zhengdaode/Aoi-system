// Aoi-system — 订单 / 周边 / 批次：导入确认、录入、展示、筛选、批量操作
window.Aoi = window.Aoi || {};
Aoi.orders = {};

// 制品类型常用标签（供 datalist 建议，可自由输入新类型）
Aoi.orders.TYPE_SUGGESTIONS = ['徽章', '立牌', '文件夹', '色纸', '明信片', '拍立得', '钥匙扣', '毛绒挂件', '吧唧', '亚克力挂件', '卡套'];

// 确保 Aoi.state.data 结构齐全
Aoi.orders.ensure = function () {
  var d = Aoi.state.data || {};
  if (!Array.isArray(d.orders)) d.orders = [];
  if (!Array.isArray(d.products)) d.products = [];
  if (!Array.isArray(d.activities)) d.activities = [];
  if (!Array.isArray(d.ips)) d.ips = [];
  if (!Array.isArray(d.batches)) d.batches = [];
  if (!d.activityMeta) d.activityMeta = {};
  if (!d.typeMeta) d.typeMeta = {};
  if (!d.ipTypes) d.ipTypes = {};
  if (!d.addresses) d.addresses = {};
  if (!d.memberMeta) d.memberMeta = {};
  if (!Array.isArray(d.cnChanges)) d.cnChanges = [];
  // 首次迁移：把内置常用类型并入类型库（线路=未分类）
  Aoi.orders.TYPE_SUGGESTIONS.forEach(function (t) {
    if (!d.typeMeta[t]) d.typeMeta[t] = { route: '未分类' };
  });
  // 反推活动：订单里出现但未登记进 d.activities 的活动补进列表（幂等）
  (d.orders || []).forEach(function (o) {
    if (o.activity && d.activities.indexOf(o.activity) < 0) d.activities.push(o.activity);
  });
  Aoi.state.data = d;
  return d;
};

// 收集去重 IP 列表（订单 + 周边 + 手动登记的 IP）
Aoi.orders.collectIps = function (d) {
  var set = {};
  (d.orders || []).forEach(function (o) { if (o.ip) set[o.ip] = 1; });
  (d.products || []).forEach(function (p) { if (p.ip) set[p.ip] = 1; });
  (d.ips || []).forEach(function (ip) { if (ip) set[ip] = 1; });
  return Object.keys(set);
};

// 刷新 datalist（IP / 活动 / 制品类型）
Aoi.orders.refillDatalists = function () {
  var d = Aoi.orders.ensure();
  var ipList = document.getElementById('ipOptions');
  if (ipList) ipList.innerHTML = Aoi.orders.collectIps(d)
    .map(function (ip) { return '<option value="' + Aoi.escapeHtml(ip) + '">'; }).join('');
  var actList = document.getElementById('activityOptions');
  if (actList) actList.innerHTML = d.activities
    .map(function (a) { return '<option value="' + Aoi.escapeHtml(a) + '">'; }).join('');
  var typeList = document.getElementById('typeOptions');
  if (typeList) typeList.innerHTML = Aoi.orders.TYPE_SUGGESTIONS
    .map(function (t) { return '<option value="' + t + '">'; }).join('');
};

// —— 导入 ——

// 导入文件：解析 → 识别活动/IP → 弹窗确认
Aoi.orders.importFile = async function (file) {
  var buf = await file.arrayBuffer();
  var records = Aoi.import.parse(buf, file.name);
  if (!records.length) { Aoi.toast('未识别到订单数据', 'warning'); return; }
  Aoi.import.pending = records;
  document.getElementById('importActivity').value = Aoi.import.detectActivity(records);
  document.getElementById('importIp').value = Aoi.import.detectIp(records);
  document.getElementById('importCount').textContent = records.length;
  document.getElementById('importModal').classList.remove('hidden');
};

// 确认导入：应用确认后的活动/IP，入库
Aoi.orders.confirmImport = async function () {
  var activity = document.getElementById('importActivity').value.trim();
  var ip = document.getElementById('importIp').value.trim();
  var records = Aoi.import.pending || [];
  document.getElementById('importModal').classList.add('hidden');
  if (!records.length) return;
  records.forEach(function (r) { if (activity) r.activity = activity; if (ip) r.ip = ip; });
  var d = Aoi.orders.ensure();
  d.orders = d.orders.concat(records);
  if (activity && d.activities.indexOf(activity) < 0) d.activities.push(activity);
  if (ip && d.ips.indexOf(ip) < 0) d.ips.push(ip);
  if (activity && ip) {
    if (!d.activityMeta[activity]) d.activityMeta[activity] = {};
    d.activityMeta[activity].ip = ip;
  }
  await Aoi.saveTeamData(d);
  Aoi.import.pending = [];
  Aoi.orders.render();
  Aoi.orders.refillDatalists();
  Aoi.toast('导入 ' + records.length + ' 条订单', 'success');
};

Aoi.orders.cancelImport = function () {
  Aoi.import.pending = [];
  document.getElementById('importModal').classList.add('hidden');
};

// —— 手动录入 ——

// 实时预览人民币价格（货币≠人民币时）
Aoi.orders.previewRmb = function (priceId, currencyId, outId) {
  var price = parseFloat(document.getElementById(priceId).value);
  var currency = document.getElementById(currencyId).value;
  var out = document.getElementById(outId);
  if (!out) return;
  if (isNaN(price)) { out.textContent = ''; return; }
  out.textContent = '= ¥' + Aoi.calc.toRmb(price, currency).toFixed(2);
};

// 手动新增订单（价格统一转为人民币保存）
Aoi.orders.addManual = async function () {
  var get = function (id) { return document.getElementById(id).value.trim(); };
  var ip = get('oIp'), activity = get('oActivity'), type = get('oType'),
      model = get('oModel'), buyer = get('oBuyer');
  var currency = document.getElementById('oCurrency').value;
  var price = parseFloat(get('oPrice'));
  var count = parseInt(get('oCount'), 10);
  if (!type || !model || !buyer || isNaN(price) || isNaN(count) || count <= 0) {
    Aoi.toast('请填写制品类型、型号、价格、数量、购买者', 'warning'); return;
  }
  var d = Aoi.orders.ensure();
  d.orders.push({
    id: Aoi.genId(), ip: ip, activity: activity, type: type, model: model,
    price: Aoi.calc.toRmb(price, currency), count: count, buyer: buyer,
    status: '未到货', batchId: null, paid: '未交'
  });
  if (activity && d.activities.indexOf(activity) < 0) d.activities.push(activity);
  if (ip && d.ips.indexOf(ip) < 0) d.ips.push(ip);
  if (activity && ip) {
    if (!d.activityMeta[activity]) d.activityMeta[activity] = {};
    d.activityMeta[activity].ip = ip;
  }
  await Aoi.saveTeamData(d);
  Aoi.orders.render();
  Aoi.orders.refillDatalists();
  Aoi.toast('已新增订单', 'success');
};

// 手动新增周边（预建商品，价格统一转为人民币）
Aoi.orders.addProduct = async function () {
  var get = function (id) { return document.getElementById(id).value.trim(); };
  var ip = get('pIp'), type = get('pType'), model = get('pModel');
  var currency = document.getElementById('pCurrency').value;
  var price = parseFloat(get('pPrice'));
  if (!type || !model || isNaN(price)) { Aoi.toast('请填写制品类型、型号、价格', 'warning'); return; }
  var d = Aoi.orders.ensure();
  d.products.push({ id: Aoi.genId(), ip: ip, type: type, model: model, price: Aoi.calc.toRmb(price, currency) });
  if (ip && d.ips.indexOf(ip) < 0) d.ips.push(ip);
  await Aoi.saveTeamData(d);
  Aoi.orders.renderProducts();
  Aoi.orders.refillDatalists();
  Aoi.toast('已新增周边', 'success');
};

// —— 批次（按到货日期划分）——

Aoi.orders.ensureBatch = function (date) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < d.batches.length; i++) {
    if (d.batches[i].date === date) return d.batches[i].id;
  }
  var b = { id: Aoi.genId(), date: date };
  d.batches.push(b);
  return b.id;
};

Aoi.orders.batchDate = function (batchId) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < d.batches.length; i++) {
    if (d.batches[i].id === batchId) return d.batches[i].date;
  }
  return '';
};

Aoi.orders.batchCount = function (batchId) {
  var d = Aoi.orders.ensure();
  return d.orders.filter(function (o) { return o.batchId === batchId; }).length;
};

// 批次显示名（有自定义名用名字，否则用日期）
Aoi.orders.batchLabel = function (b) {
  return b.name || b.date;
};

// 批次内包含的活动及订单数（展开查看用）
Aoi.orders.batchActivities = function (batchId) {
  var d = Aoi.orders.ensure();
  var map = {};
  d.orders.forEach(function (o) {
    if (o.batchId !== batchId) return;
    var a = o.activity || '（未填活动）';
    map[a] = (map[a] || 0) + 1;
  });
  return Object.keys(map).sort().map(function (a) { return { activity: a, count: map[a] }; });
};

// 新建批次（国际批次页，按日期，可选命名）
Aoi.orders.createBatch = async function () {
  var date = document.getElementById('newBatchDate').value;
  var name = ((document.getElementById('newBatchName') || {}).value || '').trim();
  if (!date) { Aoi.toast('请选择到货日期', 'warning'); return; }
  var d = Aoi.orders.ensure();
  if (d.batches.some(function (b) { return b.date === date; })) { Aoi.toast('该日期批次已存在', 'warning'); return; }
  d.batches.push({ id: Aoi.genId(), date: date, name: name || date });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderBatches();
  Aoi.orders.refillAllBatchSelects();
  Aoi.toast('已新建批次 ' + (name || date), 'success');
};

// 从批次列表跳转订单管理，为该批次勾选具体到货商品
Aoi.orders.addToBatch = function (batchId) {
  Aoi.nav('view-orders');
  var fBatch = document.getElementById('fBatch');
  if (fBatch) fBatch.value = '__none__';  // 只看未分批商品
  var sel = document.getElementById('arriveBatchSel');
  if (sel) sel.value = batchId;
  Aoi.orders.render();
  Aoi.toast('勾选已到货的商品，点「标记到货」归入该批次', 'info');
};

// 删除批次：订单保留，取消分批
Aoi.orders.deleteBatch = async function (id) {
  if (!(await Aoi.confirm('确定删除该批次？其订单将变为未分批'))) return;
  var d = Aoi.orders.ensure();
  Aoi.undo.arm('删除批次', d);
  d.batches = d.batches.filter(function (b) { return b.id !== id; });
  d.orders.forEach(function (o) { if (o.batchId === id) o.batchId = null; });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderBatches();
  Aoi.orders.refillAllBatchSelects();
  Aoi.orders.render();
  Aoi.toast('已删除批次', 'success');
};

// 改名批次
Aoi.orders.renameBatch = async function (id) {
  var d = Aoi.orders.ensure();
  var batch = null;
  for (var i = 0; i < d.batches.length; i++) if (d.batches[i].id === id) batch = d.batches[i];
  if (!batch) return;
  var name = window.prompt('批次名称（留空则用日期）', batch.name || batch.date);
  if (name === null) return;
  name = name.trim();
  batch.name = name || batch.date;
  await Aoi.saveTeamData(d);
  Aoi.orders.renderBatches();
  Aoi.orders.refillAllBatchSelects();
  Aoi.toast('已改名', 'success');
};

// 展开/收起批次明细行
Aoi.orders.toggleBatchDetail = function (id) {
  var el = document.getElementById('batchDetail_' + id);
  if (el) el.classList.toggle('hidden');
};

// 渲染批次列表
Aoi.orders.renderBatches = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('batchTbody');
  if (!tbody) return;
  var list = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  tbody.innerHTML = list.map(function (b) {
    var acts = Aoi.orders.batchActivities(b.id);
    var detailHtml = acts.map(function (a) {
      return '<span class="inline-block bg-gray-100 rounded px-2 py-1 mr-1 mb-1 text-xs">' + Aoi.escapeHtml(a.activity) + ' ×' + a.count + '</span>';
    }).join('') || '<span class="text-xs text-gray-400">暂无活动</span>';
    var label = Aoi.orders.batchLabel(b);
    var sub = (b.name && b.name !== b.date) ? '<div class="text-xs text-gray-400">' + Aoi.escapeHtml(b.date) + '</div>' : '';
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(label) + sub + '</td>'
      + '<td class="px-3 py-2 text-right">' + Aoi.orders.batchCount(b.id) + '</td>'
      + '<td class="px-3 py-2 whitespace-nowrap">'
      + '<button class="text-blue-500 hover:underline mr-3" onclick="Aoi.orders.addToBatch(\'' + b.id + '\')">选货</button>'
      + '<button class="text-gray-500 hover:underline mr-3" onclick="Aoi.orders.toggleBatchDetail(\'' + b.id + '\')">展开</button>'
      + '<button class="text-gray-500 hover:underline mr-3" onclick="Aoi.orders.renameBatch(\'' + b.id + '\')">改名</button>'
      + '<button class="text-red-500 hover:underline" onclick="Aoi.orders.deleteBatch(\'' + b.id + '\')">删除</button>'
      + '</td></tr>'
      + '<tr id="batchDetail_' + b.id + '" class="hidden"><td colspan="3" class="px-3 py-2 bg-gray-50 text-sm">' + detailHtml + '</td></tr>';
  }).join('');
};

// 刷新批次下拉（筛选 + 标记到货选择器）
Aoi.orders.refillBatches = function () {
  var d = Aoi.orders.ensure();
  var opts = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
    .map(function (b) { return '<option value="' + b.id + '">' + Aoi.escapeHtml(Aoi.orders.batchLabel(b) + '（' + Aoi.orders.batchCount(b.id) + '）') + '</option>'; })
    .join('');

  var sel = document.getElementById('fBatch');
  if (sel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">全部批次</option>' + opts + '<option value="__none__">未分批</option>';
    sel.value = cur;
  }
  var arrive = document.getElementById('arriveBatchSel');
  if (arrive) {
    arrive.innerHTML = '<option value="">标记到货：选择批次…</option>' + opts + '<option value="__new__">+ 新建批次（按日期）</option>';
  }
};

// 统一刷新所有批次下拉（订单筛选/标记到货/国际计算/审批/发货/通知）
Aoi.orders.refillAllBatchSelects = function () {
  Aoi.orders.refillBatches();
  Aoi.intl.refillBatches();
  Aoi.approval.refillBatches();
  Aoi.ship.refillBatches();
  if (Aoi.notify && Aoi.notify.refillBatches) Aoi.notify.refillBatches();
};

// —— 渲染 ——

Aoi.orders.statusBadge = function (status) {
  var s = status || '未到货';
  var cls = s === '已到货' ? 'text-green-600' : 'text-gray-400';
  return '<span class="' + cls + '">' + Aoi.escapeHtml(s) + '</span>';
};

// 渲染订单表 + 筛选 + 勾选
Aoi.orders.render = function () {
  var d = Aoi.orders.ensure();
  Aoi.orders.refillActivities();

  var buyerFilter = (document.getElementById('fBuyer') || {}).value || '';
  var actFilter = (document.getElementById('fActivity') || {}).value || '';
  var batchFilter = (document.getElementById('fBatch') || {}).value || '';

  var rows = d.orders.filter(function (o) {
    if (buyerFilter && o.buyer.indexOf(buyerFilter) < 0) return false;
    if (actFilter && o.activity !== actFilter) return false;
    if (batchFilter === '__none__') { if (o.batchId) return false; }
    else if (batchFilter) { if (o.batchId !== batchFilter) return false; }
    return true;
  });

  var tbody = document.getElementById('orderTbody');
  var total = 0;
  tbody.innerHTML = rows.map(function (o, i) {
    var sum = o.price * o.count;
    total += sum;
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-2 py-2"><input type="checkbox" class="row-check" data-id="' + o.id + '"></td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.activity) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.type) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.model) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.price.toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.count + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.buyer) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.orders.statusBadge(o.status) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.batchId ? Aoi.orders.batchDate(o.batchId) : '—') + '</td>'
      + '<td class="px-3 py-2 text-right">' + sum.toFixed(2) + '</td>'
      + '</tr>';
  }).join('');

  var stat = document.getElementById('orderStat');
  if (stat) stat.textContent = '共 ' + rows.length + ' 条，合计 ¥' + total.toFixed(2);
};

// —— 批量操作 ——

Aoi.orders.selectedIds = function () {
  return Array.prototype.map.call(document.querySelectorAll('.row-check:checked'), function (c) { return c.getAttribute('data-id'); });
};

Aoi.orders.toggleAll = function (checkbox) {
  document.querySelectorAll('.row-check').forEach(function (c) { c.checked = checkbox.checked; });
};

// 切换「新建批次」时的日期输入框显隐
Aoi.orders.onBatchSel = function (sel) {
  var dateInput = document.getElementById('arriveDate');
  if (dateInput) dateInput.classList.toggle('hidden', sel.value !== '__new__');
};

// 标记到货：指定批次（按日期）
Aoi.orders.markArrived = async function () {
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var sel = document.getElementById('arriveBatchSel');
  var batchId;
  if (sel.value === '__new__') {
    var date = document.getElementById('arriveDate').value;
    if (!date) { Aoi.toast('请选择到货日期', 'warning'); return; }
    batchId = Aoi.orders.ensureBatch(date);
  } else if (sel.value) {
    batchId = sel.value;
  } else {
    Aoi.toast('请选择批次或新建批次', 'warning'); return;
  }
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  d.orders.forEach(function (o) { if (idSet[o.id]) { o.status = '已到货'; o.batchId = batchId; } });
  await Aoi.saveTeamData(d);
  Aoi.orders.render();
  Aoi.orders.refillAllBatchSelects();
  Aoi.orders.renderBatches();
  Aoi.toast('已标记 ' + ids.length + ' 条到货', 'success');
};

// 设为未到货（清空批次）
Aoi.orders.markUnarrived = async function () {
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  d.orders.forEach(function (o) { if (idSet[o.id]) { o.status = '未到货'; o.batchId = null; } });
  await Aoi.saveTeamData(d);
  Aoi.orders.render();
  Aoi.orders.refillAllBatchSelects();
  Aoi.toast('已设为未到货', 'success');
};

Aoi.orders.batchDelete = async function () {
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  if (!(await Aoi.confirm('确定删除选中的 ' + ids.length + ' 条订单？'))) return;
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  Aoi.undo.arm('删除 ' + ids.length + ' 条订单', d);
  d.orders = d.orders.filter(function (o) { return !idSet[o.id]; });
  await Aoi.saveTeamData(d);
  Aoi.orders.render();
  Aoi.orders.refillAllBatchSelects();
  Aoi.toast('已删除 ' + ids.length + ' 条', 'success');
};

// —— 周边 ——

Aoi.orders.renderProducts = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('productTbody');
  if (!tbody) return;
  tbody.innerHTML = d.products.map(function (p, i) {
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(p.type + '-' + p.model) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(p.ip) + '</td>'
      + '<td class="px-3 py-2 text-right">' + p.price.toFixed(2) + '</td>'
      + '<td class="px-3 py-2"><button class="text-red-500 hover:underline" onclick="Aoi.orders.removeProduct(\'' + p.id + '\')">删</button></td>'
      + '</tr>';
  }).join('');
};

Aoi.orders.removeProduct = async function (id) {
  var d = Aoi.orders.ensure();
  Aoi.undo.arm('删除周边', d);
  d.products = d.products.filter(function (p) { return p.id !== id; });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderProducts();
};

// 刷新活动下拉（去重）
Aoi.orders.refillActivities = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('fActivity');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">全部活动</option>'
    + d.activities.map(function (a) { return '<option>' + Aoi.escapeHtml(a) + '</option>'; }).join('');
  sel.value = cur;
};

// —— 活动管理：购买时间 / 出货日期 / 平台链接 / 进度状态 ——

Aoi.orders.ACTIVITY_STATUSES = ['未开始', '进行中', '已下单', '已出货', '已完成'];

Aoi.orders.activityStatusOptions = function (cur) {
  return Aoi.orders.ACTIVITY_STATUSES.map(function (s) {
    return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s + '</option>';
  }).join('');
};

Aoi.orders.renderActivities = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('activityTbody');
  if (!tbody) return;
  tbody.innerHTML = d.activities.length ? d.activities.map(function (name, i) {
    var m = d.activityMeta[name] || {};
    return '<tr class="border-b border-gray-100">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 font-semibold whitespace-nowrap"><button data-jump="' + Aoi.escapeHtml(name) + '" class="text-blue-600 hover:underline text-left">' + Aoi.escapeHtml(name) + '</button></td>'
      + '<td class="px-3 py-2"><select data-activity="' + Aoi.escapeHtml(name) + '" data-field="ip" class="border border-gray-300 rounded px-2 py-1 text-sm">' + Aoi.orders.ipOptions(m.ip) + '</select></td>'
      + '<td class="px-3 py-2"><input type="date" value="' + Aoi.escapeHtml(m.buyDate || '') + '" data-activity="' + Aoi.escapeHtml(name) + '" data-field="buyDate" class="border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td class="px-3 py-2"><input type="date" value="' + Aoi.escapeHtml(m.shipDate || '') + '" data-activity="' + Aoi.escapeHtml(name) + '" data-field="shipDate" class="border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td class="px-3 py-2"><input type="text" value="' + Aoi.escapeHtml(m.link || '') + '" placeholder="平台链接" data-activity="' + Aoi.escapeHtml(name) + '" data-field="link" class="border border-gray-300 rounded px-2 py-1 text-sm w-40"></td>'
      + '<td class="px-3 py-2"><select data-activity="' + Aoi.escapeHtml(name) + '" data-field="status" class="border border-gray-300 rounded px-2 py-1 text-sm">' + Aoi.orders.activityStatusOptions(m.status) + '</select></td>'
      + '<td class="px-3 py-2"><button data-remove="' + Aoi.escapeHtml(name) + '" class="text-red-500 hover:underline">删</button></td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="8" class="px-3 py-2 text-gray-400">暂无活动，录入订单或手动新增</td></tr>';
  Aoi.orders.renderBuyers();
};

Aoi.orders.addActivity = async function () {
  var el = document.getElementById('newActivity');
  var name = el.value.trim();
  if (!name) { Aoi.toast('请输入活动名称', 'warning'); return; }
  var ipEl = document.getElementById('newActivityIp');
  var ip = ipEl ? ipEl.value.trim() : '';
  var d = Aoi.orders.ensure();
  if (d.activities.indexOf(name) >= 0) { Aoi.toast('该活动已存在', 'warning'); return; }
  d.activities.push(name);
  d.activityMeta[name] = { buyDate: '', shipDate: '', link: '', status: '未开始', ip: ip };
  await Aoi.saveTeamData(d);
  el.value = '';
  Aoi.orders.renderActivities();
  Aoi.orders.refillDatalists();
  Aoi.orders.refillActivities();
  Aoi.toast('已新增活动 ' + name, 'success');
};

Aoi.orders.removeActivity = async function (name) {
  if (!(await Aoi.confirm('确定删除活动「' + name + '」？相关订单将变为「无活动」'))) return;
  var d = Aoi.orders.ensure();
  Aoi.undo.arm('删除活动', d);
  var affected = {};
  d.orders.forEach(function (o) { if (o.activity === name && o.buyer) affected[o.buyer] = 1; });
  d.activities = d.activities.filter(function (a) { return a !== name; });
  delete d.activityMeta[name];
  d.orders.forEach(function (o) { if (o.activity === name) o.activity = ''; });
  // 级联清理：受影响买家若无未处理完订单，一并删除其 CN
  var purged = [];
  Object.keys(affected).forEach(function (buyer) {
    if (Aoi.orders.buyerUnfinished(d, buyer) === 0) { Aoi.orders.purgeBuyer(d, buyer); purged.push(buyer); }
  });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderActivities();
  Aoi.orders.refillDatalists();
  Aoi.orders.refillActivities();
  Aoi.orders.render();
  Aoi.toast(purged.length ? '已删除活动，并清理 ' + purged.length + ' 位无待处理订单的买家' : '已删除活动', 'success');
};

// 跳转到订单管理并按活动筛选
Aoi.orders.jumpToActivity = function (name) {
  Aoi.nav('view-orders');
  Aoi.orders.refillActivities();
  var f = document.getElementById('fActivity');
  if (f) f.value = name;
  Aoi.orders.render();
};

// 删除 IP：清除其在订单/周边/活动/IP 列表/常用类型中的关联
Aoi.orders.removeIp = async function (ip) {
  if (!(await Aoi.confirm('确定删除 IP「' + ip + '」？相关订单/周边/活动将变为「未分类」'))) return;
  var d = Aoi.orders.ensure();
  Aoi.undo.arm('删除 IP', d);
  d.ips = d.ips.filter(function (x) { return x !== ip; });
  d.orders.forEach(function (o) { if (o.ip === ip) o.ip = ''; });
  d.products.forEach(function (p) { if (p.ip === ip) p.ip = ''; });
  Object.keys(d.activityMeta).forEach(function (a) { if (d.activityMeta[a].ip === ip) d.activityMeta[a].ip = ''; });
  delete d.ipTypes[ip];
  await Aoi.saveTeamData(d);
  Aoi.overview.render();
  Aoi.orders.refillDatalists();
  Aoi.orders.renderActivities();
  Aoi.toast('已删除 IP「' + ip + '」', 'success');
};

// —— 买家（CN）管理 ——

// 订单是否已处理完（已到货且已发货）
Aoi.orders.isOrderDone = function (o) {
  return (o.status || '未到货') === '已到货' && (o.shipped || '未发') === '已发';
};

// 收集去重买家（CN）
Aoi.orders.collectBuyers = function (d) {
  var set = {};
  (d.orders || []).forEach(function (o) { if (o.buyer) set[o.buyer] = 1; });
  return Object.keys(set).sort();
};

// 某买家未处理完的订单数
Aoi.orders.buyerUnfinished = function (d, buyer) {
  return (d.orders || []).filter(function (o) { return o.buyer === buyer && !Aoi.orders.isOrderDone(o); }).length;
};

// 清除买家在所有数据里的引用（不保存）
Aoi.orders.purgeBuyer = function (d, buyer) {
  d.orders = (d.orders || []).filter(function (o) { return o.buyer !== buyer; });
  ['payments', 'notifications', 'transfers'].forEach(function (k) {
    if (Array.isArray(d[k])) d[k] = d[k].filter(function (x) { return x.buyer !== buyer; });
  });
  if (d.addresses && d.addresses[buyer]) delete d.addresses[buyer];
  if (d.memberMeta && d.memberMeta[buyer]) delete d.memberMeta[buyer];
};

// 渲染买家（CN）列表
Aoi.orders.renderBuyers = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('buyerTbody');
  if (!tbody) return;
  var buyers = Aoi.orders.collectBuyers(d);
  tbody.innerHTML = buyers.length ? buyers.map(function (buyer, i) {
    var total = (d.orders || []).filter(function (o) { return o.buyer === buyer; }).length;
    var unfinished = Aoi.orders.buyerUnfinished(d, buyer);
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 font-medium">' + Aoi.escapeHtml(buyer) + '</td>'
      + '<td class="px-3 py-2 text-right text-gray-400">' + total + '</td>'
      + '<td class="px-3 py-2 text-right ' + (unfinished ? 'text-amber-500' : 'text-green-600') + '">' + unfinished + '</td>'
      + '<td class="px-3 py-2 text-right"><button data-del-buyer="' + Aoi.escapeHtml(buyer) + '" class="text-red-500 hover:underline">删</button></td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">暂无买家</td></tr>';
};

// 手动删除买家（CN）
Aoi.orders.removeBuyer = async function (buyer) {
  var d = Aoi.approval.ensure();
  var total = (d.orders || []).filter(function (o) { return o.buyer === buyer; }).length;
  var unfinished = Aoi.orders.buyerUnfinished(d, buyer);
  var warn = unfinished > 0 ? '\n⚠️ 该买家仍有 ' + unfinished + ' 条未处理完的订单！' : '';
  if (!(await Aoi.confirm('确定删除买家「' + buyer + '」？将删除其 ' + total + ' 条订单及交费/地址/通知等记录' + warn, { title: '删除买家', okText: '删除', danger: true }))) return;
  Aoi.undo.arm('删除买家', d);
  Aoi.orders.purgeBuyer(d, buyer);
  await Aoi.saveTeamData(d);
  Aoi.orders.render();
  Aoi.orders.renderBuyers();
  Aoi.orders.refillAllBatchSelects();
  Aoi.overview.render();
  Aoi.toast('已删除买家「' + buyer + '」', 'success');
};

// —— 改圈名申请审核（团员申请 → 团长同意后全局迁移） ——

Aoi.orders.renderCnChanges = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('cnChangeTbody');
  if (!tbody) return;
  var rows = (d.cnChanges || []).filter(function (c) { return c.status === '待处理'; })
    .slice().sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
  tbody.innerHTML = rows.length ? rows.map(function (c, i) {
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(c.oldCn) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(c.newCn) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(c.qq || '—') + '</td>'
      + '<td class="px-3 py-2 whitespace-nowrap">'
      + '<button data-cnapprove="' + c.id + '" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 mr-1">同意</button>'
      + '<button data-cnreject="' + c.id + '" class="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">驳回</button>'
      + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">暂无改圈名申请</td></tr>';
};

// 把某买家在所有数据里的引用从 oldCn 迁移到 newCn（不保存）
Aoi.orders.migrateBuyer = function (d, oldCn, newCn) {
  d.orders.forEach(function (o) { if (o.buyer === oldCn) o.buyer = newCn; });
  ['payments', 'notifications', 'transfers'].forEach(function (k) {
    if (Array.isArray(d[k])) d[k].forEach(function (x) { if (x.buyer === oldCn) x.buyer = newCn; });
  });
  if (d.addresses && d.addresses[oldCn] != null) { d.addresses[newCn] = d.addresses[oldCn]; delete d.addresses[oldCn]; }
  if (d.memberMeta && d.memberMeta[oldCn]) { d.memberMeta[newCn] = d.memberMeta[oldCn]; delete d.memberMeta[oldCn]; }
};

Aoi.orders.approveCnChange = async function (id) {
  var d = Aoi.orders.ensure();
  var c = null;
  for (var i = 0; i < (d.cnChanges || []).length; i++) if (d.cnChanges[i].id === id) { c = d.cnChanges[i]; break; }
  if (!c) return;
  if (c.newCn !== c.oldCn && Aoi.orders.collectBuyers(d).indexOf(c.newCn) >= 0) {
    Aoi.toast('新圈名「' + c.newCn + '」已存在，无法合并', 'error'); return;
  }
  if (!(await Aoi.confirm('确认将「' + c.oldCn + '」改名为「' + c.newCn + '」？其订单/交费/地址/QQ 绑定将一并迁移', { title: '同意改圈名', okText: '同意', danger: true }))) return;
  c.status = '已同意';
  Aoi.orders.migrateBuyer(d, c.oldCn, c.newCn);
  await Aoi.saveTeamData(d);
  Aoi.orders.renderCnChanges();
  Aoi.orders.renderBuyers();
  Aoi.orders.render();
  Aoi.overview.render();
  Aoi.toast('已改名：' + c.oldCn + ' → ' + c.newCn, 'success');
};

Aoi.orders.rejectCnChange = async function (id) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < (d.cnChanges || []).length; i++) if (d.cnChanges[i].id === id) { d.cnChanges[i].status = '已驳回'; break; }
  await Aoi.saveTeamData(d);
  Aoi.orders.renderCnChanges();
  Aoi.toast('已驳回', 'success');
};

document.getElementById('cnChangeTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-cnapprove')) Aoi.orders.approveCnChange(btn.getAttribute('data-cnapprove'));
  else if (btn.hasAttribute('data-cnreject')) Aoi.orders.rejectCnChange(btn.getAttribute('data-cnreject'));
});

Aoi.orders.setActivityField = async function (name, field, value) {
  var d = Aoi.orders.ensure();
  if (!d.activityMeta[name]) d.activityMeta[name] = {};
  d.activityMeta[name][field] = value;
  await Aoi.saveTeamData(d);
};

// 事件委托：活动字段即时保存 / 删除
document.getElementById('activityTbody').addEventListener('change', function (e) {
  var el = e.target;
  if (!el.hasAttribute('data-activity')) return;
  Aoi.orders.setActivityField(el.getAttribute('data-activity'), el.getAttribute('data-field'), el.value);
});
document.getElementById('activityTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-remove]');
  if (btn) { Aoi.orders.removeActivity(btn.getAttribute('data-remove')); return; }
  var jump = e.target.closest('button[data-jump]');
  if (jump) Aoi.orders.jumpToActivity(jump.getAttribute('data-jump'));
});
document.getElementById('buyerTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-del-buyer]');
  if (btn) Aoi.orders.removeBuyer(btn.getAttribute('data-del-buyer'));
});

// —— 分级选择：IP → 活动（按 IP 过滤）、类型（线路分组 + 搜索） ——

Aoi.orders.ROUTES = ['常规二次元线路', '一般线路发送', '大件类', '名贵类', '未分类'];

Aoi.orders.ipOptions = function (cur) {
  var d = Aoi.orders.ensure();
  var ips = Aoi.orders.collectIps(d);
  if (cur && ips.indexOf(cur) < 0) ips.push(cur);
  return '<option value="">（未分类）</option>' + ips.map(function (ip) {
    return '<option value="' + Aoi.escapeHtml(ip) + '"' + (ip === cur ? ' selected' : '') + '>' + Aoi.escapeHtml(ip) + '</option>';
  }).join('');
};

Aoi.orders.activitiesByIp = function (ip) {
  var d = Aoi.orders.ensure();
  return d.activities.filter(function (a) {
    var m = d.activityMeta[a] || {};
    return (m.ip || '') === ip;
  });
};

// IP 常用类型优先，其余兜底
Aoi.orders.typesByIp = function (ip) {
  var d = Aoi.orders.ensure();
  var all = Object.keys(d.typeMeta);
  var common = (d.ipTypes && d.ipTypes[ip]) || [];
  var seen = {}, result = [];
  common.forEach(function (t) { if (d.typeMeta[t] && !seen[t]) { seen[t] = 1; result.push(t); } });
  all.forEach(function (t) { if (!seen[t]) result.push(t); });
  return result;
};

Aoi.orders.typeRoute = function (type) {
  var d = Aoi.orders.ensure();
  var m = d.typeMeta[type];
  return (m && m.route) ? m.route : '未分类';
};

// IP 输入变化 → 刷新活动 select + 类型面板
Aoi.orders.onIpChange = function (ipId) {
  var typeId = ipId === 'oIp' ? 'oType' : 'pType';
  if (ipId === 'oIp') Aoi.orders.refillActivitySelect();
  var panel = document.getElementById(typeId + 'Panel');
  if (panel && !panel.classList.contains('hidden')) Aoi.orders.renderTypePanel(typeId);
};

Aoi.orders.refillActivitySelect = function () {
  var ip = (document.getElementById('oIp') || {}).value.trim();
  var dl = document.getElementById('oActivityOptions');
  if (!dl) return;
  var acts = ip ? Aoi.orders.activitiesByIp(ip) : [];
  dl.innerHTML = acts.map(function (a) {
    return '<option value="' + Aoi.escapeHtml(a) + '">';
  }).join('');
};

// —— 类型选择面板：显式 × 关闭，点空白不关闭 ——

Aoi.orders.toggleTypePanel = function (typeId) {
  var panel = document.getElementById(typeId + 'Panel');
  if (!panel) return;
  if (!panel.classList.contains('hidden')) { Aoi.orders.closeTypePanel(typeId); return; }
  ['oType', 'pType'].forEach(function (id) { if (id !== typeId) Aoi.orders.closeTypePanel(id); });
  Aoi.orders.renderTypePanel(typeId);
  panel.classList.remove('hidden');
};

Aoi.orders.closeTypePanel = function (typeId) {
  var panel = document.getElementById(typeId + 'Panel');
  if (panel) panel.classList.add('hidden');
};

Aoi.orders.filterTypePanel = function (typeId) {
  Aoi.orders.renderTypePanel(typeId);
};

Aoi.orders.renderTypePanel = function (typeId) {
  var list = document.getElementById(typeId + 'List');
  if (!list) return;
  var ipId = typeId === 'oType' ? 'oIp' : 'pIp';
  var ip = (document.getElementById(ipId) || {}).value.trim();
  var kwEl = document.getElementById(typeId + 'Search');
  var kw = kwEl ? kwEl.value.trim().toLowerCase() : '';
  var types = ip ? Aoi.orders.typesByIp(ip) : Object.keys(Aoi.orders.ensure().typeMeta);
  if (kw) types = types.filter(function (t) { return t.toLowerCase().indexOf(kw) >= 0; });
  var groups = {};
  types.forEach(function (t) { var r = Aoi.orders.typeRoute(t); if (!groups[r]) groups[r] = []; groups[r].push(t); });
  var html = '';
  Aoi.orders.ROUTES.forEach(function (route, idx) {
    if (!groups[route] || !groups[route].length) return;
    html += '<div class="text-xs font-bold text-gray-400 px-2 mt-2 mb-1 cursor-pointer select-none" onclick="Aoi.orders.toggleTypeGroup(\'' + typeId + '\',' + idx + ')">▾ ' + Aoi.escapeHtml(route) + '</div>';
    html += '<div id="typeGroup_' + typeId + '_' + idx + '" class="flex flex-wrap gap-1 px-2">';
    groups[route].forEach(function (t) {
      html += '<button class="px-2 py-1 bg-gray-100 hover:bg-blue-100 rounded text-sm" data-input="' + typeId + '" data-type="' + Aoi.escapeHtml(t) + '">' + Aoi.escapeHtml(t) + '</button>';
    });
    html += '</div>';
  });
  list.innerHTML = html || '<div class="px-2 py-2 text-sm text-gray-400">无匹配类型</div>';
};

// 折叠/展开类型面板的某一大类（按线路分组）
Aoi.orders.toggleTypeGroup = function (typeId, idx) {
  var el = document.getElementById('typeGroup_' + typeId + '_' + idx);
  if (el) el.classList.toggle('hidden');
};

// 事件委托：点类型 chip → 填入 input 并关闭
document.addEventListener('click', function (e) {
  var chip = e.target.closest('button[data-type]');
  if (!chip) return;
  var input = document.getElementById(chip.getAttribute('data-input'));
  if (input) input.value = chip.getAttribute('data-type');
  Aoi.orders.closeTypePanel(chip.getAttribute('data-input'));
});

// —— 类型管理：线路标签 + 按 IP 常用类型 ——

Aoi.orders.routeOptions = function (cur) {
  return Aoi.orders.ROUTES.map(function (r) {
    return '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + r + '</option>';
  }).join('');
};

Aoi.orders.renderTypes = function () {
  var d = Aoi.orders.ensure();
  var kwEl = document.getElementById('typeSearch');
  var kw = kwEl ? kwEl.value.trim().toLowerCase() : '';
  var types = Object.keys(d.typeMeta);
  if (kw) types = types.filter(function (t) {
    return t.toLowerCase().indexOf(kw) >= 0 || Aoi.orders.typeRoute(t).toLowerCase().indexOf(kw) >= 0;
  });

  var groups = {};
  types.forEach(function (t) { var r = Aoi.orders.typeRoute(t); if (!groups[r]) groups[r] = []; groups[r].push(t); });

  var box = document.getElementById('typeGroups');
  if (box) {
    var html = '';
    var idx = 0;
    Aoi.orders.ROUTES.forEach(function (route) {
      var list = groups[route];
      if (!list || !list.length) return;
      html += '<div class="mt-3"><div class="flex items-center gap-1 text-xs font-bold text-gray-500 cursor-pointer select-none" data-tgroup="' + idx + '">▾ ' + Aoi.escapeHtml(route) + ' <span class="text-gray-300">(' + list.length + ')</span></div>';
      html += '<div id="typeGroup_' + idx + '" class="mt-1 border border-gray-100 rounded divide-y divide-gray-100">';
      list.forEach(function (t) {
        var m = d.typeMeta[t];
        html += '<div class="flex items-center justify-between px-3 py-2">'
          + '<span class="text-sm font-semibold">' + Aoi.escapeHtml(t) + '</span>'
          + '<div class="flex items-center gap-2">'
          + '<select data-type="' + Aoi.escapeHtml(t) + '" data-field="route" class="border border-gray-300 rounded px-2 py-1 text-xs">' + Aoi.orders.routeOptions(m.route) + '</select>'
          + '<button data-remove-type="' + Aoi.escapeHtml(t) + '" class="text-red-500 hover:underline text-xs">删</button>'
          + '</div></div>';
      });
      html += '</div></div>';
      idx++;
    });
    box.innerHTML = html || '<div class="text-sm text-gray-400 py-2">无匹配类型</div>';
  }
  var ipSel = document.getElementById('typeIpSel');
  if (ipSel) {
    var ips = Aoi.orders.collectIps(d);
    var cur = ipSel.value;
    ipSel.innerHTML = '<option value="">选择 IP…</option>' + ips.map(function (ip) {
      return '<option value="' + Aoi.escapeHtml(ip) + '">' + Aoi.escapeHtml(ip) + '</option>';
    }).join('');
    if (cur && ips.indexOf(cur) >= 0) ipSel.value = cur;
  }
  Aoi.orders.renderTypeIp();
};

Aoi.orders.renderTypeIp = function () {
  var ip = document.getElementById('typeIpSel').value;
  var box = document.getElementById('typeIpBox');
  if (!box) return;
  if (!ip) { box.innerHTML = '<div class="text-gray-400 text-sm">先选择 IP</div>'; return; }
  var kwEl = document.getElementById('typeIpSearch');
  var kw = kwEl ? kwEl.value.trim().toLowerCase() : '';
  var d = Aoi.orders.ensure();
  var common = d.ipTypes[ip] || [];
  var set = {}; common.forEach(function (t) { set[t] = 1; });
  var types = Object.keys(d.typeMeta);
  if (kw) types = types.filter(function (t) { return t.toLowerCase().indexOf(kw) >= 0; });
  box.innerHTML = types.map(function (t) {
    var on = set[t] ? ' checked' : '';
    return '<label class="inline-flex items-center gap-1 mr-3 mb-2 text-sm cursor-pointer"><input type="checkbox" data-iptype="' + Aoi.escapeHtml(t) + '"' + on + '>' + Aoi.escapeHtml(t) + '</label>';
  }).join('') || '<div class="text-gray-400 text-sm">无匹配类型</div>';
};

// 按关键词过滤常用类型勾选
Aoi.orders.filterTypeIp = function () {
  Aoi.orders.renderTypeIp();
};

Aoi.orders.toggleTypeIp = async function (type) {
  var ip = document.getElementById('typeIpSel').value;
  if (!ip) return;
  var d = Aoi.orders.ensure();
  if (!d.ipTypes[ip]) d.ipTypes[ip] = [];
  var i = d.ipTypes[ip].indexOf(type);
  if (i >= 0) d.ipTypes[ip].splice(i, 1); else d.ipTypes[ip].push(type);
  await Aoi.saveTeamData(d);
};

Aoi.orders.addType = async function () {
  var nameEl = document.getElementById('newType');
  var name = nameEl.value.trim();
  var route = document.getElementById('newTypeRoute').value;
  if (!name) { Aoi.toast('请输入类型名称', 'warning'); return; }
  var d = Aoi.orders.ensure();
  if (d.typeMeta[name]) { Aoi.toast('该类型已存在', 'warning'); return; }
  d.typeMeta[name] = { route: route };
  await Aoi.saveTeamData(d);
  nameEl.value = '';
  Aoi.orders.renderTypes();
  Aoi.toast('已新增类型 ' + name, 'success');
};

Aoi.orders.removeType = async function (name) {
  if (!(await Aoi.confirm('确定删除类型「' + name + '」？'))) return;
  var d = Aoi.orders.ensure();
  Aoi.undo.arm('删除类型', d);
  delete d.typeMeta[name];
  Object.keys(d.ipTypes).forEach(function (ip) {
    d.ipTypes[ip] = d.ipTypes[ip].filter(function (t) { return t !== name; });
  });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderTypes();
  Aoi.toast('已删除类型', 'success');
};

Aoi.orders.setTypeRoute = async function (name, route) {
  var d = Aoi.orders.ensure();
  if (!d.typeMeta[name]) return;
  d.typeMeta[name].route = route;
  await Aoi.saveTeamData(d);
};

// 事件委托：类型字段即时保存 / 删除 / 分组折叠 / 常用类型勾选
document.getElementById('typeGroups').addEventListener('change', function (e) {
  var el = e.target;
  if (!el.hasAttribute('data-type')) return;
  Aoi.orders.setTypeRoute(el.getAttribute('data-type'), el.value);
});
document.getElementById('typeGroups').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-remove-type]');
  if (btn) { Aoi.orders.removeType(btn.getAttribute('data-remove-type')); return; }
  var grp = e.target.closest('[data-tgroup]');
  if (grp) {
    var g = document.getElementById('typeGroup_' + grp.getAttribute('data-tgroup'));
    if (g) g.classList.toggle('hidden');
  }
});
document.getElementById('typeIpBox').addEventListener('change', function (e) {
  var el = e.target;
  if (!el.hasAttribute('data-iptype')) return;
  Aoi.orders.toggleTypeIp(el.getAttribute('data-iptype'));
});
