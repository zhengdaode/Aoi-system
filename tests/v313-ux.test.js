// v3.13.0 体验迭代：团员端移动卡片化（responsive-cards + data-label）/ 通知筛选（全部|仅未发）/ 备份提醒
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

beforeEach(() => {
  win.localStorage.clear();
  aoi.toast = vi.fn();
});

describe('团员端移动卡片化', () => {
  it('memberFeeTable / memberOrderTable 挂 responsive-cards（≤640px 卡片视图）', () => {
    expect(doc.getElementById('memberFeeTable').classList.contains('responsive-cards')).toBe(true);
    expect(doc.getElementById('memberOrderTable').classList.contains('responsive-cards')).toBe(true);
  });

  it('renderOrders 每列带 data-label（卡片视图列名来源）', () => {
    aoi.state.data = { orders: [{ id: 'o1', buyer: '小樱', activity: '活A', type: '吧唧', model: 'X', count: 1, price: 10, currency: 'cny' }] };
    aoi.member.state = { key: 'k', cn: '小樱', teamName: '团', updatedAt: null };
    aoi.member.renderOrders('小樱');
    expect(doc.querySelectorAll('#memberOrderTbody td[data-label="活动"]').length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('#memberOrderTbody td[data-label="快递单号"]').length).toBeGreaterThan(0);
  });

  it('renderFees 行带 data-label', () => {
    aoi.state.data = { orders: [] };
    aoi.member.renderFees('小樱');
    expect(doc.querySelectorAll('#memberFeeTbody td[data-label="应付国际费"]').length).toBe(0); // 空数据无行
    aoi.state.data = {
      orders: [{ id: 'o1', buyer: '小樱', activity: '活A', type: '吧唧', model: 'X', count: 1, price: 10, currency: 'cny', status: '已到货', batchId: 'b1' }],
      batches: [{ id: 'b1', date: '2026-09-01' }]
    };
    aoi.member.renderFees('小樱');
    expect(doc.querySelectorAll('#memberFeeTbody td[data-label="应付国际费"]').length).toBe(1);
  });
});

describe('通知筛选（全部 | 仅未发）', () => {
  it('setFilter(unsent) 后列表只显示未发', () => {
    aoi.state.data = { notifications: [
      { id: 'a', type: 'remind', buyer: '甲', body: 'x', date: '2026-09-12', sent: false },
      { id: 'b', type: 'shipped', buyer: '乙', body: 'y', date: '2026-09-12', sent: true }
    ] };
    aoi.notify.setFilter('unsent');
    expect(doc.querySelectorAll('#notifyTbody tr')).toHaveLength(1);
    expect(doc.getElementById('notifyTbody').textContent).toContain('甲');
    aoi.notify.setFilter('all');
    expect(doc.querySelectorAll('#notifyTbody tr')).toHaveLength(2);
    // 统计行恒为全量口径
    expect(doc.getElementById('notifyStat').textContent).toContain('共 2 条');
  });

  it('页面筛选按钮已接线（点击切状态）', () => {
    aoi.state.data = { notifications: [] };
    const btn = doc.querySelector('[data-notify-filter="unsent"]');
    btn.click();
    expect(aoi.notify.filter).toBe('unsent');
    expect(btn.classList.contains('bg-gray-800')).toBe(true); // 选中高亮
  });
});

describe('备份提醒（距上次下载 N 天）', () => {
  it('从未下载 → 引导文案', () => {
    aoi.backup.renderReminder();
    expect(doc.getElementById('backupReminder').textContent).toContain('尚未下载过全量备份');
  });

  it('今天下载过 → 正常文案；N 天前 → 天数提醒', () => {
    win.localStorage.setItem('aoi_last_backup_download', String(Date.now()));
    aoi.backup.renderReminder();
    expect(doc.getElementById('backupReminder').textContent).toContain('今天已下载过全量备份');

    win.localStorage.setItem('aoi_last_backup_download', String(Date.now() - 8 * 86400000));
    aoi.backup.renderReminder();
    expect(doc.getElementById('backupReminder').textContent).toContain('8 天');
  });
});
