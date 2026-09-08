import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.6.0 S1：买家管理独立 tab + 点击买家筛选订单 + 状态分桶标注
describe('组合状态徽标（v3.6.0 S1）', () => {
  it('四态映射：未到货/已到货·待发货/已发货/已收货', () => {
    expect(aoi.orders.combinedStatus({}).text).toBe('未到货');
    expect(aoi.orders.combinedStatus({ status: '已到货' }).text).toBe('已到货·待发货');
    expect(aoi.orders.combinedStatus({ status: '已到货', shipped: '已发' }).text).toBe('已发货');
    expect(aoi.orders.combinedStatus({ status: '已到货', shipped: '已发', received: true }).text).toBe('已收货');
    // 未到货即使带已发字段也以未到货为准
    expect(aoi.orders.combinedStatus({ status: '未到货', shipped: '已发' }).text).toBe('未到货');
  });

  it('statusBadge 接受订单对象并转义输出', () => {
    const html = aoi.orders.statusBadge({ status: '已到货' });
    expect(html).toContain('已到货·待发货');
    expect(html).toContain('text-amber-500');
  });
});

describe('买家管理 tab（v3.6.0 S1）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: [],
      orders: [
        { id: '1', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
        { id: '2', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '已到货', batchId: null },
        { id: '3', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '已到货', shipped: '已发', batchId: null },
        { id: '4', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '已到货', shipped: '已发', received: true, batchId: null },
        { id: '5', activity: 'A', type: '吧唧', model: 'M', price: 10, currency: 'cny', count: 1, buyer: '小狼', status: '未到货', batchId: null }
      ]
    };
    doc.getElementById('buyerSearch').value = '';
  });

  function buyerRow(name) {
    const btn = [...doc.querySelectorAll('#buyerTbody button[data-buyer-jump]')]
      .find((b) => b.getAttribute('data-buyer-jump') === name);
    return btn ? btn.closest('tr') : null;
  }

  it('买家表按状态分桶计数（订单数/未到货/待发货/已发待收/已完成）', () => {
    aoi.orders.renderBuyers();
    const row = buyerRow('小樱');
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells[1]).toBe('小樱');
    expect(cells[2]).toBe('4');  // 订单数
    expect(cells[3]).toBe('1');  // 未到货
    expect(cells[4]).toBe('1');  // 已到货·待发货
    expect(cells[5]).toBe('1');  // 已发货
    expect(cells[6]).toBe('1');  // 已收货
  });

  it('圈名搜索过滤', () => {
    doc.getElementById('buyerSearch').value = '小狼';
    aoi.orders.renderBuyers();
    const rows = [...doc.querySelectorAll('#buyerTbody tr')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('小狼');
  });

  it('点击圈名跳转订单管理并按购买者筛选其订单', () => {
    aoi.orders.renderBuyers();
    const btn = [...doc.querySelectorAll('#buyerTbody button[data-buyer-jump]')]
      .find((b) => b.getAttribute('data-buyer-jump') === '小樱');
    btn.click();
    expect(doc.getElementById('view-orders').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('fBuyer').value).toBe('小樱');
    const orderRows = doc.querySelectorAll('#orderTbody tr').length;
    expect(orderRows).toBe(4);
    // 订单行带组合状态徽标（不同状态不同标注）
    const html = doc.getElementById('orderTbody').innerHTML;
    expect(html).toContain('未到货');
    expect(html).toContain('已到货·待发货');
    expect(html).toContain('已发货');
    expect(html).toContain('已收货');
  });

  it("nav('view-buyers') 进入买家管理 tab 并自动渲染", () => {
    aoi.nav('view-buyers');
    expect(doc.getElementById('view-buyers').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('view-overview').classList.contains('hidden')).toBe(true);
    expect(doc.querySelectorAll('#buyerTbody tr').length).toBe(2);
  });

  it('买家管理已成为侧边栏独立入口，原活动管理页不再包含买家卡片', () => {
    expect(doc.querySelector('[data-nav="view-buyers"]')).not.toBeNull();
    // buyerTable 只存在于 view-buyers 内
    const wrap = doc.getElementById('buyerTable').closest('[data-view]');
    expect(wrap.id).toBe('view-buyers');
  });
});
