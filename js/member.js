// Aoi-system — 团员端：免登录密钥 + CN 查询、缴国际费传凭证、发货确认、公告
window.Aoi = window.Aoi || {};
Aoi.member = {};
Aoi.member.state = { key: null, cn: null, teamName: null };

// 补齐团员端所需结构（orders/batches 由 orders.ensure，payments 由 approval.ensure）
Aoi.member.ensure = function () {
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.announcements)) d.announcements = [];
  Aoi.approval.ensure();
  return d;
};

// 进入团员端：校验密钥 + CN，拉取团队数据，渲染
Aoi.member.enter = async function () {
  var key = document.getElementById('memberKey').value.trim();
  var cn = document.getElementById('memberCn').value.trim();
  if (!key || !cn) { Aoi.toast('请输入团员密钥和圈名（CN）', 'warning'); return; }

  Aoi.showLoading('加载中...');
  var res = await Aoi.getTeamDataByMemberKey(key);
  Aoi.hideLoading();
  if (!res) { Aoi.toast('密钥无效', 'error'); return; }

  Aoi.member.state.key = key;
  Aoi.member.state.cn = cn;
  Aoi.member.state.teamName = res.name || '团队';
  // 复用现有模块（orders / intl / approval）统一读 Aoi.state.data
  Aoi.state.data = res.data;
  Aoi.member.ensure();

  Aoi.member.render();
  document.getElementById('member-entry').classList.add('hidden');
  document.getElementById('member-board').classList.remove('hidden');
};

// 渲染团员看板
Aoi.member.render = function () {
  var cn = Aoi.member.state.cn;
  document.getElementById('memberTeamName').textContent = Aoi.member.state.teamName;
  document.getElementById('memberCnLabel').textContent = '圈名：' + cn;
  Aoi.member.renderAnnounce();
  Aoi.member.renderFees(cn);
  Aoi.member.renderOrders(cn);
};

// 公告（新→旧）
Aoi.member.renderAnnounce = function () {
  var d = Aoi.orders.ensure();
  var list = (d.announcements || []).slice().sort(function (a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });
  var ul = document.getElementById('memberAnnounce');
  ul.innerHTML = list.length ? list.map(function (a) {
    return '<li class="border-b border-gray-100 py-2">'
      + '<p class="text-sm whitespace-pre-wrap">' + Aoi.escapeHtml(a.text) + '</p>'
      + '<p class="text-xs text-gray-400 mt-1">' + Aoi.escapeHtml(a.date || '') + '</p>'
      + '</li>';
  }).join('') : '<li class="text-sm text-gray-400 py-2">暂无公告</li>';
};

