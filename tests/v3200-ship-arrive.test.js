// v3.20.0 TypeSafe 发货/到货集成测试（docs/PLAN-TYPESAFE.md T6/T7）：
//   T6 快递单号智能预填（extractTracking 抽号去重/手机号排除 + smartTracking 归属预填）
//   T7 到货清单预勾选（pasteArriveList 只动勾选框不落库）
//   共用：typesafe.matchToCandidates（#k/conf 解析、匹配不到→-1、空候选短路）
// 网络层全部 mock：judge/judgeAll 直接 stub，不发任何真实请求。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

beforeEach(() => {
  aoi.state.data = {
    activities: ['测试团期'], ips: [], typeMeta: {},
    orders: [
      { id: 'o1', activity: '测试团期', type: '毛绒玩偶', model: '皮卡丘', price: 50, count: 1, buyer: '张三', status: '未到货', batchId: 'b1', shipped: '未发' },
      { id: 'o2', activity: '测试团期', type: '吧唧', model: '火火', price: 15, count: 2, buyer: '李四', status: '已到货', batchId: 'b1', shipped: '未发' },
      { id: 'o3', activity: '测试团期', type: '文件夹', model: 'A4白', price: 5, count: 1, buyer: '王五', status: '未到货', batchId: 'b1', shipped: '未发' },
      { id: 'o4', activity: '其他团', type: '挂件', model: 'X', price: 8, count: 1, buyer: '赵六', status: '未到货', batchId: 'b2', shipped: '未发' }
    ],
    batches: [], activityMeta: {}, memberMeta: {}, notifications: [],
    calc: { jpyRate: 0.048, jpyMarkup: 0.005 }
  };
  aoi.typesafe._cache.clear();
  win.localStorage.setItem('aoi_typesafe', 'on');
  aoi.config = { SUPABASE_URL: 'https://sb.supabase.co' };
  // 可能在其他用例里被覆盖成 false——每个用例前恢复原始实现
  aoi.typesafe.available = function () { return !!(aoi.typesafe.enabled() && aoi.typesafe.url()); };
  aoi.state.user = { isDebug: false };
  aoi.adminLoadSession = () => ({ token: 't'.repeat(40) });
  aoi.toast = vi.fn();
  aoi.saveTeamData = async (d) => { aoi._saved = JSON.parse(JSON.stringify(d)); };
  aoi._saved = null;
});

