#!/usr/bin/env node
// Aoi-system — 方案 C P3 对拍：用临时探针会话调用 aoi_get_all，把组装结果存为原生 JSON
// 用法：node scripts/probe-assemble.js <输出文件>
// 流程：插入 1 小时临时 admin session（固定探针 token）→ aoi_get_all → 存盘 → 删除该会话。
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
const out = process.argv[2];
if (!out) { console.error('用法：node scripts/probe-assemble.js <输出文件>'); process.exit(1); }
const TOKEN = 'aoi-probe-token-p3-' + '0123456789abcdef'; // 32+ 长度
const ref = projectRef();

async function runSql(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN },
    body: JSON.stringify({ query: sql })
  });
  const body = await r.json().catch(function () { return null; });
  if (!r.ok) { console.error('[probe] SQL 失败：' + JSON.stringify(body)); process.exit(1); }
  return body;
}
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

(async function main() {
  const hashSql = "encode(digest('" + TOKEN + "', 'sha256'), 'hex')";
  await runSql("delete from admin_sessions where token_hash = " + hashSql + ";");
  await runSql("insert into admin_sessions (admin_id, token_hash, expires_at) select a.id, " + hashSql + ", now() + interval '1 hour' from admins a order by a.created_at limit 1;");
  await sleep(300);
  const rows = await runSql("select public.aoi_get_all('" + TOKEN + "') as assembled;");
  await runSql("delete from admin_sessions where token_hash = " + hashSql + ";");
  const assembled = rows[0] && rows[0].assembled;
  if (!assembled || !assembled.data) { console.error('[probe] 组装结果异常：' + JSON.stringify(assembled).slice(0, 300)); process.exit(1); }
  fs.writeFileSync(out, JSON.stringify(assembled, null, 1));
  console.log('[probe] 组装结果 -> ' + out + '（' + JSON.stringify(assembled.data).length + ' B，team=' + assembled.name + '）');
})();
