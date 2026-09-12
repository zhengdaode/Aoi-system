import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

// v3.15.0：S1 手动录入商品联动 / S2 导入识别回填 / S3 活动商品列表导出 / S8 复盘性能记忆化 /
// S9 AI 提示词一次导入（8 列 + 相对链接补全）
describe('S1 手动录入商品联动（productFillFor / onActivityInput / onModelInput）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['万圣节'],
      activityMeta: {
        '万圣节': {
          products: [
            { id: 'p1', type: '毛绒玩偶', model: '皮卡丘玩偶', nameOrig: 'ぬいぐるみ ピカチュウ', price: 210, priceOrig: 3960, currency: 'jpy' },
            { id: 'p2', type: '徽章', model: '电次', price: 12 }
          ]
        }
      },
      typeMeta: {}, orders: [], batches: []
    };
    // DOM 在用例间共享，录入表单逐字段复位（radio 恢复默认 calc）
    ['oActivity', 'oType', 'oModel', 'oPrice', 'oPriceRmb'].forEach(function (id) { doc.getElementById(id).value = ''; });
    doc.getElementById('oCurrency').value = 'cny';
    doc.querySelector('input[name="oPriceMode"][value="calc"]').checked = true;
  });

  it('productFillFor：按型号或原名精确命中，未命中返回 null', () => {
    expect(aoi.orders.productFillFor('万圣节', '皮卡丘玩偶').id).toBe('p1');
    expect(aoi.orders.productFillFor('万圣节', 'ぬいぐるみ ピカチュウ').id).toBe('p1');
    expect(aoi.orders.productFillFor('万圣节', '不存在的商品')).toBeNull();
    expect(aoi.orders.productFillFor('别的活动', '电次')).toBeNull();
  });

  it('onActivityInput：按活动填商品候选 datalist', () => {
    doc.getElementById('oActivity').value = '万圣节';
    aoi.orders.onActivityInput();
    const dl = doc.getElementById('oModelOptions');
    expect(dl.querySelectorAll('option')).toHaveLength(2);
    expect(dl.innerHTML).toContain('皮卡丘玩偶');
  });

  it('onModelInput：外币商品且主档有人民币价 → 计算器模式同时带出原价与人民币价', () => {
    doc.getElementById('oActivity').value = '万圣节';
    doc.getElementById('oModel').value = '皮卡丘玩偶';
    aoi.orders.onModelInput();
    expect(doc.getElementById('oType').value).toBe('毛绒玩偶');
    expect(doc.getElementById('oCurrency').value).toBe('jpy');
    expect(doc.getElementById('oPrice').value).toBe('3960');
    expect(doc.getElementById('oPriceRmb').value).toBe('210');
    expect(doc.querySelector('input[name="oPriceMode"]:checked').value).toBe('calc');
  });

  it('onModelInput：外币商品缺人民币价 → 直接输入模式（价格待生成）', () => {
    aoi.state.data.activityMeta['万圣节'].products[0] = { id: 'p1', type: '毛绒玩偶', model: '皮卡丘玩偶', priceOrig: 3960, currency: 'jpy' };
    doc.getElementById('oActivity').value = '万圣节';
    doc.getElementById('oModel').value = '皮卡丘玩偶';
    aoi.orders.onModelInput();
    expect(doc.getElementById('oCurrency').value).toBe('jpy');
    expect(doc.getElementById('oPrice').value).toBe('3960');
    expect(doc.getElementById('oPriceRmb').value).toBe('');
    expect(doc.querySelector('input[name="oPriceMode"]:checked').value).toBe('direct');
  });

  it('onModelInput：人民币商品带出类型与单价', () => {
    doc.getElementById('oActivity').value = '万圣节';
    doc.getElementById('oModel').value = '电次';
    aoi.orders.onModelInput();
    expect(doc.getElementById('oType').value).toBe('徽章');
    expect(doc.getElementById('oCurrency').value).toBe('cny');
    expect(doc.getElementById('oPrice').value).toBe('12');
  });

  it('onModelInput：未命中不改动表单', () => {
    doc.getElementById('oActivity').value = '万圣节';
    doc.getElementById('oModel').value = '自由输入的商品';
    aoi.orders.onModelInput();
    expect(doc.getElementById('oType').value).toBe('');
  });
});

