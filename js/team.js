// Aoi-system — 团队设置（v3）：团名 / 团员密钥 / 管理员账号管理 / 公告
window.Aoi = window.Aoi || {};

// 渲染「账号与设置」页
Aoi.renderSettings = function () {
  var t = Aoi.state.team;
  var isSuper = Aoi.state.role === 'super';

  document.getElementById('teamName').textContent = t.name || '我的团';
  document.getElementById('myRole').textContent = isSuper ? '超级管理员' : '管理员';

  var renameBox = document.getElementById('teamRenameBox');
  if (renameBox) renameBox.classList.toggle('hidden', !isSuper);

  var mkSection = document.getElementById('memberKeySection');
  if (mkSection) mkSection.classList.toggle('hidden', !isSuper);
  var mkLabel = document.getElementById('memberKeyLabel');
  if (mkLabel) mkLabel.textContent = t.member_key || '（未生成）';

  var amSection = document.getElementById('adminMgmtSection');
  if (amSection) amSection.classList.toggle('hidden', !isSuper);
  if (isSuper) Aoi.adminMgmt.render();

  var auditSection = document.getElementById('auditSection');
  if (auditSection) auditSection.classList.toggle('hidden', !isSuper);
  if (isSuper && Aoi.auditMgmt) Aoi.auditMgmt.render(); // v3.12.0 B3：审计记录（仅 super）

  if (Aoi.backup) Aoi.backup.renderHistory(); // v3.4.0：服务端历史快照列表（异步，失败在列表内提示）
};

// —— 审计记录（v3.12.0 B3，仅 super，走 admin_list/clear_audit_log RPC）——
Aoi.auditMgmt = {};

Aoi.auditMgmt.render = async function () {
  var el = document.getElementById('auditList');
  if (!el) return;
  if (Aoi.state.user && Aoi.state.user.isDebug) {
    el.innerHTML = '<li class="text-sm text-gray-400 py-1">调试模式数据存本机，无服务端审计</li>';
    return;
  }
  el.innerHTML = '<li class="text-sm text-gray-400 py-1">加载中…</li>';
  try {
    var s = Aoi.adminLoadSession() || {};
    var r = await Aoi.db.rpc('admin_list_audit_log', { p_token: s.token, p_limit: 50 });
    if (r.error) throw new Error(Aoi.explainRpcError(r.error.message, '审计读取') || r.error.message);
    var list = r.data || [];
    el.innerHTML = list.length ? list.map(function (a) {
      var when = String(a.at || '').slice(0, 19).replace('T', ' ');
      var detail = a.detail ? Object.keys(a.detail).map(function (k) {
        return k + '=' + String(a.detail[k]);
      }).join(' ') : '';
      return '<li class="border-b border-gray-100 py-1 text-sm">'
        + '<span class="break-all">' + Aoi.escapeHtml(when + ' · ' + (a.username || '—') + ' · ' + a.action + (detail ? ' · ' + detail : '')) + '</span></li>';
    }).join('') : '<li class="text-sm text-gray-400 py-1">暂无审计记录（登录 / 保存等操作会自动留痕）</li>';
  } catch (e) {
    el.innerHTML = '<li class="text-sm text-red-500 py-1">' + Aoi.escapeHtml(e.message) + '</li>';
  }
};

Aoi.auditMgmt.clear = async function () {
  var ok = await Aoi.confirm('删除 90 天前的审计记录？', { danger: true, okText: '清理' });
  if (!ok) return;
  var s = Aoi.adminLoadSession() || {};
  var r = await Aoi.db.rpc('admin_clear_audit_log', { p_token: s.token });
  if (r.error) { Aoi.toast(Aoi.explainRpcError(r.error.message, '审计清理') || r.error.message, 'error'); return; }
  Aoi.toast('已清理 ' + r.data + ' 条', 'success');
  Aoi.auditMgmt.render();
};

// —— 管理员账号管理（仅 super，走 admin_* RPC）——
Aoi.adminMgmt = {};

