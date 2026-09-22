// v3.19.0 TypeSafe 导入链路集成测试（docs/PLAN-TYPESAFE.md T3/T4/T5）：
//   T3 表格模板识别（parseMatrix/parseRecords hints + aiMapSheet 两轮判断 + parseSmart）
//   T4 商品主档语义对齐（候选预筛/决策/回填/confirmImport 集成）
//   T5 购买人归一（候选池/预筛/confirmImport 归一/静默归一/reviewModal 人工点选）
// 网络层全部 mock：typesafe.judge / judgeAll 直接 stub，不发任何真实请求。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

beforeEach(() => {
  aoi.state.data = {
    activities: ['测试团期'], ips: [], typeMeta: {},
    orders: [], batches: [],
    activityMeta: {
      '测试团期': { products: [
        { id: 'p1', type: '毛绒玩偶', model: 'ロールクッキー アローラNA', nameOrig: 'ロールクッキー アローラNA', price: 12, priceOrig: 1760, currency: 'jpy' },
        { id: 'p2', type: '文件夹', model: 'A4クリアファイル カロス' }
      ] }
    },
    memberMeta: { '麻酱': { qq: '123' } },
    calc: { jpyRate: 0.048, jpyMarkup: 0.005 }
  };
  aoi.typesafe._cache.clear();
  win.localStorage.setItem('aoi_typesafe', 'on');
  aoi.config = { SUPABASE_URL: 'https://sb.supabase.co' };
  aoi.state.user = { isDebug: false };
  aoi.adminLoadSession = () => ({ token: 't'.repeat(40) });
  aoi.toast = vi.fn();
  aoi.saveTeamData = async (d) => { aoi._saved = JSON.parse(JSON.stringify(d)); };
});

const MATRIX_ROWS = [
  ['【测试团期】', '', '', '', ''],
  ['分类', '', '吧唧', '', '毛绒'],
  ['款式', '', '火火', '水水', '皮卡'],
  ['価格', '', '10', '12', '30'],
  ['a', '', '2', '1', ''],
  ['b', '', '', '3', '1'],
  ['总数', '合计', '2', '4', '1']
];

describe('v3.19.0 T3 表格模板识别', () => {
  it('parseMatrix 不带 hints：非常规单价行名（価格）关键字定位失败 → 空数组', () => {
    expect(aoi.import.parseMatrix(MATRIX_ROWS, 'fb')).toEqual([]);
  });

  it('parseMatrix 带 hints：AI 给的 priceRow/catRow/buyerCol 生效，四条全解析', () => {
    const recs = aoi.import.parseMatrix(MATRIX_ROWS, 'fb', { priceRow: 3, catRow: 1, buyerCol: 0 });
    expect(recs).toHaveLength(4);
    expect(recs[0]).toMatchObject({ activity: '测试团期', type: '吧唧', model: '火火', price: 10, count: 2, buyer: 'a' });
    expect(recs[3]).toMatchObject({ buyer: 'b', model: '皮卡', price: 30, count: 1, type: '毛绒' });
  });

  it('parseRecords 带 hints：表头行+列映射直接生效；不带 hints 行为不变', () => {
    const rows = [
      ['买家', '商品', '价格', '件数'],
      ['张三', '吧唧A', '15', '2'],
      ['李四', '吧唧B', '15', '1']
    ];
    const recs = aoi.import.parseRecords(rows, 'fb', { headerRow: 0, cols: { buyer: 0, model: 1, price: 2, count: 3 } });
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ buyer: '张三', model: '吧唧A', price: 15, count: 2 });
    const rows2 = [['购买者', '型号', '单价(¥)', '数量'], ['张三', '吧唧A', '15', '2']];
    expect(aoi.import.parseRecords(rows2, 'fb')).toHaveLength(1);
  });

  it('aiMapSheet：两轮判断产出 matrix hints；unknown / 低置信 → null', async () => {
    aoi.typesafe.judge = vi.fn(async (state, q) => {
      if (q.fmt) return { fmt: { type: 'choice', choice: 'matrix', confidence: 0.92 } };
      return {
        priceRow: { type: 'choice', choice: 'r3', confidence: 0.88 },
        catRow: { type: 'choice', choice: 'r1', confidence: 0.8 },
        buyerCol: { type: 'choice', choice: 'c0', confidence: 0.85 }
      };
    });
    expect(await aoi.import.aiMapSheet(MATRIX_ROWS)).toEqual({ kind: 'matrix', priceRow: 3, catRow: 1, buyerCol: 0 });
    aoi.typesafe.judge = vi.fn(async () => ({ fmt: { type: 'choice', choice: 'unknown', confidence: 0.9 } }));
    expect(await aoi.import.aiMapSheet(MATRIX_ROWS)).toBeNull();
    aoi.typesafe.judge = vi.fn(async () => ({ fmt: { type: 'choice', choice: 'matrix', confidence: 0.4 } }));
    expect(await aoi.import.aiMapSheet(MATRIX_ROWS)).toBeNull();
  });

  it('parseSmart：常规双解析器失败 → AI hints 重解析成功（XLSX stub）', async () => {
    win.XLSX = {
      read: () => ({ SheetNames: ['S1'], Sheets: { S1: {} } }),
      utils: { sheet_to_json: () => MATRIX_ROWS }
    };
    aoi.typesafe.judge = vi.fn(async (state, q) => {
      if (q.fmt) return { fmt: { type: 'choice', choice: 'matrix', confidence: 0.92 } };
      return {
        priceRow: { type: 'choice', choice: 'r3', confidence: 0.88 },
        catRow: { type: 'choice', choice: 'r1', confidence: 0.8 },
        buyerCol: { type: 'choice', choice: 'c0', confidence: 0.85 }
      };
    });
    const recs = await aoi.import.parseSmart(new ArrayBuffer(4), 'x.xlsx');
    expect(recs).toHaveLength(4);
    expect(recs[0].model).toBe('火火');
  });
});

