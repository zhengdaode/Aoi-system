// Aoi-system — 通知公告：自动提醒（催缴/发货）+ QQ 机器人推送入口
window.Aoi = window.Aoi || {};
Aoi.notify = {};

Aoi.notify.TYPES = {
  remind: { label: '催缴通知', color: 'text-amber-500' },
  shipped: { label: '发货通知', color: 'text-green-600' },
  address: { label: '收件地址更新', color: 'text-blue-500' }
};

// 补齐 notifications 结构
Aoi.notify.ensure = function () {
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.notifications)) d.notifications = [];
  return d;
};

// 去重键：同类型 × 买家 × 批次只自动提醒一次
Aoi.notify.keyOf = function (n) {
  return n.type + '|' + (n.buyer || '') + '|' + (n.batchId || '');
};

Aoi.notify.buildRemind = function (batchId, buyer, fee, status) {
  return {
    id: Aoi.genId(), type: 'remind', buyer: buyer, batchId: batchId,
    title: '催缴通知',
    body: buyer + '：应付国际费 ¥' + fee.toFixed(2) + (status === '已驳回' ? '（此前已驳回，请重新交费）' : '（请尽快交费）'),
    date: new Date().toISOString().slice(0, 10), sent: false
  };
};

// 发货文案（同批次同买家聚合）
Aoi.notify.buildShipped = function (batchId, buyer, orders) {
  var tracks = orders.map(function (o) { return o.tracking || '（无单号）'; }).join('、');
  return {
    id: Aoi.genId(), type: 'shipped', buyer: buyer, batchId: batchId,
    title: '发货通知',
    body: buyer + '：你的 ' + orders.length + ' 件商品已发货，快递单号：' + tracks,
    date: new Date().toISOString().slice(0, 10), sent: false
  };
};

// 自动同步：按当前数据补齐未通知的催缴/发货（幂等去重）
Aoi.notify.sync = async function () {
  try {
    var d = Aoi.notify.ensure();
    var seen = {};
    d.notifications.forEach(function (n) { seen[Aoi.notify.keyOf(n)] = 1; });
    var added = 0;

    d.batches.forEach(function (b) {
      Aoi.approval.buyerSummary(b.id).forEach(function (r) {
        if (r.status !== '待交' && r.status !== '已驳回') return;
        var n = Aoi.notify.buildRemind(b.id, r.buyer, r.intlFee, r.status);
        if (seen[Aoi.notify.keyOf(n)]) return;
        d.notifications.push(n); seen[Aoi.notify.keyOf(n)] = 1; added++;
      });
    });

    var byBuyer = {};
    d.orders.forEach(function (o) {
      if ((o.shipped || '未发') !== '已发') return;
      var k = o.buyer + '|' + (o.batchId || '');
      if (!byBuyer[k]) byBuyer[k] = { buyer: o.buyer, batchId: o.batchId, orders: [] };
      byBuyer[k].orders.push(o);
    });
    Object.keys(byBuyer).forEach(function (k) {
      var g = byBuyer[k];
      var n = Aoi.notify.buildShipped(g.batchId, g.buyer, g.orders);
      if (seen[Aoi.notify.keyOf(n)]) return;
      d.notifications.push(n); seen[Aoi.notify.keyOf(n)] = 1; added++;
    });

    if (added) await Aoi.saveTeamData(d);
    Aoi.notify.render();
  } catch (e) { /* 自动同步失败不打断主流程 */ }
};

// 手动补发（按批次显式生成，不去重）
Aoi.notify.generate = async function (type) {
  var batchId = document.getElementById('notifyBatch').value;
  if (!batchId) { Aoi.toast('请先选择批次', 'warning'); return; }
  var d = Aoi.notify.ensure();
  var created = 0;
  if (type === 'remind') {
    Aoi.approval.buyerSummary(batchId).forEach(function (r) {
      if (r.status !== '待交' && r.status !== '已驳回') return;
      d.notifications.push(Aoi.notify.buildRemind(batchId, r.buyer, r.intlFee, r.status)); created++;
    });
  } else if (type === 'shipped') {
    var byBuyer = {};
    d.orders.forEach(function (o) {
      if (o.batchId !== batchId || (o.shipped || '未发') !== '已发') return;
      if (!byBuyer[o.buyer]) byBuyer[o.buyer] = [];
      byBuyer[o.buyer].push(o);
    });
    Object.keys(byBuyer).forEach(function (k) { d.notifications.push(Aoi.notify.buildShipped(batchId, k, byBuyer[k])); created++; });
  }
  await Aoi.saveTeamData(d);
  Aoi.notify.render();
  Aoi.toast(created ? '已生成 ' + created + ' 条通知' : '没有需要通知的对象', created ? 'success' : 'info');
};

