// v3.18.0 TypeSafe 语义判断集成测试（docs/PLAN-TYPESAFE.md T1/T2）：
//   客户端降级矩阵/缓存/并发 + catalog T1（词典未命中建议/采纳）+ T2（语义对齐合并/无表头列角色）
// 网络层全部 mock：typesafe.judge / judgeAll 直接 stub，fetch 用 vi.fn 假响应，不发任何真实请求。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

const TOKEN = 't'.repeat(40);

// jsdom 环境兜底：无 AbortController 时补最小实现（judge 的 15s 超时钩子）
if (!win.AbortController) {
  win.AbortController = class {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  };
}

function okFetch(answers) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ model: 'jev-test', answers, usage: {} })
  }));
}

beforeEach(() => {
  aoi.state.data = {
    activities: ['测试活动'],
    typeMeta: { '毛绒玩偶': { route: '' }, '挂件': { route: '' } },
    orders: [], batches: [], activityMeta: {}, pcoItems: [],
    calc: { jpyRate: 0.048, jpyMarkup: 0.005 }
  };
  aoi.catalog.draft = [];
  aoi.catalog.matchers = null;
  aoi.typesafe._cache.clear();
  win.localStorage.setItem('aoi_typesafe', 'on');
  aoi.config = { SUPABASE_URL: 'https://sb.supabase.co' };
  aoi.state.user = { isDebug: false };
  aoi.adminLoadSession = () => ({ token: TOKEN, username: 'a' });
  aoi.toast = vi.fn();
});

describe('Aoi.typesafe 客户端', () => {
  it('url 拼接与 available 三态（开+有地址 / 关 / 无地址）', () => {
    expect(aoi.typesafe.url()).toBe('https://sb.supabase.co/functions/v1/typesafe-proxy');
    expect(aoi.typesafe.available()).toBe(true);
    win.localStorage.setItem('aoi_typesafe', 'off');
    expect(aoi.typesafe.available()).toBe(false);
    win.localStorage.setItem('aoi_typesafe', 'on');
    aoi.config = {};
    expect(aoi.typesafe.available()).toBe(false); // 本地无 config.js（debug）时的真实形态
  });

  it('judge：成功返回 answers 并按入参缓存（第二次不再发请求）；fresh 跳过缓存', async () => {
    const f = okFetch({ a: { type: 'noul', noul: 0.9 } });
    win.fetch = f;
    const q = { a: { type: 'noul', instructions: 'x' } };
    const r1 = await aoi.typesafe.judge({ s: 1 }, q);
    const r2 = await aoi.typesafe.judge({ s: 1 }, q);
    const r3 = await aoi.typesafe.judge({ s: 1 }, q, { fresh: true });
    expect(r1.a.noul).toBe(0.9);
    expect(r2.a.noul).toBe(0.9);
    expect(r3.a.noul).toBe(0.9);
    expect(f).toHaveBeenCalledTimes(2); // 1 次首判 + 1 次 fresh
    // 鉴权头：管理员 token 随 Authorization 下发（Edge 侧校验）
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer ' + TOKEN);
  });

  it('judge 降级矩阵：关开关/无会话/debug 账号/非 2xx/网络异常 → 一律 null', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 502, text: async () => '{"error":"x"}' }));
    win.fetch = f;
    expect(await aoi.typesafe.judge({ s: 1 }, {})).toBeNull();
    win.fetch = vi.fn(async () => { throw new Error('network down'); });
    expect(await aoi.typesafe.judge({ s: 2 }, {})).toBeNull();
    win.fetch = okFetch({ a: 1 });
    win.localStorage.setItem('aoi_typesafe', 'off');
    expect(await aoi.typesafe.judge({ s: 3 }, {})).toBeNull();
    win.localStorage.setItem('aoi_typesafe', 'on');
    aoi.adminLoadSession = () => null;
    expect(await aoi.typesafe.judge({ s: 4 }, {})).toBeNull();
    aoi.adminLoadSession = () => ({ token: TOKEN });
    aoi.state.user = { isDebug: true };
    expect(await aoi.typesafe.judge({ s: 5 }, {})).toBeNull();
  });

  it('judgeAll：返回顺序与入参一致，失败位补 null', async () => {
    const orig = aoi.typesafe.judge;
    aoi.typesafe.judge = async (s) => (s.i === 2 ? null : { ok: s.i });
    const r = await aoi.typesafe.judgeAll([
      { state: { i: 1 }, questions: {} },
      { state: { i: 2 }, questions: {} },
      { state: { i: 3 }, questions: {} }
    ]);
    expect(r.map((x) => x && x.ok)).toEqual([1, null, 3]);
    aoi.typesafe.judge = orig;
  });
});

