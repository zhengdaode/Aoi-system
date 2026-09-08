import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.6.0 S3：购买计划持久化 + 限购计划页 / 活动管理侧双向同步 + 失败自动重分配

function buildPlanFixture() {
  // 账号1：A×2（¥10/件）；账号2：B×1（¥5/件）；限购 A 每账号 2
  return {
    activity: '活动A',
    freeShip: 0, freeShipRmb: 0, freeCur: 'cny',
    accountsCount: 2, maxTypes: 0,
    limits: { '吧唧|A': 2 },
    items: [
      { index: 1, total: 20, diff: 0, reached: true, items: [{ type: '吧唧', model: 'A', qty: 2, price: 10, amount: 20, status: '待购买' }] },
      { index: 2, total: 5, diff: 0, reached: true, items: [{ type: '色纸', model: 'B', qty: 1, price: 5, amount: 5, status: '已购买' }] }
    ],
    remaining: [],
    updatedAt: '2026-09-09T00:00:00.000Z'
  };
}

describe('reallocateCore 失败重分配（v3.6.0 S3 纯函数）', () => {
  it('整项移出失败账号，逐件分给金额最低的可收账号（原计算器阶段一贪心）', () => {
    const plan = buildPlanFixture();
    const r = aoi.limits.reallocateCore(plan, 1, '吧唧|A');
    const acc1 = r.plan.items.find((a) => a.index === 1);
    const acc2 = r.plan.items.find((a) => a.index === 2);
    expect(acc1.items).toHaveLength(0);          // 失败项整项移出
    expect(acc1.total).toBe(0);
    const a2 = acc2.items.find((it) => it.type + '|' + it.model === '吧唧|A');
    expect(a2.qty).toBe(2);                       // 限购 A=2 恰好全收
    expect(a2.amount).toBe(20);
    expect(a2.status).toBe('待购买');             // 重分配出的件重置为待购买
    expect(acc2.total).toBe(25);
    expect(r.remaining).toBe(0);
    expect(r.moved).toEqual([{ index: 2, qty: 2 }]);
    expect(plan.items[0].items).toHaveLength(1);           // 入参未被修改（深拷贝）
    expect(plan.items[0].items[0].qty).toBe(2);
    expect(plan.items[0].total).toBe(20);
  });

  it('单账号限购装不下时余量计入 remaining', () => {
    const plan = buildPlanFixture();
    plan.limits = { '吧唧|A': 1 }; // 账号2 只能收 1 件 A
    const r = aoi.limits.reallocateCore(plan, 1, '吧唧|A');
    const acc2 = r.plan.items.find((a) => a.index === 2);
    expect(acc2.items.find((it) => it.type + '|' + it.model === '吧唧|A').qty).toBe(1);
    expect(r.remaining).toBe(1);
    expect(r.plan.remaining).toEqual([{ type: '吧唧', model: 'A', qty: 1 }]);
  });

  it('maxTypes 种类上限约束重分配；失败账号自身不接收', () => {
    const plan = buildPlanFixture();
    plan.limits = {};
    plan.maxTypes = 1; // 账号2 已持 B，不能再收新品种 A
    const r = aoi.limits.reallocateCore(plan, 1, '吧唧|A');
    const acc2 = r.plan.items.find((a) => a.index === 2);
    expect(acc2.items.find((it) => it.type + '|' + it.model === '吧唧|A')).toBeUndefined();
    expect(r.remaining).toBe(2);
  });

  it('重算后各账号包邮状态同步刷新', () => {
    const plan = buildPlanFixture();
    plan.freeShip = 15; plan.freeShipRmb = 15;
    const r = aoi.limits.reallocateCore(plan, 2, '色纸|B');
    const acc1 = r.plan.items.find((a) => a.index === 1);
    const acc2 = r.plan.items.find((a) => a.index === 2);
    expect(acc1.items.find((it) => it.type + '|' + it.model === '色纸|B')).toBeTruthy();
    expect(acc1.reached).toBe(true);   // 25 ≥ 15
    expect(acc2.reached).toBe(false);  // 0 < 15
    expect(acc2.diff).toBe(15);
  });
});

