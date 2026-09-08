// Supabase Edge Function — QQ relay 的 https 入口（纯透传，不存任何密钥）
// 浏览器（GitHub Pages, https）→ 本函数 → ECS relay（http://47.101.194.103:8080）→ NapCat
// 鉴权在 ECS relay 完成（admin_verify_session），本函数只做协议桥接：
//   解决 https 页面无法直接 fetch http 地址的混合内容拦截，替代 trycloudflare 临时隧道。
// 部署：supabase functions deploy qq-relay --project-ref blfzbrivtxjxlbhgabqi --no-verify-jwt
//   （verify_jwt 必须关：前端携带的是 Aoi 管理员 token，不是 Supabase JWT）
// v3.5.2：新增 GET /fetch/<host>/<path…> 透传 —— 链接导入在 GitHub Pages 通道的代理路径
//   （Pages 无服务端重写，https 页面也无法直连 http relay，只能经本函数桥接）。
//   host 白名单须与 relay/relay.js FETCH_HOSTS 一致（双层校验，防开放代理）。
//   注意：上游响应必须内存缓冲后再返回——运行时对透传流式 body 不稳（实测 500）。
const UPSTREAM = 'http://47.101.194.103:8080/';

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
    if (fm[1] !== 'static.zwlhome.com') {
      return new Response(JSON.stringify({ error: 'host not allowed' }),
        { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
      const r = await fetch(UPSTREAM + 'fetch/' + fm[1] + '/' + fm[2] + u.search, { redirect: 'follow' });
      return new Response(await r.arrayBuffer(), {
        status: r.status,
        headers: { ...CORS, 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream' },
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
  const r = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: req.headers.get('Authorization') ?? '',
    },
    body: await req.text(),
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
