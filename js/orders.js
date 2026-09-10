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
  // v3.7.0 F9 接口预留：PCO 商品目录（aoi-pco-monitor 直写 / 书签脚本导入的目标结构，本期无 UI）
  if (!Array.isArray(d.pcoItems)) d.pcoItems = [];
  // v1.8.0 迁移：外币原价 / 币种 / 备注（旧数据视为人民币已换算）
  d.orders.forEach(function (o) {
    if (o.currency == null) o.currency = 'cny';
    if (o.remark == null) o.remark = '';
  });
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

// 刷新 datalist（IP；活动下拉按 IP 过滤，由 refillActivitySelect 负责；登记商品页活动候选）
Aoi.orders.refillDatalists = function () {
  var d = Aoi.orders.ensure();
  var ipList = document.getElementById('ipOptions');
  if (ipList) ipList.innerHTML = Aoi.orders.collectIps(d)
    .map(function (ip) { return '<option value="' + Aoi.escapeHtml(ip) + '">'; }).join('');
  var pAct = document.getElementById('pActivityOptions');
  if (pAct) pAct.innerHTML = d.activities
    .map(function (a) { return '<option value="' + Aoi.escapeHtml(a) + '">'; }).join('');
};

// —— 导入 ——

// 导入文件：解析 → 识别活动/IP → 弹窗确认
Aoi.orders.importFile = async function (file) {
  var buf = await file.arrayBuffer();
  var records = Aoi.import.parse(buf, file.name);
  if (!records.length) { Aoi.toast('未识别到订单数据', 'warning'); return; }
  Aoi.orders.openImportModal(records);
};

// 从链接导入：排谷表/汇总表分享直链 → 拉取 → 复用文件导入的确认弹窗
Aoi.orders.importFromUrl = async function () {
  var url = (document.getElementById('importUrl').value || '').trim();
  if (!url) { Aoi.toast('请先粘贴表格链接', 'warning'); return; }
  Aoi.toast('正在拉取表格…', 'info');
  var got = await Aoi.import.fetchFromUrl(url);
  if (got.error) { Aoi.toast(got.error, 'error'); return; }
  var records;
  try { records = Aoi.import.parse(got.buffer, got.fileName); }
  catch (e) { Aoi.toast('表格解析失败，请确认链接指向的是排谷表/汇总表文件', 'error'); return; }
  if (!records.length) { Aoi.toast('未识别到订单数据', 'warning'); return; }
  Aoi.orders.openImportModal(records);
};

// 填充并打开导入确认弹窗（文件导入 / 链接导入共用）
Aoi.orders.openImportModal = function (records) {
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

// 通用外币预览（周边预建商品表单仍在用；订单表单走下方 previewEntry 双模式）
Aoi.orders.previewRmb = function (priceId, currencyId, outId) {
  var price = parseFloat(document.getElementById(priceId).value);
  var currency = document.getElementById(currencyId).value;
  var out = document.getElementById(outId);
  if (!out) return;
  if (isNaN(price)) { out.textContent = ''; return; }
  out.textContent = '= ¥' + Aoi.calc.toRmb(price, currency).toFixed(2);
};

// 录入页：币种变化 → 切换人民币/外币两种录入形态（v1.8.0 取消自动转换）
Aoi.orders.onEntryCurrencyChange = function () {
  var currency = document.getElementById('oCurrency').value;
  var foreign = currency !== 'cny';
  ['oPriceModes', 'oPriceRmbWrap'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !foreign);
  });
  var price = document.getElementById('oPrice');
  if (price) price.placeholder = foreign ? '外币价格' : '价格（人民币）';
  if (!foreign) {
    var rmb = document.getElementById('oPriceRmb');
    if (rmb) rmb.value = '';
    var prev = document.getElementById('oPricePreview');
    if (prev) prev.textContent = '';
  }
  Aoi.orders.previewEntry();
};

// 录入页：外币模式下切换「直接输入」/「计算器计算」（计算器模式实时回填人民币价，可再改）
Aoi.orders.onEntryModeChange = function () {
  var mode = (document.querySelector('input[name="oPriceMode"]:checked') || {}).value;
  var rmb = document.getElementById('oPriceRmb');
  if (rmb && mode === 'calc') {
    var price = parseFloat(document.getElementById('oPrice').value);
    var currency = document.getElementById('oCurrency').value;
    rmb.value = isNaN(price) ? '' : Aoi.calc.toRmb(price, currency).toFixed(2);
  }
  Aoi.orders.previewEntry();
};

// 录入页：实时预览（非人民币显示两种模式的说明）
Aoi.orders.previewEntry = function () {
  var out = document.getElementById('oPricePreview');
  if (!out) return;
  var price = parseFloat(document.getElementById('oPrice').value);
  var currency = document.getElementById('oCurrency').value;
  if (currency === 'cny' || isNaN(price)) { out.textContent = ''; return; }
  var mode = (document.querySelector('input[name="oPriceMode"]:checked') || {}).value;
  var rmbEl = document.getElementById('oPriceRmb');
  var rmb = (rmbEl && rmbEl.value !== '') ? parseFloat(rmbEl.value) : Aoi.calc.toRmb(price, currency);
  out.textContent = mode === 'direct'
    ? '原币 ' + price + '（人民币价留空，稍后在订单管理批量生成）'
    : '原币 ' + price + ' = ¥' + (isNaN(rmb) ? '?' : rmb.toFixed(2));
};

// 录入价格解析：返回 { price(人民币价，null=待生成), priceOrig(外币原价) }
Aoi.orders.parseEntryOrder = function (currency, mode, priceForeign, priceRmb) {
  if (currency === 'cny') return { price: priceForeign, priceOrig: null };
  if (mode === 'direct') return { price: null, priceOrig: priceForeign };
  return { price: (priceRmb != null ? priceRmb : Aoi.calc.toRmb(priceForeign, currency)), priceOrig: priceForeign };
};

