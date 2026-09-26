// Aoi-system — QQ 工单处理台（F11-M13，docs/PLAN-F11-BOT-QA.md）
// 买家 QQ 私聊「转人工 内容」→ relay 归档为工单 → 管理员在本页查看/回复/改状态/设置 QQ 提醒。
// 数据源：relay 根路由 ticketOp 协议（/onebot/* 子路径经 Edge 透传实测不可用，见 relay.js 注释）。
// 说明：旧工单（relay 未存完整 QQ 的）不能 QQ 回复，界面会提示改为看板/群内联系。
window.Aoi = window.Aoi || {};
Aoi.tickets = {};

Aoi.tickets.rows = [];
Aoi.tickets.current = null;   // 详情面板当前工单

// 状态中英文映射（与 relay QUESTION_STATUSES 对齐）
Aoi.tickets.STATUS_LABEL = {
  open: '等待查看',
  forwarded: '已转发',
  working: '解决中',
  resolved: '已解决'
};
Aoi.tickets.STATUS_CLASS = {
  open: 'bg-gray-100 text-gray-600',
  forwarded: 'bg-blue-50 text-blue-600',
  working: 'bg-amber-50 text-amber-600',
  resolved: 'bg-green-50 text-green-600'
};

// —— 纯函数（vitest 覆盖） ——

// 工单行 → 联系方式展示
Aoi.tickets.contactOf = function (row) {
  if (row.qq) return 'QQ ' + row.qq;
  return 'QQ尾' + (row.qqTail || '????');
};

