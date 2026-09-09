import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

function stubSave() {
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
}

function seedIntl() {
  aoi.state.data = {
    orders: [
      { id: 'o1', type: '色纸', model: 'A', count: 2, buyer: '小樱', batchId: 'b1', price: 10, currency: 'cny', remark: '' },
      { id: 'o2', type: '亚克力', model: 'B', count: 3, buyer: '小樱', batchId: 'b1', price: 20, currency: 'cny', remark: '' }
    ],
    batches: [{ id: 'b1', date: '2026-09-01', targetAmount: 100, weights: { '色纸|A': 1, '亚克力|B': 2 } }]
  };
}

describe('Aoi.intl v1.9.0：均价/加权拆列 + 差值 + 仪表盘', () => {
  beforeEach(() => {
    stubSave();
    seedIntl();
    // intlBatch 的 options 由 refillBatches 填充，测试中直接注入选项
    doc.getElementById('intlBatch').innerHTML = '<option value="b1">批次 2026-09-01</option>';
    doc.getElementById('intlBatch').value = 'b1';
  });

  it('gaugeData：差值 = 目标 − 已分摊，插值百分比', () => {
    const items = aoi.intl.buildItems(aoi.intl.getBatch('b1'));
    const g = aoi.intl.gaugeData(items, 100);
    expect(g.feeTotal).toBeCloseTo(100, 6); // 全部分摊（均价按总额/总重）
    expect(g.diff).toBeCloseTo(0, 6);
    expect(g.pct).toBe(100);
  });

  it('gaugeData：手动覆盖后差值显示超出目标', () => {
    aoi.state.data.batches[0].manualFees = { '色纸|A': 50 };
    const items = aoi.intl.buildItems(aoi.state.data.batches[0]);
    const g = aoi.intl.gaugeData(items, 100);
    // 色纸 50×2 = 100，亚克力 (100/9)×2×3 = 66.67 → 总 166.67 → diff = -66.67
    expect(g.diff).toBeLessThan(0);
  });

  it('gaugeData：目标为 0 时 pct=0 且不产生 NaN', () => {
    aoi.state.data.batches[0].targetAmount = 0;
    const items = aoi.intl.buildItems(aoi.state.data.batches[0]);
    const g = aoi.intl.gaugeData(items, 0);
    expect(g.pct).toBe(0);
    expect(isNaN(g.diff)).toBe(false);
  });

  it('render：均价列只读展示、加权单价列可编辑，统计行含差值', () => {
    aoi.intl.render();
    const html = doc.getElementById('intlTbody').innerHTML;
    expect(html).toContain('onchange="Aoi.intl.setFee');
    expect(doc.getElementById('intlStat').textContent).toContain('差值');
  });

  it('renderGauge 更新进度条宽度与文本；toggleGauge 可收起', () => {
    aoi.intl.render();
    expect(doc.getElementById('intlGauge').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('intlGaugeText').textContent).toContain('差值');
    aoi.intl.toggleGauge();
    expect(doc.getElementById('intlGaugeBody').classList.contains('hidden')).toBe(true);
  });

  it('resetFee 清除手动覆盖恢复均价', async () => {
    aoi.state.data.batches[0].manualFees = { '色纸|A': 50 };
    await aoi.intl.resetFee('色纸|A');
    expect(aoi.state.data.batches[0].manualFees['色纸|A']).toBeUndefined();
  });
});

describe('Aoi.orders v1.9.0：活动管理购买人/快递单号/模糊出荷', () => {
  beforeEach(() => {
    stubSave();
    aoi.state.data = { activities: ['活动A'], activityMeta: { '活动A': { ip: '', status: '进行中' } } };
  });

  it('shipFuzzySuggestions：含上中下旬、季节、季度选项', () => {
    const list = aoi.orders.shipFuzzySuggestions('2026-09-06');
    expect(list).toContain('2026年9月中旬');
    expect(list).toContain('2026年秋季');
    expect(list).toContain('2026年第3季度');
    expect(list.length).toBe(3 * (4 + 4 + 36));
  });

  it('renderActivities：购买人/快递单号/备注/模糊日期列渲染（单号入口在展开区）', () => {
    aoi.orders.renderActivities();
    const html = doc.getElementById('activityTbody').innerHTML;
    expect(html).toContain('data-act-buyers="活动A"');
    expect(html).toContain('data-field="remark"');
    expect(html).toContain('data-field="shipDateFuzzy"');
    expect(html).toContain('填写'); // 未填写时按钮文案
    // v3.7.0 S2：点击活动名展开后，展开区出现快递单号入口
    aoi.orders.toggleActivityExpand('活动A');
    expect(doc.getElementById('activityTbody').innerHTML).toContain('data-act-track="活动A"');
  });

  it('openActBuyers/saveActBuyers：多行购买人信息写回 meta', async () => {
    aoi.orders.openActBuyers('活动A');
    doc.querySelector('#actBuyerRows .ab-buyer').value = '小樱';
    doc.querySelector('#actBuyerRows .ab-account').value = 'sakura@example.com';
    doc.querySelector('#actBuyerRows .ab-address').value = '上海市某路1号';
    await aoi.orders.saveActBuyers();
    const m = aoi.state.data.activityMeta['活动A'];
    expect(m.buyers).toHaveLength(1);
    expect(m.buyers[0]).toEqual({ buyer: '小樱', account: 'sakura@example.com', address: '上海市某路1号' });
  });

  it('saveActBuyers：圈名为空的行被丢弃；账号必填；按钮显示人数', async () => {
    aoi.orders.openActBuyers('活动A');
    aoi.orders.addBuyerRow();
    const rows = doc.querySelectorAll('#actBuyerRows .act-buyer-row');
    rows[0].querySelector('.ab-buyer').value = '小樱';
    rows[0].querySelector('.ab-account').value = 'sakura@example.com';
    // 第二行圈名留空（整行丢弃）
    await aoi.orders.saveActBuyers();
    expect(aoi.state.data.activityMeta['活动A'].buyers).toHaveLength(1);
    aoi.orders.renderActivities();
    expect(doc.getElementById('activityTbody').innerHTML).toContain('1 人');
    // v3.7.0 S3：缺账号（一人一账号）时拒绝保存
    aoi.orders.openActBuyers('活动A');
    doc.querySelector('#actBuyerRows .act-buyer-row .ab-buyer').value = '小狼';
    doc.querySelector('#actBuyerRows .act-buyer-row .ab-account').value = '';
    await aoi.orders.saveActBuyers();
    expect(aoi.state.data.activityMeta['活动A'].buyers[0].buyer).toBe('小樱');
  });

  it('openActTrack/saveActTrack：每行一个单号', async () => {
    aoi.orders.openActTrack('活动A');
    doc.getElementById('actTrackInput').value = 'SF001\n \nSF002\n';
    await aoi.orders.saveActTrack();
    expect(aoi.state.data.activityMeta['活动A'].trackings).toEqual(['SF001', 'SF002']);
  });
});
