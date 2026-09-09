// Aoi-system — 认证（v3）：管理员用户名+密码自持凭据，脱离 Supabase Auth
// 凭据链路：admin_login → 随机 token（localStorage 持久化）→ 所有读写 RPC 携带 token
// 服务端：admins 表 bcrypt 哈希 + admin_sessions 表 sha256(token)（见 supabase-schema.sql v3 节）
window.Aoi = window.Aoi || {};

Aoi.auth = {};

// —— 会话存取（localStorage: aoi_admin_session）——
Aoi.adminSession = null;
Aoi.adminUpdatedAt = null; // 团队数据版本（乐观锁）

Aoi.adminLoadSession = function () {
  if (!Aoi.adminSession) {
    try { Aoi.adminSession = JSON.parse(localStorage.getItem('aoi_admin_session') || 'null'); } catch (e) { Aoi.adminSession = null; }
    if (Aoi.adminSession && new Date(Aoi.adminSession.expiresAt) <= new Date()) Aoi.adminSession = null;
  }
  return Aoi.adminSession;
};

Aoi.adminSaveSession = function (s) {
  Aoi.adminSession = s;
  localStorage.setItem('aoi_admin_session', JSON.stringify(s));
};

Aoi.adminClearSession = function () {
  Aoi.adminSession = null;
  Aoi.adminUpdatedAt = null;
  localStorage.removeItem('aoi_admin_session');
};

// RPC 错误中「会话过期」统一识别 → 清会话回登录页
Aoi.auth.sessionError = function (msg) {
  return /会话已过期/.test(msg || '');
};

// —— 登录 ——
Aoi.auth.login = async function () {
  var username = document.getElementById('loginUsername').value.trim();
  var pwd = document.getElementById('loginPassword').value;
  if (!username || !pwd) { Aoi.toast('请输入用户名和密码', 'warning'); return; }

  // 调试账户：绕过服务端，数据走 localStorage
  if (username === 'debug' && pwd === 'debug123') {
    Aoi.state.user = { id: 'debug-local', username: 'debug', isDebug: true };
    await Aoi.enterApp();
    return;
  }

  Aoi.showLoading('登录中...');
  var r = await Aoi.db.rpc('admin_login', { p_username: username, p_password: pwd });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast(r.error.message || '登录失败', 'error'); return; }
  Aoi.adminSaveSession(r.data);
  Aoi.state.user = { id: r.data.username, username: r.data.username, role: r.data.role };
  await Aoi.enterApp();
};

// —— 首次部署：初始化超管（仅 admins 表为空时服务端放行）——
Aoi.auth.bootstrap = async function () {
  var username = document.getElementById('initUsername').value.trim();
  var pwd = document.getElementById('initPassword').value;
  var pwd2 = document.getElementById('initConfirm').value;
  if (!username || !pwd) { Aoi.toast('请填写用户名和密码', 'warning'); return; }
  if (pwd.length < 6) { Aoi.toast('密码至少 6 位', 'warning'); return; }
  if (pwd !== pwd2) { Aoi.toast('两次密码不一致', 'warning'); return; }

  Aoi.showLoading('初始化中...');
  var r = await Aoi.db.rpc('admin_bootstrap', { p_username: username, p_password: pwd });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast(r.error.message || '初始化失败', 'error'); return; }
  Aoi.adminSaveSession(r.data);
  Aoi.state.user = { id: r.data.username, username: r.data.username, role: r.data.role };
  Aoi.toast('超级管理员已创建', 'success');
  await Aoi.enterApp();
};

// —— 修改自己的密码 ——
Aoi.auth.changePassword = async function () {
  var pwd = document.getElementById('newPassword').value;
  if (pwd.length < 6) { Aoi.toast('密码至少 6 位', 'warning'); return; }
  var s = Aoi.adminLoadSession();
  if (!s) { Aoi.toast('会话已过期，请重新登录', 'error'); return; }

  Aoi.showLoading('修改中...');
  var r = await Aoi.db.rpc('admin_change_password', { p_token: s.token, p_new_password: pwd });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast('修改失败：' + r.error.message, 'error'); return; }
  Aoi.toast('密码已修改', 'success');
  document.getElementById('newPassword').value = '';
};

// —— 退出 ——
Aoi.auth.logout = async function () {
  var s = Aoi.adminLoadSession();
  if (s && !(Aoi.state.user && Aoi.state.user.isDebug)) {
    try { await Aoi.db.rpc('admin_logout', { p_token: s.token }); } catch (e) { /* 本地清理即可 */ }
  }
  Aoi.adminClearSession();
  Aoi.state.user = null;
  Aoi.state.team = null;
  Aoi.state.role = null;
  Aoi.state.data = {};
  Aoi.showScreen('screen-auth');
};

// 登录后进入应用：拉取团队信息 + 业务数据 blob
Aoi.enterApp = async function () {
  if (Aoi.state.user && Aoi.state.user.isDebug) {
    Aoi.state.team = Aoi.debugTeam();
    Aoi.state.role = 'super';
    Aoi.state.data = JSON.parse(localStorage.getItem('aoi_debug_data') || '{}');
  } else {
    var s = Aoi.adminLoadSession();
    if (!s) { Aoi.showScreen('screen-auth'); return; }
    Aoi.showLoading('加载中...');
    var r = await Aoi.db.rpc('admin_get_team_data', { p_token: s.token });
    Aoi.hideLoading();
    if (r.error || !r.data) {
      var msg = (r.error && r.error.message) || '加载失败';
      if (Aoi.auth.sessionError(msg)) { Aoi.adminClearSession(); Aoi.toast('会话已过期，请重新登录', 'error'); Aoi.showScreen('screen-auth'); return; }
      Aoi.toast(msg, 'error');
      Aoi.showScreen('screen-auth');
      return;
    }
    Aoi.state.team = { name: r.data.name || '我的团', member_key: r.data.memberKey || '' };
    Aoi.state.role = s.role;
    Aoi.adminUpdatedAt = r.data.updatedAt || null;
    Aoi.state.data = r.data.data || {};
  }

  Aoi.renderSettings();
  Aoi.announce.render();
  Aoi.orders.render();
  Aoi.orders.refillDatalists();
  Aoi.orders.refillBatches();
  Aoi.orders.renderBatches();
  Aoi.orders.renderActivities();
  Aoi.orders.renderTypes();
  Aoi.intl.refillBatches();
  Aoi.approval.refillBatches();
  Aoi.ship.refillBatches();
  Aoi.notify.refillBatches();
  Aoi.notify.sync();
  Aoi.warehouse.render();
  Aoi.warehouse.renderTransfers();
  Aoi.orders.renderCnChanges();
  Aoi.orders.renderBuyers();
  Aoi.img.renderSettings();
  Aoi.bot.renderSettings();
  Aoi.calc.fillForm();
  Aoi.overview.render();
  Aoi.limits.render();
  Aoi.showScreen('screen-app');
};

// 启动：检查管理员是否已初始化 → 初始化页 / 登录页 / 恢复会话
(async function () {
  var session = Aoi.adminLoadSession();
  if (session && !session.isDebug) {
    Aoi.state.user = { id: session.username, username: session.username, role: session.role };
    await Aoi.enterApp();
    return;
  }
  if (session && session.isDebug) {
    Aoi.state.user = { id: 'debug-local', username: 'debug', isDebug: true };
    await Aoi.enterApp();
    return;
  }
  try {
    var r = await Aoi.db.rpc('admin_initialized');
    Aoi.showScreen(r.data === false ? 'screen-init' : 'screen-auth');
  } catch (e) {
    Aoi.showScreen('screen-auth');
  }
})();
