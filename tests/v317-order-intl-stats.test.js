// v3.17.0：国际计算批次前缀导出 / 恢复勾选版批量生成人民币价 /
// 每人应付国际费·货物件数（管理端+团员端）/ 订单管理勾选统计
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

beforeEach(() => {
  aoi.toast = vi.fn();
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
});

// —— 需求1：导出文件名批次前缀 ——

describe('Aoi.exportBaseName data-batch-from 批次前缀（v3.17.0）', () => {
  beforeEach(() => {
    aoi.state.data = {
      orders: [],
      batches: [
        { id: 'b1', date: '2026-08-23', name: '8.23涩谷' },
        { id: 'b2', date: '2026-09-01' } // 未命名 → 显示名回落日期
      ]
    };
    aoi.intl.refillBatches();
  });

  function btn(attrs) {
    const b = doc.createElement('button');
    Object.keys(attrs).forEach((k) => b.setAttribute(k, attrs[k]));
    doc.body.appendChild(b);
    return b;
  }

  it('选中有名批次：批次名-表格类型（如 8.23涩谷-每人应付国际费）', () => {
    doc.getElementById('intlBatch').value = 'b1';
    const b = btn({ 'data-name': '每人应付国际费', 'data-batch-from': 'intlBatch' });
    expect(aoi.exportBaseName(b)).toBe('8.23涩谷-每人应付国际费');
    b.remove();
  });

  it('未命名批次回落日期作前缀', () => {
    doc.getElementById('intlBatch').value = 'b2';
    const b = btn({ 'data-name': '分摊明细', 'data-batch-from': 'intlBatch' });
    expect(aoi.exportBaseName(b)).toBe('2026-09-01-分摊明细');
    b.remove();
  });

  it('未选批次 / 元素不存在：维持原名', () => {
    doc.getElementById('intlBatch').value = '';
    const b1 = btn({ 'data-name': '每人应付国际费', 'data-batch-from': 'intlBatch' });
    expect(aoi.exportBaseName(b1)).toBe('每人应付国际费');
    b1.remove();
    const b2 = btn({ 'data-name': '分摊明细', 'data-batch-from': 'notExist' });
    expect(aoi.exportBaseName(b2)).toBe('分摊明细');
    b2.remove();
  });

  it('批次名含非法文件名字符：替换为 -', () => {
    aoi.state.data.batches[0].name = '8.23涩谷/场';
    aoi.intl.refillBatches();
    doc.getElementById('intlBatch').value = 'b1';
    const b = btn({ 'data-name': '每人应付国际费', 'data-batch-from': 'intlBatch' });
    expect(aoi.exportBaseName(b)).toBe('8.23涩谷-场-每人应付国际费');
    b.remove();
  });

  it('活动前缀优先：data-activity-from 非空时不取批次', () => {
    doc.getElementById('intlBatch').value = 'b1';
    doc.getElementById('fActivity').innerHTML = '<option value="万圣节"></option>';
    doc.getElementById('fActivity').value = '万圣节';
    const b = btn({ 'data-name': '订单管理', 'data-activity-from': 'fActivity', 'data-batch-from': 'intlBatch' });
    expect(aoi.exportBaseName(b)).toBe('万圣节-订单管理');
    b.remove();
  });
});

// —— 需求2：恢复勾选版批量生成人民币价 ——

