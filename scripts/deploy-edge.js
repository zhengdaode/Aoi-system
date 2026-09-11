#!/usr/bin/env node
// Aoi-system — Supabase Edge Function 部署器（Management API，零依赖）
//
// 让 agent / 维护者无需 supabase CLI 也能更新线上 Edge Function（免 SSH、免 npm 安装）。
// 先例：qq-relay v5 即经 Management API 部署。
//
// 用法：
//   node scripts/deploy-edge.js <slug> <源文件路径>      # 如 qq-relay supabase/functions/qq-relay/index.ts
//   node scripts/deploy-edge.js --secret <NAME>=<VALUE>  # 仅设置 function env（Supabase secrets）
//
// 准备（一次性）：SUPABASE_ACCESS_TOKEN 写入仓库根目录 .env（同 sb.js；该文件已被 .gitignore 忽略）；
// 项目 ref 自动从 js/config.js 的 SUPABASE_URL 提取，也可显式指定 SUPABASE_PROJECT_REF。
//
// 部署通道：先走 CLI 同款 bundle 接口（POST /functions/deploy），失败回落旧版
// PATCH /functions/{slug}（JSON files）。qq-relay 的 verify_jwt 必须为 false
// （前端携带的是 Aoi 管理员 token，不是 Supabase JWT）。
'use strict';

const fs = require('fs');
const path = require('path');

// —— 极简 .env 加载（与 scripts/sb.js 同风格）——
for (const envFile of ['.env', 'relay/.env']) {
  try {
    const fp = path.join(__dirname, '..', envFile);
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* 文件不存在则跳过 */ }
}

function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
    const m = cfg.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
    if (m) return m[1];
  } catch (e) { /* config.js 不存在（CI 由 build-config 生成） */ }
  return '';
}

async function main() {
  const args = process.argv.slice(2);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();
  if (!token) { console.error('缺少 SUPABASE_ACCESS_TOKEN（写入 .env）'); process.exit(1); }
  if (!ref) { console.error('无法确定项目 ref（检查 js/config.js 或设 SUPABASE_PROJECT_REF）'); process.exit(1); }
  const api = 'https://api.supabase.com/v1/projects/' + ref;

  // --secret NAME=VALUE：设置 function 环境变量（qq-relay 的 RELAY_UPSTREAM 等）后退出
  if (args[0] === '--secret') {
    const m = String(args[1] || '').match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) { console.error('用法: --secret NAME=VALUE'); process.exit(1); }
    const r = await fetch(api + '/secrets', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ name: m[1], value: m[2] }]),
    });
    console.log('secret ' + m[1] + ':', r.status, await r.text());
    return;
  }

  const [slug, file] = args;
  if (!slug || !file) { console.error('用法: node scripts/deploy-edge.js <slug> <源文件路径> | --secret NAME=VALUE'); process.exit(1); }
  const content = fs.readFileSync(file, 'utf8');
  const attempts = [];

  // 通道一：bundle 部署（supabase CLI 同款接口）
  try {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ entrypoint_path: 'index.ts', verify_jwt: false })], { type: 'application/json' }), 'metadata');
    form.append('file', new Blob([content], { type: 'application/typescript' }), slug + '/index.ts');
    const r = await fetch(api + '/functions/deploy?slug=' + encodeURIComponent(slug), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form,
    });
    const body = await r.text();
    attempts.push({ via: 'bundle', status: r.status, body: body.slice(0, 400) });
    if (r.ok) { console.log('OK via bundle:', body); return; }
  } catch (e) { attempts.push({ via: 'bundle', error: String(e) }); }

  // 通道二：旧版 PATCH（JSON files）
  try {
    const r = await fetch(api + '/functions/' + encodeURIComponent(slug), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verify_jwt: false, entrypoint_url: 'index.ts', files: [{ name: 'index.ts', content: content }] }),
    });
    const body = await r.text();
    attempts.push({ via: 'patch', status: r.status, body: body.slice(0, 400) });
    if (r.ok) { console.log('OK via patch:', body); return; }
  } catch (e) { attempts.push({ via: 'patch', error: String(e) }); }

  console.error('部署失败，尝试记录：');
  attempts.forEach((a) => console.error(JSON.stringify(a)));
  process.exit(1);
}

main();
