// Aoi-system — 数据层：团队业务数据读写（Supabase RPC + 调试 localStorage）
// v3：管理端读写全部携带 admin token，经 admin_get/save_team_data（乐观锁内建）
window.Aoi = window.Aoi || {};

// 调试模式：团队存 localStorage（aoi_debug_ 前缀）
Aoi.debugTeam = function () {
  var key = 'aoi_debug_team';
  var team = JSON.parse(localStorage.getItem(key) || 'null');
  if (!team) {
    team = { id: 'debug-team', name: '调试团', member_key: 'DEMO', created_at: null };
    localStorage.setItem(key, JSON.stringify(team));
  }
  return team;
};

// RPC 错误分类：把 PostgREST 报错翻译成可操作的中文提示
Aoi.explainRpcError = function (msg, context) {
  msg = msg || '';
  if (/Could not find the function|schema cache|function .* does not exist/i.test(msg)) {
    return '服务端缺少' + context + '接口（RPC 不存在）——请在 Supabase SQL Editor 重跑 supabase-schema.sql 后重试';
  }
  if (/已被他人修改/.test(msg)) {
    return '数据已被他人修改，请刷新页面重新进入后重试';
  }
  if (/会话已过期/.test(msg)) {
    return '登录会话已过期，请重新登录';
  }
  if (/密钥无效/.test(msg)) {
    return '团员密钥无效，请向团长确认后重新输入';
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return '网络连接失败，请检查网络后重试';
  }
  return null;
};

// 保存团队业务数据 blob（管理端唯一写入口）
// 携带 admin token + 上次读到的数据版本（乐观锁）；成功返回并记录新版本
Aoi.saveTeamData = async function (data) {
  if (Aoi.state.user && Aoi.state.user.isDebug) {
    localStorage.setItem('aoi_debug_data', JSON.stringify(data));
    return;
  }
  var s = Aoi.adminLoadSession();
  if (!s) throw new Error('登录会话已失效，请重新登录');
  var params = { p_token: s.token, p_data: data, p_expected_updated_at: Aoi.adminUpdatedAt || null };
  var r = await Aoi.db.rpc('admin_save_team_data', params);
  if (r.error) {
    var hint = Aoi.explainRpcError(r.error.message, '数据保存');
    if (/会话已过期/.test(hint || '')) Aoi.adminClearSession();
    if (/已被他人修改/.test(hint || '')) Aoi.adminUpdatedAt = null;
    throw new Error(hint || ('保存失败：' + r.error.message));
  }
  Aoi.adminUpdatedAt = r.data; // 记录新版本，供下次写入
  return r.data;
};

// 修改团名（v3：admin_rename_team RPC）
Aoi.renameTeam = async function (name) {
  if (Aoi.state.user && Aoi.state.user.isDebug) {
    var t = Aoi.debugTeam();
    t.name = name;
    localStorage.setItem('aoi_debug_team', JSON.stringify(t));
    Aoi.state.team = t;
    return name;
  }
  var s = Aoi.adminLoadSession();
  if (!s) throw new Error('登录会话已失效，请重新登录');
  var r = await Aoi.db.rpc('admin_rename_team', { p_token: s.token, p_name: name });
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

// 重新生成团员密钥（v3：admin_regenerate_member_key RPC，仅 super）
Aoi.regenerateMemberKey = async function () {
  if (Aoi.state.user && Aoi.state.user.isDebug) return 'DEMO';
  var s = Aoi.adminLoadSession();
  if (!s) throw new Error('登录会话已失效，请重新登录');
  var r = await Aoi.db.rpc('admin_regenerate_member_key', { p_token: s.token });
  if (r.error) throw new Error(r.error.message);
  Aoi.state.team = Aoi.state.team || {};
  Aoi.state.team.member_key = r.data;
  return r.data;
};

// —— v3.4.0 B1：服务端 blob 历史快照（设置页「数据备份与恢复」用）——
// 每次保存（管理端/团员端）时服务端自动存档旧版本，保留近 30 天 / 每团最多 100 份。

// 快照列表（摘要：id/source/savedAt/ordersCount/bytes，不含数据全文）
Aoi.listDataHistory = async function (limit) {
  if (Aoi.state.user && Aoi.state.user.isDebug) return []; // debug 走 localStorage，无服务端历史
  var s = Aoi.adminLoadSession();
  if (!s) throw new Error('登录会话已失效，请重新登录');
  var r = await Aoi.db.rpc('admin_list_team_data_history', { p_token: s.token, p_limit: limit || 20 });
  if (r.error) {
    var hint = Aoi.explainRpcError(r.error.message, '历史快照读取');
    throw new Error(hint || ('读取历史快照失败：' + r.error.message));
  }
  return r.data || [];
};

// 读取单份快照全文（恢复前取回；恢复动作走 saveTeamData，覆盖前服务端又会自动存档）
Aoi.getDataHistorySnapshot = async function (id) {
  var s = Aoi.adminLoadSession();
  if (!s) throw new Error('登录会话已失效，请重新登录');
  var r = await Aoi.db.rpc('admin_get_team_data_history', { p_token: s.token, p_id: id });
  if (r.error) {
    var hint = Aoi.explainRpcError(r.error.message, '历史快照读取');
    throw new Error(hint || ('读取历史快照失败：' + r.error.message));
  }
  return r.data;
};

// —— 团员端：按团员密钥读取/保存（与 v1.7.0 一致，未改动）——

Aoi.getTeamDataByMemberKey = async function (key, cnOrQq) {
  var debugTeam = JSON.parse(localStorage.getItem('aoi_debug_team') || 'null');
  if (debugTeam && (debugTeam.member_key || 'DEMO') === key) {
    return {
      name: debugTeam.name || '调试团',
      data: JSON.parse(localStorage.getItem('aoi_debug_data') || '{}'),
      updatedAt: null
    };
  }
  // v3.4.0 B2：携带输入（圈名或 QQ 号），服务端把 addresses/memberMeta/cnChanges
  // 裁剪到本人条目后返回（含解析出的 cn）；不传则服务端整体剔除这三类 PII。
  var params = { member_key: key };
  if (cnOrQq) params.p_cn = cnOrQq;
  var r = await Aoi.db.rpc('get_team_by_member_key', params);
  if (r.error) {
    var hint = Aoi.explainRpcError(r.error.message, '团员端读取');
    throw new Error(hint || ('读取团队数据失败：' + r.error.message));
  }
  if (!r.data) return null; // 密钥不匹配（或该团队 member_key 为空）
  return r.data;
};

Aoi.saveTeamDataByMemberKey = async function (key, data, expectedUpdatedAt, cn) {
  var debugTeam = JSON.parse(localStorage.getItem('aoi_debug_team') || 'null');
  if (debugTeam && (debugTeam.member_key || 'DEMO') === key) {
    localStorage.setItem('aoi_debug_data', JSON.stringify(data));
    return null;
  }
  var params = { member_key: key, new_data: data };
  if (expectedUpdatedAt) params.expected_updated_at = expectedUpdatedAt;
  if (cn) params.p_cn = cn; // v3.4.0 B2：写入口按 CN 白名单合并（防整份覆盖管理端数据）
  var r = await Aoi.db.rpc('update_team_data_by_member_key', params);
  if (r.error) {
    var hint = Aoi.explainRpcError(r.error.message, '团员端写入');
    throw new Error(hint || ('保存失败：' + r.error.message));
  }
  return r.data;
};