Aoi.adminMgmt.render = async function () {
  var ul = document.getElementById('adminMgmtList');
  if (!ul) return;
  var s = Aoi.adminLoadSession();
  if (!s) return;
  try {
    var r = await Aoi.db.rpc('admin_list', { p_token: s.token });
    if (r.error) { ul.innerHTML = '<li class="text-sm text-red-500 py-1">' + Aoi.escapeHtml(r.error.message) + '</li>'; return; }
    ul.innerHTML = (r.data || []).map(function (a) {
      var isSelf = a.username === (Aoi.state.user && Aoi.state.user.username);
      var actions = [];
      if (!isSelf) {
        actions.push('<button data-am-reset="' + a.id + '" data-am-user="' + Aoi.escapeHtml(a.username) + '" class="text-blue-500 text-sm hover:underline">重置密码</button>');
        actions.push('<button data-am-del="' + a.id + '" data-am-user="' + Aoi.escapeHtml(a.username) + '" class="text-red-500 text-sm hover:underline">删除</button>');
      }
      return '<li class="flex items-center justify-between border-b border-gray-200 py-2">'
        + '<span>' + (a.role === 'super' ? '👑 ' : '👤 ') + Aoi.escapeHtml(a.username)
        + ' <span class="text-xs text-gray-400">（' + (a.role === 'super' ? '超级管理员' : '管理员') + (isSelf ? ' · 我' : '') + '）</span></span>'
        + '<span class="flex gap-3">' + actions.join('') + '</span></li>';
    }).join('');
  } catch (e) {
    ul.innerHTML = '<li class="text-sm text-red-500 py-1">' + Aoi.escapeHtml(e.message) + '</li>';
  }
};

