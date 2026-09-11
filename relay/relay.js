#!/usr/bin/env node
// Aoi-system QQ 机器人 relay — 部署在阿里云 ECS（与 NapCat 同机）
// 职责：验证 Supabase 登录态 + role → 转发 NapCat（OneBot v11 HTTP API）
//
// 部署步骤（ECS 上）：
//   1. 复制 .env.example 为 .env，填真实值
//   2. node relay.js                 # Node 18+（内置 fetch，零第三方依赖）
//      或常驻：systemctl restart qq-relay（线上为 systemd 单元 qq-relay.service；
//      pm2 start relay.js --name qq-relay 为等价替代方案）
//   3. 安全组只放行 RELAY_PORT，NapCat 的 3000/6099 一律不放公网
//
// 接口：POST <relay>/  header: Authorization: Bearer <supabase_access_token>
//   body: { user_id, message }  → 私聊 /send_private_msg
//   body: { group_id, message } → 群发 /send_group_msg
//   v3.12.0 B4 加固：入站 body ≤64KB、单条消息 ≤4500 字符、每 token ≤60 次/分钟
//     （超限 413/400/429）；推送审计（内存环形缓冲最近 200 条，重启清零）。
// 接口：GET  <relay>/audit  header: Authorization: Bearer <supabase_access_token>
//   v3.12.0：返回最近推送审计（谁/何时/私聊或群/目标/长度/HTTP 结果），admin 鉴权同 POST。
// 接口：GET  <relay>/fetch/<host>/<path…>  免鉴权（Netlify 重写代理无法附加 header）
//   仅放行 FETCH_HOSTS 白名单主机（排谷表/汇总表直链），10MB 上限 + 20s 超时，
//   防开放代理/SSRF；v3.12.0 重定向逐跳校验白名单（3xx 跳到白名单外主机一律 403），
//   配合 netlify.toml 的 /media-relay 重写作为链接导入的国内中转通道。
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
// v3.12.0 B4：redirect 改 manual 逐跳校验——此前 redirect:'follow' 时白名单主机若
// 302 到任意目标，会沦为 SSRF 跳板；现每跳 host 必须仍在白名单内（≤4 跳）。
const FETCH_HOSTS = ['static.zwlhome.com', 'www.pokemoncenter-online.com', 'esaimg.cdn1.vip', 'img.cdn1.vip'];
const FETCH_MAX = 10 * 1024 * 1024;
async function proxyFetch(res, host, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 20000);
  try {
    let target = 'https://' + host + '/' + path;
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(target);
      if (FETCH_HOSTS.indexOf(u.hostname.toLowerCase()) < 0) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('redirect host not allowed');
      }
      const r = await fetch(target, { signal: ctrl.signal, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) { res.writeHead(502); return res.end('bad redirect'); }
        target = new URL(loc, target).href;
        continue;
      }
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
      return res.end(Buffer.from(ab));
    }
    res.writeHead(508, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('too many redirects');
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

// —— v3.12.0 B4：入站限频 + 推送审计 ——

// 每 token ≤60 次/分钟（防滥用/爆破）；内存计数即可，重启归零
const rateMap = {};
function rateLimited(token) {
  const now = Date.now();
  const arr = (rateMap[token] || (rateMap[token] = [])).filter(function (t) { return now - t < 60000; });
  arr.push(now);
  return arr.length > 60;
}

// 推送审计：内存环形缓冲最近 200 条（重启清零；持久化以 systemd 日志为准）
const auditBuf = [];
function pushAudit(entry) {
  auditBuf.push(entry);
  if (auditBuf.length > 200) auditBuf.shift();
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
    return proxyFetch(res, host, fm[2]);
  }
  // v3.12.0：GET /audit — 推送审计查询（admin 鉴权同 POST）
  if (req.method === 'GET' && req.url.match(/^\/audit\/?$/)) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const admin = await verifyAdmin(token);
    if (!admin) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { count: auditBuf.length, items: auditBuf.slice().reverse() });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const admin = await verifyAdmin(token);
  if (!admin) return send(res, 401, { error: 'unauthorized' });
  if (rateLimited(token)) return send(res, 429, { error: 'too many requests (max 60/min)' });

  // v3.12.0 B4：入站 body ≤64KB（超限即断，防内存累积）
  const MAX_BODY = 64 * 1024;
  let body = '';
  let tooBig = false;
  req.on('data', function (c) {
    if (tooBig) return;
    body += c;
    if (body.length > MAX_BODY) {
      tooBig = true;
      send(res, 413, { error: 'payload too large (max 64KB)' });
    }
  });
  req.on('end', async function () {
    if (tooBig) return;
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad json' }); }
    if (!payload || (!payload.user_id && !payload.group_id) || typeof payload.message !== 'string') {
      return send(res, 400, { error: 'bad payload' });
    }
    if (payload.message.length > 4500) return send(res, 400, { error: 'message too long (max 4500 chars)' });
    const out = await throttledNapcat(payload);
    pushAudit({
      at: new Date().toISOString(),
      admin: admin.username,
      channel: payload.user_id ? 'private' : 'group',
      target: payload.user_id ? String(payload.user_id) : String(payload.group_id),
      length: payload.message.length,
      httpStatus: out.status,
      ok: !!(out.data && out.data.retcode === 0)
    });
    send(res, out.status, out.data);
  });
}).listen(PORT, function () {
  console.log('[qq-relay] listening on :' + PORT);
});