describe('v3.19.0 T4 商品主档语义对齐', () => {
  it('productCandidates：归一化子串命中、无关不进', () => {
    const cands = aoi.orders.productCandidates('测试团期', 'ロールクッキー アローラ');
    expect(cands).toHaveLength(1);
    expect(cands[0].model).toBe('ロールクッキー アローラNA');
    expect(aoi.orders.productCandidates('测试团期', '全然違うグッズ')).toHaveLength(0);
  });

  it('decideChoice：#k 高置信 auto / 中间带 review / 低置信与「都不是」none', () => {
    expect(aoi.orders.decideChoice({ type: 'choice', choice: '#2', confidence: 0.9 }, 0.85, 0.5)).toEqual({ action: 'auto', idx: 1 });
    expect(aoi.orders.decideChoice({ type: 'choice', choice: '#1', confidence: 0.6 }, 0.85, 0.5)).toEqual({ action: 'review', idx: 0 });
    expect(aoi.orders.decideChoice({ type: 'choice', choice: '#1', confidence: 0.3 }, 0.85, 0.5)).toEqual({ action: 'none', idx: 0 });
    expect(aoi.orders.decideChoice({ type: 'choice', choice: '都不是已有商品', confidence: 0.99 }, 0.85, 0.5)).toEqual({ action: 'none', idx: -1 });
    expect(aoi.orders.decideChoice(null, 0.85, 0.5)).toEqual({ action: 'none', idx: -1 });
  });

  it('fillFromProduct：只补缺失不覆盖（与精确命中分支同语义）', () => {
    const r = { type: '', price: 0, priceOrig: null };
    expect(aoi.orders.fillFromProduct(r, { type: '毛绒玩偶', price: 12, priceOrig: 1760, currency: 'jpy' })).toBe(true);
    expect(r).toMatchObject({ type: '毛绒玩偶', price: 12, priceOrig: 1760, currency: 'jpy' });
    const r2 = { type: '手办', price: 20, priceOrig: 500, currency: 'jpy' };
    expect(aoi.orders.fillFromProduct(r2, { type: '毛绒玩偶', price: 12, priceOrig: 1760, currency: 'krw' })).toBe(false);
    expect(r2.currency).toBe('jpy');
  });

  it('confirmImport：未命中型号语义对齐（auto）→ 回填主档字段、不登记重复骨架、toast 计数', async () => {
    doc.getElementById('importActivity').value = '测试团期';
    doc.getElementById('importIp').value = '';
    const cb = doc.getElementById('importAutoRegister');
    if (cb) cb.checked = true;
    aoi.import.pending = [
      { id: 'r1', activity: '测试团期', type: '', model: 'ロールクッキー アローラ', price: 0, priceOrig: null, currency: 'cny', count: 1, buyer: '麻酱', status: '未到货' }
    ];
    aoi.typesafe.judgeAll = vi.fn(async (jobs) => jobs.map(() => ({ same: { type: 'choice', choice: '#1', confidence: 0.9 } })));
    await aoi.orders.confirmImport();
    const o = aoi.state.data.orders[aoi.state.data.orders.length - 1];
    expect(o).toMatchObject({ model: 'ロールクッキー アローラ', type: '毛绒玩偶', price: 12, priceOrig: 1760, currency: 'jpy' });
    expect(o._aiAligned).toBe('ロールクッキー アローラNA');
    expect(aoi.state.data.activityMeta['测试团期'].products).toHaveLength(2); // 未重复登记骨架
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('语义对齐 1 条'), 'success');
  });
});

