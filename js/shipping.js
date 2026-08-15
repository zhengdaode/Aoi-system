// Aoi-system — 发货管理：按批次录快递单号、设合照、标记发货
window.Aoi = window.Aoi || {};
Aoi.ship = {};

Aoi.ship.shippedBadge = function (s) {
  var v = s || '未发';
  var cls = v === '已发' ? 'text-green-600' : 'text-gray-400';
  return '<span class="' + cls + '">' + Aoi.escapeHtml(v) + '</span>';
};

Aoi.ship.selectedIds = function () {
  return Array.prototype.map.call(document.querySelectorAll('.ship-check:checked'), function (c) { return c.getAttribute('data-id'); });
};

Aoi.ship.toggleAll = function (cb) {
  document.querySelectorAll('.ship-check').forEach(function (c) { c.checked = cb.checked; });
};

Aoi.ship.render = function () {
  var batchId = document.getElementById('shipBatch').value;
  var tbody = document.getElementById('shipTbody');
  if (!batchId) {
    if (tbody) tbody.innerHTML = '';
    var s0 = document.getElementById('shipStat'); if (s0) s0.textContent = '';
    return;
  }
  var d = Aoi.orders.ensure();
  var rows = d.orders.filter(function (o) { return o.batchId === batchId; });
  rows = rows.slice().sort(function (a, b) {
    return Aoi.orders.typeRoute(a.type) < Aoi.orders.typeRoute(b.type) ? -1 : 1;
  });
  var shipped = 0;
  tbody.innerHTML = rows.map(function (o) {
    if ((o.shipped || '未发') === '已发') shipped++;
    var photo = o.photo ? '<a href="' + Aoi.escapeHtml(o.photo) + '" target="_blank" class="text-blue-500 hover:underline">查看</a>' : '<span class="text-gray-400">—</span>';
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2"><input type="checkbox" class="ship-check" data-id="' + o.id + '"></td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.buyer) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.type + ' - ' + o.model) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(Aoi.orders.typeRoute(o.type)) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.count + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(Aoi.warehouse.name(o.warehouseId) || '—') + '</td>'
      + '<td class="px-3 py-2">' + photo + '</td>'
      + '<td class="px-3 py-2"><input type="text" value="' + Aoi.escapeHtml(o.tracking || '') + '" placeholder="快递单号" onchange="Aoi.ship.setTracking(\'' + o.id + '\', this.value)" class="w-32 border border-gray-300 rounded px-2 py-1 text-sm"></td>'
      + '<td class="px-3 py-2">' + Aoi.ship.shippedBadge(o.shipped) + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('shipStat').textContent = rows.length ? '共 ' + rows.length + ' 条 · 已发 ' + shipped : '该批次暂无订单';
};

Aoi.ship.setTracking = async function (orderId, value) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < d.orders.length; i++) {
    if (d.orders[i].id === orderId) { d.orders[i].tracking = value; break; }
  }
  await Aoi.saveTeamData(d);
  Aoi.toast('快递单号已保存', 'success');
};

Aoi.ship.setPhoto = async function () {
  var ids = Aoi.ship.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var url = document.getElementById('shipPhoto').value.trim();
  if (!url) { Aoi.toast('请输入合照 URL', 'warning'); return; }
  var idSet = {}; ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  d.orders.forEach(function (o) { if (idSet[o.id]) o.photo = url; });
  await Aoi.saveTeamData(d);
  Aoi.ship.render();
  Aoi.toast('已设合照 ' + ids.length + ' 条', 'success');
};

Aoi.ship.setShipped = async function () {
  var ids = Aoi.ship.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var status = document.getElementById('shipStatus').value;
  var idSet = {}; ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  d.orders.forEach(function (o) { if (idSet[o.id]) o.shipped = status; });
  await Aoi.saveTeamData(d);
  Aoi.ship.render();
  Aoi.toast('已设 ' + ids.length + ' 条为' + status, 'success');
  if (status === '已发') Aoi.notify.sync();
};

Aoi.ship.refillBatches = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('shipBatch');
  if (!sel) return;
  var cur = sel.value;
  var list = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  sel.innerHTML = '<option value="">选择批次…</option>' + list.map(function (b) {
    return '<option value="' + b.id + '">' + Aoi.escapeHtml(b.date + '（' + Aoi.orders.batchCount(b.id) + '）') + '</option>';
  }).join('');
  if (cur && d.batches.some(function (b) { return b.id === cur; })) sel.value = cur;
};

// 导出当前批次为 CSV（排发表）
Aoi.ship.export = function () {
  var batchId = document.getElementById('shipBatch').value;
  if (!batchId) { Aoi.toast('请先选择批次', 'warning'); return; }
  var d = Aoi.orders.ensure();
  var rows = d.orders.filter(function (o) { return o.batchId === batchId; });
  if (!rows.length) { Aoi.toast('该批次暂无订单', 'warning'); return; }
  var data = rows.map(function (o) {
    return {
      '购买者': o.buyer,
      '制品': o.type + ' - ' + o.model,
      '发货线路': Aoi.orders.typeRoute(o.type),
      '数量': o.count,
      '囤货地': Aoi.warehouse.name(o.warehouseId) || '',
      '快递单号': o.tracking || '',
      '合照': o.photo || '',
      '状态': o.shipped || '未发'
    };
  });
  var csv = '﻿' + XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(data));
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '排发_' + Aoi.orders.batchDate(batchId) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  Aoi.toast('已导出 ' + rows.length + ' 条', 'success');
};
