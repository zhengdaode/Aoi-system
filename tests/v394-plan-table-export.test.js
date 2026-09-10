import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

// v3.9.4：购买清单表格导出（取代 v3.9.0 逐账号 PNG 图片方案）——
// buildWorkbook 描述符（每账号一个 Sheet：账号名大标题 + 参考图内嵌 + 外文原名/外币价/件数/外币总价）
// + displayName 原文解析 + exportAll 兜底提示与 exceljs 通道接线 + 活动管理展开区导出按钮

const cell = (sh, r, c) => (sh.rows[r] && sh.rows[r][c]) || null;
const val = (sh, r, c) => { const x = cell(sh, r, c); return x ? x.v : undefined; };

function fixture() {
  return {
    activities: ['CP27'],
    orders: [
      // 立牌 L1 主档无 priceOrig → 外币单价回落订单外币原价均价
      { id: 'o1', activity: 'CP27', type: '立牌', model: 'L1', price: 10, priceOrig: 550, currency: 'jpy', count: 1, buyer: 'x', status: '未到货', batchId: null }
    ],
    activityMeta: {
      CP27: {
        products: [
          { id: 'p1', type: '吧唧', model: '皮卡丘', refImage: 'https://img.example/m1.jpg', refUrl: '/products/jan1.html', priceOrig: 385, currency: 'jpy' },
          { id: 'p2', type: '立牌', model: 'L1', refImage: '', refUrl: '' },
          { id: 'p3', type: '挂件', model: 'ぬいぐるみ ピカチュウ', refImage: 'data:image/png;base64,AAA', refUrl: '' }
        ],
        buyers: [{ buyer: 'ks', account: 'ks@x.com' }, {}, {}, {}]
      }
    },
    pcoItems: [
      { id: 'c1', url: '/products/jan1.html', jpName: 'ピカチュウ バッジ', name: '皮卡丘徽章' }
    ],
    limitPlans: {
      CP27: {
        activity: 'CP27', accountsCount: 3,
        items: [
          { index: 1, total: 30, diff: 0, reached: true, items: [
            { type: '吧唧', model: '皮卡丘', qty: 2, price: 10, amount: 20, status: '待购买' },
            { type: '立牌', model: 'L1', qty: 1, price: 10, amount: 10, status: '待购买' }
          ] },
          { index: 2, total: 5, diff: 0, reached: true, items: [
            { type: '挂件', model: 'ぬいぐるみ ピカチュウ', qty: 1, price: 5, amount: 5, status: '待购买' }
          ] },
          { index: 3, total: 0, diff: 0, reached: false, items: [] }
        ],
        remaining: []
      }
    }
  };
}

