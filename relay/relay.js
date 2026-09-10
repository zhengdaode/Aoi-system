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
// 接口：GET  <relay>/fetch/<host>/<path…>  免鉴权（Netlify 重写代理无法附加 header）
//   仅放行 FETCH_HOSTS 白名单主机（排谷表/汇总表直链），10MB 上限 + 20s 超时，
//   防开放代理/SSRF；配合 netlify.toml 的 /media-relay 重写作为链接导入的国内中转通道。
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

// ① 鉴权（v3）：验证 admin token —— 调 Supabase RPC admin_verify_session，
//    返回 {id, username, role} 或 null。role 限 super/admin。
async function verifyAdmin(token) {
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE + '/rest/v1/rpc/admin_verify_session', {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token })
    });
    if (!r.ok) return null;
    const admin = await r.json();
    if (!admin || (admin.role !== 'super' && admin.role !== 'admin')) return null;
    return admin;
  } catch (e) { return null; }
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

// NapCat 转发串行队列：相邻两条间隔 ≥1s（批量私聊时防 QQ 风控/限频）
let napcatQueue = Promise.resolve();
let napcatLastAt = 0;
function throttledNapcat(payload) {
  const task = napcatQueue.then(async function () {
    const wait = 1000 - (Date.now() - napcatLastAt);
    if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); });
    napcatLastAt = Date.now();
    return toNapcat(payload);
  });
  // 队列断链自愈：某条失败不影响后续
  napcatQueue = task.catch(function () {});
  return task;
}

// 表格直链拉取：内存中转（文件仅几 KB～MB 级），白名单外的 host 一律 403
// v3.9.1：追加图床/商品图主机（汇总表参考图内嵌、购买清单图片绘制的图片中转；
// 需 ECS 重新部署本文件后生效）
const FETCH_HOSTS = ['static.zwlhome.com', 'www.pokemoncenter-online.com', 'esaimg.cdn1.vip', 'img.cdn1.vip'];
const FETCH_MAX = 10 * 1024 * 1024;
async function proxyFetch(res, target) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 20000);
  try {
    const r = await fetch(target, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) {
      res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('upstream ' + r.status);
    }
    const ab = await r.arrayBuffer();
    if (ab.byteLength > FETCH_MAX) { res.writeHead(413); return res.end(); }
    res.writeHead(200, {
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': String(ab.byteLength)
    });
    res.end(Buffer.from(ab));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer(async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const fm = req.method === 'GET' && req.url.match(/^\/fetch\/([^\/]+)\/(.+)$/);
  if (fm) {
    const host = decodeURIComponent(fm[1]).toLowerCase();
    if (FETCH_HOSTS.indexOf(host) < 0) return send(res, 403, { error: 'host not allowed' });
    return proxyFetch(res, 'https://' + host + '/' + fm[2]);
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const admin = await verifyAdmin(token);
  if (!admin) return send(res, 401, { error: 'unauthorized' });

  let body = '';
  req.on('data', function (c) { body += c; });
  req.on('end', async function () {
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad json' }); }
    if (!payload || (!payload.user_id && !payload.group_id) || typeof payload.message !== 'string') {
      return send(res, 400, { error: 'bad payload' });
    }
    const out = await throttledNapcat(payload);
    send(res, out.status, out.data);
  });
}).listen(PORT, function () {
  console.log('[qq-relay] listening on :' + PORT);
});
