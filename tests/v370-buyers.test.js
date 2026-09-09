import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.7.0 S3：购买人体系——候选仅取以往活动购买人、一人一账号校验、与限购计划账号槽位同步
describe('购买人体系（v3.7.0 S3）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['CP27', 'CP26'],
      activityMeta: {
        CP27: { ip: '', buyers: [{ buyer: 'ks', account: 'ks@example.com', address: '' }] },
        CP26: { ip: '', buyers: [{ buyer: 'サーモン', account: 'salmon@example.com', address: '' }] }
      },
      memberMeta: { '小樱': { qq: '123' } },
      orders: [
        { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null }
      ],
      limitPlans: {
        CP27: {
          activity: 'CP27', accountsCount: 3,
          items: [
            { index: 1, total: 10, diff: 0, reached: true, items: [{ type: '吧唧', model: 'M1', qty: 1, price: 10, amount: 10, status: '待购买' }] },
            { index: 2, total: 10, diff: 0, reached: true, items: [{ type: '吧唧', model: 'M1', qty: 1, price: 10, amount: 10, status: '待购买' }] },
            { index: 3, total: 0, diff: 0, reached: true, items: [] }
          ]
        }
      }
    };
  });

  it('buyerCandidates 仅取以往活动登记过的购买人（不含订单 CN/团员圈名）', () => {
    expect(aoi.orders.buyerCandidates(aoi.state.data)).toEqual(['ks', 'サーモン']);
  });

  it('openActBuyers 渲染映射提示：已填人数 / 计划账号数', () => {
    aoi.orders.openActBuyers('CP27');
    const hint = doc.getElementById('actBuyersSync').textContent;
    expect(hint).toContain('已填 1 人');
    expect(hint).toContain('3 个账号');
    expect(hint).toContain('数量不一致');
    aoi.orders.closeActBuyers();
  });

  it('saveActBuyers：账号必填（一人一账号）', async () => {
    aoi.orders.openActBuyers('CP27');
    doc.querySelector('#actBuyerRows .act-buyer-row .ab-buyer').value = '新代购';
    doc.querySelector('#actBuyerRows .act-buyer-row .ab-account').value = '';
    await aoi.orders.saveActBuyers();
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
    expect(aoi.state.data.activityMeta.CP27.buyers[0].buyer).toBe('ks'); // 未被覆盖
  });

  it('saveActBuyers：同活动内圈名/账号重复被拒', async () => {
    aoi.orders.openActBuyers('CP27');
    // 现有 1 行 ks，再加一行同账号
    aoi.orders.addBuyerRow();
    const rows = doc.querySelectorAll('#actBuyerRows .act-buyer-row');
    rows[0].querySelector('.ab-buyer').value = 'ks';
    rows[0].querySelector('.ab-account').value = 'ks@example.com';
    rows[1].querySelector('.ab-buyer').value = '别人';
    rows[1].querySelector('.ab-account').value = 'ks@example.com';
    await aoi.orders.saveActBuyers();
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
  });

  it('saveActBuyers：合法数据正常保存', async () => {
    aoi.orders.openActBuyers('CP27');
    const rows = doc.querySelectorAll('#actBuyerRows .act-buyer-row');
    rows[0].querySelector('.ab-buyer').value = 'ks';
    rows[0].querySelector('.ab-account').value = 'ks@example.com';
    await aoi.orders.saveActBuyers();
    expect(aoi.saveTeamData).toHaveBeenCalled();
    expect(aoi.state.data.activityMeta.CP27.buyers).toHaveLength(1);
  });

  it('genBuyersFromPlan 按计划账号数生成行并带入既有购买人', () => {
    aoi.orders.openActBuyers('CP27'); // 已有 1 行 ks
    aoi.orders.genBuyersFromPlan();
    const rows = doc.querySelectorAll('#actBuyerRows .act-buyer-row');
    expect(rows).toHaveLength(3);                    // 计划 3 账号
    expect(rows[0].querySelector('.ab-buyer').value).toBe('ks'); // 既有购买人按行序带入
    expect(rows[1].querySelector('.ab-buyer').value).toBe('');
  });

  it('renderPlan 账号槽位显示购买人标签（按行序对应）', () => {
    aoi.limits.renderPlan(aoi.state.data.limitPlans.CP27);
    const html = doc.getElementById('limResultTbody').innerHTML;
    expect(html).toContain('账号 1');
    expect(html).toContain('ks（ks@example.com）');
    expect(html).not.toContain('サーモン'); // 槽位 2 无对应购买人
  });

  it('purchaserLabel：无对应购买人返回空串', () => {
    expect(aoi.limits.purchaserLabel('CP27', 2)).toBe('');
    expect(aoi.limits.purchaserLabel('不存在', 1)).toBe('');
  });
});