// 我的国际费：按到货批次，复用 intl 分摊 + approval 交费状态
Aoi.member.renderFees = function (cn) {
  var d = Aoi.orders.ensure();
  var myBatches = {};
  d.orders.forEach(function (o) {
    if (o.buyer !== cn || !o.batchId) return;
    if (!myBatches[o.batchId]) {
      var b = Aoi.intl.getBatch(o.batchId);
      if (b) myBatches[o.batchId] = b;
    }
  });

  var ids = Object.keys(myBatches).sort(function (a, b) {
    return (myBatches[a].date || '') < (myBatches[b].date || '') ? -1 : 1;
  });

  var tbody = document.getElementById('memberFeeTbody');
  tbody.innerHTML = ids.length ? ids.map(function (batchId) {
    var batch = myBatches[batchId];
    var items = Aoi.intl.buildItems(batch);
    var totals = Aoi.intl.buyerTotals(batchId, items);
    var fee = totals[cn] || 0;
    var rec = Aoi.approval.getRecord(batchId, cn);
    var status = rec ? rec.status : '待交';
    var receipt = rec ? rec.receipt : null;

    var action;
    if (status !== '已交') {
      action = '<input id="receipt_' + batchId + '" type="text" placeholder="付款凭证 URL" class="w-40 border border-gray-300 rounded px-2 py-1 text-xs">'
        + '<button data-batch="' + batchId + '" class="ml-2 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">提交凭证</button>';
    } else if (receipt) {
      action = '<a href="' + Aoi.escapeHtml(receipt) + '" target="_blank" class="text-blue-500 hover:underline text-xs">查看凭证</a>';
    } else {
      action = '<span class="text-gray-400 text-xs">已交</span>';
    }

    return '<tr class="border-b border-gray-100">'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(batch.date || '') + '</td>'
      + '<td class="px-3 py-2 text-right font-semibold">¥' + fee.toFixed(2) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.approval.statusBadge(status) + '</td>'
      + '<td class="px-3 py-2">' + action + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="4" class="px-3 py-2 text-gray-400">暂无到货批次（该圈名还没有已到货的订单）</td></tr>';

  var stat = document.getElementById('memberFeeStat');
  if (stat) stat.textContent = ids.length ? '共 ' + ids.length + ' 个到货批次' : '';
};

// 我的订单：按圈名过滤
Aoi.member.renderOrders = function (cn) {
  var d = Aoi.orders.ensure();
  var rows = d.orders.filter(function (o) { return o.buyer === cn; });
  var tbody = document.getElementById('memberOrderTbody');
  tbody.innerHTML = rows.length ? rows.map(function (o) {
    var sum = o.price * o.count;
    var shipped = (o.shipped || '未发') === '已发';
    var confirm;
    if (shipped && !o.received) {
      confirm = '<button data-order="' + o.id + '" class="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">确认收货</button>';
    } else if (o.received) {
      confirm = '<span class="text-green-600 text-xs">已确认</span>';
    } else {
      confirm = '<span class="text-gray-400 text-xs">未发货</span>';
    }
    var tracking = o.tracking || '—';
    return '<tr class="border-b border-gray-100">'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.activity) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.type + ' - ' + o.model) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.price.toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.count + '</td>'
      + '<td class="px-3 py-2 text-right">' + sum.toFixed(2) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.batchId ? Aoi.orders.batchDate(o.batchId) : '—') + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(tracking) + '</td>'
      + '<td class="px-3 py-2">' + confirm + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="8" class="px-3 py-2 text-gray-400">没有找到该圈名的订单，请确认 CN 是否正确</td></tr>';
};

// 提交付款凭证：写 payments，状态置为待审核
Aoi.member.submitReceipt = async function (batchId, receiptUrl) {
  if (!receiptUrl) { Aoi.toast('请填写付款凭证 URL', 'warning'); return; }
  var cn = Aoi.member.state.cn;
  var d = Aoi.approval.ensure();
  var p = Aoi.approval.getRecord(batchId, cn);
  if (p) {
    p.receipt = receiptUrl;
    p.receiptDate = new Date().toISOString();
    p.status = '待审核';
  } else {
    d.payments.push({ id: Aoi.genId(), batchId: batchId, buyer: cn, status: '待审核', receipt: receiptUrl, receiptDate: new Date().toISOString() });
  }
  await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
  Aoi.member.renderFees(cn);
  Aoi.toast('凭证已提交，等待团长审核', 'success');
};

// 确认收货
Aoi.member.confirmShip = async function (orderId) {
  var d = Aoi.orders.ensure();
  for (var i = 0; i < d.orders.length; i++) {
    if (d.orders[i].id === orderId) { d.orders[i].received = true; break; }
  }
  await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
  Aoi.member.renderOrders(Aoi.member.state.cn);
  Aoi.toast('已确认收货', 'success');
};

// 事件委托：我的国际费「提交凭证」
document.getElementById('memberFeeTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-batch]');
  if (!btn) return;
  var batchId = btn.getAttribute('data-batch');
  var input = document.getElementById('receipt_' + batchId);
  Aoi.member.submitReceipt(batchId, input ? input.value.trim() : '');
});

// 事件委托：我的订单「确认收货」
document.getElementById('memberOrderTbody').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-order]');
  if (btn) Aoi.member.confirmShip(btn.getAttribute('data-order'));
});

// 退出团员端
Aoi.member.logout = function () {
  Aoi.member.state = { key: null, cn: null, teamName: null };
  Aoi.state.data = {};
  document.getElementById('member-board').classList.add('hidden');
  document.getElementById('member-entry').classList.remove('hidden');
  Aoi.showScreen('screen-auth');
};