// 渲染通知列表（新→旧）
Aoi.notify.render = function () {
  var d = Aoi.notify.ensure();
  var tbody = document.getElementById('notifyTbody');
  if (!tbody) return;
  var list = d.notifications.slice().sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
  tbody.innerHTML = list.length ? list.map(function (n) {
    var t = Aoi.notify.TYPES[n.type] || { label: n.type, color: 'text-gray-500' };
    return '<tr class="border-b border-gray-100 hover:bg-gray-50">'
      + '<td class="px-3 py-2 whitespace-nowrap"><span class="' + t.color + ' text-xs font-semibold">' + Aoi.escapeHtml(t.label) + '</span></td>'
      + '<td class="px-3 py-2 whitespace-nowrap">' + Aoi.escapeHtml(n.buyer) + '</td>'
      + '<td class="px-3 py-2 text-sm">' + Aoi.escapeHtml(n.body) + '</td>'
      + '<td class="px-3 py-2 whitespace-nowrap text-xs text-gray-400">' + Aoi.escapeHtml(n.date || '') + '</td>'
      + '<td class="px-3 py-2 whitespace-nowrap">'
      + '<button data-copy="' + n.id + '" class="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">复制</button> '
      + '<button data-toggle="' + n.id + '" class="px-2 py-1 ' + (n.sent ? 'bg-green-600' : 'bg-gray-400') + ' text-white text-xs rounded hover:opacity-90">' + (n.sent ? '已发' : '未发') + '</button> '
      + '<button data-del="' + n.id + '" class="px-2 py-1 text-red-500 text-xs hover:underline">删</button>'
      + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">暂无通知（点「同步生成」或上方按钮生成）</td></tr>';
  var stat = document.getElementById('notifyStat');
  if (stat) stat.textContent = list.length ? '共 ' + list.length + ' 条 · 未发 ' + list.filter(function (n) { return !n.sent; }).length : '';
};

// 刷新批次下拉
Aoi.notify.refillBatches = function () {
  var d = Aoi.orders.ensure();
  var sel = document.getElementById('notifyBatch');
  if (!sel) return;
  var cur = sel.value;
  var list = d.batches.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  sel.innerHTML = '<option value="">选择批次…</option>' + list.map(function (b) {
    return '<option value="' + b.id + '">' + Aoi.escapeHtml(b.date + '（' + Aoi.orders.batchCount(b.id) + '）') + '</option>';
  }).join('');
  if (cur && d.batches.some(function (b) { return b.id === cur; })) sel.value = cur;
};

Aoi.notify.byId = function (id) {
  var d = Aoi.notify.ensure();
  for (var i = 0; i < d.notifications.length; i++) if (d.notifications[i].id === id) return d.notifications[i];
  return null;
};

Aoi.notify.copy = function (id) {
  var n = Aoi.notify.byId(id);
  if (!n) return;
  Aoi.copyText(n.body).then(function () { Aoi.toast('已复制', 'success'); });
};

Aoi.notify.copyAll = function () {
  var d = Aoi.notify.ensure();
  var unsent = d.notifications.filter(function (n) { return !n.sent; });
  if (!unsent.length) { Aoi.toast('没有未发送的通知', 'info'); return; }
  Aoi.copyText(unsent.map(function (n) { return n.body; }).join('\n'))
    .then(function () { Aoi.toast('已复制 ' + unsent.length + ' 条', 'success'); });
};

Aoi.notify.toggleSent = async function (id) {
  var d = Aoi.notify.ensure();
  for (var i = 0; i < d.notifications.length; i++) {
    if (d.notifications[i].id === id) { d.notifications[i].sent = !d.notifications[i].sent; break; }
  }
  await Aoi.saveTeamData(d);
  Aoi.notify.render();
};

Aoi.notify.remove = async function (id) {
  var d = Aoi.notify.ensure();
  d.notifications = d.notifications.filter(function (n) { return n.id !== id; });
  await Aoi.saveTeamData(d);
  Aoi.notify.render();
};

Aoi.notify.clearSent = async function () {
  var d = Aoi.notify.ensure();
  var before = d.notifications.length;
  d.notifications = d.notifications.filter(function (n) { return !n.sent; });
  await Aoi.saveTeamData(d);
  Aoi.notify.render();
  Aoi.toast('已清除 ' + (before - d.notifications.length) + ' 条已发送', 'success');
};

// 通过 QQ 机器人推送未发通知（未接入时抛错提示）
Aoi.notify.pushBot = async function () {
  var d = Aoi.notify.ensure();
  var unsent = d.notifications.filter(function (n) { return !n.sent; });
  if (!unsent.length) { Aoi.toast('没有未发送的通知', 'info'); return; }
  try {
    await Aoi.bot.pushAll(unsent);
    Aoi.toast('已推送 ' + unsent.length + ' 条', 'success');
  } catch (e) {
    Aoi.toast(e.message || 'QQ 机器人未接入', 'warning');
  }
};

// 事件委托：通知列表操作
document.getElementById('notifyTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-copy')) Aoi.notify.copy(btn.getAttribute('data-copy'));
  else if (btn.hasAttribute('data-toggle')) Aoi.notify.toggleSent(btn.getAttribute('data-toggle'));
  else if (btn.hasAttribute('data-del')) Aoi.notify.remove(btn.getAttribute('data-del'));
});
