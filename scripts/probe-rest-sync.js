#!/usr/bin/env node
// Aoi-system — 临时探针：模拟浏览器 PostgREST 通道的 aoi_get_all / aoi_sync 全链路
// （sync-smoke 走 SQL 直调；本探针走 REST，与 supabase-js 底层完全同形）
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
const ref = projectRef();
const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
const URL = cfg.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const ANON = cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const TOKEN = 'aoi-probe-rest-tok-' + '0123456789abcdef';

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
// 与 supabase-js rpc 完全同形：POST /rest/v1/rpc/<fn>，apikey+Authorization=anon
async function restRpc(fn, args) {
  const r = await fetch(URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: 'Bearer ' + ANON
    },
    body: JSON.stringify(args)
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: r.status, body };
}
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

(async function main() {
  const hashSql = "encode(digest('" + TOKEN + "', 'sha256'), 'hex')";
  await runSql("delete from admin_sessions where token_hash = " + hashSql + ";");
  await runSql("insert into admin_sessions (admin_id, token_hash, expires_at) select a.id, " + hashSql + ", now() + interval '1 hour' from admins a order by a.created_at limit 1;");
  await sleep(300);

  // 1. REST 读（函数 returns json → body 即 {name, memberKey, data, updatedAt} 信封）
  let r = await restRpc('aoi_get_all', { p_token: TOKEN });
  const env1 = r.body || {};
  console.log('[probe] aoi_get_all status=' + r.status + ' 键数=' + Object.keys(env1.data || {}).length);
  if (r.status !== 200) { console.error('[probe] 读取失败'); process.exit(1); }

  // 2. REST 写——模拟「导入新拼团」变更集（新活动 + 商品 + 订单 + 限购 + 通用编辑）
  const ch = {
    activities: { upsert: [{ name: 'PROBE测试团', sortOrder: 999999, status: null, remark: 'probe' }], delete: [] },
    products: { upsert: [{ id: 'probe-prod-1', activity: 'PROBE测试团', type: '测试类型', model: '测试型号', price: 100, currency: 'JPY', sortOrder: 0 }], delete: [] },
    orders: { upsert: [{ id: 'probe-order-1', activity: 'PROBE测试团', type: '测试类型', model: '测试型号', buyer: '探针', count: 1, price: 100, currency: 'JPY', status: '未到货', sortOrder: 999999 }], delete: [] },
    limitPlans: { upsert: [{ activity: 'PROBE测试团', payload: { '测试类型|测试型号': { limit: 3 } } }], delete: [] },
    settings: { upsert: [{ key: 'probeKey', value: { hello: 'world' } }], delete: [] }
  };
  r = await restRpc('aoi_sync', { p_token: TOKEN, p_changes: ch });
  console.log('[probe] aoi_sync(导入形状) status=' + r.status + ' body=' + JSON.stringify(r.body).slice(0, 300));
  if (r.status !== 200) {
    console.error('[probe] ★ REST 写失败——这就是浏览器侧根因');
  } else {
    // 3. 回读验证
    const got = await restRpc('aoi_get_all', { p_token: TOKEN });
    const d = (got.body && got.body.data) || {};
    const act = (d.activities || []).indexOf('PROBE测试团');
    const ord = (d.orders || []).find(function (o) { return o.id === 'probe-order-1'; });
    const prod = ((d.activityMeta || {})['PROBE测试团'] || {}).products || [];
    const lp = ((d.limitPlans || {})['PROBE测试团']);
    const kv = d.probeKey;
    console.log('[probe] 回读 activities含PROBE=' + (act >= 0) + ' orders=' + !!ord + ' products=' + prod.length + ' limitPlans=' + JSON.stringify(lp) + ' probeKey=' + JSON.stringify(kv));
  }

  // 4. 清理（走同样的 REST 通道删除）
  const del = { activities: { upsert: [], delete: ['PROBE测试团'] }, orders: { upsert: [], delete: ['probe-order-1'] }, settings: { upsert: [], delete: ['probeKey'] } };
  r = await restRpc('aoi_sync', { p_token: TOKEN, p_changes: del });
  console.log('[probe] 清理 status=' + r.status + ' ' + (r.status !== 200 ? JSON.stringify(r.body).slice(0, 300) : ''));
  await runSql("delete from admin_sessions where token_hash = " + hashSql + ";");
  console.log('[probe] 完成（探针会话已删除）');
  process.exit(0);
})();
