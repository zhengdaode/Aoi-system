// Aoi-system — 囤货地管理：站点 + 收款码 + 换囤货地申请审核
window.Aoi = window.Aoi || {};
Aoi.warehouse = {};

Aoi.warehouse.ensure = function () {
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.warehouses)) d.warehouses = [];
  if (!Array.isArray(d.transfers)) d.transfers = [];
  return d;
};

Aoi.warehouse.name = function (id) {
  var d = Aoi.warehouse.ensure();
  for (var i = 0; i < d.warehouses.length; i++) if (d.warehouses[i].id === id) return d.warehouses[i].name;
  return '';
};

// 团长：新增囤货地
Aoi.warehouse.add = async function () {
  var name = document.getElementById('whName').value.trim();
  var qr = document.getElementById('whQr').value.trim();
  if (!name) { Aoi.toast('请输入囤货地名称', 'warning'); return; }
  var d = Aoi.warehouse.ensure();
  d.warehouses.push({ id: Aoi.genId(), name: name, qrCode: qr });
  await Aoi.saveTeamData(d);
  document.getElementById('whName').value = '';
  document.getElementById('whQr').value = '';
  Aoi.warehouse.render();
  Aoi.warehouse.refillOptions();
  Aoi.toast('已新增囤货地', 'success');
};

Aoi.warehouse.remove = async function (id) {
  var d = Aoi.warehouse.ensure();
  d.warehouses = d.warehouses.filter(function (w) { return w.id !== id; });
  await Aoi.saveTeamData(d);
  Aoi.warehouse.render();
  Aoi.warehouse.refillOptions();
};

// 渲染设置页囤货地列表
Aoi.warehouse.render = function () {
  var d = Aoi.warehouse.ensure();
  var ul = document.getElementById('whList');
  if (!ul) return;
  ul.innerHTML = d.warehouses.length ? d.warehouses.map(function (w) {
    var qr = w.qrCode ? '<a href="' + Aoi.escapeHtml(w.qrCode) + '" target="_blank" class="text-blue-500 hover:underline text-xs ml-2">收款码</a>' : '';
    return '<li class="flex items-center justify-between border-b border-gray-200 py-2">'
      + '<span>' + Aoi.escapeHtml(w.name) + qr + '</span>'
      + '<button class="text-red-500 text-sm hover:underline" data-wh-del="' + w.id + '">删</button>'
      + '</li>';
  }).join('') : '<li class="text-sm text-gray-400 py-2">暂无囤货地</li>';
};

// 刷新囤货地下拉（团员申请目标选择）
Aoi.warehouse.refillOptions = function () {
  var d = Aoi.warehouse.ensure();
  var sel = document.getElementById('transferTo');
  if (!sel) return;
  sel.innerHTML = '<option value="">选择目标囤货地…</option>' + d.warehouses.map(function (w) {
    return '<option value="' + w.id + '">' + Aoi.escapeHtml(w.name) + '</option>';
  }).join('');
};

// 渲染审批页换囤货地申请（待处理）
Aoi.warehouse.renderTransfers = function () {
  var d = Aoi.warehouse.ensure();
  var tbody = document.getElementById('transferTbody');
  if (!tbody) return;
  var rows = d.transfers.filter(function (t) { return t.status === '待处理'; })
    .slice().sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
  tbody.innerHTML = rows.length ? rows.map(function (t) {
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(t.buyer) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(Aoi.orders.batchDate(t.batchId)) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(Aoi.warehouse.name(t.toWarehouseId)) + '</td>'
      + '<td class="px-3 py-2 text-sm text-gray-500">' + Aoi.escapeHtml(t.reason || '') + '</td>'
      + '<td class="px-3 py-2 whitespace-nowrap">'
      + '<button data-tapprove="' + t.id + '" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 mr-1">同意</button>'
      + '<button data-treject="' + t.id + '" class="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600">驳回</button>'
      + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">暂无换囤货地申请</td></tr>';
};

// 同意：把该买家在该批次的订单标记到目标囤货地
Aoi.warehouse.approve = async function (id) {
  var d = Aoi.warehouse.ensure();
  var t = null;
  for (var i = 0; i < d.transfers.length; i++) if (d.transfers[i].id === id) { t = d.transfers[i]; break; }
  if (!t) return;
  t.status = '已同意';
  d.orders.forEach(function (o) { if (o.buyer === t.buyer && o.batchId === t.batchId) o.warehouseId = t.toWarehouseId; });
  await Aoi.saveTeamData(d);
  Aoi.warehouse.renderTransfers();
  Aoi.toast('已同意 ' + t.buyer + ' 换囤货地', 'success');
};

Aoi.warehouse.reject = async function (id) {
  var d = Aoi.warehouse.ensure();
  for (var i = 0; i < d.transfers.length; i++) if (d.transfers[i].id === id) { d.transfers[i].status = '已驳回'; break; }
  await Aoi.saveTeamData(d);
  Aoi.warehouse.renderTransfers();
  Aoi.toast('已驳回', 'success');
};

// 事件委托：囤货地列表删除
document.getElementById('whList').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-wh-del]');
  if (btn) Aoi.warehouse.remove(btn.getAttribute('data-wh-del'));
});

// 事件委托：换囤货地申请审批
document.getElementById('transferTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-tapprove')) Aoi.warehouse.approve(btn.getAttribute('data-tapprove'));
  else if (btn.hasAttribute('data-treject')) Aoi.warehouse.reject(btn.getAttribute('data-treject'));
});
