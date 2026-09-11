// Supabase Edge Function — QQ relay 的 https 入口（纯透传，不存任何密钥）
// 浏览器（GitHub Pages, https）→ 本函数 → ECS relay（地址经 function env RELAY_UPSTREAM 注入，
// 服务器侧硬编码仅存在于 netlify.toml 重写，本仓库代码零硬编码）→ NapCat
// 鉴权在 ECS relay 完成（admin_verify_session），本函数只做协议桥接：
//   解决 https 页面无法直接 fetch http 地址的混合内容拦截，替代 trycloudflare 临时隧道。
// 部署：supabase functions deploy qq-relay --project-ref blfzbrivtxjxlbhgabqi --no-verify-jwt
//   （verify_jwt 必须关：前端携带的是 Aoi 管理员 token，不是 Supabase JWT）
// v3.5.2：新增 GET /fetch/<host>/<path…> —— 链接导入在 GitHub Pages 通道的代理路径
//   （Pages 无服务端重写，https 页面也无法直连 http relay，只能经本函数桥接）。
//   host 白名单防开放代理；响应内存缓冲（运行时对透传流式 body 不稳，实测 500）；
//   直连源站 + 15s 超时（实测 Edge→境内源站 ~350ms，偶发网关挂起由前端 20s 超时+重试兜底）。
// v3.9.3：/fetch 白名单由单主机扩为共享主机表（与前端 PROXY_HOSTS 同步）——汇总表参考图
//   内嵌 / 购买清单图绘制需要拉图床（esaimg/img.cdn1.vip）与商品图（PCO 主站）的字节，
//   这些源站无 CORS 头，Pages/本地环境唯一代理路径就是本通道。
// v3.12.0 B4 加固：
//   ① UPSTREAM 移入 function env（RELAY_UPSTREAM，Supabase secrets 配置；仓库不再硬编码 IP）；
//   ② POST body ≤64KB、/fetch 响应 ≤10MB（防内存耗尽）；
//   ③ /fetch redirect 改 manual 逐跳校验白名单（防白名单主机 302 到任意目标沦为 SSRF 跳板）。
const UPSTREAM = Deno.env.get('RELAY_UPSTREAM') ?? '';
const FETCH_HOSTS = [
  'static.zwlhome.com',
  'www.pokemoncenter-online.com',
  'esaimg.cdn1.vip',
  'img.cdn1.vip',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  const fm = req.method === 'GET' && u.pathname.match(/\/fetch\/([^/]+)\/(.+)$/);
  if (fm) {
    if (FETCH_HOSTS.indexOf(fm[1]) < 0) {
      return new Response(JSON.stringify({ error: 'host not allowed' }),
        { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let r: Response | null = null;
      try {
        // 逐跳校验：初始 host 与每个 3xx Location 的 host 都必须在白名单内（≤4 跳）
        let target = 'https://' + fm[1] + '/' + fm[2] + u.search;
        for (let hop = 0; hop < 4; hop++) {
          const hu = new URL(target);
          if (FETCH_HOSTS.indexOf(hu.hostname.toLowerCase()) < 0) {
            return new Response(JSON.stringify({ error: 'redirect host not allowed' }),
              { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
          }
          r = await fetch(target, { redirect: 'manual', signal: ctrl.signal });
          if (r.status >= 300 && r.status < 400) {
            const loc = r.headers.get('location');
            if (!loc) {
              return new Response(JSON.stringify({ error: 'bad redirect' }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            target = new URL(loc, target).href;
            continue;
          }
          break;
        }
      } finally {
        clearTimeout(timer);
      }
      const ab = await (r as Response).arrayBuffer();
      if (ab.byteLength > 10 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'payload too large' }),
          { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      return new Response(ab, {
        status: (r as Response).status,
        headers: { ...CORS, 'Content-Type': (r as Response).headers.get('content-type') ?? 'application/octet-stream' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'upstream fetch failed' }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }),
      { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!UPSTREAM) {
    return new Response(JSON.stringify({ error: 'RELAY_UPSTREAM not configured' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const text = await req.text();
  if (text.length > 64 * 1024) {
    return new Response(JSON.stringify({ error: 'payload too large' }),
      { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const r = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: req.headers.get('Authorization') ?? '',
    },
    body: text,
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
