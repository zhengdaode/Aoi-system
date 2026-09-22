// Supabase Edge Function — TypeSafe（Jev/System One）语义判断代理（v3.18.0，docs/PLAN-TYPESAFE.md）
// 浏览器 js/typesafe.js → 本函数 → https://api.typesafe.ai/v1/systemone
// 设计纪律：
//   ① TYPESAFE_API_KEY 只存 function secrets，前端零密钥（静态 SPA 存不了密钥）；
//   ② 鉴权复用 Aoi 管理员会话：Authorization: Bearer <admin token>，服务端调 admin_verify_session
//      校验（verify_jwt 关闭——前端携带的是 Aoi 管理员 token，不是 Supabase JWT，与 qq-relay 同理）；
//   ③ 纯转发不落盘：state/questions 原样透传，不做任何持久化；
//   ④ 防失控：body ≤64KB、每 token 30 次/分钟内存限频、上游 14s 超时、429/529 单次退避重试；
//   ⑤ 失败返回明确错误码，前端一律静默降级回「精确匹配 + 人工兜底」现状行为。
// 部署：node scripts/deploy-edge.js typesafe-proxy supabase/functions/typesafe-proxy/index.ts
//   密钥：node scripts/deploy-edge.js --secret TYPESAFE_API_KEY=<key>（值在本地 .env，不入仓库）
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const API_KEY = Deno.env.get('TYPESAFE_API_KEY') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 每 token 简易限频（单 isolate 内存近似，足够防前端失控循环；跨实例不保证精确）
const RATE = { max: 30, windowMs: 60_000 };
const buckets = new Map<string, { n: number; t0: number }>();
function limited(token: string): boolean {
  const now = Date.now();
  let b = buckets.get(token);
  if (!b || now - b.t0 > RATE.windowMs) {
    b = { n: 0, t0: now };
    buckets.set(token, b);
    if (buckets.size > 1000) buckets.clear();
  }
  b.n++;
  return b.n > RATE.max;
}

// 管理员会话校验：admin_verify_session 返回 {id, username, role} 或 null
async function verifyAdmin(token: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY || !token || token.length < 32) return false;
  try {
    const r = await fetch(SB_URL.replace(/\/+$/, '') + '/rest/v1/rpc/admin_verify_session', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && (j as { id?: string }).id);
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!API_KEY) return json(503, { error: 'TYPESAFE_API_KEY not configured' });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!(await verifyAdmin(token))) return json(401, { error: 'invalid admin session' });
  if (limited(token)) return json(429, { error: 'rate limited' });

  let body: { state?: unknown; questions?: unknown; model?: string };
  try {
    const text = await req.text();
    if (text.length > 64 * 1024) return json(413, { error: 'payload too large' });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'bad json' });
  }
  if (!body || body.state == null || !body.questions || typeof body.questions !== 'object') {
    return json(422, { error: 'state and questions required' });
  }

  const payload = JSON.stringify({
    state: body.state,
    questions: body.questions,
    model: body.model || 'jev-latest',
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    try {
      const r = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: payload,
        signal: ctrl.signal,
      });
      if (r.ok) {
        return new Response(await r.text(), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      // 429/529 按官方建议退避重试一次；401 说明密钥失效，归一为 502 让前端静默降级（不暴露细节）
      if ((r.status === 429 || r.status === 529) && attempt === 0) {
        clearTimeout(timer);
        await sleep(800);
        continue;
      }
      return json(502, { error: 'typesafe upstream ' + r.status });
    } catch {
      if (attempt === 0) {
        clearTimeout(timer);
        await sleep(300);
        continue;
      }
      return json(502, { error: 'typesafe upstream unreachable' });
    } finally {
      clearTimeout(timer);
    }
  }
  return json(502, { error: 'typesafe upstream failed' });
});