describe('catalog T1：词典未命中建议（候选预筛 → 判断 → 人工采纳）', () => {
  const patchDict = () => {
    aoi.catalog.matchers = [
      { jp: 'ぬいぐるみ', zh: '毛绒玩偶', cat: true },
      { jp: 'マスコット', zh: '挂件', cat: false }
    ];
    aoi.catalog.phrases = [];
  };

  it('suggestCandidates：编辑距离 ≤2 / 互为子串进候选，无关片段不进', () => {
    patchDict();
    expect(aoi.catalog.suggestCandidates({ unmatched: ['ぬいぐるめ'] })).toEqual([{ zh: '毛绒玩偶', jp: 'ぬいぐるみ' }]);
    expect(aoi.catalog.suggestCandidates({ unmatched: ['マスコット（ウルトラ）'] })).toContainEqual({ zh: '挂件', jp: 'マスコット' });
    expect(aoi.catalog.suggestCandidates({ unmatched: [] })).toEqual([]);
  });

  it('enrichDraft：只为「有未识别/类型缺失」的行提问，建议挂 aiSuggest 并定向注入 DOM', async () => {
    patchDict();
    aoi.catalog.addToDraft([
      { jpName: 'ぬいぐるめ ピカチュウ', priceJpy: 100 },            // 有 unmatched 且无类型 → cn+type 双问
      { jpName: 'キーホルダー ピカチュウ', name: '钥匙扣 皮卡丘' },  // AI 行：name 直入、无 unmatched；type 缺 → 仅 type 问
      { jpName: 'マスコット ぬいぐるみ' }                              // 词典全命中且有类型 → 不问
    ]);
    aoi.catalog.render();
    const judgeAll = vi.fn(async (jobs) => jobs.map(() => ({
      cn: { type: 'choice', choice: '毛绒玩偶', confidence: 0.8 },
      type: { type: 'choice', choice: '毛绒玩偶', confidence: 0.9 }
    })));
    aoi.typesafe.judgeAll = judgeAll;
    await aoi.catalog.enrichDraft();
    expect(judgeAll).toHaveBeenCalledTimes(1);
    const jobs = judgeAll.mock.calls[0][0];
    expect(jobs).toHaveLength(2); // 第三行词典全覆盖不送判（省成本）
    expect(jobs[0].questions.cn).toBeTruthy();
    expect(jobs[0].questions.type).toBeTruthy();
    expect(jobs[1].questions.cn).toBeUndefined();
    expect(jobs[1].questions.type).toBeTruthy();
    expect(aoi.catalog.draft[0].aiSuggest.cn).toBe('毛绒玩偶');
    expect(aoi.catalog.draft[1].aiSuggest.type).toBe('毛绒玩偶');
    expect(aoi.catalog.draft[2].aiSuggest).toBeUndefined();
    // 定向注入：对应行出现「AI 建议」标记（未整表重绘）
    const row0 = doc.querySelector('#catDraftTbody tr[data-id="' + aoi.catalog.draft[0].id + '"]');
    expect(row0.querySelector('.cat-ai').textContent).toContain('AI 建议：毛绒玩偶');
  });

  it('enrichDraft 阈值：低置信不展示，「（无匹配，保持现状）」不展示', async () => {
    patchDict();
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるめ ピカチュウ', priceJpy: 100 }]);
    aoi.catalog.render();
    aoi.typesafe.judgeAll = async () => [
      { cn: { type: 'choice', choice: '毛绒玩偶', confidence: 0.3 } }
    ];
    await aoi.catalog.enrichDraft();
    expect(aoi.catalog.draft[0].aiSuggest).toBeUndefined();
    aoi.typesafe.judgeAll = async () => [
      { cn: { type: 'choice', choice: '（无匹配，保持现状）', confidence: 0.99 } }
    ];
    await aoi.catalog.enrichDraft();
    expect(aoi.catalog.draft[0].aiSuggest).toBeUndefined();
  });

  it('applyAiSuggest：采纳中文名后写入 name、清 unmatched、建议标记消失', async () => {
    patchDict();
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるめ ピカチュウ', priceJpy: 100 }]);
    aoi.catalog.render();
    aoi.typesafe.judgeAll = async () => [
      { cn: { type: 'choice', choice: '毛绒玩偶 皮卡丘', confidence: 0.9 } }
    ];
    await aoi.catalog.enrichDraft();
    const id = aoi.catalog.draft[0].id;
    aoi.catalog.applyAiSuggest(id, 'cn');
    expect(aoi.catalog.draft[0].name).toBe('毛绒玩偶 皮卡丘');
    expect(aoi.catalog.draft[0].unmatched).toEqual([]);
    expect(aoi.catalog.draft[0].aiSuggest).toBeUndefined();
    const row0 = doc.querySelector('#catDraftTbody tr[data-id="' + id + '"]');
    expect(row0.querySelector('.cat-ai')).toBeNull();
  });
});

