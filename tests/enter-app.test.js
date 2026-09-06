import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

// v3.2.0 回归守护：限购计算器曾因 enterApp 漏刷 limits.render 导致活动下拉恒空
// （CHANGELOG v3.2.0 第 2 条）。本用例保证登录进入应用后 limActivity 必然被填充。
describe('Aoi.enterApp 登录后刷新（limits 回归守护）', () => {
  beforeEach(() => {
    aoi.state.user = { id: 'boss', username: 'boss', role: 'admin' };
    aoi.adminLoadSession = () => ({ token: 'tok-1', role: 'admin', updatedAt: null });
    aoi.adminUpdatedAt = null;
    aoi.db = {
      rpc: vi.fn(async (name) => {
        if (name === 'admin_get_team_data') {
          return {
            data: {
              name: '测试团',
              memberKey: 'K1',
              updatedAt: '2026-09-07T00:00:00Z',
              data: {
                activities: ['CP27', 'Only2'],
                ips: ['CP27'],
                orders: [
                  { id: 'o1', ip: 'CP27', activity: 'CP27', type: '吧唧', model: 'A款', price: 10, count: 1, status: '未到货', batchId: null }
                ],
                batches: [],
                payments: []
              }
            }
          };
        }
        return { data: null };
      })
    };
  });

  it('enterApp 后限购计算器活动下拉必须包含 blob 中的活动', async () => {
    await aoi.enterApp();
    const sel = doc.getElementById('limActivity');
    expect(sel).not.toBeNull();
    expect(sel.innerHTML).toContain('CP27');
    expect(sel.innerHTML).toContain('Only2');
  });

  it('enterApp 后各批次/数据下拉同步刷新（intl/approval/ship/notify）', async () => {
    aoi.state.data = {
      activities: ['CP27'], ips: [], batches: [{ id: 'b9', date: '2026-09-01' }], orders: [], payments: []
    };
    await aoi.enterApp();
    // 批次为空时四个下拉都应有占位 option（证明 refill 被调用而非残留空 DOM）
    ['intlBatch', 'approvalBatch', 'shipBatch', 'notifyBatch'].forEach((id) => {
      const el = doc.getElementById(id);
      expect(el).not.toBeNull();
      expect(el.innerHTML).not.toBe('');
    });
  });
});