describe('Aoi.orders 批量生成人民币价·勾选版（v3.17.0 恢复）', () => {
  beforeEach(() => {
    aoi.state.data = {
      orders: [
        { id: 'o1', type: '吧唧', model: 'A', count: 1, currency: 'jpy', price: null, priceOrig: 100, buyer: '小樱' },
        { id: 'o2', type: '吧唧', model: 'B', count: 1, currency: 'jpy', price: 9, priceOrig: 200, buyer: '小樱' },
        { id: 'o3', type: '色纸', model: 'C', count: 1, currency: 'cny', price: 50, priceOrig: null, buyer: '小狼' },
        { id: 'o4', type: '立牌', model: 'D', count: 1, currency: 'krw', price: null, priceOrig: 3000, buyer: '小狼' }
      ],
      batches: []
    };
  });

  function checkRow(i) {
    doc.querySelectorAll('#orderTbody .row-check')[i].checked = true;
  }

  it('未勾选：showGenRmb 提示且公式条不展开', () => {
    aoi.orders.showGenRmb();
    expect(aoi.toast).toHaveBeenCalledWith('请先勾选订单', 'warning');
    expect(doc.getElementById('genRmbBox').classList.contains('hidden')).toBe(true);
  });

  it('showGenRmb 预填勾选中最常见外币币种与计算器汇率', () => {
    aoi.orders.render();
    checkRow(0); checkRow(1); checkRow(2); // o1/o2 jpy + o3 cny → 最常见外币 jpy
    aoi.orders.showGenRmb();
    expect(doc.getElementById('genCurrency').value).toBe('jpy');
    const cfg = aoi.calc.get().jpy;
    expect(parseFloat(doc.getElementById('genRate').value)).toBe(cfg.rate);
    expect(parseFloat(doc.getElementById('genMarkup').value)).toBe(cfg.markup);
    expect(doc.getElementById('genRmbBox').classList.contains('hidden')).toBe(false);
  });

  it('applyGenRmb 只为勾选的外币订单生成，人民币单与未勾选不动，可撤销', async () => {
    aoi.orders.render();
    checkRow(0); checkRow(1); checkRow(2); // 勾选 o1/o2/o3；o4 不勾
    aoi.orders.showGenRmb();
    doc.getElementById('genRate').value = '0.05';
    doc.getElementById('genMarkup').value = '0';
    await aoi.orders.applyGenRmb();
    const o = aoi.state.data.orders;
    expect(o[0].price).toBe(aoi.calc.convert(100, 0.05, 0)); // 勾选 jpy → 生成
    expect(o[1].price).toBe(aoi.calc.convert(200, 0.05, 0)); // 已有价也按公式重算
    expect(o[2].price).toBe(50);                              // 人民币单不动
    expect(o[3].price).toBeNull();                            // 未勾选不动
    expect(aoi.undo.snapshot).not.toBeNull();
    expect(aoi.undo.label).toBe('批量生成人民币价');
    expect(doc.getElementById('genRmbBox').classList.contains('hidden')).toBe(true);
  });

  it('applyGenRmb 未勾选：不改任何价格', async () => {
    await aoi.orders.applyGenRmb();
    aoi.state.data.orders.forEach((o) => {
      if (o.id === 'o1' || o.id === 'o4') expect(o.price).toBeNull();
    });
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
  });
});

// —— 需求3：每人应付国际费·货物件数（管理端 + 团员端） ——

