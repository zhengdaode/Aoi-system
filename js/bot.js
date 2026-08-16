// Aoi-system — QQ 机器人接入（OneBot v11，经服务端 relay 转发）
// relay 部署在阿里云 ECS（与 NapCat 同机），token 只在 relay/NapCat 侧，前端不存任何密钥。
window.Aoi = window.Aoi || {};
Aoi.bot = {};

// 机器人配置（默认关；团长在「账号与设置」填 relay 地址 + 群号）
Aoi.bot.config = {
  enabled: false,
  relay: '',     // relay 服务地址，如 http://1.2.3.4:8080
  groupId: ''    // 群发兜底目标群号
};

// 从团队数据回填配置（持久化在 team_data blob 的 botConfig）
Aoi.bot.load = function () {
  var d = Aoi.orders.ensure();
  if (!d.botConfig) return;
  Aoi.bot.config.enabled = !!d.botConfig.enabled;
  Aoi.bot.config.relay = d.botConfig.relay || '';
  Aoi.bot.config.groupId = d.botConfig.groupId || '';
};

// 当前 Supabase 会话 token（relay 鉴权用）；debug 模式无 token
Aoi.bot.sessionToken = async function () {
  var r = await Aoi.db.auth.getSession();
  return (r.data && r.data.session && r.data.session.access_token) || '';
};

// 统一请求：POST relay，带 Supabase token；非 2xx 抛错
Aoi.bot.request = async function (payload) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.relay) throw new Error('QQ 机器人未接入');
  var token = await Aoi.bot.sessionToken();
  var r = await fetch(Aoi.bot.config.relay, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    var text = '';
    try { text = await r.text(); } catch (e) { /* ignore */ }
    throw new Error('推送失败（' + r.status + '）：' + text);
  }
  return r.json();
};

// 私聊单发
Aoi.bot.sendPrivate = function (qq, message) {
  return Aoi.bot.request({ user_id: qq, message: message });
};

// 群发
Aoi.bot.sendGroup = function (message) {
  return Aoi.bot.request({ group_id: Aoi.bot.config.groupId, message: message });
};

// 批量推送通知：按 buyer 找 QQ 号私聊，查不到则并入群发；统计失败数
Aoi.bot.pushAll = async function (notifications) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.relay) throw new Error('QQ 机器人未接入');
  var d = Aoi.orders.ensure();
  var meta = d.memberMeta || {};
  var groupMsgs = [];
  var failed = 0;
  for (var i = 0; i < notifications.length; i++) {
    var n = notifications[i];
    var qq = (n.buyer && meta[n.buyer]) ? meta[n.buyer].qq : null;
    if (qq) {
      try { await Aoi.bot.sendPrivate(qq, n.body); }
      catch (e) { failed++; }
    } else {
      groupMsgs.push(n.body);
    }
  }
  if (groupMsgs.length) {
    try { await Aoi.bot.sendGroup(groupMsgs.join('\n')); }
    catch (e) { failed++; }
  }
  if (failed) throw new Error('有 ' + failed + ' 条推送失败，请重试');
};

// 渲染设置页机器人配置
Aoi.bot.renderSettings = function () {
  Aoi.bot.load();
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  var chk = document.getElementById('botEnabled');
  if (chk) chk.checked = Aoi.bot.config.enabled;
  set('botRelay', Aoi.bot.config.relay);
  set('botGroupId', Aoi.bot.config.groupId);
};

// 保存设置页机器人配置
Aoi.bot.saveSettings = async function () {
  var d = Aoi.orders.ensure();
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var chk = document.getElementById('botEnabled');
  d.botConfig = {
    enabled: !!(chk && chk.checked),
    relay: get('botRelay'),
    groupId: get('botGroupId')
  };
  await Aoi.saveTeamData(d);
  Aoi.bot.load();
  Aoi.toast('机器人设置已保存', 'success');
};
