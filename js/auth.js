// Aoi-system — 认证：注册 / 登录 / 找回 / 改密 / 退出
window.Aoi = window.Aoi || {};

Aoi.auth = {};

Aoi.auth.register = async function () {
  var email = document.getElementById('regEmail').value.trim();
  var pwd = document.getElementById('regPassword').value;
  var pwd2 = document.getElementById('regConfirm').value;
  if (!email || !pwd) { Aoi.toast('请填写邮箱和密码', 'warning'); return; }
  if (pwd.length < 6) { Aoi.toast('密码至少 6 位', 'warning'); return; }
  if (pwd !== pwd2) { Aoi.toast('两次密码不一致', 'warning'); return; }

  Aoi.showLoading('注册中...');
  var r = await Aoi.db.auth.signUp({
    email: email,
    password: pwd,
    options: { emailRedirectTo: window.location.origin }
  });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast('注册失败：' + r.error.message, 'error'); return; }
  Aoi.toast('注册成功，请去邮箱点击确认链接（可能在垃圾邮件）', 'success');
  Aoi.showScreen('screen-auth');
};

Aoi.auth.login = async function () {
  var email = document.getElementById('loginEmail').value.trim();
  var pwd = document.getElementById('loginPassword').value;
  if (!email || !pwd) { Aoi.toast('请输入邮箱和密码', 'warning'); return; }

  // 调试账户：绕过 Supabase，数据走 localStorage
  if (email === Aoi.DEBUG_EMAIL && pwd === Aoi.DEBUG_PWD) {
    Aoi.state.user = { id: 'debug-local', email: Aoi.DEBUG_EMAIL, isDebug: true };
    await Aoi.enterApp();
    return;
  }

  Aoi.showLoading('登录中...');
  var r = await Aoi.db.auth.signInWithPassword({ email: email, password: pwd });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast('登录失败：邮箱或密码错误', 'error'); return; }
  Aoi.state.user = r.data.user;
  await Aoi.enterApp();
};

Aoi.auth.sendReset = async function () {
  var email = document.getElementById('forgotEmail').value.trim();
  if (!email) { Aoi.toast('请输入注册邮箱', 'warning'); return; }

  Aoi.showLoading('发送中...');
  var r = await Aoi.db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast('发送失败：' + r.error.message, 'error'); return; }
  Aoi.toast('重置链接已发送，请查收邮箱', 'success');
  Aoi.showScreen('screen-auth');
};

Aoi.auth.doReset = async function () {
  var pwd = document.getElementById('resetPassword').value;
  if (pwd.length < 6) { Aoi.toast('新密码至少 6 位', 'warning'); return; }

  Aoi.showLoading('重置中...');
  var r = await Aoi.db.auth.updateUser({ password: pwd });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast('重置失败：' + r.error.message, 'error'); return; }
  Aoi.toast('密码已重置', 'success');
  var user = (await Aoi.db.auth.getUser()).data.user;
  Aoi.state.user = user;
  await Aoi.enterApp();
};

Aoi.auth.changePassword = async function () {
  var pwd = document.getElementById('newPassword').value;
  if (pwd.length < 6) { Aoi.toast('新密码至少 6 位', 'warning'); return; }

  Aoi.showLoading('修改中...');
  var r = await Aoi.db.auth.updateUser({ password: pwd });
  Aoi.hideLoading();
  if (r.error) { Aoi.toast('修改失败：' + r.error.message, 'error'); return; }
  Aoi.toast('密码已修改', 'success');
  document.getElementById('newPassword').value = '';
};

Aoi.auth.logout = async function () {
  await Aoi.db.auth.signOut();
  Aoi.state.user = null;
  Aoi.state.team = null;
  Aoi.state.members = [];
  Aoi.showScreen('screen-auth');
};

// 登录后进入应用：有团队 → 设置页；无团队 → 入驻页
Aoi.enterApp = async function () {
  var info = await Aoi.loadTeam();
  if (!info) { Aoi.showScreen('screen-onboard'); return; }
  Aoi.state.team = info.team;
  Aoi.state.role = info.role;
  Aoi.state.members = info.members;
  Aoi.state.data = await Aoi.getTeamData();
  Aoi.renderSettings();
  Aoi.announce.render();
  Aoi.orders.render();
  Aoi.orders.renderProducts();
  Aoi.orders.refillDatalists();
  Aoi.orders.refillBatches();
  Aoi.orders.renderBatches();
  Aoi.orders.renderActivities();
  Aoi.intl.refillBatches();
  Aoi.approval.refillBatches();
  Aoi.ship.refillBatches();
  Aoi.notify.refillBatches();
  Aoi.notify.sync();
  Aoi.warehouse.render();
  Aoi.warehouse.renderTransfers();
  Aoi.img.renderSettings();
  Aoi.calc.fillForm();
  Aoi.showScreen('screen-app');
};

// 监听密码找回回调
Aoi.db.auth.onAuthStateChange(function (event) {
  if (event === 'PASSWORD_RECOVERY') Aoi.showScreen('screen-reset');
});

// 启动：恢复会话
Aoi.db.auth.getSession().then(function (res) {
  if (res.data && res.data.session) {
    Aoi.state.user = res.data.session.user;
    Aoi.enterApp();
  } else {
    Aoi.showScreen('screen-auth');
  }
});
