#!/usr/bin/env node
// Aoi-system — Supabase agent 操作入口（Management API 零依赖 SQL 执行器）
//
// 让 agent（Claude/ZCode 等）能直接对线上 Supabase 执行 SQL，无需人工复制粘贴。
// 原理：Supabase Management API POST /v1/projects/{ref}/database/query
//
// 准备（一次性）：
//   1. Supabase Dashboard → Account → Access Tokens → 生成个人 token
//   2. 设置环境变量（Git Bash）：
//        export SUPABASE_ACCESS_TOKEN="sbp_xxx"
//      （或写入仓库根目录 .env——本脚本会读取，且该文件已被 .gitignore 忽略）
//   3. 项目 ref 自动从 js/config.js 的 SUPABASE_URL 提取，也可显式指定：
//        export SUPABASE_PROJECT_REF="xxxxxxxxxxxxxxxxxxxx"
//
// 用法：
//   node scripts/sb.js "select id, name, member_key from teams;"
//   node scripts/sb.js -f supabase-schema.sql      # 执行整个 SQL 文件
//   node scripts/sb.js --check                     # 只验证连通性
//
// 安全提醒：token 等同账号全权，勿提交进仓库。
'use strict';

const fs = require('fs');
const path = require('path');

// —— 极简 .env 加载（与 relay/relay.js 同风格，零依赖）——
for (const envFile of ['.env', 'relay/.env']) {
  try {
    const fp = path.join(__dirname, '..', envFile);
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* 文件不存在则跳过 */ }
}

// —— 项目 ref：优先环境变量，否则从 js/config.js 提取 ——
function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
    const m = cfg.match(/SUPABASE_URL:\s*'https:\/\/([a-z0-9]+)\.supabase\.co'/);
    if (m) return m[1];
  } catch (e) { /* ignore */ }
  return null;
}

async function runSql(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();
  if (!token || !ref) {
    console.error('[sb] 缺少配置：SUPABASE_ACCESS_TOKEN' + (ref ? '' : ' 或 SUPABASE_PROJECT_REF（且无法从 js/config.js 提取）'));
    console.error('[sb] 获取 token：Supabase Dashboard → Account → Access Tokens');
    process.exit(2);
  }
  const r = await fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query: sql })
  });
  const body = await r.json().catch(function () { return null; });
  if (!r.ok) {
    console.error('[sb] 执行失败（HTTP ' + r.status + '）：', JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
}

function cellStr(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return String(v);
}

function printRows(rows) {
  if (!Array.isArray(rows)) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('(0 rows)'); return; }
  const cols = Object.keys(rows[0]);
  const w = cols.map(function (c) {
    return Math.max(c.length, ...rows.map(function (r) { return cellStr(r[c]).length; }));
  });
  const line = function (cells) { return cells.map(function (c, i) { return c.padEnd(w[i]); }).join(' | '); };
  console.log(line(cols));
  console.log(w.map(function (n) { return '-'.repeat(n); }).join('-+-'));
  rows.forEach(function (r) {
    console.log(line(cols.map(function (c) { return cellStr(r[c]); })));
  });
  console.log('(' + rows.length + ' rows)');
}

// —— v3.12.0 B5：迁移机制——按文件名序执行 supabase/migrations/ 中未应用的 *.sql，
//    应用后在 schema_migrations 登记版本。全量基线（supabase-schema.sql）保持可独立重跑。
async function migrate() {
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.sql'); }).sort();
  } catch (e) { console.log('[sb] 无 supabase/migrations 目录，无可执行迁移'); return; }
  const applied = await runSql('select version from schema_migrations');
  const done = new Set((applied || []).map(function (r) { return r.version; }));
  let ran = 0;
  for (const f of files) {
    if (done.has(f)) { console.log('[sb] 已应用，跳过: ' + f); continue; }
    console.log('[sb] 应用迁移: ' + f);
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await runSql(sql);
    await runSql('insert into schema_migrations (version) values (\'' + f.replace(/'/g, "''") + '\')');
    ran++;
  }
  console.log('[sb] 迁移完成：本次执行 ' + ran + ' 个，共 ' + files.length + ' 个脚本');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    const rows = await runSql('select current_database() as db, now() as now');
    console.log('[sb] 连接成功'); printRows(rows); return;
  }
  if (args[0] === '--migrate') { await migrate(); return; }
  let sql;
  if (args[0] === '-f') {
    if (!args[1]) { console.error('[sb] 用法: node scripts/sb.js -f <file.sql>'); process.exit(2); }
    sql = fs.readFileSync(path.resolve(args[1]), 'utf8');
    console.error('[sb] 执行文件: ' + args[1] + '（' + sql.length + ' 字符）');
  } else if (args[0]) {
    sql = args.join(' ');
  } else {
    console.error('用法:\n  node scripts/sb.js "select 1"\n  node scripts/sb.js -f supabase-schema.sql\n  node scripts/sb.js --migrate\n  node scripts/sb.js --check');
    process.exit(2);
  }
  printRows(await runSql(sql));
}

main().catch(function (e) { console.error('[sb] 异常：', e.message); process.exit(1); });
