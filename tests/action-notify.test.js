// v3.4.0 F1+F2：审批/到货自动通知 + 团员端订单进度时间线
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

const realConfirm = aoi.confirm;
const realSelectedIds = aoi.orders.selectedIds;
const realSave = aoi.saveTeamData;

beforeEach(() => {
  doc.getElementById('approvalBatch').value = 'b1';
  aoi.confirm = realConfirm;
  aoi.orders.selectedIds = realSelectedIds;
  aoi.saveTeamData = async (d) => { aoi.state.data = d; return 'ts'; };
});

describe('F1：审批结果自动通知（paid / rejected）', () => {
  it('标记已交 → 生成 paid 通知，交费状态落库', async () => {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: '小樱', batchId: 'b1', status: '已到货' }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [], notifications: []
    };
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.notify.sync = vi.fn();
    await aoi.approval.setStatus('b1', '小樱', '已交');

    expect(aoi.state.data.payments[0].status).toBe('已交');
    const n = aoi.state.data.notifications[0];
    expect(n.type).toBe('paid');
    expect(n.buyer).toBe('小樱');
    expect(n.body).toContain('2026-09-01');
    expect(n.sent).toBe(false);
  });

  it('驳回 → 生成 rejected 通知', async () => {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: '小樱', batchId: 'b1', status: '已到货' }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [{ id: 'p1', batchId: 'b1', buyer: '小樱', status: '待审核' }],
      notifications: []
    };
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.notify.sync = vi.fn();
    await aoi.approval.setStatus('b1', '小樱', '已驳回');

    expect(aoi.state.data.payments[0].status).toBe('已驳回');
    expect(aoi.state.data.notifications[0].type).toBe('rejected');
  });

  it('取消确认不写状态也不生成通知', async () => {
    aoi.state.data = {
      orders: [], batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [], notifications: []
    };
    aoi.confirm = vi.fn().mockResolvedValue(false);
    aoi.notify.sync = vi.fn();
    await aoi.approval.setStatus('b1', '小樱', '已交');

    expect(aoi.state.data.payments).toHaveLength(0);
    expect(aoi.state.data.notifications).toHaveLength(0);
  });
});

describe('F1：标记到货自动通知（arrived，按 买家×批次 去重）', () => {
  function setup(notifications) {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: '小樱', status: '未到货', batchId: null }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [], notifications: notifications || []
    };
    doc.getElementById('arriveBatchSel').innerHTML = '<option value="b1">b1</option>';
    doc.getElementById('arriveBatchSel').value = 'b1';
    aoi.orders.selectedIds = () => ['o1'];
  }

  it('标记到货 → 每位买家一条 arrived 通知', async () => {
    setup();
    await aoi.orders.markArrived();

    expect(aoi.state.data.orders[0].status).toBe('已到货');
    expect(aoi.state.data.notifications).toHaveLength(1);
    const n = aoi.state.data.notifications[0];
    expect(n.type).toBe('arrived');
    expect(n.buyer).toBe('小樱');
    expect(n.body).toContain('2026-09-01');
  });

  it('同买家同批次已存在 arrived 通知时不重复生成', async () => {
    setup([{ id: 'n0', type: 'arrived', buyer: '小樱', batchId: 'b1', body: 'x', sent: false }]);
    await aoi.orders.markArrived();

    expect(aoi.state.data.notifications).toHaveLength(1);
    expect(aoi.state.data.notifications[0].id).toBe('n0');
  });
});

describe('F2：团员端订单进度时间线（progressChain）', () => {
  const cn = '小樱';

  it('全流程完成：五节点全亮', () => {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: cn, status: '已到货', batchId: 'b1', shipped: '已发', received: true }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [{ id: 'p1', batchId: 'b1', buyer: cn, status: '已交' }],
      notifications: []
    };
    const html = aoi.member.progressChain(aoi.state.data.orders[0], cn);
    expect(html).toContain('●排单');
    expect(html).toContain('●到货');
    expect(html).toContain('●交费');
    expect(html).toContain('●发货');
    expect(html).toContain('●收货');
    expect(html).not.toContain('○');
  });

  it('中途节点：未到货 → 交费待审核为琥珀色，后续节点灰', () => {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: cn, status: '未到货', batchId: 'b1' }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [{ id: 'p1', batchId: 'b1', buyer: cn, status: '待审核' }],
      notifications: []
    };
    const html = aoi.member.progressChain(aoi.state.data.orders[0], cn);
    expect(html).toContain('●排单');
    expect(html).toContain('○到货');
    expect(html).toContain('○交费');
    expect(html).toContain('text-amber-500');
    expect(html).toContain('○发货');
    expect(html).toContain('○收货');
  });

  it('已驳回节点为红色', () => {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: cn, status: '已到货', batchId: 'b1' }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [{ id: 'p1', batchId: 'b1', buyer: cn, status: '已驳回' }],
      notifications: []
    };
    const html = aoi.member.progressChain(aoi.state.data.orders[0], cn);
    expect(html).toContain('text-red-500');
    expect(html).toContain('○交费');
  });

  it('我的订单表渲染进度列', () => {
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: cn, status: '已到货', batchId: 'b1', type: '吧唧', model: 'A', count: 1, price: 10 }],
      batches: [{ id: 'b1', date: '2026-09-01' }],
      payments: [], notifications: []
    };
    aoi.member.renderOrders(cn);
    const html = doc.getElementById('memberOrderTbody').innerHTML;
    expect(html).toContain('●排单');
    expect(html).toContain('○交费');
  });
});
