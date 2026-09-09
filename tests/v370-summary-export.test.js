import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi } from './helpers/aoi.js';

// v3.7.0 S5：汇总表导出——buildWorkbook 描述符（采购表 + 每活动汇总矩阵）
const cell = (sh, r, c) => (sh.rows[r] && sh.rows[r][c]) || null;
const val = (sh, r, c) => { const x = cell(sh, r, c); return x ? x.v : undefined; };

function fixture() {
  return {
    activities: ['CP27', 'CP28', '空活动'],
    activityMeta: {
      CP27: {
        link: 'https://shop.example/cp27',
        products: [
          { id: 'p1', type: '吧唧', model: 'M1', refImage: 'https://img.example/m1.jpg', refUrl: '', price: 10 },
          { id: 'p2', type: '立牌', model: 'L1', refImage: '', refUrl: 'https://shop.example/p/2' }
        ],
        buyers: [{ buyer: 'ks', account: 'ks@x.com', address: '' }, { buyer: '二号', account: '', address: '' }]
      },
      CP28: {},
      空活动: {}
    },
    orders: [
      { id: 'o1', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小狼', status: '未到货', batchId: null },
      { id: 'o2', activity: 'CP27', type: '吧唧', model: 'M1', price: 10, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
      { id: 'o3', activity: 'CP27', type: '立牌', model: 'L1', price: 20, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null },
      { id: 'o4', activity: 'CP28', type: '色纸', model: 'S1', price: 5, currency: 'cny', count: 3, buyer: '阿明', status: '未到货', batchId: null }
    ],
    limitPlans: {
      CP27: {
        activity: 'CP27', accountsCount: 2,
        items: [
          { index: 1, total: 20, diff: 0, reached: true, items: [{ type: '吧唧', model: 'M1', qty: 2, price: 10, amount: 20, status: '已购买' }] },
          { index: 2, total: 0, diff: 0, reached: false, items: [] }
        ],
        remaining: [{ type: '吧唧', model: 'M1', qty: 1 }]
      }
    }
  };
}

describe('汇总表导出 builder（v3.7.0 S5）', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
  });

  it('无数据时返回空并提示', () => {
    const desc = aoi.exportSummary.buildWorkbook({ activities: ['空活动'], activityMeta: { 空活动: {} }, orders: [] }, null);
    expect(desc.sheets).toHaveLength(0);
    aoi.exportSummary();
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('没有可导出'), 'warning');
  });

  it('全部导出：采购表 + 每活动汇总（无订单/商品的活动跳过）', () => {
    const desc = aoi.exportSummary.buildWorkbook(fixture(), null);
    expect(desc.sheets.map((s) => s.name)).toEqual(['采购表', '【CP27】汇总', '【CP28】汇总']);
  });

  it('采购表：组标题/名称/人民币价/需求总数与总计', () => {
    const desc = aoi.exportSummary.buildWorkbook(fixture(), null);
    const pc = desc.sheets[0];
    // 组标题：A–D 留给标签区，CP27 占 E..F（列 4..5），CP28 从列 6 起
    expect(val(pc, 0, 4)).toBe('CP27');
    expect(pc.merges.some((m) => m.r1 === 0 && m.c1 === 4 && m.c2 === 5)).toBe(true);
    expect(val(pc, 0, 6)).toBe('CP28');
    // 名称行
    expect(val(pc, 1, 4)).toBe('M1');
    expect(val(pc, 1, 5)).toBe('L1');
    expect(val(pc, 1, 6)).toBe('S1'); // 订单中未登记的组合也进采购表
    // 人民币价（按件加权均价）
    expect(val(pc, 4, 4)).toBe(10);
    expect(val(pc, 4, 5)).toBe(20);
    expect(val(pc, 4, 6)).toBe(5);
    // 需求总数：M1=2、L1=1、S1=3；B 列总计=6
    expect(val(pc, 5, 4)).toBe(2);
    expect(val(pc, 5, 5)).toBe(1);
    expect(val(pc, 5, 6)).toBe(3);
    expect(val(pc, 5, 1)).toBe(6);
    // 参考图行：图片链接
    expect(val(pc, 2, 4)).toBe('图片链接');
    expect(cell(pc, 2, 4).s.link).toBe('https://img.example/m1.jpg');
  });

  it('采购表：购买人分摊矩阵（购买人标签/金额/实际购买总数）与多余部分行', () => {
    const desc = aoi.exportSummary.buildWorkbook(fixture(), null);
    const pc = desc.sheets[0];
    // 表头 r8
    expect(val(pc, 8, 0)).toBe('购买人');
    // 账号 1 → ks（ks@x.com），金额 20，总数 2，已购 2，M1 分摊 2（E 列）
    expect(val(pc, 9, 0)).toBe('ks（ks@x.com）');
    expect(val(pc, 9, 1)).toBe(20);
    expect(val(pc, 9, 2)).toBe(2);
    expect(val(pc, 9, 3)).toBe(2);
    expect(val(pc, 9, 4)).toBe(2);
    // 账号 2 空槽位也渲染（0 件），便于对照购买人名单
    expect(val(pc, 10, 0)).toBe('二号');
    expect(val(pc, 10, 2)).toBe(0);
    // 多余部分：remaining M1 ×1 → 标记行
    expect(desc.notes).toEqual(['CP27 吧唧-M1 ×1']);
    const lastRow = pc.rows.length - 1;
    expect(val(pc, lastRow, 0)).toBe('购入多余部分（未分配）');
    expect(val(pc, lastRow, 4)).toBe(1);
  });

  it('【CP27】汇总：标题合并/种类/单价/总数 + 买家矩阵按订单逐单累计', () => {
    const desc = aoi.exportSummary.buildWorkbook(fixture(), 'CP27');
    expect(desc.sheets.map((s) => s.name)).toEqual(['采购表', '【CP27】汇总']);
    const sh = desc.sheets[1];
    expect(val(sh, 0, 0)).toBe('【CP27】汇总');
    expect(sh.merges.some((m) => m.r1 === 0 && m.c1 === 0 && m.c2 === 3)).toBe(true);
    // 表头
    expect(val(sh, 2, 1)).toBe('种类');
    expect(val(sh, 2, 2)).toBe('吧唧 M1');
    expect(val(sh, 2, 3)).toBe('立牌 L1');
    expect(val(sh, 3, 2)).toBe(10);
    expect(val(sh, 3, 3)).toBe(20);
    expect(val(sh, 4, 1)).toBe('昵称/总数');
    expect(val(sh, 4, 2)).toBe(2); // M1 总件数
    expect(val(sh, 4, 3)).toBe(1);
    // 买家矩阵：小樱（30 = 10 + 20）；小狼（10 = 10）
    const byName = {};
    sh.rows.slice(5).forEach((r) => { if (r && r[1]) byName[r[1].v] = r; });
    expect(byName['小樱'][0].v).toBe(30);
    expect(byName['小樱'][3].v).toBe(1);  // L1 ×1
    expect(byName['小狼'][0].v).toBe(10);
    expect(byName['小狼'][2].v).toBe(1);  // M1 ×1
    expect(cell(sh, 5, 0).s.fmt).toBe('0.00');
  });

  it('工作表名净化：非法字符替换、超长截断、重名去重', () => {
    const d = fixture();
    const weird = 'A/B:C*D?E"F<G>H|I'.repeat(4);
    d.activities = [weird, 'CP27'];
    d.activityMeta[weird] = { products: [] };
    d.orders = [{ id: 'o1', activity: weird, type: '吧唧', model: 'M', price: 1, currency: 'cny', count: 1, buyer: '小樱', status: '未到货', batchId: null }];
    const desc = aoi.exportSummary.buildWorkbook(d, null);
    const names = desc.sheets.map((s) => s.name);
    expect(names.every((n) => n.length <= 31 && !/[\\/:*?[\]]/.test(n))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