describe('v3.19.0 T5 购买人归一', () => {
  it('aiBuyerCandidates：归一化相等/子串/首字+编辑距离命中，无关不进（避开 v3.7.0 同名函数）', () => {
    const pool = ['麻酱', 'Maho', '完全不同的人'];
    expect(aoi.orders.aiBuyerCandidates(pool, '麻酱丶')).toEqual(['麻酱']);
    expect(aoi.orders.aiBuyerCandidates(pool, 'maho ✨')).toEqual(['Maho']);
    expect(aoi.orders.aiBuyerCandidates(pool, '肉包')).toHaveLength(0);
  });

  it('buyerPool：memberMeta 圈名 ∪ 历史买家去重', () => {
    aoi.state.data.orders = [{ buyer: '历史甲' }, { buyer: '麻酱' }];
    const pool = aoi.orders.buyerPool(aoi.state.data);
    expect(pool).toContain('麻酱');
    expect(pool).toContain('历史甲');
    expect(pool.filter((x) => x === '麻酱')).toHaveLength(1);
  });

  it('confirmImport：池外购买人高置信归一 → buyer 改写、buyerRaw 留档、toast 计数', async () => {
    doc.getElementById('importActivity').value = '测试团期';
    doc.getElementById('importIp').value = '';
    aoi.import.pending = [
      { id: 'r1', activity: '测试团期', type: '毛绒玩偶', model: '不存在的商品XYZ', price: 10, priceOrig: null, currency: 'cny', count: 1, buyer: '麻酱丶', status: '未到货' }
    ];
    aoi.typesafe.judgeAll = vi.fn(async (jobs) => jobs.map(() => ({ person: { type: 'choice', choice: '#1', confidence: 0.9 } })));
    await aoi.orders.confirmImport();
    const o = aoi.state.data.orders[aoi.state.data.orders.length - 1];
    expect(o.buyer).toBe('麻酱');
    expect(o.buyerRaw).toBe('麻酱丶');
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('购买人归一 1 条'), 'success');
  });

  it('normalizeBuyersSilent：高置信改写+留档，无候选保留原样', async () => {
    aoi.typesafe.judgeAll = vi.fn(async (jobs) => jobs.map(() => ({ person: { type: 'choice', choice: '#1', confidence: 0.9 } })));
    const out = await aoi.orders.normalizeBuyersSilent(['麻酱丶', '新人乙']);
    expect(out[0]).toMatchObject({ buyer: '麻酱', buyerRaw: '麻酱丶' });
    expect(out[1]).toMatchObject({ buyer: '新人乙', buyerRaw: '' }); // 无候选不送判
    expect(aoi.typesafe.judgeAll).toHaveBeenCalledTimes(1);
  });

  it('reviewModal：中间带生成点选弹窗，不点选 = 保留原样，完成后弹窗移除', async () => {
    doc.getElementById('importActivity').value = '测试团期';
    doc.getElementById('importIp').value = '';
    aoi.import.pending = [
      { id: 'r1', activity: '测试团期', type: '毛绒玩偶', model: '不存在的商品XYZ', price: 10, priceOrig: null, currency: 'cny', count: 1, buyer: '麻酱丶', status: '未到货' }
    ];
    aoi.typesafe.judgeAll = vi.fn(async (jobs) => jobs.map(() => ({ person: { type: 'choice', choice: '#1', confidence: 0.6 } })));
    const p = aoi.orders.confirmImport();
    await new Promise((r) => setTimeout(r, 20));
    const done = doc.getElementById('rvDone');
    expect(done).toBeTruthy();
    done.click();
    await p;
    const o = aoi.state.data.orders[aoi.state.data.orders.length - 1];
    expect(o.buyer).toBe('麻酱丶'); // 未点选 = 保留原样（人工兜底语义）
    expect(o.buyerRaw).toBeUndefined();
    expect(doc.getElementById('rvDone')).toBeNull();
  });
});
