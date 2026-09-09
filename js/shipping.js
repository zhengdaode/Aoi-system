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
  tbody.innerHTML = rows.map(function (o, i) {
    if ((o.shipped || '未发') === '已发') shipped++;
    // v3.7.0 S8：合照列由文字链接升级为缩略图（点击原窗口打开大图）
    var photo = o.photo
      ? '<a href="' + Aoi.escapeHtml(o.photo) + '" target="_blank" title="查看合照大图"><img src="' + Aoi.escapeHtml(o.photo) + '" alt="合照" class="w-10 h-10 object-cover rounded border border-gray-200"></a>'
      : '<span class="text-gray-400">—</span>';
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-2 py-2"><input type="checkbox" class="ship-check" data-id="' + o.id + '"></td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.buyer) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.type + ' - ' + o.model) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(Aoi.orders.typeRoute(o.type)) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.count + '</td>'
      + '<td class="px-3 py-2">' + Aoi.ship.warehouseSelect(o.id, o.warehouseId) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(Aoi.member.address(o.buyer) || '—') + '</td>'
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

// 每行囤货地下拉（到货后按商品/订单分配囤货地）
Aoi.ship.warehouseSelect = function (orderId, selectedId) {
  var d = Aoi.warehouse.ensure();
  var opts = '<option value="">—</option>' + d.warehouses.map(function (w) {
    return '<option value="' + w.id + '"' + (w.id === selectedId ? ' selected' : '') + '>' + Aoi.escapeHtml(w.name) + '</option>';
  }).join('');
  return '<select onchange="Aoi.ship.setWarehouse(\'' + orderId + '\', this.value)" class="border border-gray-300 rounded px-1 py-1 text-xs">' + opts + '</select>';
};

Aoi.ship.setWarehouse = async function (orderId, warehouseId) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < d.orders.length; i++) {
    if (d.orders[i].id === orderId) { d.orders[i].warehouseId = warehouseId || null; break; }
  }
  await Aoi.saveTeamData(d);
  Aoi.toast('囤货地已更新', 'success');
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
  var batchId = document.getElementById('shipBatch').value;
  var idSet = {}; ids.forEach(function (id) { idSet[id] = 1; });
  var d = Aoi.orders.ensure();
  d.orders.forEach(function (o) {
    if (!idSet[o.id]) return;
    o.shipped = status;
    // v3.5.0 F6：首标已发时记录发货时间戳（复盘统计的发货时效数据源；切回未发不删除，避免反复切换失真）
    if (status === '已发' && !o.shippedAt) o.shippedAt = new Date().toISOString();
  });
  await Aoi.saveTeamData(d);
  Aoi.ship.render();
  Aoi.toast('已设 ' + ids.length + ' 条为' + status, 'success');
  if (status === '已发') {
    Aoi.notify.sync();
    // F5-H①：批量设为已发后排发表 xlsx 自动私发管理员；
    // 异步执行且失败只提示，不影响「设为已发」本身
    if (Aoi.bot.config.enabled && Aoi.bot.config.relay && Aoi.bot.config.adminQq) {
      Aoi.bot.exportShipping(batchId).then(function () {
        Aoi.toast('排发表已私发管理员 QQ', 'success');
      }).catch(function (e) {
        Aoi.toast('排发表私发失败：' + (e && e.message ? e.message : e), 'error');
      });
    }
  }
  Aoi.overview.render();
};

Aoi.ship.refillBatches = function () {
  Aoi.orders.refillBatchSelect(document.getElementById('shipBatch'), '选择批次…');
};