describe('S2 表格导入识别已有商品（confirmImport 回填 + 自动登记）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['万圣节'],
      activityMeta: {
        '万圣节': {
          products: [
            { id: 'p1', type: '毛绒玩偶', model: '皮卡丘玩偶', price: 210, priceOrig: 3960, currency: 'jpy' }
          ]
        }
      },
      typeMeta: {}, orders: [], batches: [], ips: []
    };
    doc.getElementById('importActivity').value = '万圣节';
    doc.getElementById('importIp').value = '宝可梦';
    doc.getElementById('importAutoRegister').checked = true;
  });

  it('命中主档：回填缺失的类型/人民币价/外币原价，已有值不覆盖', async () => {
    aoi.import.pending = [
      { id: 'r1', activity: '万圣节', type: '默认类型', model: '皮卡丘玩偶', price: 0, priceOrig: null, currency: 'cny', count: 1, buyer: '小樱' },
      { id: 'r2', activity: '万圣节', type: '徽章', model: '皮卡丘玩偶', price: 999, priceOrig: 123, currency: 'jpy', count: 1, buyer: '小狼' }
    ];
    await aoi.orders.confirmImport();
    const [r1, r2] = aoi.state.data.orders;
    expect(r1.type).toBe('毛绒玩偶'); // 默认类型视为缺失 → 回填
    expect(r1.price).toBe(210);
    expect(r1.priceOrig).toBe(3960);
    expect(r1.currency).toBe('jpy');
    expect(r2.price).toBe(999); // 已有值不覆盖
    expect(r2.priceOrig).toBe(123);
    expect(aoi.state.data.orders).toHaveLength(2);
  });

  it('未命中：自动登记商品主档骨架（可关），一次落库', async () => {
    aoi.import.pending = [
      { id: 'r1', activity: '万圣节', type: '色纸', model: '新商品A', price: 10, priceOrig: null, currency: 'cny', count: 1, buyer: '小樱' }
    ];
    await aoi.orders.confirmImport();
    const ps = aoi.state.data.activityMeta['万圣节'].products;
    expect(ps).toHaveLength(2);
    expect(ps[1]).toMatchObject({ type: '色纸', model: '新商品A' });

    doc.getElementById('importAutoRegister').checked = false;
    aoi.import.pending = [
      { id: 'r2', activity: '万圣节', type: '色纸', model: '新商品B', price: 10, priceOrig: null, currency: 'cny', count: 1, buyer: '小狼' }
    ];
    await aoi.orders.confirmImport();
    expect(aoi.state.data.activityMeta['万圣节'].products).toHaveLength(2); // 关闭后不登记
  });
});

describe('S3 活动商品列表导出（exportProductList）', () => {
  beforeEach(() => {
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
    aoi.state.data = {
      activities: ['万圣节'],
      activityMeta: {
        '万圣节': {
          products: [
            { id: 'p1', type: '毛绒玩偶', model: '皮卡丘玩偶', nameOrig: 'ぬいぐるみ ピカチュウ', price: 210, priceOrig: 3960, currency: 'jpy', limit: 2, refImage: 'https://img.example/1.jpg', refUrl: 'https://x/p/1' }
          ]
        }
      },
      typeMeta: {}, orders: [], batches: []
    };
  });

  it('导出当前主档数据（点击即同步），文件名带活动名', () => {
    const captured = {};
    win.XLSX = {
      utils: {
        aoa_to_sheet: (aoa) => ({ aoa }),
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; }
      },
      writeFile: (wb, fname) => { captured.fname = fname; captured.aoa = wb.Sheets[wb.SheetNames[0]].aoa; }
    };
    aoi.orders.exportProductList('万圣节');
    expect(captured.fname).toBe('万圣节-商品列表.xlsx');
    expect(captured.aoa[0]).toEqual(['类型', '型号', '原语言名', '币种', '外币原价', '人民币价', '限购', '参考图', '商品链接']);
    expect(captured.aoa[1]).toEqual(['毛绒玩偶', '皮卡丘玩偶', 'ぬいぐるみ ピカチュウ', 'JP¥', 3960, 210, 2, 'https://img.example/1.jpg', 'https://x/p/1']);
    delete win.XLSX;
  });
});

