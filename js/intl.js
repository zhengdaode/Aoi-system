// Aoi-system — 国际计算：按重量分摊国际运费（公式复用自 intl-freight-calc 计算引擎）
window.Aoi = window.Aoi || {};
Aoi.intl = {};

// 从选中批次的订单聚合条目（按 制品类型|型号 去重，数量累加）
Aoi.intl.itemsForBatch = function (batchId) {
  var d = Aoi.orders.ensure();
  var map = {};
  d.orders.forEach(function (o) {
    if (o.batchId !== batchId) return;
    var key = o.type + '|' + o.model;
    if (!map[key]) map[key] = { key: key, type: o.type, model: o.model, quantity: 0 };
    map[key].quantity += o.count;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
};

// 取批次（返回 data 内引用，便于读写配置）
Aoi.intl.getBatch = function (batchId) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < d.batches.length; i++) if (d.batches[i].id === batchId) return d.batches[i];
  return null;
};

// 核心分摊（复用 ifcRecalcAll）：每单位国际费 = 总额/总重 × 单位重
Aoi.intl.recalc = function (items, targetAmount) {
  var tareTotal = 0;
  items.forEach(function (it) { it.totalWeight = it.unitWeight * it.quantity; tareTotal += it.totalWeight; });
  items.forEach(function (it) {
    it.avgIntlFee = (tareTotal > 0 && targetAmount > 0) ? (targetAmount / tareTotal) * it.unitWeight : 0;
    it.weightedIntlFee = it.manual ? it.manualFee : it.avgIntlFee;
    it.weightedTotalFee = it.weightedIntlFee * it.quantity;
  });
  return tareTotal;
};

// 组装完整条目：注入单位重量 + 手动覆盖，再分摊
Aoi.intl.buildItems = function (batch) {
  var items = Aoi.intl.itemsForBatch(batch.id);
  var weights = batch.weights || {};
  var manual = batch.manualFees || {};
  items.forEach(function (it) {
    it.unitWeight = parseFloat(weights[it.key]) || 0;
    if (manual[it.key] != null) { it.manual = true; it.manualFee = parseFloat(manual[it.key]) || 0; }
  });
  Aoi.intl.recalc(items, batch.targetAmount || 0);
  return items;
};

// 每人应付国际费（按订单归属累加）
Aoi.intl.buyerTotals = function (batchId, items) {
  var feeByKey = {};
  items.forEach(function (it) { feeByKey[it.key] = it.weightedIntlFee; });
  var d = Aoi.orders.ensure();
  var totals = {};
  d.orders.forEach(function (o) {
    if (o.batchId !== batchId) return;
    var key = o.type + '|' + o.model;
    totals[o.buyer] = (totals[o.buyer] || 0) + (feeByKey[key] || 0) * o.count;
  });
  return totals;
};

// 渲染国际计算页
Aoi.intl.render = function () {
  var batch = Aoi.intl.getBatch(document.getElementById('intlBatch').value);
  if (!batch) { Aoi.intl.clear(); return; }
  document.getElementById('intlTarget').value = batch.targetAmount || '';

  var items = Aoi.intl.buildItems(batch);
  var tbody = document.getElementById('intlTbody');
  var tareTotal = 0, feeTotal = 0;
  tbody.innerHTML = items.map(function (it) {
    tareTotal += it.totalWeight; feeTotal += it.weightedTotalFee;
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(it.type + ' - ' + it.model) + '</td>'
      + '<td class="px-3 py-2 text-right">' + it.quantity + '</td>'
      + '<td class="px-3 py-2"><input type="number" step="0.01" value="' + (it.unitWeight || '') + '" onchange="Aoi.intl.setWeight(\'' + it.key + '\', this.value)" class="w-20 border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td class="px-3 py-2 text-right">' + it.totalWeight.toFixed(2) + '</td>'
      + '<td class="px-3 py-2"><input type="number" step="0.01" value="' + (it.manual ? it.manualFee : it.avgIntlFee.toFixed(2)) + '" onchange="Aoi.intl.setFee(\'' + it.key + '\', this.value)" class="w-20 border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td class="px-3 py-2 text-right">' + it.weightedTotalFee.toFixed(2) + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('intlStat').textContent = items.length
    ? '共 ' + items.length + ' 种制品 · 总重量 ' + tareTotal.toFixed(2) + ' · 已分摊国际费 ' + feeTotal.toFixed(2)
    : '该批次暂无订单';

  var totals = Aoi.intl.buyerTotals(batch.id, items);
  var btbody = document.getElementById('intlBuyerTbody');
  btbody.innerHTML = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).map(function (buyer) {
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(buyer) + '</td>'
      + '<td class="px-3 py-2 text-right">' + totals[buyer].toFixed(2) + '</td></tr>';
  }).join('');
};

Aoi.intl.clear = function () {
  var t = document.getElementById('intlTbody'); if (t) t.innerHTML = '';
  var b = document.getElementById('intlBuyerTbody'); if (b) b.innerHTML = '';
  var s = document.getElementById('intlStat'); if (s) s.textContent = '';
  var tg = document.getElementById('intlTarget'); if (tg) tg.value = '';
};

// 保存目标运费总额
Aoi.intl.saveTarget = async function () {
  var batch = Aoi.intl.getBatch(document.getElementById('intlBatch').value);
  if (!batch) return;
  batch.targetAmount = parseFloat(document.getElementById('intlTarget').value) || 0;
  await Aoi.saveTeamData(Aoi.state.data);
  Aoi.intl.render();
  Aoi.toast('国际运费总额已保存', 'success');
};

// 设置单位重量
Aoi.intl.setWeight = async function (key, value) {
  var batch = Aoi.intl.getBatch(document.getElementById('intlBatch').value);
  if (!batch) return;
  batch.weights = batch.weights || {};
  batch.weights[key] = parseFloat(value) || 0;
  await Aoi.saveTeamData(Aoi.state.data);
  Aoi.intl.render();
};

// 手动覆盖单位国际费
Aoi.intl.setFee = async function (key, value) {
  var batch = Aoi.intl.getBatch(document.getElementById('intlBatch').value);
  if (!batch) return;
  batch.manualFees = batch.manualFees || {};
  batch.manualFees[key] = parseFloat(value) || 0;
  await Aoi.saveTeamData(Aoi.state.data);
  Aoi.intl.render();
};

// 刷新批次下拉
Aoi.intl.refillBatches = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('intlBatch');
  if (!sel) return;
  var cur = sel.value;
  var list = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  sel.innerHTML = '<option value="">选择批次…</option>' + list.map(function (b) {
    return '<option value="' + b.id + '">' + Aoi.escapeHtml(b.date + '（' + Aoi.orders.batchCount(b.id) + '）') + '</option>';
  }).join('');
  if (cur && d.batches.some(function (b) { return b.id === cur; })) sel.value = cur;
};
