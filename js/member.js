// Aoi-system — 团员端：免登录密钥 + CN 查询、缴国际费传凭证、发货确认、公告
window.Aoi = window.Aoi || {};
Aoi.member = {};
Aoi.member.state = { key: null, cn: null, teamName: null };

// 补齐团员端所需结构（orders/batches 由 orders.ensure，payments 由 approval.ensure）
Aoi.member.ensure = function () {
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.announcements)) d.announcements = [];
  Aoi.approval.ensure();
  Aoi.notify.ensure();
  return d;
};

// 进入团员端：校验密钥 + CN，拉取团队数据，渲染
Aoi.member.enter = async function () {
  var key = document.getElementById('memberKey').value.trim();
  var id = document.getElementById('memberId').value.trim();
  if (!key || !id) { Aoi.toast('请输入团员密钥和圈名（CN）或 QQ 号', 'warning'); return; }

  Aoi.showLoading('加载中...');
  var res = await Aoi.getTeamDataByMemberKey(key);
  Aoi.hideLoading();
  if (!res) { Aoi.toast('密钥无效', 'error'); return; }

  // 复用现有模块（orders / intl / approval）统一读 Aoi.state.data
  Aoi.state.data = res.data;
  Aoi.member.ensure();

  var cn = Aoi.member.resolveCn(id);
  if (!cn) { Aoi.toast('未找到该圈名（CN）或 QQ 号，请确认后重试', 'error'); return; }

  Aoi.member.state.key = key;
  Aoi.member.state.cn = cn;
  Aoi.member.state.teamName = res.name || '团队';

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
  Aoi.member.renderAddress(cn);
  Aoi.member.renderBind(cn);
  Aoi.member.refillTransferBatches();
  Aoi.warehouse.refillOptions();
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
  tbody.innerHTML = ids.length ? ids.map(function (batchId, i) {
    var batch = myBatches[batchId];
    var rec = Aoi.approval.getRecord(batchId, cn);
    var items = Aoi.intl.buildItems(batch);
    var totals = Aoi.intl.buyerTotals(batchId, items);
    var fee = (rec && rec.intlFee != null) ? rec.intlFee : (totals[cn] || 0);
    var status = rec ? rec.status : '待交';
    var receipt = rec ? rec.receipt : null;

    var action;
    if (status !== '已交') {
      action = '<input id="receipt_' + batchId + '" type="text" placeholder="付款凭证 URL" class="w-40 border border-gray-300 rounded px-2 py-1 text-xs">'
        + '<label class="ml-2 px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded cursor-pointer hover:bg-gray-300">上传<input type="file" accept="image/*" class="hidden" onchange="Aoi.img.fill(this, \'receipt_' + batchId + '\')"></label>'
        + '<button data-batch="' + batchId + '" class="ml-2 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">提交凭证</button>';
    } else if (receipt) {
      action = '<a href="' + Aoi.escapeHtml(receipt) + '" target="_blank" class="text-blue-500 hover:underline text-xs">查看凭证</a>';
    } else {
      action = '<span class="text-gray-400 text-xs">已交</span>';
    }

    return '<tr class="border-b border-gray-100">'
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(batch.date || '') + '</td>'
      + '<td class="px-3 py-2 text-right font-semibold">¥' + fee.toFixed(2) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.approval.statusBadge(status) + '</td>'
      + '<td class="px-3 py-2">' + action + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="5" class="px-3 py-2 text-gray-400">暂无到货批次（该圈名还没有已到货的订单）</td></tr>';

  var stat = document.getElementById('memberFeeStat');
  if (stat) stat.textContent = ids.length ? '共 ' + ids.length + ' 个到货批次' : '';
};

// 我的订单：按圈名过滤
Aoi.member.renderOrders = function (cn) {
  var d = Aoi.orders.ensure();
  var rows = d.orders.filter(function (o) { return o.buyer === cn; });
  var tbody = document.getElementById('memberOrderTbody');
  tbody.innerHTML = rows.length ? rows.map(function (o, i) {
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
      + '<td class="px-2 py-2 text-right text-gray-400 select-none">' + (i + 1) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.activity) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.type + ' - ' + o.model) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.price.toFixed(2) + '</td>'
      + '<td class="px-3 py-2 text-right">' + o.count + '</td>'
      + '<td class="px-3 py-2 text-right">' + sum.toFixed(2) + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(o.batchId ? Aoi.orders.batchDate(o.batchId) : '—') + '</td>'
      + '<td class="px-3 py-2">' + Aoi.escapeHtml(tracking) + '</td>'
      + '<td class="px-3 py-2">' + confirm + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="9" class="px-3 py-2 text-gray-400">没有找到该圈名的订单，请确认 CN 是否正确</td></tr>';
};

// —— 收件地址：只写不读（保护隐私），提交后在 QQ 通知团长 ——

Aoi.member.address = function (cn) {
  var d = Aoi.orders.ensure();
  return (d.addresses && d.addresses[cn]) || '';
};

Aoi.member.renderAddress = function (cn) {
  var has = !!Aoi.member.address(cn);
  var status = document.getElementById('memberAddrStatus');
  if (status) status.textContent = has ? '已填写（为保护隐私，不显示原文）' : '未填写';
};

Aoi.member.saveAddress = async function () {
  var addr = document.getElementById('memberAddr').value.trim();
  if (!addr) { Aoi.toast('请输入收件地址', 'warning'); return; }
  var cn = Aoi.member.state.cn;
  try {
    var d = Aoi.member.ensure();
    d.addresses[cn] = addr;
    d.notifications.push({
      id: Aoi.genId(), type: 'address', buyer: cn, batchId: null,
      title: '收件地址更新',
      body: cn + ' 更新了收件地址：' + addr,
      date: new Date().toISOString().slice(0, 10), sent: false
    });
    await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
    document.getElementById('memberAddr').value = '';
    Aoi.member.renderAddress(cn);
    Aoi.toast('收件地址已保存，团长将收到通知', 'success');
  } catch (e) {
    Aoi.toast('地址保存失败：' + (e && e.message ? e.message : e), 'error');
  }
};

// —— QQ 绑定 + QQ 查询 + 申请改圈名 ——

// 用输入（圈名或 QQ 号）解析到圈名；查不到返回 null
Aoi.member.resolveCn = function (id) {
  var d = Aoi.orders.ensure();
  if (!id) return null;
  var buyers = Aoi.orders.collectBuyers(d);
  if (buyers.indexOf(id) >= 0) return id;
  var meta = d.memberMeta || {};
  var found = null;
  Object.keys(meta).forEach(function (cn) {
    if (meta[cn] && String(meta[cn].qq) === id) found = cn;
  });
  return found;
};

Aoi.member.qq = function (cn) {
  var d = Aoi.orders.ensure();
  return (d.memberMeta && d.memberMeta[cn] && d.memberMeta[cn].qq) || '';
};

Aoi.member.renderBind = function (cn) {
  var box = document.getElementById('memberQqBox');
  if (!box) return;
  var qq = Aoi.member.qq(cn);
  box.innerHTML = qq
    ? '<p class="text-sm text-gray-600">已绑定 QQ：<span class="font-semibold">' + Aoi.escapeHtml(qq) + '</span></p>'
    : '<div class="flex items-center gap-2">'
      + '<input id="memberQq" type="text" placeholder="QQ 号（可选，便于机器人联系提醒）" class="flex-1 border border-gray-300 rounded px-3 py-2 text-sm">'
      + '<button onclick="Aoi.member.bindQq()" class="px-3 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600">绑定</button>'
      + '</div>'
      + '<p class="text-xs text-gray-400 mt-1">绑定后可用 QQ 号登录查询；团长也能通过机器人私聊提醒</p>';
};

Aoi.member.bindQq = async function () {
  var qq = document.getElementById('memberQq').value.trim();
  var cn = Aoi.member.state.cn;
  if (!qq) { Aoi.toast('请输入 QQ 号', 'warning'); return; }
  try {
    var d = Aoi.orders.ensure();
    d.memberMeta = d.memberMeta || {};
    d.memberMeta[cn] = d.memberMeta[cn] || {};
    d.memberMeta[cn].qq = qq;
    await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
    Aoi.member.renderBind(cn);
    Aoi.toast('QQ 已绑定', 'success');
  } catch (e) {
    Aoi.toast('QQ 绑定失败：' + (e && e.message ? e.message : e), 'error');
  }
};

// 团员申请改圈名：写 cnChanges + 生成改圈名通知
Aoi.member.submitCnChange = async function () {
  var newCn = document.getElementById('memberNewCn').value.trim();
  var cn = Aoi.member.state.cn;
  if (!newCn) { Aoi.toast('请输入新圈名', 'warning'); return; }
  if (newCn === cn) { Aoi.toast('新圈名与当前圈名相同', 'warning'); return; }
  var d = Aoi.orders.ensure();
  if (Aoi.orders.collectBuyers(d).indexOf(newCn) >= 0) { Aoi.toast('该圈名已被占用', 'error'); return; }
  var qq = Aoi.member.qq(cn);
  try {
    d.cnChanges = d.cnChanges || [];
    d.cnChanges.push({ id: Aoi.genId(), oldCn: cn, newCn: newCn, qq: qq, status: '待处理', date: new Date().toISOString().slice(0, 10) });
    d.notifications = d.notifications || [];
    d.notifications.push({
      id: Aoi.genId(), type: 'cnchange', buyer: cn, batchId: null,
      title: '改圈名申请',
      body: cn + ' 申请改圈名为「' + newCn + '」' + (qq ? '（QQ：' + qq + '）' : ''),
      date: new Date().toISOString().slice(0, 10), sent: false
    });
    await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
    document.getElementById('memberNewCn').value = '';
    var st = document.getElementById('memberCnChangeStatus');
    if (st) st.textContent = '已提交，等待团长审核';
    Aoi.toast('改圈名申请已提交', 'success');
  } catch (e) {
    Aoi.toast('改圈名提交失败：' + (e && e.message ? e.message : e), 'error');
  }
};

// 提交付款凭证：写 payments，状态置为待审核
Aoi.member.submitReceipt = async function (batchId, receiptUrl) {
  if (!receiptUrl) { Aoi.toast('请填写付款凭证 URL', 'warning'); return; }
  var cn = Aoi.member.state.cn;
  try {
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
  } catch (e) {
    Aoi.toast('凭证提交失败：' + (e && e.message ? e.message : e), 'error');
  }
};

// 确认收货
Aoi.member.confirmShip = async function (orderId) {
  try {
    var d = Aoi.orders.ensure();
    for (var i = 0; i < d.orders.length; i++) {
      if (d.orders[i].id === orderId) { d.orders[i].received = true; break; }
    }
    await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
    Aoi.member.renderOrders(Aoi.member.state.cn);
    Aoi.toast('已确认收货', 'success');
  } catch (e) {
    Aoi.toast('确认收货失败：' + (e && e.message ? e.message : e), 'error');
  }
};

// 刷新「申请换囤货地」的批次下拉（只看自己的到货批次）
Aoi.member.refillTransferBatches = function () {
  var d = Aoi.orders.ensure();
  var cn = Aoi.member.state.cn;
  var myBatches = {};
  d.orders.forEach(function (o) { if (o.buyer === cn && o.batchId) myBatches[o.batchId] = 1; });
  var sel = document.getElementById('memberTransferBatch');
  if (!sel) return;
  sel.innerHTML = '<option value="">选择到货批次…</option>' + Object.keys(myBatches).sort(function (a, b) {
    return Aoi.orders.batchDate(a) < Aoi.orders.batchDate(b) ? -1 : 1;
  }).map(function (id) {
    return '<option value="' + id + '">' + Aoi.escapeHtml(Aoi.orders.batchDate(id)) + '</option>';
  }).join('');
};

// 提交换囤货地申请
Aoi.member.submitTransfer = async function () {
  var batchId = document.getElementById('memberTransferBatch').value;
  var toId = document.getElementById('transferTo').value;
  var reason = document.getElementById('memberTransferReason').value.trim();
  if (!batchId || !toId) { Aoi.toast('请选择到货批次和目标囤货地', 'warning'); return; }
  try {
    var d = Aoi.warehouse.ensure();
    d.transfers.push({ id: Aoi.genId(), buyer: Aoi.member.state.cn, batchId: batchId, toWarehouseId: toId, reason: reason, status: '待处理', date: new Date().toISOString().slice(0, 10) });
    await Aoi.saveTeamDataByMemberKey(Aoi.member.state.key, d);
    document.getElementById('memberTransferReason').value = '';
    Aoi.toast('换囤货地申请已提交，等待团长审核', 'success');
  } catch (e) {
    Aoi.toast('申请提交失败：' + (e && e.message ? e.message : e), 'error');
  }
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
