// Aoi-system — QQ 机器人接入（OneBot v11，经服务端 relay 转发）
// relay 部署在阿里云 ECS（与 NapCat 同机），token 只在 relay/NapCat 侧，前端不存任何密钥。
window.Aoi = window.Aoi || {};
Aoi.bot = {};

// 机器人配置（默认关；团长在「账号与设置」填 relay 地址 + 群号）
// v3.5.0 F5 扩展：adminQq（排发 xlsx 私发目标）+ qrUrl（催缴缴费二维码，网页换图下次催缴自动生效）
Aoi.bot.config = {
  enabled: false,
  relay: '',     // relay 服务地址，如 https://relay.example.com
  groupId: '',   // 群发兜底目标群号
  adminQq: '',   // 排发表 xlsx 私发目标（管理员 QQ）
  qrUrl: ''      // 缴费二维码图片 URL（relay 每次催缴实时读取）
};

// 从团队数据回填配置（持久化在 team_data blob 的 botConfig）
Aoi.bot.load = function () {
  var d = Aoi.orders.ensure();
  if (!d.botConfig) return;
  Aoi.bot.config.enabled = !!d.botConfig.enabled;
  Aoi.bot.config.relay = d.botConfig.relay || '';
  Aoi.bot.config.groupId = d.botConfig.groupId || '';
  Aoi.bot.config.adminQq = d.botConfig.adminQq || '';
  Aoi.bot.config.qrUrl = d.botConfig.qrUrl || '';
};

// 推送鉴权令牌（v3：admin token；relay 端经 admin_verify_session 校验）
Aoi.bot.sessionToken = async function () {
  var s = Aoi.adminLoadSession();
  return s ? s.token : '';
};

// 登录态类错误（401 / 会话失效）——批量私聊时据此中止，避免顶着坏会话打满全队列
Aoi.bot.isAuthError = function (e) {
  return /（401）|unauthorized|登录态/.test((e && e.message) || '');
};

// 统一请求：POST relay，带 admin token；非 2xx 抛错
Aoi.bot.request = async function (payload) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.relay) throw new Error('QQ 机器人未接入');
  if (Aoi.state.user && Aoi.state.user.isDebug) {
    throw new Error('debug 账号没有管理员会话，无法通过 relay 鉴权——请用真实管理员账号登录后再测试推送');
  }
  var token = await Aoi.bot.sessionToken();
  if (!token) throw new Error('管理员登录态缺失，请退出后重新登录再推送');
  var r = await fetch(Aoi.bot.config.relay, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    var text = '';
    try { text = await r.text(); } catch (e) { /* ignore */ }
    if (r.status === 401) {
      throw new Error('推送失败（401）：管理员会话已失效，请退出后重新登录再试；重新登录后仍 401 则检查 ECS relay 是否已更新到 v3 校验逻辑');
    }
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

// 批量私聊：按 memberMeta 的 QQ 逐人 send_private_msg。
// 此前 sendPrivate 从未被任何链路调用，私聊推送实际不存在——此函数补上该链路。
// relay 侧对 NapCat 转发做 ≥1s 节流防风控，前端顺序发送即可。
// 返回 { sent, failed, sentIds, unbound }：sentIds 标记哪些通知已私聊成功，
// unbound 为未绑定 QQ 的圈名（需走群发兜底）。
Aoi.bot.pushPrivate = async function (notifications) {
  var d = Aoi.orders.ensure();
  var meta = d.memberMeta || {};
  var sent = 0, failed = 0;
  var sentIds = [], unbound = [];
  for (var i = 0; i < notifications.length; i++) {
    var n = notifications[i];
    var qq = (n.buyer && meta[n.buyer]) ? meta[n.buyer].qq : null;
    if (!qq) {
      if (n.buyer && unbound.indexOf(n.buyer) < 0) unbound.push(n.buyer);
      continue;
    }
    try {
      await Aoi.bot.sendPrivate(qq, n.body);
      sent++;
      sentIds.push(n.id);
    } catch (e) {
      // 登录态失效（401）时逐条重试没有意义且徒增 relay/NapCat 压力，直接中止让上层提示
      if (Aoi.bot.isAuthError(e)) throw e;
      failed++;
    }
  }
  return { sent: sent, failed: failed, sentIds: sentIds, unbound: unbound };
};

// 群发（@ 每个人：绑定 QQ 的用 CQ:at 真提及；未绑定的用圈名文字 @ 兜底——
// 不触发 QQ 客户端提醒，但群成员能明确看到叫谁）
Aoi.bot.pushAll = async function (notifications) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.relay) throw new Error('QQ 机器人未接入');
  var d = Aoi.orders.ensure();
  var meta = d.memberMeta || {};
  var lines = notifications.map(function (n) {
    var qq = (n.buyer && meta[n.buyer]) ? meta[n.buyer].qq : null;
    if (qq) return '[CQ:at,qq=' + qq + '] ' + n.body;
    if (n.buyer) return '@' + n.buyer + ' ' + n.body;
    return n.body;
  });
  await Aoi.bot.sendGroup(lines.join('\n'));
};

