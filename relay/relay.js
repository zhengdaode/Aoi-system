#!/usr/bin/env node
// Aoi-system QQ 机器人 relay — 部署在阿里云 ECS（与 NapCat 同机）
// 职责：验证 Supabase 登录态 + role → 转发 NapCat（OneBot v11 HTTP API）
//
// 部署步骤（ECS 上）：
//   1. 复制 .env.example 为 .env，填真实值
//   2. node relay.js                 # Node 18+（内置 fetch，零第三方依赖）
//      或常驻：pm2 start relay.js --name qq-relay && pm2 save
//   3. 安全组只放行 RELAY_PORT，NapCat 的 3000/6099 一律不放公网
//
// 接口：POST <relay>/  header: Authorization: Bearer <supabase_access_token>
//   body: { user_id, message }  → 私聊 /send_private_msg
//   body: { group_id, message } → 群发 /send_group_msg
'use strict';

const http = require('http');
const fs = require('fs');

// 极简 .env 加载（零依赖，避免引入 dotenv）
try {
  const envFile = fs.readFileSync(__dirname + '/.env', 'utf8');
  envFile.split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  });
} catch (e) { /* 无 .env 时走系统环境变量 */ }

const PORT = process.env.RELAY_PORT || 8080;
const SUPABASE = process.env.SUPABASE_URL;      // https://xxx.supabase.co
const ANON_KEY = process.env.SUPABASE_ANON_KEY; // 验证 JWT + 查 role（public）
const NAPCAT = process.env.NAPCAT_HTTP_API || 'http://127.0.0.1:3000';
const NAPCAT_TOKEN = process.env.NAPCAT_TOKEN;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

if (!SUPABASE || !ANON_KEY || !NAPCAT_TOKEN) {
  console.error('[qq-relay] 缺少环境变量：SUPABASE_URL / SUPABASE_ANON_KEY / NAPCAT_TOKEN 至少一个未配置');
  process.exit(1);
}

// ① 验证 Supabase access token，返回 user.id；无效返回 null
async function verifyUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: ANON_KEY }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u.id || null;
  } catch (e) { return null; }
}

// ② 校验是否 owner/admin（用用户自己的 JWT 走 RLS，无需 service_role）
async function isAdmin(uid, token) {
  try {
    const r = await fetch(SUPABASE + '/rest/v1/team_members?user_id=eq.' + uid + '&select=role', {
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return false;
    const rows = await r.json();
    return rows.some(function (m) { return m.role === 'owner' || m.role === 'admin'; });
  } catch (e) { return false; }
}

// ③ 转发 NapCat
async function toNapcat(payload) {
  const path = payload.user_id ? '/send_private_msg' : '/send_group_msg';
  const body = payload.user_id
    ? { user_id: payload.user_id, message: payload.message }
    : { group_id: payload.group_id, message: payload.message };
  const r = await fetch(NAPCAT + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NAPCAT_TOKEN },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(function () { return null; });
  return { status: r.status, data: data };
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer(async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const uid = await verifyUser(token);
  if (!uid) return send(res, 401, { error: 'unauthorized' });
  if (!(await isAdmin(uid, token))) return send(res, 403, { error: 'forbidden: not an admin' });

  let body = '';
  req.on('data', function (c) { body += c; });
  req.on('end', async function () {
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad json' }); }
    if (!payload || (!payload.user_id && !payload.group_id) || typeof payload.message !== 'string') {
      return send(res, 400, { error: 'bad payload' });
    }
    const out = await toNapcat(payload);
    send(res, out.status, out.data);
  });
}).listen(PORT, function () {
  console.log('[qq-relay] listening on :' + PORT);
});
