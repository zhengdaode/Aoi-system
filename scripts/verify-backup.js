// Aoi-system — 备份校验（方案 C 迁移前）：解析备份 JSON、统计行数/字节/键结构/SHA-256
// 用法：node scripts/verify-backup.js <backup-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = process.argv[2];
if (!dir) { console.error('用法：node scripts/verify-backup.js <backup-dir>'); process.exit(1); }

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const teams = JSON.parse(fs.readFileSync(path.join(dir, 'teams.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(dir, 'team_data.json'), 'utf8'));
const users = JSON.parse(fs.readFileSync(path.join(dir, 'auth-users-summary.json'), 'utf8'));

console.log('=== 备份校验：' + dir + ' ===');
console.log('teams.json        :', teams.length, '行 |', fs.statSync(path.join(dir, 'teams.json')).size, 'B | sha256=' + sha256(path.join(dir, 'teams.json')).slice(0, 16) + '…');
console.log('team_data.json    :', data.length, '行 |', fs.statSync(path.join(dir, 'team_data.json')).size, 'B | sha256=' + sha256(path.join(dir, 'team_data.json')).slice(0, 16) + '…');
console.log('auth-users.json   :', users.length, '行 |', fs.statSync(path.join(dir, 'auth-users-summary.json')).size, 'B | sha256=' + sha256(path.join(dir, 'auth-users-summary.json')).slice(0, 16) + '…');

const blob = data[0] && data[0].data ? data[0].data : null;
if (!blob) { console.error('team_data.data 结构异常'); process.exit(1); }
console.log('\n--- blob 概况 ---');
console.log('团队 updated_at:', data[0].updated_at);
console.log('blob 键数:', Object.keys(blob).length);
console.log('blob 字节数(JSON 序列化):', JSON.stringify(blob).length);
console.log('\n--- blob 各键类型与规模 ---');
Object.keys(blob).sort().forEach(function (k) {
  const v = blob[k];
  if (Array.isArray(v)) console.log('  ' + k + ': array(' + v.length + ')');
  else if (v && typeof v === 'object') console.log('  ' + k + ': object(' + Object.keys(v).length + ' keys)');
  else console.log('  ' + k + ':', JSON.stringify(v));
});
// orders 单条字段集合（迁移 DDL 输入）
function fieldSet(arr) {
  const s = {};
  (arr || []).forEach(function (o) { Object.keys(o || {}).forEach(function (k) { s[k] = (s[k] || 0) + 1; }); });
  return s;
}
console.log('\n--- orders 字段集合（出现次数/总 ' + ((blob.orders || []).length) + '）---');
const of = fieldSet(blob.orders);
Object.keys(of).sort().forEach(function (k) { console.log('  ' + k + ': ' + of[k]); });
console.log('\n--- activityMeta 首个活动字段 ---');
const firstMeta = Object.values(blob.activityMeta || {})[0] || {};
console.log(' ', Object.keys(firstMeta).join(', '));
console.log('--- 首个商品字段 ---');
const firstProduct = firstMeta.products ? firstMeta.products[0] : null;
console.log(' ', firstProduct ? Object.keys(firstProduct).join(', ') : '(无商品)');
