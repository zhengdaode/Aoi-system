// Aoi-system — 事务审批：按批次逐人核实国际费交费（标记已交 / 驳回 / 催缴）
window.Aoi = window.Aoi || {};
Aoi.approval = {};

Aoi.approval.ensure = function () {
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.payments)) d.payments = [];
  return d;
};

// 取某批次某人的交费记录
Aoi.approval.getRecord = function (batchId, buyer) {
  var d = Aoi.approval.ensure();
  for (var i = 0; i < d.payments.length; i++) {
    var p = d.payments[i];
    if (p.batchId === batchId && p.buyer === buyer) return p;
  }
  return null;
};

// 每人应付汇总：货款（订单小计）+ 国际费（复用 intl 分摊）
Aoi.approval.buyerSummary = function (batchId) {
  var d = Aoi.orders.ensure();
  var batch = Aoi.intl.getBatch(batchId);
  var intlTotals = batch ? Aoi.intl.buyerTotals(batchId, Aoi.intl.buildItems(batch)) : {};
  var map = {};
  d.orders.forEach(function (o) {
    if (o.batchId !== batchId) return;
    if (!map[o.buyer]) map[o.buyer] = { buyer: o.buyer, goods: 0 };
    map[o.buyer].goods += o.price * o.count;
  });
  return Object.keys(map).map(function (buyer) {
    var m = map[buyer];
    var rec = Aoi.approval.getRecord(batchId, buyer);
    m.intlFee = (rec && rec.intlFee != null) ? rec.intlFee : (intlTotals[buyer] || 0);
    m.status = rec ? rec.status : '待交';
    m.receipt = rec ? rec.receipt : null;
    return m;
  }).sort(function (a, b) { return a.buyer < b.buyer ? -1 : 1; });
};

Aoi.approval.statusBadge = function (status) {
  var map = { '待交': 'text-gray-400', '待审核': 'text-amber-500', '已交': 'text-green-600', '已驳回': 'text-red-500' };
  return '<span class="' + (map[status] || 'text-gray-400') + '">' + Aoi.escapeHtml(status) + '</span>';
};

// 操作按钮点击（事件委托，买家名走 data 属性避免注入）
Aoi.approval.onAction = function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  Aoi.approval.setStatus(
    document.getElementById('approvalBatch').value,
    btn.getAttribute('data-buyer'),
    btn.getAttribute('data-status')
  );
};

// 渲染审批列表
Aoi.approval.render = function () {
  var batchId = document.getElementById('approvalBatch').value;
  var tbody = document.getElementById('approvalTbody');
  if (!batchId) {
    if (tbody) tbody.innerHTML = '';
    var s = document.getElementById('approvalStat'); if (s) s.textContent = '';
    var r = document.getElementById('approvalRemind'); if (r) r.value = '';
    return;
  }
  var rows = Aoi.approval.buyerSummary(batchId);
  var paid = 0, pending = 0;
  tbody.innerHTML = rows.map(function (r) {
    if (r.status === '已交') paid++;
    if (r.status === '待审核') pending++;
    var b = Aoi.escapeHtml(r.buyer);
    var receipt = r.receipt
      ? ' <a href="' + Aoi.escapeHtml(r.receipt) + '" target="_blank" class="text-blue-500 hover:underline text-xs">凭证</a>'
      : '';
    var actions = '';
    if (r.status !== '已交') actions += '<button data-buyer="' + b + '" data-status="已交" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 mr-1">标记已交</button>';
    if (r.status !== '已驳回') actions += '<button data-buyer="' + b + '" data-status="已驳回" class="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">驳回</button>';
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-3 py-2">' + b + '</td>'
      + '<td class="px-3 py-2 text-right text-gray-400">' + r.goods.toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right font-semibold">' + r.intlFee.toFixed(2) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.approval.statusBadge(r.status) + receipt + '</td>'
      + '<td class="px-3 py-2">' + actions + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('approvalStat').textContent = rows.length
    ? '共 ' + rows.length + ' 人 · 已交 ' + paid + ' · 待审核 ' + pending + ' · 待交/驳回 ' + (rows.length - paid - pending)
    : '该批次暂无订单';
};

// 写入交费状态
Aoi.approval.setStatus = async function (batchId, buyer, status) {
  if (!batchId || !buyer) return;
  var d = Aoi.approval.ensure();
  var p = Aoi.approval.getRecord(batchId, buyer);
  // 两步确认：标记已交 / 驳回前弹确认，防止误操作
  var ok = await Aoi.confirm('确认将「' + buyer + '」标记为「' + status + '」？', {
    title: status === '已交' ? '确认收款' : '确认驳回',
    okText: status === '已交' ? '确认已交' : '确认驳回',
    danger: status === '已驳回'
  });
  if (!ok) return;
  if (p) p.status = status;
  else d.payments.push({ id: Aoi.genId(), batchId: batchId, buyer: buyer, status: status });
  await Aoi.saveTeamData(d);
  Aoi.approval.render();
  Aoi.toast(buyer + ' → ' + status, 'success');
  Aoi.overview.render();
  Aoi.notify.sync();
};

// 生成催缴名单（待交 + 已驳回，含国际费金额）
Aoi.approval.remind = function () {
  var batchId = document.getElementById('approvalBatch').value;
  if (!batchId) return;
  var unpaid = Aoi.approval.buyerSummary(batchId).filter(function (r) { return r.status === '待交' || r.status === '已驳回'; });
  document.getElementById('approvalRemind').value = unpaid.map(function (r) {
    return r.buyer + '：应付国际费 ¥' + r.intlFee.toFixed(2) + (r.status === '已驳回' ? '（已驳回）' : '');
  }).join('\n');
  Aoi.toast(unpaid.length ? '已生成 ' + unpaid.length + ' 条催缴名单' : '全部已交，无需催缴', unpaid.length ? 'success' : 'info');
};

Aoi.approval.copyRemind = function () {
  var ta = document.getElementById('approvalRemind');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(function () { Aoi.toast('已复制', 'success'); }, function () { ta.select(); });
  } else {
    ta.select();
    document.execCommand('copy');
    Aoi.toast('已复制', 'success');
  }
};

// 刷新批次下拉
Aoi.approval.refillBatches = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('approvalBatch');
  if (!sel) return;
  var cur = sel.value;
  var list = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  sel.innerHTML = '<option value="">选择批次…</option>' + list.map(function (b) {
    return '<option value="' + b.id + '">' + Aoi.escapeHtml(Aoi.orders.batchLabel(b) + '（' + Aoi.orders.batchCount(b.id) + '）') + '</option>';
  }).join('');
  if (cur && d.batches.some(function (b) { return b.id === cur; })) sel.value = cur;
};