Aoi.adminMgmt.add = async function () {
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var username = get('amUsername'), password = get('amPassword'), role = get('amRole');
  if (!username || !password) { Aoi.toast('请填写用户名和密码', 'warning'); return; }
  var s = Aoi.adminLoadSession();
  if (!s) { Aoi.toast('会话已过期，请重新登录', 'error'); return; }
  try {
    var r = await Aoi.db.rpc('admin_create', { p_token: s.token, p_username: username, p_password: password, p_role: role });
    if (r.error) { Aoi.toast(r.error.message, 'error'); return; }
    document.getElementById('amUsername').value = '';
    document.getElementById('amPassword').value = '';
    Aoi.adminMgmt.render();
    Aoi.toast('已添加管理员 ' + username, 'success');
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

Aoi.adminMgmt.remove = async function (adminId, username) {
  if (!(await Aoi.confirm('确定删除管理员「' + username + '」？该账号将立即失效', { danger: true }))) return;
  var s = Aoi.adminLoadSession();
  if (!s) { Aoi.toast('会话已过期，请重新登录', 'error'); return; }
  try {
    var r = await Aoi.db.rpc('admin_delete', { p_token: s.token, p_admin_id: adminId });
    if (r.error) { Aoi.toast(r.error.message, 'error'); return; }
    Aoi.adminMgmt.render();
    Aoi.toast('已删除 ' + username, 'success');
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

Aoi.adminMgmt.resetPwd = async function (adminId, username) {
  var pwd = prompt('为「' + username + '」设置新密码（至少 6 位）：');
  if (pwd === null) return;
  if (pwd.length < 6) { Aoi.toast('密码至少 6 位', 'warning'); return; }
  var s = Aoi.adminLoadSession();
  if (!s) { Aoi.toast('会话已过期，请重新登录', 'error'); return; }
  try {
    var r = await Aoi.db.rpc('admin_reset_password', { p_token: s.token, p_admin_id: adminId, p_new_password: pwd });
    if (r.error) { Aoi.toast(r.error.message, 'error'); return; }
    Aoi.toast('已重置「' + username + '」的密码，该账号已全部下线', 'success');
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

// 重新生成团员密钥
Aoi.onRegenerateMemberKey = async function () {
  try {
    var code = await Aoi.regenerateMemberKey();
    document.getElementById('memberKeyLabel').textContent = code;
    Aoi.toast('团员密钥已更新', 'success');
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

// 修改团名
Aoi.onRenameTeam = async function () {
  var input = document.getElementById('teamRenameInput');
  var name = input.value.trim();
  if (!name) { Aoi.toast('请输入新团名', 'warning'); return; }
  try {
    await Aoi.renameTeam(name);
    Aoi.state.team.name = name;
    Aoi.renderSettings();
    input.value = '';
    Aoi.toast('团名已更新', 'success');
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

// 公告（手动发布/删除，展示给团员端）
Aoi.announce = {};

// 发布公告。pushGroup 为 true 时同时把公告推送到 QQ 群（机器人未接入/失败不影响站内发布）
Aoi.announce.publish = async function (pushGroup) {
  var ta = document.getElementById('announceInput');
  var text = ta.value.trim();
  if (!text) { Aoi.toast('请输入公告内容', 'warning'); return; }
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.announcements)) d.announcements = [];
  d.announcements.push({ id: Aoi.genId(), text: text, date: new Date().toISOString().slice(0, 10) });
  await Aoi.saveTeamData(d);
  ta.value = '';
  Aoi.announce.render();
  if (!pushGroup) { Aoi.toast('公告已发布', 'success'); return; }
  try {
    await Aoi.bot.sendGroup('【公告】' + text);
    Aoi.toast('公告已发布并推送到 QQ 群', 'success');
  } catch (e) {
    Aoi.toast('公告已发布，但 QQ 群推送失败：' + (e.message || '未知错误'), 'warning');
  }
};

Aoi.announce.render = function () {
  var ul = document.getElementById('announceList');
  if (!ul) return;
  var d = Aoi.orders.ensure();
  var list = (d.announcements || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  ul.innerHTML = list.length ? list.map(function (a) {
    return '<li class="flex items-start justify-between border-b border-gray-100 py-2">'
      + '<div class="flex-1"><p class="text-sm whitespace-pre-wrap">' + Aoi.escapeHtml(a.text) + '</p>'
      + '<p class="text-xs text-gray-400 mt-1">' + Aoi.escapeHtml(a.date || '') + '</p></div>'
      + '<button data-remove-announce="' + a.id + '" class="text-red-500 text-sm hover:underline ml-2">删</button>'
      + '</li>';
  }).join('') : '<li class="text-sm text-gray-400 py-2">暂无公告</li>';
};

Aoi.announce.remove = async function (id) {
  var d = Aoi.orders.ensure();
  d.announcements = (d.announcements || []).filter(function (a) { return a.id !== id; });
  await Aoi.saveTeamData(d);
  Aoi.announce.render();
};

// 事件委托：管理员账号列表操作
document.getElementById('adminMgmtList').addEventListener('click', function (e) {
  var del = e.target.closest('button[data-am-del]');
  if (del) { Aoi.adminMgmt.remove(del.getAttribute('data-am-del'), del.getAttribute('data-am-user')); return; }
  var rst = e.target.closest('button[data-am-reset]');
  if (rst) Aoi.adminMgmt.resetPwd(rst.getAttribute('data-am-reset'), rst.getAttribute('data-am-user'));
});

// 事件委托：公告列表里的「删」按钮
document.getElementById('announceList').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-remove-announce]');
  if (btn) Aoi.announce.remove(btn.getAttribute('data-remove-announce'));
});

// —— 数据备份与恢复（v3.4.0 B1/F4）：本地备份文件 + 服务端历史快照回滚 ——
// 服务端侧：两个写入口 RPC 每次保存前自动存档旧版（保留近 30 天 / 每团最多 100 份）；
// 恢复动作统一走 Aoi.saveTeamData（乐观锁），覆盖前服务端又会先存档当前版本，可连续回滚。
Aoi.backup = {};

// 备份文件标识与版本号：导入时校验，防止拿任意 JSON 覆盖数据
Aoi.backup.KIND = 'aoi-backup';

// 构造备份文件内容（data 为当前内存中的整份团队数据）
Aoi.backup.buildExport = function (data) {
  return {
    kind: Aoi.backup.KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    teamName: (Aoi.state.team && Aoi.state.team.name) || '',
    data: data
  };
};

// 校验导入文件内容 → 返回 { data, exportedAt, teamName }，不合法抛错（文案面向普通管理员）
Aoi.backup.parseImport = function (text) {
  var obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('不是有效的 JSON 文件'); }
  if (!obj || obj.kind !== Aoi.backup.KIND || typeof obj.data !== 'object' || obj.data === null) {
    throw new Error('文件不是本系统导出的备份（缺少备份标识或 data 字段）');
  }
  return obj;
};

// 下载全量备份（当前内存数据 → JSON 文件）
Aoi.backup.download = function () {
  var payload = Aoi.backup.buildExport(Aoi.orders.ensure());
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'aoi-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  Aoi.toast('备份已下载（' + a.download + '）', 'success');
};

// 「从备份文件恢复」入口：读取 <input type=file>，校验后走统一恢复流程
Aoi.backup.onImportFile = async function (ev) {
  var file = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // 允许重复选择同一文件
  if (!file) return;
  var payload;
  try {
    payload = Aoi.backup.parseImport(await file.text());
  } catch (e) {
    Aoi.toast(e.message, 'error');
    return;
  }
  await Aoi.backup.restoreFromObject(payload);
};

// 统一恢复流程：确认摘要 → saveTeamData 写回 → 刷新全部视图
Aoi.backup.restoreFromObject = async function (payload) {
  var d = payload.data;
  var orders = Array.isArray(d.orders) ? d.orders.length : 0;
  var when = payload.exportedAt ? String(payload.exportedAt).slice(0, 19).replace('T', ' ') : '未知时间';
  var ok = await Aoi.confirm(
    '确定用这份备份覆盖当前全部数据？备份时间 ' + when + '，含 ' + orders + ' 条订单。'
    + '覆盖前服务端会自动存档当前版本，可再回滚',
    { danger: true, okText: '覆盖恢复' });
  if (!ok) return;
  await Aoi.saveTeamData(d);
  Aoi.state.data = d;
  Aoi.refreshViews();
  Aoi.toast('已从备份恢复数据', 'success');
};

// 服务端历史快照列表（新→旧）。debug 模式数据在本机 localStorage，无服务端历史
Aoi.backup.renderHistory = async function () {
  var el = document.getElementById('backupHistoryList');
  if (!el) return;
  if (Aoi.state.user && Aoi.state.user.isDebug) {
    el.innerHTML = '<li class="text-sm text-gray-400 py-1">调试模式数据存本机，无服务端历史快照</li>';
    return;
  }
  el.innerHTML = '<li class="text-sm text-gray-400 py-1">加载中…</li>';
  try {
    var list = await Aoi.listDataHistory(10);
    el.innerHTML = list.length ? list.map(function (h) {
      var label = (h.savedAt || '').slice(0, 19).replace('T', ' ')
        + ' · ' + (h.source === 'member' ? '团员保存' : '管理端保存')
        + ' · ' + (h.ordersCount || 0) + ' 单 · ' + Math.round((h.bytes || 0) / 1024) + ' KB';
      return '<li class="flex items-center justify-between border-b border-gray-100 py-1 text-sm">'
        + '<span>' + Aoi.escapeHtml(label) + '</span>'
        + '<button data-bk-restore="' + h.id + '" class="text-blue-500 hover:underline">恢复此版</button></li>';
    }).join('') : '<li class="text-sm text-gray-400 py-1">暂无历史快照（每次保存自动生成，保留近 30 天 / 最多 100 份）</li>';
  } catch (e) {
    el.innerHTML = '<li class="text-sm text-red-500 py-1">' + Aoi.escapeHtml(e.message) + '</li>';
  }
};

// 恢复到指定历史快照
Aoi.backup.restoreSnapshot = async function (id) {
  var ok = await Aoi.confirm('确定恢复到这份历史快照？当前数据会先被服务端自动存档，可再次回滚',
    { danger: true, okText: '恢复' });
  if (!ok) return;
  var snap = await Aoi.getDataHistorySnapshot(id);
  await Aoi.saveTeamData(snap.data);
  Aoi.state.data = snap.data;
  Aoi.refreshViews();
  Aoi.toast('已恢复到 ' + String(snap.savedAt || '').slice(0, 19).replace('T', ' '), 'success');
  Aoi.backup.renderHistory();
};

// 事件委托：历史快照列表里的「恢复此版」按钮
document.getElementById('backupHistoryList').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-bk-restore]');
  if (btn) Aoi.backup.restoreSnapshot(btn.getAttribute('data-bk-restore'));
});