describe('v3.20.0 共用：matchToCandidates', () => {
  it('#k/conf 解析、「匹配不到」→ -1、空候选短路不发请求', async () => {
    const lines = [{ text: '甲 SF123' }, { text: '无关' }];
    const candidates = [{ label: 'A' }, { label: 'B' }];
    const spy = vi.fn(async () => [
      { target: { type: 'choice', choice: '#2', confidence: 0.8 } },
      { target: { type: 'choice', choice: '匹配不到', confidence: 0.9 } }
    ]);
    aoi.typesafe.judgeAll = spy;
    const r = await aoi.typesafe.matchToCandidates(lines, candidates, {});
    expect(r).toEqual([{ idx: 1, conf: 0.8 }, { idx: -1, conf: 0.9 }]);
    expect(spy).toHaveBeenCalledTimes(1);
    const r2 = await aoi.typesafe.matchToCandidates(lines, [], {});
    expect(r2).toHaveLength(2);
    expect(r2.every((x) => x.idx === -1)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // 空候选不再发起判断
  });
});

describe('v3.20.0 T6 快递单号智能预填', () => {
  it('extractTracking：字母前缀/纯数字抽号、手机号排除、去重、带行上下文', () => {
    const text = [
      '张三 SF1453245234523 已发出',
      '李四的: JT3139485723492',
      '电话 13812345678',
      '快递单号 1358245637891 请查收',
      '张三 SF1453245234523（重复）'
    ].join('\n');
    const nums = aoi.ship.extractTracking(text);
    expect(nums.map((n) => n.no)).toEqual(['SF1453245234523', 'JT3139485723492', '1358245637891']);
    expect(nums[0].context).toContain('张三');
    expect(nums[1].context).toContain('李四');
  });

  it('smartTracking：归属 ≥col 预填 o.tracking 并整包保存，未匹配计数提示', async () => {
    const sel = doc.getElementById('shipBatch');
    sel.innerHTML = '<option value="b1">b1</option>';
    sel.value = 'b1';
    doc.getElementById('shipTrackingPaste').value = [
      '张三 SF1453245234523 已发出',
      '李四收件人 JT3139485723492',
      '快递单号 1358245637891 请查收'
    ].join('\n');
    aoi.typesafe.judgeAll = vi.fn(async (jobs) => jobs.map((j) => {
      const l = j.state.line || '';
      if (l.indexOf('SF') >= 0) return { target: { type: 'choice', choice: '#1', confidence: 0.9 } };
      if (l.indexOf('JT') >= 0) return { target: { type: 'choice', choice: '#2', confidence: 0.85 } };
      return { target: { type: 'choice', choice: '匹配不到', confidence: 0.95 } };
    }));
    await aoi.ship.smartTracking();
    const d = aoi.state.data;
    expect(d.orders.find((o) => o.id === 'o1').tracking).toBe('SF1453245234523');
    expect(d.orders.find((o) => o.id === 'o2').tracking).toBe('JT3139485723492'); // 候选按批次+未发过滤，#2=李四的订单
    expect(d.orders.find((o) => o.id === 'o1').shipped).toBe('未发'); // 只预填单号，不改发货状态
    expect(aoi._saved).toBeTruthy(); // 整包保存一次
    expect(doc.getElementById('shipTrackingPaste').value).toBe('');
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('已预填 2 个单号'), 'success');
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('1 个单号未匹配'), 'success');
  });

  it('smartTracking：AI 不可用 → 提示手工、不写不存', async () => {
    const sel = doc.getElementById('shipBatch');
    sel.innerHTML = '<option value="b1">b1</option>';
    sel.value = 'b1';
    doc.getElementById('shipTrackingPaste').value = '张三 SF1453245234523';
    aoi.typesafe.available = () => false;
    await aoi.ship.smartTracking();
    expect(aoi.state.data.orders.find((o) => o.id === 'o1').tracking).toBeUndefined();
    expect(aoi._saved).toBeNull();
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('AI 语义判断未启用'), 'warning');
  });
});

describe('v3.20.0 T7 到货清单预勾选', () => {
  it('pasteArriveList：匹配行预勾选对应 .row-check（不落库），未识别行计数', async () => {
    aoi.orders.render(); // 生成 .row-check
    doc.getElementById('arrivePaste').value = '李四 文件夹A4白\n无关的一条信息';
    aoi.typesafe.judgeAll = vi.fn(async (jobs) => jobs.map((j) => {
      const l = (j.state.line || '');
      if (l.indexOf('李四') >= 0) return { target: { type: 'choice', choice: '#2', confidence: 0.9 } }; // 候选=未到货 o1,o3 → o3
      return { target: { type: 'choice', choice: '匹配不到', confidence: 0.9 } };
    }));
    await aoi.orders.pasteArriveList();
    expect(doc.querySelector('.row-check[data-id="o3"]').checked).toBe(true);
    expect(doc.querySelector('.row-check[data-id="o1"]').checked).toBe(false);
    const o3 = aoi.state.data.orders.find((x) => x.id === 'o3');
    expect(o3.status).toBe('未到货'); // 不落库——标记到货仍由人工触发
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('已预勾选 1 笔'), 'success');
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('1 行未识别'), 'success');
  });

  it('pasteArriveList：AI 不可用 → 提示手工勾选', async () => {
    doc.getElementById('arrivePaste').value = '李四 文件夹A4白';
    aoi.typesafe.available = () => false;
    await aoi.orders.pasteArriveList();
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('AI 语义判断未启用'), 'warning');
  });
});