describe('购买计划双向同步（v3.6.0 S3）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.undo.arm = vi.fn();
    aoi.state.data = {
      activities: ['活动A'],
      orders: [
        { id: 'o1', activity: '活动A', type: '吧唧', model: 'A', count: 3, price: 10, currency: 'cny', buyer: '小樱', status: '未到货', batchId: null },
        { id: 'o2', activity: '活动A', type: '色纸', model: 'B', count: 4, price: 5, currency: 'cny', buyer: '小狼', status: '未到货', batchId: null }
      ],
      limitPlans: { 活动A: buildPlanFixture() }
    };
  });

  it('plan() 重算入库且同名 (账号,商品) 保留既有购买状态', async () => {
    doc.getElementById('limActivity').innerHTML = '<option value="活动A">活动A</option>';
    doc.getElementById('limActivity').value = '活动A';
    aoi.limits.load();
    doc.getElementById('limAccounts').value = '2';
    await aoi.limits.plan();
    const stored = aoi.state.data.limitPlans['活动A'];
    expect(stored).toBeTruthy();
    expect(aoi.saveTeamData).toHaveBeenCalled();
    // 账号2 的 色纸|B 保留「已购买」
    const acc2 = stored.items.find((a) => a.index === 2);
    const b = acc2.items.find((it) => it.type + '|' + it.model === '色纸|B');
    expect(b.status).toBe('已购买');
  });

  it('限购计划页 load 时展示已存计划（含购买状态下拉）', () => {
    doc.getElementById('limActivity').innerHTML = '<option value="活动A">活动A</option>';
    doc.getElementById('limActivity').value = '活动A';
    aoi.limits.load();
    expect(doc.getElementById('limResultBox').classList.contains('hidden')).toBe(false);
    expect(doc.querySelectorAll('#limResultTbody select[data-plan-status]')).toHaveLength(2);
    expect(doc.getElementById('limResultStat').textContent).toContain('活动「活动A」');
  });

  it('openActPlan 活动侧弹窗读取同一份计划（自动同步）', () => {
    aoi.limits.openActPlan('活动A');
    expect(doc.getElementById('actPlanModal').classList.contains('hidden')).toBe(false);
    expect(doc.querySelectorAll('#actPlanTbody tr')).toHaveLength(2);
    expect(doc.getElementById('actPlanBody').innerHTML).toContain('吧唧-A');
    aoi.limits.closeActPlan();
    expect(doc.getElementById('actPlanModal').classList.contains('hidden')).toBe(true);
    // 无计划的活动给出指引
    aoi.state.data.activities.push('活动B');
    aoi.limits.openActPlan('活动B');
    expect(doc.getElementById('actPlanBody').innerHTML).toContain('还没有购买计划');
    aoi.limits.closeActPlan();
  });

  it('弹窗内改件数：重算金额/包邮状态并落库，双侧重渲染', async () => {
    aoi.limits.openActPlan('活动A');
    doc.getElementById('limActivity').value = '活动A'; // 限购侧也在同步范围
    await aoi.limits.setItemQty('活动A', 1, '吧唧|A', 1);
    const stored = aoi.state.data.limitPlans['活动A'];
    const acc1 = stored.items.find((a) => a.index === 1);
    expect(acc1.items.find((it) => it.type + '|' + it.model === '吧唧|A').qty).toBe(1);
    expect(acc1.total).toBe(10);
    expect(acc1.reached).toBe(true); // 包邮线为 0 时所有账号视为达标
    expect(aoi.saveTeamData).toHaveBeenCalled();
    expect(doc.getElementById('actPlanStat').textContent).toContain('活动「活动A」');
    // 限购侧结果表同步更新
    expect(doc.getElementById('limResultStat').textContent).toContain('活动「活动A」');
  });

  it('状态切「已购买」直接写回；取消「购买失败」不改动原状态', async () => {
    await aoi.limits.setItemStatus('活动A', 1, '吧唧|A', '已购买');
    const it1 = aoi.limits.findItem(aoi.state.data.limitPlans['活动A'], 1, '吧唧|A');
    expect(it1.status).toBe('已购买');

    aoi.confirm = vi.fn().mockResolvedValue(false); // 拒绝失败确认
    const r = await aoi.limits.setItemStatus('活动A', 2, '色纸|B', '购买失败');
    expect(r).toBe('cancel');
    const it2 = aoi.limits.findItem(aoi.state.data.limitPlans['活动A'], 2, '色纸|B');
    expect(it2.status).toBe('已购买');
  });

  it('确认「购买失败」→ 自动重分配给剩余账号并落库 + 30 秒可撤销', async () => {
    aoi.confirm = vi.fn().mockResolvedValue(true);
    doc.getElementById('limActivity').value = '活动A';
    aoi.limits.openActPlan('活动A');
    await aoi.limits.setItemStatus('活动A', 1, '吧唧|A', '购买失败');
    const stored = aoi.state.data.limitPlans['活动A'];
    const acc1 = stored.items.find((a) => a.index === 1);
    const acc2 = stored.items.find((a) => a.index === 2);
    expect(acc1.items).toHaveLength(0); // 失败项已移出
    const moved = acc2.items.find((it) => it.type + '|' + it.model === '吧唧|A');
    expect(moved.qty).toBe(2);          // 账号2 未持 A，限购 2 → 全部重分配给它
    expect(moved.status).toBe('待购买');
    expect(acc2.total).toBe(25);
    expect(aoi.saveTeamData).toHaveBeenCalled();
    expect(aoi.undo.arm).toHaveBeenCalledWith('购买失败重分配', aoi.state.data);
    // 弹窗仍开着且已被重渲染
    expect(doc.getElementById('actPlanModal').classList.contains('hidden')).toBe(false);
  });

  it('活动管理行渲染「计划」按钮并显示账号数，点击打开弹窗', () => {
    aoi.orders.renderActivities();
    const btn = doc.querySelector('button[data-act-plan="活动A"]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('2账号');
    btn.click();
    expect(doc.getElementById('actPlanModal').classList.contains('hidden')).toBe(false);
  });
});