describe('catalog T2：语义对齐合并与列角色', () => {
  it('mergeEntry：补缺失字段、AI 中文名覆盖并清未识别（与精确合并分支同语义）', () => {
    const target = { jpName: '页面行', name: '', type: '', priceJpy: null, limit: '', image: '', url: '', saleDate: '', unmatched: ['メガシンカ'] };
    aoi.catalog.mergeEntry(target, {
      jpName: 'AI行', name: '超级进化 皮卡丘 毛绒玩偶', type: '毛绒玩偶',
      priceJpy: 4180, limit: 3, image: 'https://img.example/a.jpg', url: 'https://x/p/1', saleDate: '11月8日発売'
    });
    expect(target).toMatchObject({
      name: '超级进化 皮卡丘 毛绒玩偶', type: '毛绒玩偶', priceJpy: 4180, limit: 3,
      image: 'https://img.example/a.jpg', url: 'https://x/p/1', saleDate: '11月8日発売'
    });
    expect(target.unmatched).toEqual([]);
    // 已有值不覆盖（补缺失语义）
    const t2 = { jpName: 'x', name: '已有名', type: '挂件', priceJpy: 100, limit: '', image: '', url: '', saleDate: '', unmatched: [] };
    aoi.catalog.mergeEntry(t2, { name: 'AI 新名', type: '', priceJpy: 999 });
    expect(t2.name).toBe('AI 新名'); // src.name 存在 → 覆盖（与精确分支 hasCn 覆盖一致）
    expect(t2.priceJpy).toBe(100);   // 已有价不覆盖
    expect(t2.type).toBe('挂件');    // src 无类型 → 保留
  });

  it('alignCandidates：子串/编辑距离命中、排除自身与待定行、完全相等不进', () => {
    const page = { id: 'p', jpName: 'メガシンカ ピカチュウ ぬいぐるみ' };
    const ai = { id: 'a', jpName: 'メガシンカ ピカチュウぬいぐるみ', alignPending: true };
    const other = { id: 'o', jpName: 'マスコット ゾロア' };
    const dup = { id: 'd', jpName: 'メガシンカ ピカチュウ ぬいぐるみ' };
    const cands = aoi.catalog.alignCandidates(ai, [page, ai, other, dup]);
    expect(cands.map((c) => c.id)).toEqual(['p', 'd']); // 编辑距离 1 命中 page；dup 与 page 同名各自成候选
    // 自身排除
    expect(aoi.catalog.alignCandidates(page, [page]).map((c) => c.id)).toEqual([]);
  });

  it('aiAlign 高置信：自动合并进已有行并删行（合并语义与两步流程一致）', async () => {
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウ ぬいぐるみ', priceJpy: 4180, limit: 3, image: 'https://img.example/p1.jpg', url: 'https://x/p/1' }]);
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウぬいぐるみ', name: '超级进化 皮卡丘 毛绒玩偶', type: '毛绒玩偶' }]);
    aoi.catalog.draft[1].aiFrom = true;
    aoi.catalog.draft[1].alignPending = true;
    aoi.typesafe.judge = vi.fn(async () => ({ same: { type: 'choice', choice: '#1', confidence: 0.93 } }));
    await aoi.catalog.aiAlign();
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0]).toMatchObject({ jpName: 'メガシンカ ピカチュウ ぬいぐるみ', name: '超级进化 皮卡丘 毛绒玩偶', type: '毛绒玩偶', priceJpy: 4180 });
    expect(aoi.catalog.draft[0].unmatched).toEqual([]);
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('自动合并 1 行'), 'success');
  });

  it('aiAlign 中间带：两行都保留并标黄待人工；人工可合并/保留', async () => {
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウ ぬいぐるみ' }]);
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウぬいぐるみ', name: '超级进化 皮卡丘', type: '毛绒玩偶' }]);
    aoi.catalog.draft[1].alignPending = true;
    aoi.typesafe.judge = vi.fn(async () => ({ same: { type: 'choice', choice: '#1', confidence: 0.6 } }));
    await aoi.catalog.aiAlign();
    expect(aoi.catalog.draft).toHaveLength(2);
    expect(aoi.catalog.draft[1].aiSuspect).toMatchObject({ id: aoi.catalog.draft[0].id });
    aoi.catalog.render();
    expect(doc.querySelector('#catDraftTbody').textContent).toContain('疑似与');

    // 人工「合并」→ 并入并删行
    aoi.catalog.resolveSuspect(aoi.catalog.draft[1].id, true);
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0].name).toBe('超级进化 皮卡丘');
  });

  it('aiAlign：无候选 / judge 返回 null（服务不可用）→ 行原样保留（回落现状）', async () => {
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウ ぬいぐるみ' }]);
    aoi.catalog.addToDraft([{ jpName: 'まったく別の新商品', name: '全新商品' }]);
    aoi.catalog.draft[1].alignPending = true;
    aoi.typesafe.judge = vi.fn(async () => null);
    await aoi.catalog.aiAlign();
    expect(aoi.catalog.draft).toHaveLength(2);
    expect(aoi.catalog.draft[1].alignPending).toBeUndefined();
    expect(aoi.typesafe.judge).not.toHaveBeenCalled(); // 无候选不花一次判断
  });

  it('aiColumnMapFromAnswers：置信度降序防冲突、低置信跳过、无 jp 列 → null', () => {
    const a1 = {
      c0: { type: 'choice', choice: 'jp', confidence: 0.95 },
      c1: { type: 'choice', choice: 'name', confidence: 0.8 },
      c2: { type: 'choice', choice: 'ignore', confidence: 0.7 }
    };
    expect(aoi.catalog.aiColumnMapFromAnswers(a1)).toEqual({ jp: 0, name: 1 });
    // 同字段两列：高置信者胜
    const a2 = {
      c0: { type: 'choice', choice: 'name', confidence: 0.7 },
      c1: { type: 'choice', choice: 'name', confidence: 0.9 },
      c2: { type: 'choice', choice: 'jp', confidence: 0.99 }
    };
    expect(aoi.catalog.aiColumnMapFromAnswers(a2)).toEqual({ name: 1, jp: 2 });
    // 低置信整列跳过 / 缺对齐键列 → null
    const a3 = { c0: { type: 'choice', choice: 'name', confidence: 0.3 }, c1: { type: 'choice', choice: 'type', confidence: 0.9 } };
    expect(aoi.catalog.aiColumnMapFromAnswers(a3)).toEqual(null);
    expect(aoi.catalog.aiColumnMapFromAnswers(null)).toBeNull();
  });

  it('aiRows/aiItems：有表头按关键字映射；无表头 map 为 null（固定列序兜底）', () => {
    const p1 = aoi.catalog.aiRows('| 日文原名 | 中文名 | 类型 |\n| --- | --- | --- |\n| ピカチュウ | 皮卡丘 | 毛绒玩偶 |');
    expect(p1.map.jp).toBe(0);
    expect(aoi.catalog.aiItems(p1.rows, p1.map)[0]).toMatchObject({ jpName: 'ピカチュウ', name: '皮卡丘', type: '毛绒玩偶' });
    const p2 = aoi.catalog.aiRows('ぬいぐるみ ピカチュウ\t皮卡丘 毛绒\t毛绒玩偶');
    expect(p2.map).toBeNull();
    expect(aoi.catalog.aiItems(p2.rows, null)[0]).toMatchObject({ jpName: 'ぬいぐるみ ピカチュウ', name: '皮卡丘 毛绒', type: '毛绒玩偶' });
  });

  it('importPaste 无表头 + AI 列角色：按判断出的映射解析（列序故意与固定兜底不同）', async () => {
    // 列序：中文名 / 日文原名 / 类型 —— 固定列序兜底会把 jp 认成第 0 列（错），AI 判断后应为第 1 列
    doc.getElementById('catPaste').value = '皮卡丘毛绒\tぬいぐるみ ピカチュウ\t毛绒玩偶';
    aoi.typesafe.judge = vi.fn(async (state, questions) => ({
      c0: { type: 'choice', choice: 'name', confidence: 0.9 },
      c1: { type: 'choice', choice: 'jp', confidence: 0.95 },
      c2: { type: 'choice', choice: 'type', confidence: 0.85 }
    }));
    await aoi.catalog.importPaste();
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0]).toMatchObject({ jpName: 'ぬいぐるみ ピカチュウ', name: '皮卡丘毛绒', type: '毛绒玩偶' });
    expect(aoi.catalog.draft[0].aiFrom).toBe(true);
  });

  it('importPaste 带表头 AI 表保持同步行为（无 await，既有调用方不感知 async 化）', () => {
    doc.getElementById('catPaste').value = '| 日文原名 | 中文名 | 类型 | 日元价 | 限购 |\n| --- | --- | --- | --- | --- |\n| ピカチュウ | 皮卡丘 | 毛绒玩偶 | 4180 | 3 |';
    aoi.catalog.importPaste();
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(doc.getElementById('catPaste').value).toBe('');
  });
});