// 渲染设置页机器人配置
Aoi.bot.renderSettings = function () {
  Aoi.bot.load();
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  var chk = document.getElementById('botEnabled');
  if (chk) chk.checked = Aoi.bot.config.enabled;
  set('botRelay', Aoi.bot.config.relay);
  set('botGroupId', Aoi.bot.config.groupId);
  set('botAdminQq', Aoi.bot.config.adminQq);
  set('botQrUrl', Aoi.bot.config.qrUrl);
};

// 保存设置页机器人配置
Aoi.bot.saveSettings = async function () {
  var d = Aoi.orders.ensure();
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var chk = document.getElementById('botEnabled');
  var enabled = !!(chk && chk.checked);
  var relay = get('botRelay');
  // https 页面下浏览器会拦截 http 请求（混合内容），CSP 也不放行 —— 直接拦在保存时
  if (enabled && relay && window.location.protocol === 'https:' && !/^https:\/\//i.test(relay)) {
    Aoi.toast('relay 地址必须为 https：当前页面是 https，请求 http 地址会被浏览器直接拦截，推送必然失败', 'error');
    return;
  }
  d.botConfig = {
    enabled: enabled,
    relay: relay,
    groupId: get('botGroupId'),
    adminQq: get('botAdminQq'),
    qrUrl: get('botQrUrl')
  };
  await Aoi.saveTeamData(d);
  Aoi.bot.load();
  Aoi.toast('机器人设置已保存', 'success');
};

// F5-H①（v3.5.0）：排发表 xlsx 经 relay 生成并私发管理员。
// 行数据字段与发货管理排发表一致（购买者/制品/发货线路/数量/囤货地/快递单号/合照/状态）；
// relay 生成 xlsx 后经 NapCat upload_private_file 发到 botConfig.adminQq，临时文件用后即删。
Aoi.bot.exportShipping = async function (batchId) {
  if (!Aoi.bot.config.enabled || !Aoi.bot.config.relay) throw new Error('QQ 机器人未接入');
  if (!Aoi.bot.config.adminQq) throw new Error('未配置管理员转发 QQ：请在设置页「QQ 机器人」卡填写并保存');
  var d = Aoi.orders.ensure();
  var rows = d.orders.filter(function (o) { return o.batchId === batchId; });
  if (!rows.length) throw new Error('该批次暂无订单');
  var payloadRows = rows.map(function (o) {
    return {
      '购买者': o.buyer,
      '制品': o.type + ' - ' + o.model,
      '发货线路': Aoi.orders.typeRoute(o.type),
      '数量': o.count,
      '囤货地': Aoi.warehouse.name(o.warehouseId) || '',
      '快递单号': o.tracking || '',
      '合照': o.photo || '',
      '状态': o.shipped || '未发'
    };
  });
  var token = await Aoi.bot.sessionToken();
  if (!token) throw new Error('管理员登录态缺失，请退出后重新登录再试');
  var r = await fetch(Aoi.bot.config.relay.replace(/\/+$/, '') + '/onebot/export-shipping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ batchId: batchId, batchDate: Aoi.orders.batchDate(batchId), rows: payloadRows, targetQq: Aoi.bot.config.adminQq })
  });
  if (!r.ok) {
    var text = '';
    try { text = await r.text(); } catch (e) { /* ignore */ }
    if (r.status === 401) throw new Error('排发表推送失败（401）：管理员会话已失效，请重新登录');
    throw new Error('排发表推送失败（' + r.status + '）：' + text);
  }
  return r.json();
};