describe('S8 复盘性能治理（buyerSummary 记忆化 + stats 渲染缓存）', () => {
  function seed() {
    aoi.state.data = {
      activities: [], activityMeta: {}, typeMeta: {}, ips: [],
      batches: [{ id: 'b1', date: '2026-08-15' }],
      orders: [
        { id: 'o1', activity: 'A', buyer: '小樱', type: '吧唧', model: 'M', price: 10, priceOrig: null, currency: 'cny', count: 1, batchId: 'b1' }
      ],
      payments: []
    };
  }

  beforeEach(() => {
    seed();
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
  });

  it('buyerSummary：同数据同批次重复调用命中缓存（同一数组），数据换代后重算', () => {
    const r1 = aoi.approval.buyerSummary('b1');
    const r2 = aoi.approval.buyerSummary('b1');
    expect(r2).toBe(r1);
    // 新数据对象（换代）→ 重新计算
    seed();
    const r3 = aoi.approval.buyerSummary('b1');
    expect(r3).not.toBe(r1);
    expect(r3[0].goods).toBe(10);
  });

  it('buyerSummary：bumpDataVersion 后失效重算', () => {
    const r1 = aoi.approval.buyerSummary('b1');
    aoi.state.data.orders[0].price = 99;
    aoi.bumpDataVersion(); // saveTeamData 成功后的失效信号
    const r2 = aoi.approval.buyerSummary('b1');
    expect(r2).not.toBe(r1);
    expect(r2[0].goods).toBe(99);
  });

  it('stats.render：聚合结果进渲染缓存，数据不变时二次渲染直接命中', () => {
    aoi.stats.render();
    const key1 = aoi.stats._renderCache.key;
    aoi.stats.render();
    expect(aoi.stats._renderCache.key).toBe(key1);
    // 口径变化 → 缓存键变化
    aoi.stats.ipMetric = 'count';
    aoi.stats.render();
    expect(aoi.stats._renderCache.key).not.toBe(key1);
    // 数据变化（新对象）→ 缓存键变化
    seed();
    aoi.stats.ipMetric = 'amount';
    const key2 = aoi.stats._renderCache.key;
    aoi.stats.render();
    expect(aoi.stats._renderCache.key).not.toBe(key2);
  });

  it('stats.kpis：传入预计算 summaries/aging 与自行计算结果一致（单次渲染去重）', () => {
    const d = aoi.state.data;
    const summaries = aoi.stats.batchSummaries(d, 'all');
    const aging = aoi.stats.shipAgingRows(d, 'all');
    const a = aoi.stats.kpis(d, 'all', '', summaries, aging);
    const b = aoi.stats.kpis(d, 'all', '');
    expect(a.orderCount).toBe(b.orderCount);
    expect(a.receivable).toBe(b.receivable);
    expect(a.agingDays).toBe(b.agingDays);
  });
});

describe('S9 AI 提示词一次导入（8 列 + 链接校验）', () => {
  beforeEach(() => {
    aoi.state.data = { activities: [], typeMeta: {}, orders: [], batches: [], activityMeta: {} };
    aoi.catalog.draft = [];
    aoi.catalog.matchers = null;
  });

  it('AI_PROMPT 含商品链接/图片链接列与防编造约束', () => {
    expect(aoi.catalog.AI_PROMPT).toContain('| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 | 商品链接 | 图片链接 |');
    expect(aoi.catalog.AI_PROMPT).toContain('绝不允许编造');
    expect(aoi.catalog.AI_PROMPT).toContain('留空');
  });

  it('parseAi：识别 8 列表格（含商品链接/图片链接）', () => {
    const items = aoi.catalog.parseAi([
      '| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 | 商品链接 | 图片链接 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| ぬいぐるみ ピカチュウ | 皮卡丘玩偶 | 毛绒玩偶 | 3,960 | 2 | 11月8日発売 | https://x/p/1 | https://img/1.jpg |'
    ].join('\n'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      jpName: 'ぬいぐるみ ピカチュウ', name: '皮卡丘玩偶', type: '毛绒玩偶',
      priceJpy: 3960, limit: 2, saleDate: '11月8日発売',
      url: 'https://x/p/1', image: 'https://img/1.jpg'
    });
  });

  it('addToDraft：AI 行的站内相对链接自动补全为 PCO 绝对地址', () => {
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', name: '皮卡丘玩偶', url: '/products/123.html' }]);
    expect(aoi.catalog.draft[0].url).toBe('https://www.pokemoncenter-online.com/products/123.html');
  });
});
