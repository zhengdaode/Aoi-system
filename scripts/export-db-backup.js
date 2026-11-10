// Aoi-system — 数据库全量备份（方案 C 迁移前快照）
// 经 Management API SQL 导出 teams / team_data / auth.users 摘要为原生 JSON + manifest（行数/SHA-256）。
// 备份含 PII（地址/QQ/邮箱），输出到仓库外目录，绝不入仓。
//
// 用法：node scripts/export-db-backup.js <输出目录>
// 前置：.env 含 SUPABASE_ACCESS_TOKEN（同 sb.js；项目 ref 自 js/config.js 提取）
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const outDir = process.argv[2];
if (!outDir) { console.error('用法：node scripts/export-db-backup.js <输出目录（仓库外）>'); process.exit(1); }
if (!process.env.SUPABASE_ACCESS_TOKEN) { console.error('缺少 SUPABASE_ACCESS_TOKEN'); process.exit(1); }
const ref = projectRef();
if (!ref) { console.error('无法确定项目 ref'); process.exit(1); }

async function runSql(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN },
    body: JSON.stringify({ query: sql })
  });
  const body = await r.json().catch(function () { return null; });
  if (!r.ok) { console.error('[backup] SQL 失败（HTTP ' + r.status + '）：', JSON.stringify(body)); process.exit(1); }
  return body;
}

const QUERIES = [
  { file: 'teams.json', sql: 'select * from teams order by created_at;' },
  { file: 'team_data.json', sql: 'select team_id, data, updated_at from team_data order by updated_at;' },
  { file: 'auth-users-summary.json', sql: 'select id, email, email_confirmed_at, created_at, last_sign_in_at from auth.users order by created_at;' }
];

(async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { exportedAt: new Date().toISOString(), projectRef: ref, tables: [] };
  for (const q of QUERIES) {
    const rows = await runSql(q.sql);
    const fp = path.join(outDir, q.file);
    fs.writeFileSync(fp, JSON.stringify(rows, null, 1));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    const bytes = JSON.stringify(rows).length;
    manifest.tables.push({ file: q.file, rows: rows.length, bytes: bytes, sha256: sha });
    console.log('[backup] ' + q.file + '  ' + rows.length + ' 行  ' + bytes + ' B  sha256=' + sha.slice(0, 16) + '…');
  }
  // blob 概况（供迁移对账）
  const dr = (manifest.tables.find(function (t) { return t.file === 'team_data.json'; }), null);
  const dataRows = JSON.parse(fs.readFileSync(path.join(outDir, 'team_data.json'), 'utf8'));
  manifest.blobSummary = dataRows.map(function (r) {
    const b = r.data || {};
    const counts = {};
    Object.keys(b).sort().forEach(function (k) {
      const v = b[k];
      counts[k] = Array.isArray(v) ? ('array:' + v.length) : (v && typeof v === 'object' ? ('object:' + Object.keys(v).length) : JSON.stringify(v));
    });
    return { team_id: r.team_id, updated_at: r.updated_at, blobKeys: counts, serializedBytes: JSON.stringify(b).length };
  });
  const mp = path.join(outDir, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
  console.log('[backup] manifest -> ' + mp);
  console.log('[backup] 完成。目录：' + outDir);
})();
