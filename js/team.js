// Aoi-system — 团队设置：成员、邀请码、入驻
window.Aoi = window.Aoi || {};

// 渲染「账号与设置」页
Aoi.renderSettings = function () {
  var t = Aoi.state.team;
  var isOwner = Aoi.state.role === 'owner';

  document.getElementById('teamName').textContent = t.name || '我的团';
  document.getElementById('myRole').textContent = isOwner ? '团长（超级管理员）' : '管理员';

  document.getElementById('inviteSection').classList.toggle('hidden', !isOwner);
  document.getElementById('inviteCode').textContent = t.invite_code || '（未生成）';

  var list = document.getElementById('memberList');
  list.innerHTML = '';
  Aoi.state.members.forEach(function (m) {
    var row = document.createElement('li');
    row.className = 'flex items-center justify-between border-b border-gray-200 py-2';
    var label = (m.role === 'owner' ? '👑 团长 · ' : '👤 管理员 · ') + (m.email || m.user_id);
    var removeBtn = (isOwner && m.role !== 'owner')
      ? '<button class="text-red-500 text-sm hover:underline" data-remove="' + m.user_id + '">移除</button>'
      : '';
    row.innerHTML = '<span>' + Aoi.escapeHtml(label) + '</span>' + removeBtn;
    list.appendChild(row);
  });
};

// 团长生成 / 刷新邀请码
Aoi.onRegenerateCode = async function () {
  try {
    var code = await Aoi.regenerateInviteCode();
    document.getElementById('inviteCode').textContent = code;
    Aoi.toast('邀请码已更新', 'success');
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

// 团长移除管理员
Aoi.onRemoveMember = async function (userId) {
  if (!(await Aoi.confirm('确定移除该管理员？'))) return;
  try {
    await Aoi.removeMember(userId);
    Aoi.toast('已移除', 'success');
    await Aoi.enterApp();
  } catch (e) { Aoi.toast(e.message, 'error'); }
};

// 入驻：创建我的团
Aoi.onCreateTeam = async function () {
  var name = document.getElementById('newTeamName').value.trim();
  Aoi.showLoading('创建中...');
  try {
    await Aoi.createMyTeam(name);
    Aoi.hideLoading();
    await Aoi.enterApp();
  } catch (e) { Aoi.hideLoading(); Aoi.toast(e.message, 'error'); }
};

// 入驻：通过邀请码加入
Aoi.onJoinTeam = async function () {
  var code = document.getElementById('joinCode').value.trim();
  if (!code) { Aoi.toast('请输入邀请码', 'warning'); return; }
  Aoi.showLoading('加入中...');
  try {
    await Aoi.joinTeamByCode(code);
    Aoi.hideLoading();
    Aoi.toast('加入成功', 'success');
    await Aoi.enterApp();
  } catch (e) { Aoi.hideLoading(); Aoi.toast(e.message, 'error'); }
};

// 事件委托：成员列表里的「移除」按钮
document.getElementById('memberList').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-remove]');
  if (btn) Aoi.onRemoveMember(btn.getAttribute('data-remove'));
});
