// Supabase Edge Function — TypeSafe（Jev/System One）语义判断代理（v3.18.0，docs/PLAN-TYPESAFE.md）
// 浏览器 js/typesafe.js → 本函数 → https://api.typesafe.ai/v1/systemone
// 设计纪律：
//   ① TYPESAFE_API_KEY 只存 function secrets，前端零密钥（静态 SPA 存不了密钥）；
//   ② 鉴权复用 Aoi 管理员会话：Authorization: Bearer <admin token>，服务端调 admin_verify_session
//      校验（verify_jwt 关闭——前端携带的是 Aoi 管理员 token，不是 Supabase JWT，与 qq-relay 同理）；
//   ③ 纯转发不落盘：state/questions 原样透传，不做任何持久化；
//   ④ 防失控：body ≤64KB、每 token 30 次/分钟内存限频、上游 14s 超时、429/529 单次退避重试；
//   ⑤ 失败返回明确错误码，前端一律静默降级回「精确匹配 + 人工兜底」现状行为。
//   ⑥ F11-M9（docs/PLAN-F11-BOT-QA.md）新增 /bot-intent：QQ bot 专用意图判断端点，与 admin 通道
//      完全隔离——X-Bot-Token 共享密钥（function secrets BOT_INTENT_TOKEN），全 choice 判断，
//      服务端组题、结果归一后返回给 relay 消费；文本 ≤200 字、payload ≤8KB、限频共用 30 次/分钟。
// 部署：node scripts/deploy-edge.js typesafe-proxy supabase/functions/typesafe-proxy/index.ts
//   密钥：node scripts/deploy-edge.js --secret TYPESAFE_API_KEY=<key> --secret BOT_INTENT_TOKEN=<值>
//   （值在本地 .env，不入仓库）
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// 上游调用（admin 透传与 /bot-intent 共用）：14s 超时、429/529 单次退避重试；
// 失败归一 502 不暴露上游细节，调用方静默降级。
async function callUpstream(payload: string): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
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
      if (r.ok) return { ok: true, text: await r.text() };
      // 429/529 按官方建议退避重试一次；401 说明密钥失效，归一为 502 让调用方静默降级（不暴露细节）
      if ((r.status === 429 || r.status === 529) && attempt === 0) {
        clearTimeout(timer);
        await sleep(800);
        continue;
      }
      return { ok: false, response: json(502, { error: 'typesafe upstream ' + r.status }) };
    } catch {
      if (attempt === 0) {
        clearTimeout(timer);
        await sleep(300);
        continue;
      }
      return { ok: false, response: json(502, { error: 'typesafe upstream unreachable' }) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, response: json(502, { error: 'typesafe upstream failed' }) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!API_KEY) return json(503, { error: 'TYPESAFE_API_KEY not configured' });

  // —— F11-M9：QQ bot 意图路由（与 admin 通道隔离，X-Bot-Token 共享密钥） ——
  const url = new URL(req.url);
  if (url.pathname === '/bot-intent') {
    const botSecret = Deno.env.get('BOT_INTENT_TOKEN') ?? '';
    if (!botSecret) return json(503, { error: 'BOT_INTENT_TOKEN not configured' });
    const botToken = (req.headers.get('X-Bot-Token') ?? '').trim();
    if (!botToken || botToken !== botSecret) return json(401, { error: 'invalid bot token' });
    if (limited('bot-intent')) return json(429, { error: 'rate limited' });

    let bot: { text?: unknown; intents?: unknown };
    try {
      const raw = await req.text();
      if (raw.length > 8 * 1024) return json(413, { error: 'payload too large' });
      bot = JSON.parse(raw);
    } catch {
      return json(400, { error: 'bad json' });
    }
    // relay 侧已脱敏截断，此处兜底再截；候选指令清洗（防超长/超量选项注入）
    const text = String(bot.text ?? '').slice(0, 200);
    const intents = Array.isArray(bot.intents)
      ? bot.intents.map((s) => String(s)).filter((s) => s && s.length <= 12).slice(0, 12)
      : [];
    if (!text.trim()) return json(422, { error: 'text required' });
    if (!intents.length) intents.push('其他');

    // 全 choice 判断（仓库内唯一有生产先例的契约；「有意义/紧急度」选项化，阈值由 relay 影子模式校准）
    const criteria: Record<string, string> = { 其他: '以上意图都不是' };
    for (const s of intents) criteria[s] = '指令「' + s + '」对应的意图';
    const payload = JSON.stringify({
      state: { text },
      questions: {
        intent: {
          type: 'choice',
          instructions: '这是一位团购买家发给 QQ 机器人的消息（非指令格式）。买家想做什么？拿不准就选「其他」，不要臆测消息里没有的诉求。',
          criteria,
        },
        meaningful: {
          type: 'choice',
          instructions: '这条消息是否包含需要回应的有效诉求？',
          criteria: { 有诉求: '包含问题/请求/不满等值得回应的内容', 无意义: '寒暄、无意义字符、与团购无关的闲聊' },
        },
        category: {
          type: 'choice',
          instructions: '这条消息属于哪一类？',
          criteria: {
            进度咨询: '订单/排单/到货/发货/收货进度',
            物流快递: '快递单号/物流状态/包裹异常',
            交费问题: '缴费金额/方式/凭证/退款',
            绑定账号: 'QQ 绑定/圈名/账号问题',
            商品咨询: '商品本身/数量/款式',
            投诉不满: '不满/投诉/催促',
            其他: '以上都不是',
          },
        },
        importance: {
          type: 'choice',
          instructions: '需要管理员介入的紧急程度？',
          criteria: { 紧急: '金钱纠纷/丢件/情绪激烈，应立即处理', 重要: '有明确问题，可等每日汇总', 普通: '一般咨询' },
        },
      },
      model: 'jev-latest',
    });
    const up = await callUpstream(payload);
    if (!up.ok) return up.response;
    let parsed: { answers?: Record<string, { type?: string; choice?: unknown; confidence?: unknown }> };
    try { parsed = JSON.parse(up.text); } catch { return json(502, { error: 'typesafe upstream bad json' }); }
    const answers = parsed.answers ?? {};
    const pick = (key: string) => {
      const a = answers[key];
      if (!a || a.type !== 'choice') return null;
      return { label: String(a.choice ?? ''), confidence: a.confidence == null ? 1 : Number(a.confidence) || 0 };
    };
    const meaningful = pick('meaningful');
    const importance = pick('importance');
    return json(200, {
      intent: pick('intent'),
      meaningful: meaningful ? meaningful.label !== '无意义' : true,
      category: pick('category'),
      importance: importance
        ? { label: importance.label, score: importance.label === '紧急' ? 100 : importance.label === '重要' ? 60 : 20 }
        : null,
    });
  }

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
  const up = await callUpstream(payload);
  if (!up.ok) return up.response;
  return new Response(up.text, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