// 时间展示：ISO → MM-DD HH:MM（本地）
Aoi.tickets.fmtTime = function (iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

// 回复文案：与 relay 端点拼装一致（relay 侧再加【回复 编号】头，这里传正文）
Aoi.tickets.replyText = function (row, text) {
  return String(text || '').trim();
};

// —— 数据 ——

Aoi.tickets.load = async function (manual) {
  try {
    var out = await Aoi.bot.request({ ticketOp: 'list', days: 14, how: 'forward' });
    Aoi.tickets.rows = out.rows || [];
    Aoi.tickets.render();
    if (manual) Aoi.toast('已刷新（近 14 天 ' + Aoi.tickets.rows.length + ' 条工单）', 'success');
  } catch (e) {
    Aoi.tickets.rows = [];
    Aoi.tickets.render();
    if (manual || Aoi.tickets._warnOnce !== true) {
      Aoi.tickets._warnOnce = true;
      Aoi.toast('工单加载失败：' + (e && e.message), 'warning');
    }
  }
};

// —— 渲染 ——

Aoi.tickets.render = function () {
  var tbody = document.getElementById('ticketTbody');
  if (!tbody) return;
  if (!Aoi.tickets.rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-3 py-6 text-center text-gray-400 text-sm">近 14 天没有转人工工单</td></tr>';
    return;
  }
  tbody.innerHTML = Aoi.tickets.rows.map(function (r) {
    var cls = Aoi.tickets.STATUS_CLASS[r.status] || 'bg-gray-100 text-gray-600';
    var label = Aoi.tickets.STATUS_LABEL[r.status] || r.status;
    var replies = (r.replies || []).length;
    var reminds = (r.reminders || []).length;
    var badge = (r.importance >= 100 ? '<span class="text-red-500 font-bold mr-1">⚠</span>' : '');
    return '<tr class="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onclick="Aoi.tickets.openDetail(\'' + r.id + '\')">'
      + '<td class="px-3 py-2 font-mono text-xs">' + r.id + '</td>'
      + '<td class="px-3 py-2">' + badge + Aoi.escapeHtml(r.cn || '未绑定') + '</td>'
      + '<td class="px-3 py-2 text-gray-500 text-xs">' + Aoi.escapeHtml(Aoi.tickets.contactOf(r)) + '</td>'
      + '<td class="px-3 py-2 text-xs text-gray-500">' + Aoi.escapeHtml(Aoi.tickets.fmtTime(r.ts)) + '</td>'
      + '<td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs font-bold ' + cls + '">' + label + '</span>'
      + (replies ? '<span class="ml-1 text-xs text-gray-400">回' + replies + '</span>' : '')
      + (reminds ? '<span class="ml-1 text-xs text-amber-500">铃' + reminds + '</span>' : '')
      + '</td></tr>';
  }).join('');
};

// 详情卡（按用户定稿布局：编号头 / 昵称+提交时间 / 联系方式 / 问题块 / 回复记录 / 回复框 /
// 一键同步到QQ / 状态下拉 / QQ 提醒）
Aoi.tickets.openDetail = function (id) {
  var row = Aoi.tickets.rows.find(function (r) { return r.id === id; });
  if (!row) return;
  Aoi.tickets.current = row;
  var el = document.getElementById('ticketDetail');
  if (!el) return;
  var repliesHtml = (row.replies || []).length
    ? row.replies.map(function (rep) {
        return '<div class="text-sm border-l-2 border-gray-200 pl-2 py-1">'
          + '<span class="text-xs text-gray-400">' + Aoi.escapeHtml(Aoi.tickets.fmtTime(rep.ts)) + '</span> '
          + Aoi.escapeHtml(rep.text) + '</div>';
      }).join('')
    : '<div class="text-sm text-gray-400">暂无回复</div>';
  var reminds = row.reminders || [];
  el.innerHTML = [
    '<div class="bg-white rounded-lg border border-gray-200 p-6">',
    '  <div class="flex items-center justify-between mb-3">',
    '    <h4 class="font-bold font-mono">' + row.id + '</h4>',
    '    <button onclick="Aoi.tickets.closeDetail()" class="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>',
    '  </div>',
    '  <div class="grid grid-cols-2 gap-2 text-sm mb-3">',
    '    <div><span class="text-gray-400">昵称：</span>' + Aoi.escapeHtml(row.cn || '未绑定') + '</div>',
    '    <div class="text-right text-gray-500"><span class="text-gray-400">提交时间：</span>' + Aoi.escapeHtml(Aoi.tickets.fmtTime(row.ts)) + '</div>',
    '    <div class="col-span-2"><span class="text-gray-400">联系方式：</span>' + Aoi.escapeHtml(Aoi.tickets.contactOf(row)) + '</div>',
    '  </div>',
    '  <div class="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap mb-3">' + Aoi.escapeHtml(row.raw || '（无内容）') + '</div>',
    '  <div class="mb-3"><div class="text-xs font-bold text-gray-400 mb-1">回复记录</div>' + repliesHtml + '</div>',
    '  <div class="mb-3">',
    '    <div class="text-xs font-bold text-gray-400 mb-1">回复（一键同步到QQ' + (row.qq ? '' : '——此工单无完整QQ，仅存档') + '）</div>',
    '    <textarea id="ticketReplyInput" rows="3" class="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="回复内容，点击同步后通过 QQ 发给买家"></textarea>',
    '    <div class="flex flex-wrap items-center gap-2 mt-2">',
    '      <button onclick="Aoi.tickets.reply()" class="px-4 py-2 btn-primary text-sm font-bold rounded"' + (row.qq ? '' : ' disabled') + '>一键同步到QQ</button>',
    '      <select id="ticketStatusSel" class="border border-gray-300 rounded px-3 py-2 text-sm">',
    Object.keys(Aoi.tickets.STATUS_LABEL).map(function (k) {
      return '<option value="' + k + '"' + (row.status === k ? ' selected' : '') + '>' + Aoi.tickets.STATUS_LABEL[k] + '</option>';
    }).join(''),
    '      </select>',
    '      <button onclick="Aoi.tickets.saveStatus()" class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300">保存状态</button>',
    '    </div>',
    '  </div>',
    '  <div>',
    '    <div class="text-xs font-bold text-gray-400 mb-1">QQ 提醒（每日到点把本工单摘要私发管理员，直至清除）</div>',
    '    <div class="flex flex-wrap items-center gap-2">',
    '      <input id="ticketRemindTime" type="time" class="border border-gray-300 rounded px-3 py-2 text-sm">',
    '      <button onclick="Aoi.tickets.addRemind()" class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300">设置QQ提醒</button>',
    reminds.map(function (rem) {
      return '<span class="px-2 py-1 rounded bg-amber-50 text-amber-600 text-xs font-bold">每日 ' + rem.time
        + ' <button class="ml-1 text-red-400" onclick="Aoi.tickets.removeRemind(\'' + rem.time + '\')">×</button></span>';
    }).join(''),
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
  el.classList.remove('hidden');
};

Aoi.tickets.closeDetail = function () {
  Aoi.tickets.current = null;
  var el = document.getElementById('ticketDetail');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
};

// —— 操作 ——

Aoi.tickets.reply = async function () {
  var row = Aoi.tickets.current;
  if (!row) return;
  var input = document.getElementById('ticketReplyInput');
  var text = input ? input.value.trim() : '';
  if (!text) { Aoi.toast('回复内容为空', 'warning'); return; }
  try {
    var out = await Aoi.bot.request({ ticketOp: 'reply', id: row.id, text: text });
    Aoi.toast('已通过 QQ 发给买家', 'success');
    Aoi.tickets._replace(out.row);
    Aoi.tickets.openDetail(row.id);
  } catch (e) {
    Aoi.toast(e && e.message, 'error');
  }
};

Aoi.tickets.saveStatus = async function () {
  var row = Aoi.tickets.current;
  if (!row) return;
  var sel = document.getElementById('ticketStatusSel');
  if (!sel) return;
  try {
    var out = await Aoi.bot.request({ ticketOp: 'status', id: row.id, status: sel.value });
    Aoi.toast('状态已保存：' + Aoi.tickets.STATUS_LABEL[sel.value], 'success');
    Aoi.tickets._replace(out.row);
    Aoi.tickets.openDetail(row.id);
  } catch (e) {
    Aoi.toast(e && e.message, 'error');
  }
};

Aoi.tickets.addRemind = async function () {
  var row = Aoi.tickets.current;
  if (!row) return;
  var input = document.getElementById('ticketRemindTime');
  var time = input ? input.value : '';
  if (!/^\d{2}:\d{2}$/.test(time)) { Aoi.toast('请先选择提醒时间', 'warning'); return; }
  var times = (row.reminders || []).map(function (r) { return r.time; });
  if (times.indexOf(time) >= 0) { Aoi.toast('该时间点已设置', 'warning'); return; }
  times.push(time);
  times.sort();
  try {
    var out = await Aoi.bot.request({ ticketOp: 'remind', id: row.id, times: times });
    Aoi.toast('已设置：每日 ' + time + ' QQ 提醒', 'success');
    Aoi.tickets._replace(out.row);
    Aoi.tickets.openDetail(row.id);
  } catch (e) {
    Aoi.toast(e && e.message, 'error');
  }
};

Aoi.tickets.removeRemind = async function (time) {
  var row = Aoi.tickets.current;
  if (!row) return;
  var times = (row.reminders || []).map(function (r) { return r.time; }).filter(function (t) { return t !== time; });
  try {
    var out = await Aoi.bot.request({ ticketOp: 'remind', id: row.id, times: times });
    Aoi.toast('已清除 ' + time + ' 提醒', 'success');
    Aoi.tickets._replace(out.row);
    Aoi.tickets.openDetail(row.id);
  } catch (e) {
    Aoi.toast(e && e.message, 'error');
  }
};

// 行替换 + 列表刷新
Aoi.tickets._replace = function (row) {
  if (!row) return;
  var idx = Aoi.tickets.rows.findIndex(function (r) { return r.id === row.id; });
  if (idx >= 0) Aoi.tickets.rows[idx] = row;
  else Aoi.tickets.rows.unshift(row);
  Aoi.tickets.current = row;
  Aoi.tickets.render();
};