// 手动新增订单（v1.8.0）：
//  - 购买者 textarea 多行 = 多位用户，同款订单批量生成
//  - 取消录入时自动转换；非人民币两种模式：直接输入外币价（人民币留空）/
//    计算器计算（外币原价 + 人民币价同时入库，人民币可手改）
Aoi.orders.addManual = async function () {
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var ip = get('oIp'), activity = get('oActivity'), type = get('oType'),
      model = get('oModel');
  var currency = document.getElementById('oCurrency').value;
  var modeEl = document.querySelector('input[name="oPriceMode"]:checked');
  var mode = modeEl ? modeEl.value : 'calc';
  var priceForeign = parseFloat(get('oPrice'));
  var rmbRaw = get('oPriceRmb');
  var priceRmb = rmbRaw === '' ? null : parseFloat(rmbRaw);
  var count = parseInt(get('oCount'), 10);
  var buyers = get('oBuyer').split(/\r?\n+/).map(function (s) { return s.trim(); }).filter(Boolean);

  if (!type || !model || isNaN(count) || count <= 0 || !buyers.length) {
    Aoi.toast('请填写制品类型、型号、数量、购买者（每行一个）', 'warning'); return;
  }
  if (isNaN(priceForeign)) { Aoi.toast('请填写价格', 'warning'); return; }
  if (currency !== 'cny' && mode === 'calc' && priceRmb != null && isNaN(priceRmb)) {
    Aoi.toast('人民币价格格式不正确', 'warning'); return;
  }
  var prices = Aoi.orders.parseEntryOrder(currency, mode, priceForeign, priceRmb);

  var d = Aoi.orders.ensure();
  buyers.forEach(function (buyer) {
    d.orders.push({
      id: Aoi.genId(), ip: ip, activity: activity, type: type, model: model,
      price: prices.price, priceOrig: prices.priceOrig, currency: currency,
      count: count, buyer: buyer, remark: '',
      status: '未到货', batchId: null
    });
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
  Aoi.toast('已为 ' + buyers.length + ' 位购买者新增订单' + (prices.price == null ? '（人民币价待批量生成）' : ''), 'success');
};

// 信息录入页：登记活动商品（v3.7.0 S4 统一入活动商品主档 activityMeta[].products，
// 取代旧「预建商品池」d.products 的读写；活动不存在时按名称新建）
Aoi.orders.addProduct = async function () {
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var activity = get('pActivity');
  var ip = get('pIp');
  var currency = document.getElementById('pCurrency').value;
  var price = parseFloat(get('pPrice'));
  var limitRaw = get('pLimit');
  var input = {
    type: get('pType'), model: get('pModel'),
    refImage: get('pImage'), refUrl: get('pUrl'),
    limit: limitRaw === '' ? null : parseInt(limitRaw, 10)
  };
  if (isNaN(price)) { input.price = null; }
  else if (currency === 'cny') { input.price = price; }
  else { input.priceOrig = price; input.currency = currency; input.price = Aoi.calc.toRmb(price, currency); }

  var d = Aoi.orders.ensure();
  if (activity && d.activities.indexOf(activity) < 0) d.activities.push(activity);
  if (activity && ip) {
    if (!d.activityMeta[activity]) d.activityMeta[activity] = {};
    if (!d.activityMeta[activity].ip) d.activityMeta[activity].ip = ip;
    if (ip && d.ips.indexOf(ip) < 0) d.ips.push(ip);
  }
  var p = await Aoi.orders.registerProduct(activity, input);
  if (!p) return;
  ['pModel', 'pPrice', 'pLimit', 'pImage', 'pUrl'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  Aoi.orders.refillDatalists();
  Aoi.orders.renderActivities();
  Aoi.toast('已登记商品 ' + p.type + '-' + p.model + '（' + activity + '）', 'success');
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

// 通用批次下拉填充（intl/approval/ship/notify 共用；按日期排序 + 恢复当前选中值）
Aoi.orders.refillBatchSelect = function (sel, placeholder) {
  if (!sel) return;
  var d = Aoi.orders.ensure();
  var cur = sel.value;
  var list = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  sel.innerHTML = '<option value="">' + (placeholder || '选择批次…') + '</option>' + list.map(function (b) {
    return '<option value="' + b.id + '">' + Aoi.escapeHtml(Aoi.orders.batchLabel(b) + '（' + Aoi.orders.batchCount(b.id) + '）') + '</option>';
  }).join('');
  if (cur && d.batches.some(function (b) { return b.id === cur; })) sel.value = cur;
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

// 组合状态（v3.6.0 S1）：到货 × 发货 × 收货 → 四态徽标（未到货灰 / 待发货琥珀 / 已发货绿 / 已收货深绿）
Aoi.orders.combinedStatus = function (o) {
  var arrived = (o.status || '未到货') === '已到货';
  if (!arrived) return { text: '未到货', cls: 'text-gray-400' };
  if ((o.shipped || '未发') !== '已发') return { text: '已到货·待发货', cls: 'text-amber-500' };
  return o.received
    ? { text: '已收货', cls: 'text-green-700 font-semibold' }
    : { text: '已发货', cls: 'text-green-600' };
};

Aoi.orders.statusBadge = function (o) {
  var s = Aoi.orders.combinedStatus(o);
  return '<span class="' + s.cls + '">' + Aoi.escapeHtml(s.text) + '</span>';
};

// 人民币价显示：未生成（null）时显示占位（v1.8.0 直输外币模式允许人民币价留空）
Aoi.orders.priceText = function (o) {
  return o.price == null ? '<span class="text-amber-500">待生成</span>' : o.price.toFixed(2);
};

// 外币原价显示（人民币单显示 —）
Aoi.orders.origText = function (o) {
  if (o.currency === 'cny' || o.priceOrig == null) return '—';
  var sym = Aoi.currencySymbol(o.currency);
  return sym + o.priceOrig;
};

// 备注：点击展开/收起（默认 2 行折叠）
Aoi.orders.toggleRemark = function (el) {
  el.classList.toggle('expanded');
};

// —— 表头排序（v3.6.2）：点击表头循环 不排→升→降；只作用于渲染副本，不写回 blob ——

var ORDERS_SORT_KEY = 'aoi_orders_sort';

// 中文/混合文本排序单例（zh 拼音序）；无 Intl.Collator 环境回退码点比较
Aoi.orders.collator = (typeof Intl !== 'undefined' && Intl.Collator)
  ? new Intl.Collator('zh-Hans-CN', { numeric: true }) : null;

// 到货状态生命周期阶段序（复用 combinedStatus 四态）
Aoi.orders.STATUS_STAGE = { '未到货': 0, '已到货·待发货': 1, '已发货': 2, '已收货': 3 };
Aoi.orders.statusStage = function (o) {
  return Aoi.orders.STATUS_STAGE[Aoi.orders.combinedStatus(o).text] || 0;
};

// 可排序字段：label 备用，get 取排序值（null/'' 视为空值恒排最后）
Aoi.orders.SORT_FIELDS = {
  activity: { label: '活动', get: function (o) { return o.activity || ''; } },
  type:     { label: '制品类型', get: function (o) { return o.type || ''; } },
  model:    { label: '型号', get: function (o) { return o.model || ''; } },
  price:    { label: '单价', get: function (o) { return o.price; } },
  count:    { label: '数量', get: function (o) { return o.count; } },
  buyer:    { label: '购买者', get: function (o) { return o.buyer || ''; } },
  status:   { label: '到货状态', get: Aoi.orders.statusStage },
  sum:      { label: '小计', get: function (o) { return (o.price != null) ? o.price * o.count : null; } }
};

// 比较器（dir=±1）：空值不受方向影响恒排最后；同值交由稳定排序保持录入序
Aoi.orders.compareBy = function (a, b, field, dir) {
  var f = Aoi.orders.SORT_FIELDS[field];
  if (!f) return 0;
  var va = f.get(a), vb = f.get(b);
  var ea = (va == null || va === ''), eb = (vb == null || vb === '');
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  var r;
  if (typeof va === 'number' && typeof vb === 'number') {
    r = va - vb;
  } else {
    var sa = String(va), sb = String(vb);
    r = Aoi.orders.collator
      ? Aoi.orders.collator.compare(sa, sb)
      : (sa < sb ? -1 : sa > sb ? 1 : 0);
  }
  return r * (dir || 1);
};

// 返回排序后的新数组（slice，保证 d.orders 原序 = blob 录入序不被改动）
Aoi.orders.sortOrders = function (rows, sel) {
  var s = sel || Aoi.orders.sortSel;
  if (!s || !Aoi.orders.SORT_FIELDS[s.field]) return rows;
  return rows.slice().sort(function (a, b) {
    return Aoi.orders.compareBy(a, b, s.field, s.dir);
  });
};

Aoi.orders.loadSort = function () {
  try {
    var s = JSON.parse(localStorage.getItem(ORDERS_SORT_KEY) || 'null');
    if (s && Aoi.orders.SORT_FIELDS[s.field] && (s.dir === 1 || s.dir === -1)) return s;
  } catch (e) {}
  return null;
};
Aoi.orders.saveSort = function (s) {
  try {
    if (s) localStorage.setItem(ORDERS_SORT_KEY, JSON.stringify(s));
    else localStorage.removeItem(ORDERS_SORT_KEY);
  } catch (e) {}
};

// 当前排序 {field, dir} 或 null；启动时从 localStorage 恢复（跨刷新记忆）
Aoi.orders.sortSel = Aoi.orders.loadSort();

// 表头点击：同列循环 升→降→清除；异列直接升序
Aoi.orders.setSort = function (field) {
  if (!Aoi.orders.SORT_FIELDS[field]) return;
  var cur = Aoi.orders.sortSel;
  Aoi.orders.sortSel = (cur && cur.field === field)
    ? (cur.dir === 1 ? { field: field, dir: -1 } : null)
    : { field: field, dir: 1 };
  Aoi.orders.saveSort(Aoi.orders.sortSel);
  Aoi.orders.render();
};

// 移动端排序下拉（窄屏表头被卡片视图隐藏，与表头共享同一状态）
Aoi.orders.onSortMenu = function (el) {
  var v = el.value || '';
  if (!v) Aoi.orders.sortSel = null;
  else {
    var p = v.split(':');
    Aoi.orders.sortSel = { field: p[0], dir: parseInt(p[1], 10) === -1 ? -1 : 1 };
  }
  Aoi.orders.saveSort(Aoi.orders.sortSel);
  Aoi.orders.render();
};

// 表头箭头/高亮 + 下拉选中值与当前排序状态同步
Aoi.orders.syncSortUi = function () {
  var sel = Aoi.orders.sortSel;
  var ths = document.querySelectorAll('#orderTable thead th[data-sort]');
  for (var i = 0; i < ths.length; i++) {
    var th = ths[i];
    var on = !!sel && sel.field === th.getAttribute('data-sort');
    var arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = on ? (sel.dir === 1 ? '↑' : '↓') : '';
    th.classList.toggle('text-gray-800', on);
    th.classList.toggle('font-semibold', on);
  }
  var menu = document.getElementById('fSort');
  if (menu) menu.value = sel ? sel.field + ':' + sel.dir : '';
};

// 渲染订单表 + 筛选 + 排序 + 勾选（v1.8.0：外币原价/备注/编辑列；v3.6.2：表头排序）
Aoi.orders.render = function () {
  var d = Aoi.orders.ensure();
  Aoi.orders.refillActivities();

  var buyerFilter = (document.getElementById('fBuyer') || {}).value || '';
  var actFilter = (document.getElementById('fActivity') || {}).value || '';
  var batchFilter = (document.getElementById('fBatch') || {}).value || '';
  var modelFilter = (document.getElementById('fModel') || {}).value || '';

  var rows = d.orders.filter(function (o) {
    if (buyerFilter && o.buyer.indexOf(buyerFilter) < 0) return false;
    if (actFilter && o.activity !== actFilter) return false;
    if (modelFilter && (o.model || '').indexOf(modelFilter) < 0) return false;
    if (batchFilter === '__none__') { if (o.batchId) return false; }
    else if (batchFilter) { if (o.batchId !== batchFilter) return false; }
    return true;
  });
  rows = Aoi.orders.sortOrders(rows); // v3.6.2 表头排序（渲染副本，不写回）

  var tbody = document.getElementById('orderTbody');
  var total = 0, pending = 0;
  tbody.innerHTML = rows.map(function (o, i) {
    var sum = (o.price != null) ? o.price * o.count : 0;
    if (o.price != null) total += sum; else pending++;
    return '<tr class="border-b border-gray-100 hover:bg-gray-50 align-top">'
      + '<td data-label="行号" class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td data-label="选择" class="px-2 py-2"><input type="checkbox" class="row-check" data-id="' + o.id + '"></td>'
      + '<td data-label="活动" class="px-3 py-2 wrap" title="' + Aoi.escapeHtml(o.activity || '—') + '">' + Aoi.escapeHtml(o.activity || '—') + '</td>'
      + '<td data-label="制品类型" class="px-3 py-2 wrap" title="' + Aoi.escapeHtml(o.type) + '">' + Aoi.escapeHtml(o.type) + '</td>'
      + '<td data-label="型号" class="px-3 py-2 wrap" title="' + Aoi.escapeHtml(o.model) + '">' + Aoi.escapeHtml(o.model) + '</td>'
      + '<td data-label="单价(¥)" class="px-3 py-2 text-right wrap">' + Aoi.orders.priceText(o) + '</td>'
      + '<td data-label="外币原价" data-lowpri class="px-3 py-2 text-right whitespace-nowrap">' + Aoi.orders.origText(o) + '</td>'
      + '<td data-label="数量" class="px-3 py-2 text-right">' + o.count + '</td>'
      + '<td data-label="购买者" class="px-3 py-2 wrap" title="' + Aoi.escapeHtml(o.buyer) + '">' + Aoi.escapeHtml(o.buyer) + '</td>'
      + '<td data-label="备注" class="px-3 py-2"><div class="remark-cell" title="点击展开/收起" onclick="Aoi.orders.toggleRemark(this)">' + Aoi.escapeHtml(o.remark || '—') + '</div></td>'
      + '<td data-label="到货状态" class="px-3 py-2">' + Aoi.orders.statusBadge(o) + '</td>'
      + '<td data-label="到货批次" class="px-3 py-2">' + Aoi.escapeHtml(o.batchId ? Aoi.orders.batchDate(o.batchId) : '—') + '</td>'
      + '<td data-label="小计" class="px-3 py-2 text-right wrap">' + (o.price != null ? sum.toFixed(2) : '—') + '</td>'
      + '<td data-label="操作" class="px-3 py-2"><button data-edit="' + o.id + '" class="text-blue-600 hover:underline text-xs whitespace-nowrap">编辑</button></td>'
      + '</tr>';
  }).join('');

  var stat = document.getElementById('orderStat');
  if (stat) stat.textContent = '共 ' + rows.length + ' 条，合计 ¥' + total.toFixed(2) + (pending ? '（' + pending + ' 条人民币价待生成）' : '');
  Aoi.orders.syncSortUi();
};

// —— 批量生成人民币价（v1.8.0：替代录入时自动转换，与批量删除同排）——

Aoi.orders.showGenRmb = function () {
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var box = document.getElementById('genRmbBox');
  if (!box) return;
  // 预填汇率：取勾选订单中最常见的外币币种
  var d = Aoi.orders.ensure();
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = 1; });
  var counter = {};
  d.orders.forEach(function (o) {
    if (idSet[o.id] && o.currency && o.currency !== 'cny') counter[o.currency] = (counter[o.currency] || 0) + 1;
  });
  var best = null, bestN = 0;
  Object.keys(counter).forEach(function (c) { if (counter[c] > bestN) { best = c; bestN = counter[c]; } });
  if (!best) Aoi.toast('勾选中没有外币订单，生成不会改动任何订单', 'info');
  document.getElementById('genCurrency').value = best || 'jpy';
  Aoi.orders.onGenCurrencyChange();
  box.classList.remove('hidden');
};

// 币种切换 → 回填计算器配置的汇率/加价（可在此基础上修改）
Aoi.orders.onGenCurrencyChange = function () {
  var cfg = Aoi.calc.get()[document.getElementById('genCurrency').value];
  if (!cfg) return;
  document.getElementById('genRate').value = cfg.rate;
  document.getElementById('genMarkup').value = cfg.markup;
};

Aoi.orders.hideGenRmb = function () {
  var box = document.getElementById('genRmbBox');
  if (box) box.classList.add('hidden');
};

Aoi.orders.applyGenRmb = async function () {
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var rate = parseFloat(document.getElementById('genRate').value);
  var markup = parseFloat(document.getElementById('genMarkup').value) || 0;
  if (isNaN(rate) || rate <= 0) { Aoi.toast('请填写汇率', 'warning'); return; }
  var idSet = {};
  ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  var n = 0;
  Aoi.undo.arm('批量生成人民币价', d);
  d.orders.forEach(function (o) {
    if (!idSet[o.id] || o.currency === 'cny' || o.priceOrig == null) return;
    o.price = Aoi.calc.convert(o.priceOrig, rate, markup);
    n++;
  });
  await Aoi.saveTeamData(d);
  Aoi.orders.render();
  Aoi.orders.hideGenRmb();
  Aoi.toast(n ? ('已为 ' + n + ' 条订单生成人民币价（30 秒内可撤销）') : '没有可生成的订单（需含外币原价）', n ? 'success' : 'warning');
};

// —— 订单编辑（v1.8.0）——

Aoi.orders.editingId = null;

Aoi.orders.openEdit = function (id) {
  var d = Aoi.orders.ensure();
  var o = null;
  d.orders.forEach(function (x) { if (x.id === id) o = x; });
  if (!o) return;
  Aoi.orders.editingId = id;
  var set = function (elId, v) { var el = document.getElementById(elId); if (el) el.value = v; };
  set('eActivity', o.activity || '');
  set('eType', o.type);
  set('eModel', o.model);
  set('eCount', o.count);
  set('eCurrency', o.currency || 'cny');
  set('ePriceOrig', o.priceOrig != null ? o.priceOrig : '');
  set('ePrice', o.price != null ? o.price : '');
  set('eRemark', o.remark || '');
  var modal = document.getElementById('orderEditModal');
  if (modal) modal.classList.remove('hidden');
};

Aoi.orders.closeEdit = function () {
  var modal = document.getElementById('orderEditModal');
  if (modal) modal.classList.add('hidden');
  Aoi.orders.editingId = null;
};

Aoi.orders.saveEdit = async function () {
  var d = Aoi.orders.ensure();
  var o = null;
  d.orders.forEach(function (x) { if (x.id === Aoi.orders.editingId) o = x; });
  if (!o) { Aoi.orders.closeEdit(); return; }
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var type = get('eType'), model = get('eModel');
  var count = parseInt(get('eCount'), 10);
  if (!type || !model || isNaN(count) || count <= 0) { Aoi.toast('类型/型号/数量必填', 'warning'); return; }
  var priceRaw = get('ePrice');
  var origRaw = get('ePriceOrig');
  o.type = type;
  o.model = model;
  o.count = count;
  o.activity = get('eActivity');
  o.remark = get('eRemark');
  o.currency = get('eCurrency') || 'cny';
  o.price = priceRaw === '' ? null : parseFloat(priceRaw);
  if (o.price != null && isNaN(o.price)) { Aoi.toast('人民币价格格式不正确', 'warning'); return; }
  o.priceOrig = origRaw === '' ? null : parseFloat(origRaw);
  if (o.priceOrig != null && isNaN(o.priceOrig)) { Aoi.toast('外币原价格式不正确', 'warning'); return; }
  await Aoi.saveTeamData(d);
  Aoi.orders.closeEdit();
  Aoi.orders.render();
  Aoi.toast('订单已更新', 'success');
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
  // v3.4.0 F1：到货自动通知（按买家去重：type|buyer|batchId 已存在则不重复生成）
  var notified = {};
  d.notifications.forEach(function (n) { notified[Aoi.notify.keyOf(n)] = 1; });
  var buyers = {};
  d.orders.forEach(function (o) {
    if (idSet[o.id]) {
      o.status = '已到货'; o.batchId = batchId;
      if (o.buyer && !buyers[o.buyer]) {
        var n = Aoi.notify.buildAction('arrived', batchId, o.buyer,
          '你购买的商品已到货（批次 ' + Aoi.orders.batchDate(batchId) + '），交费/分摊完成后团长会安排发货');
        if (!notified[Aoi.notify.keyOf(n)]) { d.notifications.push(n); notified[Aoi.notify.keyOf(n)] = 1; }
        buyers[o.buyer] = 1;
      }
    }
  });
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

// —— 周边（旧预建商品池）：v3.7.0 S4 起录入统一走「登记活动商品」（addProduct），
// d.products 旧数据保留但不再读写与展示 ——

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

// 出货模糊日期建议（x年上/中/下旬、x年春夏秋冬、x年第N季度；近三年）
Aoi.orders.shipFuzzySuggestions = function (now) {
  var y = (now ? new Date(now) : new Date()).getFullYear();
  var out = [];
  [y - 1, y, y + 1].forEach(function (yy) {
    ['春', '夏', '秋', '冬'].forEach(function (s) { out.push(yy + '年' + s + '季'); });
    for (var q = 1; q <= 4; q++) out.push(yy + '年第' + q + '季度');
    for (var m = 1; m <= 12; m++) ['上旬', '中旬', '下旬'].forEach(function (x) { out.push(yy + '年' + m + '月' + x); });
  });
  return out;
};

Aoi.orders.renderActivities = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('activityTbody');
  if (!tbody) return;
  var fuzzyList = document.getElementById('shipFuzzyOptions');
  if (fuzzyList) fuzzyList.innerHTML = Aoi.orders.shipFuzzySuggestions()
    .map(function (s) { return '<option value="' + Aoi.escapeHtml(s) + '">'; }).join('');
  Aoi.orders.refillActProductTypes();
  tbody.innerHTML = d.activities.length ? d.activities.map(function (name, i) {
    var m = d.activityMeta[name] || {};
    var buyers = m.buyers || [];
    var sum = Aoi.orders.activityProductSummary(name);
    var expanded = !!Aoi.orders.expandedActivities[name];
    var row = '<tr class="border-b border-gray-100 align-top">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 font-semibold whitespace-nowrap"><button data-expand="' + Aoi.escapeHtml(name) + '" class="text-blue-600 hover:underline text-left" title="点击展开/收起商品明细">' + (expanded ? '▾ ' : '▸ ') + Aoi.escapeHtml(name) + '</button></td>'
      + '<td class="px-3 py-2"><select data-activity="' + Aoi.escapeHtml(name) + '" data-field="ip" class="border border-gray-300 rounded px-2 py-1 text-sm">' + Aoi.orders.ipOptions(m.ip) + '</select></td>'
      + '<td class="px-3 py-2"><input type="date" value="' + Aoi.escapeHtml(m.buyDate || '') + '" data-activity="' + Aoi.escapeHtml(name) + '" data-field="buyDate" class="border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td class="px-3 py-2"><input type="date" value="' + Aoi.escapeHtml(m.shipDate || '') + '" data-activity="' + Aoi.escapeHtml(name) + '" data-field="shipDate" class="border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td data-lowpri class="px-3 py-2"><input type="text" list="shipFuzzyOptions" value="' + Aoi.escapeHtml(m.shipDateFuzzy || '') + '" placeholder="如 9月中旬" data-activity="' + Aoi.escapeHtml(name) + '" data-field="shipDateFuzzy" class="border border-gray-300 rounded px-2 py-1 text-sm w-28"></td>'
      + '<td class="px-3 py-2"><select data-activity="' + Aoi.escapeHtml(name) + '" data-field="status" class="border border-gray-300 rounded px-2 py-1 text-sm">' + Aoi.orders.activityStatusOptions(m.status) + '</select></td>'
      + '<td class="px-3 py-2"><button data-act-buyers="' + Aoi.escapeHtml(name) + '" class="px-2 py-1 border border-gray-300 rounded text-xs ' + (buyers.length ? 'text-blue-600 border-blue-300' : 'text-gray-500') + ' hover:bg-blue-50 whitespace-nowrap">' + (buyers.length ? buyers.length + ' 人' : '填写') + '</button></td>'
      + '<td class="px-3 py-2"><button data-expand="' + Aoi.escapeHtml(name) + '" class="px-2 py-1 border border-gray-300 rounded text-xs ' + (sum.count ? 'text-blue-600 border-blue-300' : 'text-gray-500') + ' hover:bg-blue-50 whitespace-nowrap">' + (sum.count ? sum.count + ' 款·' + sum.qty + ' 件' : '商品') + '</button></td>'
      + '<td class="px-3 py-2"><input type="text" value="' + Aoi.escapeHtml(m.remark || '') + '" placeholder="备注" data-activity="' + Aoi.escapeHtml(name) + '" data-field="remark" class="border border-gray-300 rounded px-2 py-1 text-sm w-32"></td>'
      + '<td class="px-3 py-2"><button data-remove="' + Aoi.escapeHtml(name) + '" class="text-red-500 hover:underline">删</button></td>'
      + '</tr>';
    if (expanded) {
      row += '<tr class="border-b border-gray-100"><td colspan="11" class="px-3 py-3 bg-gray-50/60 border-l-2 border-l-blue-200">' + Aoi.orders.actExpandHtml(name, i) + '</td></tr>';
    }
    return row;
  }).join('') : '<tr><td colspan="11" class="px-3 py-2 text-gray-400">暂无活动，录入订单或手动新增</td></tr>';
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
  d.activityMeta[name] = { buyDate: '', shipDate: '', shipDateFuzzy: '', link: '', status: '未开始', ip: ip, remark: '', buyers: [], trackings: [] };
  await Aoi.saveTeamData(d);
  el.value = '';
  Aoi.orders.renderActivities();
  Aoi.orders.refillDatalists();
  Aoi.orders.refillActivities();
  Aoi.toast('已新增活动 ' + name, 'success');
};

Aoi.orders.removeActivity = async function (name) {
  var d = Aoi.orders.ensure();
  var targets = d.orders.filter(function (o) { return o.activity === name; });
  if (!(await Aoi.confirm('确定删除活动「' + name + '」？将同时删除其 ' + targets.length + ' 笔订单（30 秒内可撤销）'))) return;
  Aoi.undo.arm('删除活动', d);
  var affected = {};
  targets.forEach(function (o) { if (o.buyer) affected[o.buyer] = 1; });
  d.activities = d.activities.filter(function (a) { return a !== name; });
  delete d.activityMeta[name];
  delete Aoi.orders.expandedActivities[name];
  if (d.limitPlans) delete d.limitPlans[name];
  var removed = {};
  targets.forEach(function (o) { removed[o.id] = 1; });
  d.orders = d.orders.filter(function (o) { return !removed[o.id]; });
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

// 渲染买家列表（v3.6.0 S1：状态分桶计数 + 圈名点击筛选其订单 + 圈名搜索）
Aoi.orders.renderBuyers = function () {
  var d = Aoi.orders.ensure();
  var tbody = document.getElementById('buyerTbody');
  if (!tbody) return;
  var kwEl = document.getElementById('buyerSearch');
  var kw = kwEl ? kwEl.value.trim().toLowerCase() : '';
  var buyers = Aoi.orders.collectBuyers(d);
  if (kw) buyers = buyers.filter(function (b) { return b.toLowerCase().indexOf(kw) >= 0; });
  tbody.innerHTML = buyers.length ? buyers.map(function (buyer, i) {
    var mine = (d.orders || []).filter(function (o) { return o.buyer === buyer; });
    var bucket = { arrive: 0, toShip: 0, shipped: 0, done: 0 };
    mine.forEach(function (o) {
      var s = Aoi.orders.combinedStatus(o);
      if (s.text === '未到货') bucket.arrive++;
      else if (s.text === '已到货·待发货') bucket.toShip++;
      else if (s.text === '已发货') bucket.shipped++;
      else bucket.done++;
    });
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2 font-medium"><button data-buyer-jump="' + Aoi.escapeHtml(buyer) + '" class="text-blue-600 hover:underline" title="查看该买家的全部订单">' + Aoi.escapeHtml(buyer) + '</button></td>'
      + '<td class="px-3 py-2 text-right">' + mine.length + '</td>'
      + '<td class="px-3 py-2 text-right ' + (bucket.arrive ? 'text-gray-500' : 'text-gray-300') + '">' + bucket.arrive + '</td>'
      + '<td class="px-3 py-2 text-right ' + (bucket.toShip ? 'text-amber-500' : 'text-gray-300') + '">' + bucket.toShip + '</td>'
      + '<td class="px-3 py-2 text-right ' + (bucket.shipped ? 'text-green-600' : 'text-gray-300') + '">' + bucket.shipped + '</td>'
      + '<td class="px-3 py-2 text-right ' + (bucket.done ? 'text-green-700' : 'text-gray-300') + '">' + bucket.done + '</td>'
      + '<td class="px-3 py-2 text-right"><button data-del-buyer="' + Aoi.escapeHtml(buyer) + '" class="text-red-500 hover:underline">删</button></td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="8" class="px-3 py-2 text-gray-400">' + (kw ? '无匹配圈名' : '暂无买家') + '</td></tr>';
};

// 跳转订单管理并按该买家筛选（v3.6.0 S1）
Aoi.orders.jumpToBuyer = function (buyer) {
  Aoi.nav('view-orders');
  var f = document.getElementById('fBuyer');
  if (f) f.value = buyer;
  Aoi.orders.render();
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
  var ex = e.target.closest('button[data-expand]');
  if (ex) { Aoi.orders.toggleActivityExpand(ex.getAttribute('data-expand')); return; }
  var jump = e.target.closest('button[data-jump]');
  if (jump) { Aoi.orders.jumpToActivity(jump.getAttribute('data-jump')); return; }
  var b = e.target.closest('button[data-act-buyers]');
  if (b) { Aoi.orders.openActBuyers(b.getAttribute('data-act-buyers')); return; }
  var syn = e.target.closest('button[data-act-sync]');
  if (syn) { Aoi.orders.syncProductsFromOrders(syn.getAttribute('data-act-sync')); return; }
  var es = e.target.closest('button[data-act-exportsummary]');
  if (es) { Aoi.exportSummary(es.getAttribute('data-act-exportsummary')); return; }
  var ap = e.target.closest('button[data-act-addproduct]');
  if (ap) { Aoi.orders.addActProduct(ap); return; }
  var ps = e.target.closest('button[data-psave]');
  if (ps) { Aoi.orders.saveActProduct(ps.getAttribute('data-psave')); return; }
  var pd = e.target.closest('button[data-pdel]');
  if (pd) { Aoi.orders.removeActProduct(pd.getAttribute('data-pdel')); return; }
  var pj = e.target.closest('button[data-pjump]');
  if (pj) {
    var loc = Aoi.orders.findProductById(Aoi.orders.ensure(), pj.getAttribute('data-pjump'));
    if (loc) Aoi.orders.jumpToProduct(loc.activity, loc.product.type, loc.product.model);
    return;
  }
  var pl = e.target.closest('button[data-act-plan]');
  if (pl) { Aoi.limits.openActPlan(pl.getAttribute('data-act-plan')); return; }
  var t = e.target.closest('button[data-act-track]');
  if (t) Aoi.orders.openActTrack(t.getAttribute('data-act-track'));
});

// —— 活动购买人信息 / 快递单号弹窗（v1.9.0）——

Aoi.orders.actTarget = null;

// 购买人一行：购买人 + 购买账号（邮箱）+ 送达地址
// 三个输入均支持搜索下拉（datalist）：圈名/邮箱候选取全站已知值，
// 选中已知圈名后自动带出团员端提交过的送达地址（可手改）
Aoi.orders.buyerRowHtml = function (b) {
  b = b || {};
  return '<div class="grid grid-cols-3 gap-2 act-buyer-row">'
    + '<input class="ab-buyer border border-gray-300 rounded px-2 py-1 text-sm" list="abBuyerOptions" placeholder="圈名（可搜索）" oninput="Aoi.orders.autofillBuyerAddress(this)" value="' + Aoi.escapeHtml(b.buyer || '') + '">'
    + '<input class="ab-account border border-gray-300 rounded px-2 py-1 text-sm" list="abAccountOptions" placeholder="邮箱（可搜索）" value="' + Aoi.escapeHtml(b.account || '') + '">'
    + '<input class="ab-address border border-gray-300 rounded px-2 py-1 text-sm" placeholder="送达地址" value="' + Aoi.escapeHtml(b.address || '') + '">'
    + '</div>';
};

// 购买人候选：仅取「以往活动登记过的购买人」（v3.7.0 S3——购买人=代购工作人员，
// 不再混入全部订单 CN / 团员圈名；新人直接空行手输）
Aoi.orders.buyerCandidates = function (d) {
  var set = {};
  Object.keys(d.activityMeta || {}).forEach(function (a) {
    ((d.activityMeta[a] || {}).buyers || []).forEach(function (b) { if (b.buyer) set[b.buyer] = 1; });
  });
  return Object.keys(set).sort();
};

// 购买账号（邮箱）候选：全站既有购买人信息中的账号去重
Aoi.orders.accountCandidates = function (d) {
  var set = {};
  Object.keys(d.activityMeta || {}).forEach(function (a) {
    ((d.activityMeta[a] || {}).buyers || []).forEach(function (b) { if (b.account) set[b.account] = 1; });
  });
  return Object.keys(set).sort();
};

// 某圈名在团员端提交过的送达地址（未登记返回空串）
Aoi.orders.addressFor = function (d, cn) {
  return (cn && d.addresses && d.addresses[cn]) || '';
};

// 圈名输入后自动带出送达地址（地址已填则不覆盖）
Aoi.orders.autofillBuyerAddress = function (input) {
  var row = input.closest ? input.closest('.act-buyer-row') : null;
  if (!row) return;
  var addr = row.querySelector('.ab-address');
  if (!addr || addr.value.trim()) return;
  var a = Aoi.orders.addressFor(Aoi.orders.ensure(), input.value.trim());
  if (a) addr.value = a;
};

// 填充弹窗内三个 datalist 候选（openActBuyers 时调用一次）
Aoi.orders.fillBuyerDatalists = function () {
  var d = Aoi.orders.ensure();
  var bl = document.getElementById('abBuyerOptions');
  if (bl) bl.innerHTML = Aoi.orders.buyerCandidates(d).map(function (cn) {
    return '<option value="' + Aoi.escapeHtml(cn) + '">';
  }).join('');
  var al = document.getElementById('abAccountOptions');
  if (al) al.innerHTML = Aoi.orders.accountCandidates(d).map(function (acc) {
    return '<option value="' + Aoi.escapeHtml(acc) + '">';
  }).join('');
};

Aoi.orders.openActBuyers = function (name) {
  var d = Aoi.orders.ensure();
  var m = d.activityMeta[name] || {};
  Aoi.orders.actTarget = name;
  var title = document.getElementById('actBuyersTitle');
  if (title) title.textContent = '活动：' + name;
  var box = document.getElementById('actBuyerRows');
  if (box) {
    var rows = (m.buyers && m.buyers.length) ? m.buyers : [{}];
    box.innerHTML = rows.map(Aoi.orders.buyerRowHtml).join('');
  }
  Aoi.orders.fillBuyerDatalists();
  Aoi.orders.renderBuyerSyncHint();
  document.getElementById('actBuyersModal').classList.remove('hidden');
};

// 购买人 ↔ 计划账号映射提示（v3.7.0 S3）：购买人按行序对应限购计划的账号 1..N
Aoi.orders.renderBuyerSyncHint = function () {
  var el = document.getElementById('actBuyersSync');
  if (!el) return;
  var name = Aoi.orders.actTarget;
  var d = Aoi.orders.ensure();
  var plan = name && d.limitPlans && d.limitPlans[name];
  var filled = document.querySelectorAll('#actBuyerRows .act-buyer-row').length;
  if (!plan) { el.textContent = '购买人按行序对应购买计划的账号 1..N（该活动暂无购买计划）'; return; }
  var slots = Math.max(plan.accountsCount || 0, (plan.items || []).length);
  el.textContent = '购买人按行序对应计划账号 1..' + slots + '：已填 ' + filled + ' 人 / 计划 ' + slots + ' 个账号'
    + (filled !== slots ? '（数量不一致，可与计划核对）' : '（数量一致）');
};

// 从计划生成购买人行：按计划账号数生成行，已有购买人按行序带入（名称/账号可再改）
Aoi.orders.genBuyersFromPlan = function () {
  var name = Aoi.orders.actTarget;
  if (!name) return;
  var d = Aoi.orders.ensure();
  var plan = d.limitPlans && d.limitPlans[name];
  if (!plan) { Aoi.toast('该活动还没有购买计划——先到「工具 → 限购计划」计算', 'warning'); return; }
  var cur = Aoi.orders.readBuyerRows();
  var slots = Math.max(plan.accountsCount || 0, (plan.items || []).length);
  if (slots < 1) { Aoi.toast('该计划没有可用账号', 'warning'); return; }
  var rows = [];
  for (var i = 0; i < slots; i++) rows.push(cur[i] || {});
  var box = document.getElementById('actBuyerRows');
  if (box) box.innerHTML = rows.map(Aoi.orders.buyerRowHtml).join('');
  Aoi.orders.renderBuyerSyncHint();
  Aoi.toast('已按计划生成 ' + slots + ' 行购买人（账号列请补齐邮箱）', 'success');
};

// 读取弹窗内购买人行（保存 / 从计划带入共用）：圈名为空的行丢弃
Aoi.orders.readBuyerRows = function () {
  var rows = [];
  document.querySelectorAll('#actBuyerRows .act-buyer-row').forEach(function (row) {
    var buyer = row.querySelector('.ab-buyer').value.trim();
    if (!buyer) return;
    rows.push({
      buyer: buyer,
      account: row.querySelector('.ab-account').value.trim(),
      address: row.querySelector('.ab-address').value.trim()
    });
  });
  return rows;
};

Aoi.orders.addBuyerRow = function () {
  var box = document.getElementById('actBuyerRows');
  if (box) box.insertAdjacentHTML('beforeend', Aoi.orders.buyerRowHtml({}));
  Aoi.orders.renderBuyerSyncHint();
};

Aoi.orders.closeActBuyers = function () {
  document.getElementById('actBuyersModal').classList.add('hidden');
  Aoi.orders.actTarget = null;
};

// 保存购买人（v3.7.0 S3 加固）：一个购买人对应一个账号——账号必填、圈名/账号均不得重复
Aoi.orders.saveActBuyers = async function () {
  var name = Aoi.orders.actTarget;
  if (!name) return;
  var rows = Aoi.orders.readBuyerRows();
  var seenBuyer = {}, seenAccount = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.account) { Aoi.toast('第 ' + (i + 1) + ' 位购买人「' + r.buyer + '」未填账号（一人一账号）', 'warning'); return; }
    if (seenBuyer[r.buyer]) { Aoi.toast('购买人「' + r.buyer + '」重复', 'warning'); return; }
    if (seenAccount[r.account]) { Aoi.toast('账号「' + r.account + '」重复（一个账号只对应一位购买人）', 'warning'); return; }
    seenBuyer[r.buyer] = 1;
    seenAccount[r.account] = 1;
  }
  if (!rows.length) { Aoi.toast('请至少填写一位购买人', 'warning'); return; }
  var d = Aoi.orders.ensure();
  if (!d.activityMeta[name]) d.activityMeta[name] = {};
  d.activityMeta[name].buyers = rows;
  await Aoi.saveTeamData(d);
  Aoi.orders.closeActBuyers();
  Aoi.orders.renderActivities();
  Aoi.toast('已保存「' + name + '」购买人信息（' + rows.length + ' 人）', 'success');
};

Aoi.orders.openActTrack = function (name) {
  var d = Aoi.orders.ensure();
  var m = d.activityMeta[name] || {};
  Aoi.orders.actTarget = name;
  var title = document.getElementById('actTrackTitle');
  if (title) title.textContent = '活动：' + name + '（每行一个单号，可随时添加行数）';
  var input = document.getElementById('actTrackInput');
  if (input) input.value = (m.trackings || []).join('\n');
  document.getElementById('actTrackModal').classList.remove('hidden');
};

Aoi.orders.closeActTrack = function () {
  document.getElementById('actTrackModal').classList.add('hidden');
  Aoi.orders.actTarget = null;
};

Aoi.orders.saveActTrack = async function () {
  var name = Aoi.orders.actTarget;
  if (!name) return;
  var d = Aoi.orders.ensure();
  if (!d.activityMeta[name]) d.activityMeta[name] = {};
  var input = document.getElementById('actTrackInput');
  d.activityMeta[name].trackings = (input ? input.value : '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  await Aoi.saveTeamData(d);
  Aoi.orders.closeActTrack();
  Aoi.orders.renderActivities();
  Aoi.toast('已保存快递单号 ' + d.activityMeta[name].trackings.length + ' 个', 'success');
};

// —— 活动商品管理（v3.6.0 S2 引入；v3.7.0 S2 起展开区承载）——

// 确保活动 meta 结构齐全（products/buyers/trackings 数组化）
Aoi.orders.ensureActMeta = function (d, name) {
  if (!d.activityMeta[name]) d.activityMeta[name] = {};
  var m = d.activityMeta[name];
  if (!Array.isArray(m.products)) m.products = [];
  if (!Array.isArray(m.buyers)) m.buyers = [];
  if (!Array.isArray(m.trackings)) m.trackings = [];
  return m;
};

// 查某活动某 (类型, 型号) 的商品登记（无则 null；团员端展示用）
Aoi.orders.activityProduct = function (activity, type, model) {
  var d = Aoi.orders.ensure();
  var m = d.activityMeta && d.activityMeta[activity];
  if (!m || !Array.isArray(m.products)) return null;
  for (var i = 0; i < m.products.length; i++) {
    if (m.products[i].type === type && m.products[i].model === model) return m.products[i];
  }
  return null;
};

// 商品跳转链接：refUrl 优先，空则回落活动平台链接（再无则空串）
Aoi.orders.productLink = function (activity, p) {
  if (p && p.refUrl) return p.refUrl;
  var d = Aoi.orders.ensure();
  var m = d.activityMeta && d.activityMeta[activity];
  return (m && m.link) || '';
};

// 某 (类型, 型号) 的购买者去重列表（依据订单，按活动筛选）
Aoi.orders.productBuyers = function (activity, type, model) {
  var d = Aoi.orders.ensure();
  var set = {};
  (d.orders || []).forEach(function (o) {
    if (o.activity === activity && o.type === type && o.model === model && o.buyer) set[o.buyer] = 1;
  });
  return Object.keys(set).sort();
};

// —— 商品主档聚合（v3.7.0 S1）：数量/购买人/购买情况一律从订单与限购计划实时聚合，不在商品上存副本 ——

// 单商品聚合：qty 购买件数(Σcount)、buyers 购买者去重、priceAvg 人民币均价(按件加权，无订单价时回落商品登记价)、
// plan 购买情况（有限购计划时按状态累计件数 {pending,bought,failed}；无计划为 null，展示层改用订单到货状态）
Aoi.orders.productStats = function (activity, p) {
  var d = Aoi.orders.ensure();
  var qty = 0, arrived = 0, priceSum = 0, priceN = 0, buyers = {};
  (d.orders || []).forEach(function (o) {
    if (o.activity !== activity || o.type !== p.type || o.model !== p.model) return;
    qty += o.count || 0;
    if ((o.status || '未到货') === '已到货') arrived += (o.count || 0);
    if (o.price != null) { priceSum += o.price * (o.count || 0); priceN += (o.count || 0); }
    if (o.buyer) buyers[o.buyer] = 1;
  });
  var reg = Aoi.orders.activityProduct(activity, p.type, p.model) || {};
  var stats = {
    qty: qty,
    arrived: arrived,
    buyers: Object.keys(buyers).sort(),
    priceAvg: priceN ? Math.round(priceSum / priceN * 100) / 100
      : (p.price != null ? p.price : (reg.price != null ? reg.price : null)),
    plan: null
  };
  var plan = d.limitPlans && d.limitPlans[activity];
  if (plan) {
    var acc = { pending: 0, bought: 0, failed: 0 };
    (plan.items || []).forEach(function (a) {
      (a.items || []).forEach(function (it) {
        if (it.type !== p.type || it.model !== p.model) return;
        var q = it.qty || 0;
        if (it.status === '已购买') acc.bought += q;
        else if (it.status === '购买失败') acc.failed += q;
        else acc.pending += q;
      });
    });
    stats.plan = acc;
  }
  return stats;
};

// 扫描活动订单中「未登记进商品主档」的 (类型,型号) 组合（从订单同步商品的数据源）
Aoi.orders.missingProducts = function (activity) {
  var d = Aoi.orders.ensure();
  var m = d.activityMeta && d.activityMeta[activity];
  var reg = {};
  ((m && m.products) || []).forEach(function (p) { reg[p.type + '|' + p.model] = 1; });
  var map = {};
  (d.orders || []).forEach(function (o) {
    if (o.activity !== activity || !o.type || !o.model) return;
    var key = o.type + '|' + o.model;
    if (reg[key] || map[key]) return;
    map[key] = { type: o.type, model: o.model };
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
};

// 统一商品登记入口（活动管理展开区 / 信息录入页 / F9 目录推入共用）：
// type+model 去重；price/priceOrig/currency/limit 为可选扩展字段（v3.7.0，向后兼容）；
// 重复型号：补充缺失字段而非跳过（v3.8.0——目录重复推入时回填参考图/链接/价格/限购）
Aoi.orders.registerProduct = async function (activity, input) {
  input = input || {};
  if (!activity) { Aoi.toast('请先选择活动', 'warning'); return null; }
  var type = (input.type || '').trim(), model = (input.model || '').trim();
  if (!type || !model) { Aoi.toast('请填写制品类型和型号', 'warning'); return null; }
  var d = Aoi.orders.ensure();
  var m = Aoi.orders.ensureActMeta(d, activity);
  var existing = null;
  for (var i = 0; i < m.products.length; i++) {
    if (m.products[i].type === type && m.products[i].model === model) { existing = m.products[i]; break; }
  }
  if (existing) {
    var filled = [];
    [['refImage', input.refImage], ['refUrl', input.refUrl], ['price', input.price],
     ['priceOrig', input.priceOrig], ['currency', input.currency], ['limit', input.limit],
     ['nameOrig', input.nameOrig]].forEach(function (pair) {
      if ((existing[pair[0]] == null || existing[pair[0]] === '') && pair[1] != null && pair[1] !== '') {
        existing[pair[0]] = pair[1];
        filled.push(pair[0]);
      }
    });
    if (filled.length) {
      await Aoi.saveTeamData(d);
      Aoi.toast('已存在同型号商品「' + type + '-' + model + '」，补充了 ' + filled.join('/'), 'success');
    } else {
      Aoi.toast('已存在同型号商品「' + type + '-' + model + '」，信息完整无需补充', 'info');
    }
    return existing;
  }
  var p = { id: Aoi.genId(), type: type, model: model, refImage: input.refImage || '', refUrl: input.refUrl || '' };
  if (input.price != null && !isNaN(input.price)) p.price = input.price;
  if (input.priceOrig != null && !isNaN(input.priceOrig)) p.priceOrig = input.priceOrig;
  if (input.currency) p.currency = input.currency;
  if (input.limit != null && !isNaN(input.limit)) p.limit = input.limit;
  if (input.nameOrig) p.nameOrig = String(input.nameOrig).trim();
  m.products.push(p);
  await Aoi.saveTeamData(d);
  return p;
};

// 从订单同步商品：把活动订单中未登记的 (类型,型号) 一次性补进商品主档，返回补登数量
Aoi.orders.syncProductsFromOrders = async function (activity) {
  var missing = Aoi.orders.missingProducts(activity);
  if (!missing.length) { Aoi.toast('订单中的商品均已登记', 'info'); return 0; }
  var d = Aoi.orders.ensure();
  var m = Aoi.orders.ensureActMeta(d, activity);
  missing.forEach(function (x) {
    m.products.push({ id: Aoi.genId(), type: x.type, model: x.model, refImage: '', refUrl: '' });
  });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderActivities();
  Aoi.toast('已从订单补登记 ' + missing.length + ' 款商品', 'success');
  return missing.length;
};

// —— 活动商品展开区（v3.7.0 S2，取代 v3.6.0 商品弹窗）：点击活动名行内展开商品卡片 ——

// 展开状态（活动名 → true；重渲染后保持）
Aoi.orders.expandedActivities = {};

Aoi.orders.toggleActivityExpand = function (name) {
  if (Aoi.orders.expandedActivities[name]) delete Aoi.orders.expandedActivities[name];
  else Aoi.orders.expandedActivities[name] = true;
  Aoi.orders.renderActivities();
};

// 活动商品摘要：登记款数 + 订单聚合件数 + 购买人数（活动行「商品」按钮文案）
Aoi.orders.activityProductSummary = function (name) {
  var d = Aoi.orders.ensure();
  var m = d.activityMeta[name] || {};
  var qty = 0, buyers = {};
  (d.orders || []).forEach(function (o) {
    if (o.activity !== name) return;
    qty += o.count || 0;
    if (o.buyer) buyers[o.buyer] = 1;
  });
  return { count: (m.products || []).length, qty: qty, buyers: Object.keys(buyers).length };
};

// 按 id 在全站活动商品主档中定位商品
Aoi.orders.findProductById = function (d, pid) {
  var names = Object.keys(d.activityMeta || {});
  for (var i = 0; i < names.length; i++) {
    var m = d.activityMeta[names[i]];
    var arr = (m && m.products) || [];
    for (var j = 0; j < arr.length; j++) if (arr[j].id === pid) return { activity: names[i], meta: m, product: arr[j] };
  }
  return null;
};

// 购买情况徽标：有限购计划按状态件数（已购/待购/失败），否则按订单到货件数
Aoi.orders.productStatusBadge = function (activity, p, s) {
  if (s.plan) {
    var parts = [];
    if (s.plan.bought) parts.push('<span class="text-green-600">已购 ' + s.plan.bought + ' 件</span>');
    if (s.plan.pending) parts.push('<span class="text-amber-500">待购 ' + s.plan.pending + ' 件</span>');
    if (s.plan.failed) parts.push('<span class="text-red-500">失败 ' + s.plan.failed + ' 件</span>');
    return parts.join(' / ') || '<span class="text-gray-400">计划待购</span>';
  }
  if (!s.qty) return '<span class="text-gray-400">暂无订单</span>';
  if (s.arrived >= s.qty) return '<span class="text-green-600">已到货</span>';
  return '<span class="text-amber-500">到货 ' + s.arrived + '/' + s.qty + ' 件</span>';
};

// 商品卡片：缩略图 + 元数据行内编辑 + 聚合信息（件数/人数/购买情况）+ 查订单/删除
Aoi.orders.actProductCardHtml = function (activity, p) {
  var s = Aoi.orders.productStats(activity, p);
  var imgId = 'apImg_' + p.id;
  var thumb = p.refImage
    ? '<a href="' + Aoi.escapeHtml(p.refImage) + '" target="_blank" title="查看大图"><img src="' + Aoi.escapeHtml(p.refImage) + '" alt="参考图" class="w-14 h-14 object-cover rounded border border-gray-200 shrink-0"></a>'
    : '<span class="w-14 h-14 flex items-center justify-center text-gray-300 text-xs bg-gray-100 rounded border border-gray-100 shrink-0">无图</span>';
  var link = Aoi.orders.productLink(activity, p);
  var chips = s.buyers.slice(0, 6).map(function (b) {
    return '<span class="inline-block bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 text-xs">' + Aoi.escapeHtml(b) + '</span>';
  }).join('');
  if (s.buyers.length > 6) chips += '<span class="text-xs text-gray-400">等 ' + s.buyers.length + ' 人</span>';
  return '<div class="border border-gray-200 rounded-lg p-3 bg-white flex flex-col gap-2" data-pcard="' + p.id + '">'
    + '<div class="flex items-start gap-2">'
    + thumb
    + '<div class="flex-1 min-w-0">'
    + '<div class="text-xs text-gray-400">' + Aoi.escapeHtml(p.type) + '</div>'
    + '<input data-pmodel="' + p.id + '" value="' + Aoi.escapeHtml(p.model) + '" placeholder="型号" class="w-full font-semibold text-sm bg-transparent border-0 border-b border-transparent focus:border-blue-400 p-0">'
    + (p.nameOrig ? '<div class="text-[11px] text-gray-400 mt-0.5" title="原语言名称">原名：' + Aoi.escapeHtml(p.nameOrig) + '</div>' : '')
    + '<div class="text-xs text-gray-500 mt-0.5">'
    + (s.priceAvg != null ? '参考单价 ¥' + s.priceAvg : '单价未登记')
    + (p.limit != null ? ' · 限购 ' + p.limit : '')
    + (link ? ' · <a href="' + Aoi.escapeHtml(link) + '" target="_blank" class="text-blue-500 hover:underline">购买链接</a>' : '')
    + '</div>'
    + '</div></div>'
    + '<div class="text-xs text-gray-600">已订 <b>' + s.qty + '</b> 件 · ' + s.buyers.length + ' 人 · ' + Aoi.orders.productStatusBadge(activity, p, s) + '</div>'
    + (chips ? '<div class="flex flex-wrap gap-1">' + chips + '</div>' : '')
    + '<div class="grid grid-cols-2 gap-1.5">'
    + '<input data-pprice="' + p.id + '" type="number" step="0.01" value="' + (p.price != null ? p.price : '') + '" placeholder="登记单价¥" class="w-full border border-gray-300 rounded px-2 py-1 text-xs">'
    + '<input data-plimit="' + p.id + '" type="number" step="1" value="' + (p.limit != null ? p.limit : '') + '" placeholder="单账号限购" class="w-full border border-gray-300 rounded px-2 py-1 text-xs">'
    + '<input id="' + imgId + '" data-img-paste value="' + Aoi.escapeHtml(p.refImage || '') + '" placeholder="参考图 URL" class="col-span-2 w-full border border-gray-300 rounded px-2 py-1 text-xs">'
    + '<input data-purl="' + p.id + '" value="' + Aoi.escapeHtml(p.refUrl || '') + '" placeholder="跳转链接（空=平台链接）" class="col-span-2 w-full border border-gray-300 rounded px-2 py-1 text-xs">'
    + '</div>'
    + '<div class="flex items-center gap-2">'
    + '<button data-psave="' + p.id + '" class="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700">保存</button>'
    + '<button type="button" onclick="Aoi.img.openPicker(\'' + imgId + '\')" class="px-2 py-1 bg-gray-200 text-gray-700 text-xs font-bold rounded hover:bg-gray-300">图片…</button>'
    + '<button data-pjump="' + p.id + '" class="text-blue-600 hover:underline text-xs whitespace-nowrap">查订单</button>'
    + '<button data-pdel="' + p.id + '" class="ml-auto text-red-500 hover:underline text-xs">删</button>'
    + '</div></div>';
};

// 展开区内容：操作行（查订单/平台链接/单号/计划/同步商品）+ 新增商品表单 + 商品卡片栅格
Aoi.orders.actExpandHtml = function (name, idx) {
  var d = Aoi.orders.ensure();
  var m = Aoi.orders.ensureActMeta(d, name);
  var plan = (d.limitPlans && d.limitPlans[name]) || null;
  var trackings = m.trackings || [];
  var sfx = '_' + idx;
  var head = '<div class="flex flex-wrap items-center gap-2 mb-3">'
    + '<button data-jump="' + Aoi.escapeHtml(name) + '" class="px-3 py-1.5 bg-gray-800 text-white text-xs font-bold rounded hover:bg-gray-900 whitespace-nowrap">查订单</button>'
    + '<input type="text" value="' + Aoi.escapeHtml(m.link || '') + '" placeholder="平台链接" data-activity="' + Aoi.escapeHtml(name) + '" data-field="link" class="w-48 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<button data-act-track="' + Aoi.escapeHtml(name) + '" class="px-2 py-1.5 border border-gray-300 rounded text-xs ' + (trackings.length ? 'text-blue-600 border-blue-300' : 'text-gray-500') + ' hover:bg-blue-50 whitespace-nowrap">' + (trackings.length ? '单号 ' + trackings.length + ' 个' : '快递单号') + '</button>'
    + '<button data-act-plan="' + Aoi.escapeHtml(name) + '" class="px-2 py-1.5 border border-gray-300 rounded text-xs ' + (plan ? 'text-blue-600 border-blue-300' : 'text-gray-500') + ' hover:bg-blue-50 whitespace-nowrap">' + (plan ? '计划·' + plan.items.length + '账号' : '购买计划') + '</button>'
    + '<button data-act-sync="' + Aoi.escapeHtml(name) + '" class="px-2 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100 whitespace-nowrap">从订单同步商品</button>'
    + '<button data-act-exportsummary="' + Aoi.escapeHtml(name) + '" class="px-2 py-1.5 border border-blue-300 rounded text-xs text-blue-600 hover:bg-blue-50 whitespace-nowrap">导出汇总表</button>'
    + '</div>';
  var form = '<div class="flex flex-wrap items-center gap-2 mb-3">'
    + '<input id="apNewType' + sfx + '" list="actProductTypeOptions" placeholder="制品类型" class="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<input id="apNewModel' + sfx + '" placeholder="型号" class="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<input id="apNewPrice' + sfx + '" type="number" step="0.01" placeholder="单价¥（选填）" class="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<input id="apNewLimit' + sfx + '" type="number" step="1" placeholder="限购（选填）" class="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<input id="apNewImage' + sfx + '" data-img-paste placeholder="参考图 URL（可上传/粘贴）" class="w-44 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<button type="button" onclick="Aoi.img.openPicker(\'apNewImage' + sfx + '\')" class="px-2 py-1.5 bg-gray-200 text-gray-700 text-xs font-bold rounded hover:bg-gray-300 whitespace-nowrap">图片…</button>'
    + '<input id="apNewUrl' + sfx + '" placeholder="跳转链接（空=平台链接）" class="w-44 border border-gray-300 rounded px-2 py-1.5 text-sm">'
    + '<button data-act-addproduct="' + Aoi.escapeHtml(name) + '" data-suffix="' + sfx + '" class="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 whitespace-nowrap">添加商品</button>'
    + '</div>';
  var cards = m.products.length
    ? '<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">' + m.products.map(function (p) { return Aoi.orders.actProductCardHtml(name, p); }).join('') + '</div>'
    : '<p class="text-sm text-gray-400 py-2">还没有登记商品——在上方添加，或点「从订单同步商品」把订单里已有的商品补登记进来</p>';
  return head + form + cards;
};

// 商品类型候选 = 制品类型库（展开区新增商品表单的 datalist）
Aoi.orders.refillActProductTypes = function () {
  var d = Aoi.orders.ensure();
  var dl = document.getElementById('actProductTypeOptions');
  if (dl) dl.innerHTML = Object.keys(d.typeMeta).map(function (t) {
    return '<option value="' + Aoi.escapeHtml(t) + '">';
  }).join('');
};

// 展开区新增商品（按钮带 data-act-addproduct=活动名 + data-suffix=行内表单 id 后缀）
Aoi.orders.addActProduct = async function (btn) {
  var activity = btn.getAttribute('data-act-addproduct');
  var sfx = btn.getAttribute('data-suffix') || '';
  var get = function (id) { var el = document.getElementById(id + sfx); return el ? el.value.trim() : ''; };
  var priceRaw = get('apNewPrice');
  var limitRaw = get('apNewLimit');
  var p = await Aoi.orders.registerProduct(activity, {
    type: get('apNewType'), model: get('apNewModel'),
    refImage: get('apNewImage'), refUrl: get('apNewUrl'),
    price: priceRaw === '' ? null : parseFloat(priceRaw),
    limit: limitRaw === '' ? null : parseInt(limitRaw, 10)
  });
  if (!p) return;
  ['apNewType', 'apNewModel', 'apNewPrice', 'apNewLimit', 'apNewImage', 'apNewUrl'].forEach(function (id) {
    var el = document.getElementById(id + sfx); if (el) el.value = '';
  });
  Aoi.orders.renderActivities();
  Aoi.toast('已添加商品 ' + p.type + '-' + p.model, 'success');
};

// 卡内保存：型号/单价/限购/参考图/跳转链接
Aoi.orders.saveActProduct = async function (pid) {
  var d = Aoi.orders.ensure();
  var loc = Aoi.orders.findProductById(d, pid);
  if (!loc) return;
  var p = loc.product;
  var card = document.querySelector('[data-pcard="' + pid + '"]');
  var field = function (sel) { var el = card ? card.querySelector(sel) : null; return el ? el.value.trim() : null; };
  var model = field('[data-pmodel="' + pid + '"]');
  if (model != null) {
    if (!model) { Aoi.toast('型号不能为空', 'warning'); return; }
    var dup = loc.meta.products.some(function (x) { return x.id !== pid && x.type === p.type && x.model === model; });
    if (dup) { Aoi.toast('已存在同型号商品「' + p.type + '-' + model + '」', 'warning'); return; }
    p.model = model;
  }
  var img = document.getElementById('apImg_' + pid);
  if (img) p.refImage = img.value.trim();
  var url = field('[data-purl="' + pid + '"]');
  if (url != null) p.refUrl = url;
  var priceRaw = field('[data-pprice="' + pid + '"]');
  if (priceRaw != null) {
    if (priceRaw === '') delete p.price;
    else { var v = parseFloat(priceRaw); if (isNaN(v)) { Aoi.toast('单价格式不正确', 'warning'); return; } p.price = v; }
  }
  var limitRaw = field('[data-plimit="' + pid + '"]');
  if (limitRaw != null) {
    if (limitRaw === '') delete p.limit;
    else { var l = parseInt(limitRaw, 10); if (isNaN(l)) { Aoi.toast('限购格式不正确', 'warning'); return; } p.limit = l; }
  }
  await Aoi.saveTeamData(d);
  Aoi.orders.renderActivities();
  Aoi.toast('已保存商品 ' + p.type + '-' + p.model, 'success');
};

Aoi.orders.removeActProduct = async function (pid) {
  var d = Aoi.orders.ensure();
  var loc = Aoi.orders.findProductById(d, pid);
  if (!loc) return;
  var p = loc.product;
  if (!(await Aoi.confirm('确定删除商品「' + p.type + '-' + p.model + '」？其参考图与跳转链接将一并移除（订单不受影响）', { title: '删除商品', okText: '删除', danger: true }))) return;
  loc.meta.products = loc.meta.products.filter(function (x) { return x.id !== pid; });
  await Aoi.saveTeamData(d);
  Aoi.orders.renderActivities();
  Aoi.toast('已删除商品', 'success');
};

// 依据商品筛选购买者：跳订单管理，按活动 + 型号过滤
Aoi.orders.jumpToProduct = function (activity, type, model) {
  Aoi.nav('view-orders');
  Aoi.orders.refillActivities();
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  set('fBuyer', '');
  set('fActivity', activity);
  set('fModel', model);
  Aoi.orders.render();
  Aoi.toast('已按商品「' + type + '-' + model + '」筛选购买者', 'info');
};

document.getElementById('buyerTbody').addEventListener('click', function (e) {
  var jump = e.target.closest('button[data-buyer-jump]');
  if (jump) { Aoi.orders.jumpToBuyer(jump.getAttribute('data-buyer-jump')); return; }
  var btn = e.target.closest('button[data-del-buyer]');
  if (btn) Aoi.orders.removeBuyer(btn.getAttribute('data-del-buyer'));
});

// 事件委托：订单行「编辑」按钮
document.getElementById('orderTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-edit]');
  if (btn) Aoi.orders.openEdit(btn.getAttribute('data-edit'));
});

// 事件委托：表头点击排序（v3.6.2）
var orderThead = document.querySelector('#orderTable thead');
if (orderThead) orderThead.addEventListener('click', function (e) {
  var th = e.target.closest('th[data-sort]');
  if (th) Aoi.orders.setSort(th.getAttribute('data-sort'));
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
  var routeSel = document.getElementById(typeId + 'NewRoute');
  if (routeSel && !routeSel.options.length) routeSel.innerHTML = Aoi.orders.routeOptions();
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

// 类型面板内快捷新建：输入名称 + 选线路，即建即选（v1.8.0）
Aoi.orders.quickAddType = async function (typeId) {
  var nameEl = document.getElementById(typeId + 'NewName');
  var routeEl = document.getElementById(typeId + 'NewRoute');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { Aoi.toast('请输入类型名称', 'warning'); return; }
  var d = Aoi.orders.ensure();
  if (!d.typeMeta[name]) {
    d.typeMeta[name] = { route: routeEl ? routeEl.value : '未分类' };
    await Aoi.saveTeamData(d);
    Aoi.orders.renderTypes();
  }
  var input = document.getElementById(typeId);
  if (input) input.value = name;
  if (nameEl) nameEl.value = '';
  Aoi.orders.closeTypePanel(typeId);
  Aoi.toast('已新建类型 ' + name, 'success');
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