describe('plan-export 表格方案（v3.9.4）', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
    aoi.showLoading = vi.fn();
    aoi.hideLoading = vi.fn();
  });

  it('buildWorkbook：每个非空账号一个 Sheet，空账号槽位剔除', () => {
    aoi.state.data = fixture();
    const desc = aoi.planExport.buildWorkbook(aoi.state.data, 'CP27');
    expect(desc.title).toBe('CP27');
    expect(desc.sheets.map((s) => s.name)).toEqual(['账号1-ks（ks@x.com）', '账号2-账号 2']);
  });

  it('Sheet 版式沿用图片方案：顶部账号名大标题合并 + 6 列表头', () => {
    aoi.state.data = fixture();
    const sh = aoi.planExport.buildWorkbook(aoi.state.data, 'CP27').sheets[0];
    expect(val(sh, 0, 0)).toBe('ks（ks@x.com）');
    expect(sh.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 5 }]);
    expect(cell(sh, 0, 0).s.size).toBe(16);
    expect(sh.rows[1].map((x) => x.v)).toEqual(['参考图', '商品名（原文）', '型号', '外币单价', '件数', '外币小计']);
    expect(sh.freeze).toEqual({ r: 2, c: 0 });
  });

  it('数据行：参考图内嵌（link+img 双保险）、外文原名解析链、外币单价/小计、合计行', () => {
    aoi.state.data = fixture();
    const sh = aoi.planExport.buildWorkbook(aoi.state.data, 'CP27').sheets[0];
    // 行 1：吧唧 皮卡丘——参考图内嵌 + pcoItems 按 refUrl 回查日文原名 + 主档 priceOrig
    expect(cell(sh, 2, 0).s.img).toBe('https://img.example/m1.jpg');
    expect(cell(sh, 2, 0).s.link).toBe('https://img.example/m1.jpg');
    expect(sh.rowHeights[2]).toBe(90);
    expect(val(sh, 2, 1)).toBe('ピカチュウ バッジ');
    expect(val(sh, 2, 2)).toBe('皮卡丘');
    expect(val(sh, 2, 3)).toBe('JP¥385');
    expect(val(sh, 2, 4)).toBe(2);
    expect(val(sh, 2, 5)).toBe('JP¥770');
    // 行 2：立牌 L1——无参考图占位、原文回落型号、外币价回落订单均价
    expect(val(sh, 3, 0)).toBe('—');
    expect(val(sh, 3, 1)).toBe('L1');
    expect(val(sh, 3, 3)).toBe('JP¥550');
    expect(val(sh, 3, 5)).toBe('JP¥550');
    // 合计行：件数 3 + 按币种分组的外币合计
    const last = sh.rows.length - 1;
    expect(val(sh, last, 0)).toBe('合计');
    expect(val(sh, last, 4)).toBe(3);
    expect(val(sh, last, 5)).toBe('JP¥1,320');
  });

  it('外币价缺数据时显示 —；挂件型号本身即原文（无 nameOrig/目录命中）', () => {
    aoi.state.data = fixture();
    const sh = aoi.planExport.buildWorkbook(aoi.state.data, 'CP27').sheets[1];
    expect(val(sh, 2, 1)).toBe('ぬいぐるみ ピカチュウ');
    expect(val(sh, 2, 3)).toBe('—');
    expect(val(sh, 2, 5)).toBe('—');
    expect(val(sh, sh.rows.length - 1, 5)).toBe('—');
  });

  it('displayName：主档 nameOrig 优先 → pcoItems 回查 → 型号兜底', () => {
    aoi.state.data = fixture();
    const d = aoi.state.data;
    expect(aoi.planExport.displayName(d, { model: '皮卡丘', refUrl: 'https://www.pokemoncenter-online.com/products/jan1.html' })).toBe('ピカチュウ バッジ');
    expect(aoi.planExport.displayName(d, { model: '皮卡丘', nameOrig: 'ピカチュウ バッジ改' })).toBe('ピカチュウ バッジ改');
    expect(aoi.planExport.displayName(d, { model: 'M1' })).toBe('M1');
    expect(aoi.planExport.displayName(d, {})).toBe('');
  });

  it('fileBase：活动名-购买清单表，非法字符替换', () => {
    expect(aoi.planExport.fileBase('CP27')).toBe('CP27-购买清单表');
    expect(aoi.planExport.fileBase('A/B:C*活动')).toBe('A-B-C-活动-购买清单表');
  });

  it('exportAll：无活动/无计划时提示；exceljs 通道接线（loading 包裹 + 复用 exportSummary 渲染）', async () => {
    aoi.state.data = { activities: [], orders: [], limitPlans: {} };
    aoi.planExport.exportAll('');
    expect(aoi.toast).toHaveBeenCalledWith('请先选择活动', 'warning');
    aoi.planExport.exportAll('CP27');
    expect(aoi.toast).toHaveBeenCalledWith('该活动还没有购买计划——请先「计算购买计划」', 'warning');

    aoi.state.data = fixture();
    win.ExcelJS = { Workbook: function () {} };
    const spy = vi.spyOn(aoi.exportSummary, 'renderExcelJS').mockReturnValue(Promise.resolve());
    try {
      aoi.planExport.exportAll('CP27');
      expect(spy).toHaveBeenCalledTimes(1);
      const [desc, base] = spy.mock.calls[0];
      expect(base).toBe('CP27-购买清单表');
      expect(desc.sheets).toHaveLength(2);
      await new Promise((r) => setTimeout(r, 0));
      expect(aoi.showLoading).toHaveBeenCalledWith(expect.stringContaining('购买清单表'));
      expect(aoi.hideLoading).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      delete win.ExcelJS;
    }
  });

  it('限购结果表不再提供单账号「导出清单图」按钮（v3.9.4 取消图片方案）', () => {
    aoi.state.data = fixture();
    aoi.limits.renderPlan(aoi.state.data.limitPlans.CP27);
    expect(doc.querySelectorAll('#limResultTbody button[data-plan-export]')).toHaveLength(0);
  });

  it('活动管理展开区与计划弹窗提供整表导出入口', () => {
    aoi.state.data = fixture();
    aoi.orders.expandedActivities.CP27 = true;
    aoi.orders.renderActivities();
    const btns = [...doc.querySelectorAll('button[data-act-planexport]')];
    expect(btns.map((b) => b.getAttribute('data-act-planexport'))).toEqual(['CP27']);
    // 弹窗按钮指向当前活动（Aoi.limits.actTarget）
    const modal = doc.getElementById('actPlanModal');
    expect(modal.innerHTML).toContain('Aoi.planExport.exportAll(Aoi.limits.actTarget');
  });
});
