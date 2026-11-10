#!/usr/bin/env node
// Aoi-system — 方案 C P3 终验：aoi_sync 写路径烟测
// 改一笔订单状态 → aoi_sync → 组装回读验证 → 恢复原值 → 回读验证（数据归位）。
'use strict';
const fs = require('fs');
const path = require('path');

for (const envFile of ['.env', 'relay/.env']) {
  try {
    const fp = path.join(__dirname, '..', envFile);
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* 无文件跳过 */ }
}
function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
    const m = cfg.match(/SUPABASE_URL:\s*'https:\/\/([a-z0-9]+)\.supabase\.co'/);
    if (m) return m[1];
  } catch (e) { /* ignore */ }
  return null;
}
const TOKEN = 'aoi-probe-token-p3-' + '0123456789abcdef';
const ref = projectRef();

async function runSql(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN },
    body: JSON.stringify({ query: sql })
  });
  const body = await r.json().catch(function () { return null; });
  if (!r.ok) { console.error('[smoke] SQL 失败：' + JSON.stringify(body)); process.exit(1); }
  return body;
}
async function rpc(fn, args) {
  const pairs = Object.keys(args).map(function (k) {
    const v = args[k];
    const lit = (typeof v === 'object')
      ? "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"
      : "'" + String(v).replace(/'/g, "''") + "'";
    return k + " => " + lit;
  });
  const rows = await runSql("select public." + fn + "(" + pairs.join(', ') + ") as result;");
  return rows[0] && rows[0].result;
}
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

(async function main() {
  const hashSql = "encode(digest('" + TOKEN + "', 'sha256'), 'hex')";
  await runSql("delete from admin_sessions where token_hash = " + hashSql + ";");
  await runSql("insert into admin_sessions (admin_id, token_hash, expires_at) select a.id, " + hashSql + ", now() + interval '1 hour' from admins a order by a.created_at limit 1;");
  await sleep(300);

  // 1. 读当前组装，取第一笔订单原样
  const got = await rpc('aoi_get_all', { p_token: TOKEN });
  const order = JSON.parse(JSON.stringify(got.data.orders[0]));
  const orig = order.status;
  console.log('[smoke] 目标订单 ' + order.id + '，原 status=' + orig);

  // 2. aoi_sync 改 status（upsert 行 = 完整行 + sortOrder，模拟 diff 输出）
  order.status = '烟测中';
  order.sortOrder = 0;
  const ch1 = { orders: { upsert: [order], delete: [] } };
  await rpc('aoi_sync', { p_token: TOKEN, p_changes: ch1 });
  const got2 = await rpc('aoi_get_all', { p_token: TOKEN });
  const after = got2.data.orders.find(function (o) { return o.id === order.id; });
  console.log('[smoke] 写后 status=' + after.status + (after.status === '烟测中' ? ' ✓' : ' ✗'));

  // 3. 恢复原值
  order.status = orig;
  await rpc('aoi_sync', { p_token: TOKEN, p_changes: { orders: { upsert: [order], delete: [] } } });
  const got3 = await rpc('aoi_get_all', { p_token: TOKEN });
  const restored = got3.data.orders.find(function (o) { return o.id === order.id; });
  console.log('[smoke] 恢复后 status=' + restored.status + (restored.status === orig ? ' ✓' : ' ✗'));

  await runSql("delete from admin_sessions where token_hash = " + hashSql + ";");
  console.log('[smoke] 完成（探针会话已删除）');
  process.exit(restored.status === orig ? 0 : 1);
})();