describe('国际计算货物件数（v3.17.0）', () => {
  beforeEach(() => {
    aoi.state.data = {
      orders: [
        { id: 'o1', type: '色纸', model: 'A', count: 2, buyer: '小樱', batchId: 'b1' },
        { id: 'o2', type: '色纸', model: 'A', count: 1, buyer: '小狼', batchId: 'b1' },
        { id: 'o3', type: '亚克力', model: 'B', count: 3, buyer: '小樱', batchId: 'b1' },
        { id: 'o4', type: '亚克力', model: 'B', count: 1, buyer: '小狼', batchId: 'b2' }
      ],
      batches: [{ id: 'b1', date: '2026-09-01', targetAmount: 100, weights: { '色纸|A': 1, '亚克力|B': 2 } }],
      payments: []
    };
  });

  it('buyerRows 返回每人件数合计', () => {
    const items = aoi.intl.buildItems(aoi.intl.getBatch('b1'));
    const rows = aoi.intl.buyerRows('b1', items);
    const sakura = rows.find((r) => r.buyer === '小樱');
    const syaoran = rows.find((r) => r.buyer === '小狼');
    expect(sakura.count).toBe(5); // 2 + 3
    expect(syaoran.count).toBe(1);
  });

  it('render：每人应付国际费表增列货物件数，统计行含批次合计件数', () => {
    aoi.intl.refillBatches();
    doc.getElementById('intlBatch').value = 'b1';
    aoi.intl.render();
    const tds = doc.querySelectorAll('#intlBuyerTbody td');
    const texts = Array.from(tds).map((td) => td.textContent);
    expect(texts.filter((t) => t === '5 件')).toHaveLength(1);
    expect(texts.filter((t) => t === '1 件')).toHaveLength(1);
    expect(doc.getElementById('intlStat').textContent).toContain('合计 6 件');
  });

  it('团员端 renderFees 增列我的件数（收货核对用）', () => {
    aoi.member.state = { key: 'k', cn: '小樱', teamName: '团', updatedAt: null };
    aoi.member.renderFees('小樱');
    const tds = doc.querySelectorAll('#memberFeeTbody td[data-label="我的件数"]');
    expect(tds).toHaveLength(1);
    expect(tds[0].textContent).toBe('5 件');
    // 件数列紧邻应付国际费（同一行内前后相邻）
    const row = doc.querySelector('#memberFeeTbody tr');
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.getAttribute('data-label'));
    expect(cells.indexOf('我的件数')).toBe(cells.indexOf('应付国际费') - 1);
  });

  it('v3.17.1：购买内容列挂 intl-content-cell（宽度上限随视口自适应换行）', () => {
    aoi.intl.refillBatches();
    doc.getElementById('intlBatch').value = 'b1';
    aoi.intl.render();
    const tds = doc.querySelectorAll('#intlBuyerTbody td.intl-content-cell');
    expect(tds).toHaveLength(2); // 每行内容格各一
    expect(tds[0].textContent).toContain('×'); // 内容本体不变（类型-型号 ×件数）
  });
});

// —— 需求4：订单管理勾选统计 ——

describe('Aoi.orders.selectionStats 勾选统计（v3.17.0）', () => {
  beforeEach(() => {
    aoi.state.data = {
      orders: [
        { id: 'o1', type: '吧唧', model: 'A', count: 2, currency: 'jpy', price: 10, priceOrig: 500, buyer: '小樱', intlFee: 12.5 },
        { id: 'o2', type: '吧唧', model: 'B', count: 1, currency: 'jpy', price: null, priceOrig: 100, buyer: '小樱', intlFee: 3 },
        { id: 'o3', type: '色纸', model: 'C', count: 5, currency: 'cny', price: 8, priceOrig: null, buyer: '小狼', intlFee: 0.5 }
      ],
      batches: []
    };
    aoi.orders.render();
  });

  function check(ids) {
    doc.querySelectorAll('#orderTbody .row-check').forEach((cb, i) => {
      cb.checked = ids.indexOf(i) >= 0;
    });
  }

  it('未勾选：提示且统计条不出现', () => {
    aoi.orders.selectionStats();
    expect(aoi.toast).toHaveBeenCalledWith('请先勾选订单', 'warning');
    expect(doc.getElementById('orderSelStat').classList.contains('hidden')).toBe(true);
  });

  it('四项统计：件数 / 本体（含外币原价分列）/ 国际邮费 / 整体总金额', () => {
    check([0, 1]); // o1 + o2
    aoi.orders.selectionStats();
    const t = doc.getElementById('orderSelStatBody').textContent;
    expect(t).toContain('选中 2 条');
    expect(t).toContain('物件总数量 3 件');           // 2 + 1
    expect(t).toContain('本体总金额 ¥20.00');         // 10×2（o2 待生成不计入）
    expect(t).toContain('JP¥1100.00');                // 500×2 + 100×1
    expect(t).toContain('1 件人民币价待生成');
    expect(t).toContain('国际邮费 ¥15.50');           // 12.5 + 3
    expect(t).toContain('整体总金额 ¥35.50');         // 20 + 15.5
    expect(doc.getElementById('orderSelStat').classList.contains('hidden')).toBe(false);
  });

  it('hideSelStats 收起统计条', () => {
    check([2]);
    aoi.orders.selectionStats();
    expect(doc.getElementById('orderSelStat').classList.contains('hidden')).toBe(false);
    aoi.orders.hideSelStats();
    expect(doc.getElementById('orderSelStat').classList.contains('hidden')).toBe(true);
  });
});
