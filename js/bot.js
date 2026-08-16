// Aoi-system — QQ 机器人接入接口（占位，未接入）
// 接入时只需：填 config、实现 sendPrivate / sendGroup 的 HTTP 调用，其余模块不用改。
window.Aoi = window.Aoi || {};
Aoi.bot = {};

// 机器人配置（正式接入时填入；当前 enabled=false）
Aoi.bot.config = {
  enabled: false,
  httpApi: '',     // Go-Cqhttp / OneBot 的 HTTP API 根地址
  token: '',       // 预留：鉴权 token
  groupId: ''      // 预留：目标群号
};

// 私聊单发。未接入直接抛错。
Aoi.bot.sendPrivate = async function (qq, message) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.httpApi) throw new Error('QQ 机器人未接入');
  // TODO: fetch(Aoi.bot.config.httpApi + '/send_private_msg', {
  //   method: 'POST', headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ user_id: qq, message: message })
  // })
};

// 群发。未接入直接抛错。
Aoi.bot.sendGroup = async function (message) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.httpApi) throw new Error('QQ 机器人未接入');
  // TODO: fetch(Aoi.bot.config.httpApi + '/send_group_msg', {
  //   method: 'POST', headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ group_id: Aoi.bot.config.groupId, message: message })
  // })
};

// 批量推送通知：按 buyer 找 QQ 号私聊，查不到则并入群发。
Aoi.bot.pushAll = async function (notifications) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.httpApi) throw new Error('QQ 机器人未接入');
  var d = Aoi.orders.ensure();
  var meta = d.memberMeta || {};
  var groupMsgs = [];
  for (var i = 0; i < notifications.length; i++) {
    var n = notifications[i];
    var qq = (n.buyer && meta[n.buyer]) ? meta[n.buyer].qq : null;
    if (qq) await Aoi.bot.sendPrivate(qq, n.body);
    else groupMsgs.push(n.body);
  }
  if (groupMsgs.length) await Aoi.bot.sendGroup(groupMsgs.join('\n'));
};
