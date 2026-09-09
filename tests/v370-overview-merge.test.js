import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.7.0 S6：总览合并复盘（进入总览即渲染团期复盘）+ 发货管理 CSV 导出移除
describe('总览合并复盘与发货导出清理（v3.7.0 S6）', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
    aoi.state.data = {
      activities: ['CP27'],
      activityMeta: { CP27: { ip: '宝可梦', buyDate: '2026-08-10', status: '进行中' } },
      ips: ['宝可梦'],
      orders: [
        { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 2, buyer: '小樱', status: '已到货', batchId: 'b1', shipped: '已发', shippedAt: '2026-08-20T00:00:00.000Z' }
      ],
      batches: [{ id: 'b1', date: '2026-08-15' }],
      payments: [],
      notifications: [],
      transfers: [],
      cnChanges: []
    };
  });

  it('nav 到总览时团期复盘区块被渲染（KPI 与团期下拉有内容）', () => {
    aoi.nav('view-overview');
    expect(doc.getElementById('view-overview').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('statsKpis').innerHTML).not.toBe('');
    expect(doc.getElementById('statsTermSel').innerHTML).toContain('2026-08');
  });

  it('独立 view-stats 视图与导航项已移除', () => {
    expect(doc.getElementById('view-stats')).toBeNull();
    expect(doc.querySelector('[data-nav="view-stats"]')).toBeNull();
  });

  it('Aoi.ship.export 已删除（发货 CSV 导出移除，bot xlsx 私发保留）', () => {
    expect(aoi.ship.export).toBeUndefined();
    expect(typeof aoi.bot.exportShipping).toBe('function');
  });
});