describe('v3.18.1 ChatGPT「复制」按钮畸形 HTML（单元格级 <p>，无 <table>，2026-09-23 用户实测）', () => {
  // 真实形态：管道符与单元格各占一个 <p>，<br> 标记行边界，链接列为 <a>文本</a>&nbsp;，
  // 缺图/缺発売日为空单元格（| | |），末行可能缺右边界。
  const GPT_COPY_HTML = '<html><body><!--StartFragment-->'
    + '<p>|<br>日文原名</p><p>|</p><p>中文名</p><p>|</p><p>类型</p><p>|</p><p>日元价</p><p>|</p><p>限购</p><p>|</p><p>発売日</p><p>|</p><p>商品链接</p><p>|</p><p>图片链接</p>'
    + '<p>|<br>| --- | --- | --- | --- | --- | --- | --- | --- |<br>|</p>'
    + '<p>A4クリアファイル Pokémon Timeless Adventure アローラ</p><p>|</p><p>阿罗拉</p><p>|</p><p>文件夹</p><p>|</p><p>495</p><p>| | |</p>'
    + '<p><a href="https://www.pokemoncenter-online.com/4521329437491.html">https://www.pokemoncenter-online.com/4521329437491.html</a>&nbsp;</p><p>|</p>'
    + '<p><a href="https://www.pokemoncenter-online.com/a/img/item/4521329437491/M/x.jpg">https://www.pokemoncenter-online.com/a/img/item/4521329437491/M/x.jpg</a>&nbsp;</p><p>|<br>|</p>'
    + '<p>アクリルキーホルダー Pokémon Timeless Adventure アローラ</p><p>|</p><p>阿罗拉</p><p>|</p><p>亚克力挂件</p><p>|</p><p>935</p><p>| | |</p>'
    + '<p><a href="https://www.pokemoncenter-online.com/4521329437897.html">https://www.pokemoncenter-online.com/4521329437897.html</a>&nbsp;</p><p>| |<br>|</p>'
    + '<p>うたうフィギュア プリン</p><p>|</p><p>胖丁</p><p>|</p><p>手办</p><p>|</p><p>6600</p><p>| | |</p>'
    + '<p><a href="https://www.pokemoncenter-online.com/4521329438108.html">https://www.pokemoncenter-online.com/4521329438108.html</a>&nbsp;</p><p>| |</p>'
    + '<!--EndFragment--></body></html>';

  it('parseAiCopyHtml：按管道计数重组行，3 条全解析（含缺图行不串位、末行残尾兜底）', () => {
    const items = aoi.catalog.parseAiCopyHtml(GPT_COPY_HTML);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      jpName: 'A4クリアファイル Pokémon Timeless Adventure アローラ',
      name: '阿罗拉', type: '文件夹', priceJpy: 495
    });
    expect(items[0].url).toBe('https://www.pokemoncenter-online.com/4521329437491.html');
    expect(items[0].image).toContain('/a/img/item/4521329437491/M/');
    expect(items[1]).toMatchObject({
      jpName: 'アクリルキーホルダー Pokémon Timeless Adventure アローラ',
      name: '阿罗拉', type: '亚克力挂件', priceJpy: 935
    });
    expect(items[1].url).toContain('4521329437897');
    expect(items[1].image).toBe(''); // 缺图行的空单元格不把 URL 串到图片列
    expect(items[2]).toMatchObject({
      jpName: 'うたうフィギュア プリン', name: '胖丁', type: '手办', priceJpy: 6600
    });
    expect(items[2].url).toContain('4521329438108');
    expect(items[2].image).toBe('');
  });

  it('形状不符回落 null（PCO 商品卡 / 粗体行 / 纯文本）', () => {
    expect(aoi.catalog.parseAiCopyHtml('<ul><li class="product" data-pid="1"><div class="txt"><p class="txt">ぬいぐるみ</p></div></li></ul>')).toBeNull();
    expect(aoi.catalog.parseAiCopyHtml('<td><b>ぬいぐるみ ピカチュウ</b> 3,960円</td>')).toBeNull();
    expect(aoi.catalog.parseAiCopyHtml('ぬいぐるみ ピカチュウ 3,960円')).toBeNull();
  });

  it('importPaste：粘贴该 HTML 直接入草稿并标记 AI 行（aiFrom）', async () => {
    doc.getElementById('catPaste').value = GPT_COPY_HTML;
    await aoi.catalog.importPaste();
    expect(aoi.catalog.draft).toHaveLength(3);
    expect(aoi.catalog.draft[0]).toMatchObject({
      jpName: 'A4クリアファイル Pokémon Timeless Adventure アローラ',
      name: '阿罗拉', type: '文件夹', priceJpy: 495
    });
    expect(aoi.catalog.draft[0].url).toContain('4521329437491');
    expect(aoi.catalog.draft[0].aiFrom).toBe(true);
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('AI 翻译表格'), 'success');
  });
});
