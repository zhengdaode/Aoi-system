// v3.32.0 宣传图导出 + 国际计算导出修复测试
// ①Aoi.poster.buildData 纯函数：已排（排谷表排位数）/总量（stock 优先回落购买计划 limits）/
//   余量/合计已排/封面回落链；
// ②Aoi.exportFlattenInputs：input 值→span 文本、select→所选 option 文本、hidden 删除、
//   checkbox 保留（修复 html2canvas/table_to_book 读不到表单控件值——国际计算「国内额外金额」导出空白）；
// ③端到端：exportImage（html2canvas stub）与 tableExport（XLSX stub）导出含 input 值的表格时数值可见。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

function seedData() {
  aoi.state.data = {
    orders: [],
    activities: ['AHS娃再贩'],
    activityMeta: {
      'AHS娃再贩': {
        ip: '术力口', status: '进行中', deadline: '2026-11-01',
        products: [
          { id: 'p1', type: '娃娃', model: '樱乃', refImage: 'https://img.example/1.jpg', price: 295, currency: 'CNY', stock: 3 },
          { id: 'p2', type: '娃娃', model: '小春', refImage: '', price: 295, currency: 'CNY' },
          { id: 'p3', type: '挂件', model: '冰山', refImage: '', price: 295, currency: 'CNY', limit: 5 }
        ]
      }
    },
    paigu: { 'AHS娃再贩': { slots: { '娃娃|樱乃': [{ id: 's1' }, { id: 's2' }], '娃娃|小春': [] }, log: [] } },
    limitPlans: { 'AHS娃再贩': { items: [], limits: { '娃娃|小春': 3, '挂件|冰山': 2 } } },
    batches: [], payments: [], notifications: [], announcements: [], reservoirs: [], cnChanges: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {}, ips: []
  };
}

beforeEach(() => {
  win.localStorage.clear();
  seedData();
  aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
  aoi.toast = vi.fn();
});

describe('Aoi.poster.buildData（宣传图数据派生）', () => {
  it('已排 = 排谷表该商品键排位数；总量 stock 优先、回落购买计划 limits；余量 = 总量-已排', () => {
    const data = aoi.poster.buildData(aoi.state.data, 'AHS娃再贩');
    const sakino = data.products.find((p) => p.model === '樱乃');
    const koharu = data.products.find((p) => p.model === '小春');
    const yama = data.products.find((p) => p.model === '冰山');
    expect(sakino.placed).toBe(2);
    expect(sakino.total).toBe(3);
    expect(sakino.remain).toBe(1);
    expect(koharu.placed).toBe(0);
    expect(koharu.total).toBe(3); // 无 stock → limits
    expect(yama.total).toBe(2);
    expect(data.placedTotal).toBe(2);
  });

  it('合计已排跨商品累加；标题/IP/状态/截止日期透传；封面回落第一张商品参考图', () => {
    const data = aoi.poster.buildData(aoi.state.data, 'AHS娃再贩');
    expect(data.name).toBe('AHS娃再贩');
    expect(data.ip).toBe('术力口');
    expect(data.status).toBe('进行中');
    expect(data.deadline).toBe('2026-11-01');
    expect(data.cover).toBe('https://img.example/1.jpg');
    aoi.state.data.activityMeta['AHS娃再贩'].cover = 'https://img.example/cover.jpg';
    expect(aoi.poster.buildData(aoi.state.data, 'AHS娃再贩').cover).toBe('https://img.example/cover.jpg');
  });

  it('无排谷表/无购买计划/无库存时不虚构总量（total/remain 为 null，只显示已排）', () => {
    aoi.state.data.paigu = {};
    aoi.state.data.limitPlans = {};
    aoi.state.data.activityMeta['AHS娃再贩'].products[0].stock = null;
    const data = aoi.poster.buildData(aoi.state.data, 'AHS娃再贩');
    expect(data.products.every((p) => p.total == null && p.remain == null && p.placed === 0)).toBe(true);
    expect(data.placedTotal).toBe(0);
  });
});

describe('Aoi.exportFlattenInputs（导出前展平表单控件）', () => {
  it('input 值 → span 文本；select → 所选 option 文本；hidden 删除；checkbox 保留', () => {
    const table = doc.createElement('table');
    table.innerHTML = '<tbody><tr>'
      + '<td><input type="number" value="88.5" class="w-24"></td>'
      + '<td><select><option>甲</option><option selected>乙</option></select></td>'
      + '<td><input type="hidden" value="x"></td>'
      + '<td><input type="checkbox" data-id="r1" checked></td>'
      + '<td><textarea rows="2">多行文本</textarea></td>'
      + '</tr></tbody>';
    const clone = aoi.exportFlattenInputs(table.cloneNode(true));
    const tds = clone.querySelectorAll('td');
    expect(tds[0].textContent).toBe('88.5');
    expect(tds[0].querySelector('span').className).toBe('w-24'); // 保留样式类
    expect(tds[1].textContent).toBe('乙');
    expect(clone.querySelector('input[type="hidden"]')).toBeNull();
    expect(clone.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(clone.querySelector('input[type="checkbox"]').checked).toBe(true);
    expect(tds[4].textContent).toBe('多行文本');
  });

  it('端到端·导出图片：国际计算式表格（input 持值）经 html2canvas 后数值在画面中', async () => {
    let captured = null;
    win.html2canvas = vi.fn((el) => {
      captured = el;
      return Promise.resolve({ toDataURL: () => 'data:image/png;base64,AAA' });
    });
    const table = doc.createElement('table');
    table.id = 'fakeIntlBuyerTable';
    table.innerHTML = '<thead><tr><th>购买者</th><th>国内额外金额</th></tr></thead>'
      + '<tbody><tr><td>qwer</td><td><input type="number" step="0.01" value="88.5"></td></tr></tbody>';
    doc.body.appendChild(table);
    const btn = doc.createElement('button');
    btn.setAttribute('data-table', 'fakeIntlBuyerTable');
    btn.setAttribute('data-name', '每人应付国际费');
    aoi.exportImage(btn);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(captured).not.toBeNull();
    expect(captured.textContent).toContain('88.5');
    expect(captured.querySelector('input[type="number"]')).toBeNull();
    table.remove();
    delete win.html2canvas;
  });

  it('端到端·下载表格：table_to_book 读到 input 值（修复后不再是空列）', () => {
    let captured = null;
    const writeFile = vi.fn();
    win.XLSX = {
      utils: { table_to_book: vi.fn((t) => { captured = t; return {}; }) },
      writeFile
    };
    const table = doc.createElement('table');
    table.id = 'fakeTable2';
    table.innerHTML = '<tbody><tr><td>守护最帅猕猴桃酱</td><td><input type="number" value="20"></td></tr></tbody>';
    doc.body.appendChild(table);
    const btn = doc.createElement('button');
    btn.setAttribute('data-table', 'fakeTable2');
    btn.setAttribute('data-name', '每人应付国际费');
    aoi.tableExport(btn);
    expect(writeFile).toHaveBeenCalled();
    expect(captured.querySelector('td:nth-child(2)').textContent).toBe('20');
    table.remove();
    delete win.XLSX;
  });
});

describe('宣传图图片拉取（v3.32.1 修复）', () => {
  it('fetchImg 取 fetchImageBase64 返回对象的 .dataUrl（v3.32.0 误传整个对象致海报全图失败）', async () => {
    const origFetch = aoi.exportSummary.fetchImageBase64;
    const origLoad = aoi.poster.loadImage;
    try {
      const seen = [];
      aoi.exportSummary.fetchImageBase64 = (u) => { seen.push(u); return Promise.resolve({ dataUrl: 'data:image/jpeg;base64,QQ==', ext: 'jpeg' }); };
      aoi.poster.loadImage = (dataUrl) => Promise.resolve(dataUrl === 'data:image/jpeg;base64,QQ==' ? 'IMG' : null);
      await expect(aoi.poster.fetchImg('https://img.example/1.webp')).resolves.toBe('IMG');
      expect(seen).toEqual(['https://img.example/1.webp']);
      // 全通道失败（返回 null）→ 占位 null，不抛错
      aoi.exportSummary.fetchImageBase64 = () => Promise.resolve(null);
      await expect(aoi.poster.fetchImg('https://img.example/2.webp')).resolves.toBeNull();
      // 空链接短路
      await expect(aoi.poster.fetchImg('')).resolves.toBeNull();
    } finally {
      aoi.exportSummary.fetchImageBase64 = origFetch;
      aoi.poster.loadImage = origLoad;
    }
  });
});

describe('宣传图入口（orders 委托）', () => {
  it('展开区操作行带 data-act-poster 按钮且点击路由到 Aoi.poster.exportFor', async () => {
    aoi.poster.exportFor = vi.fn().mockResolvedValue(undefined);
    aoi.orders.toggleActivityExpand('AHS娃再贩');
    const btn = doc.querySelector('#activityTbody button[data-act-poster]');
    expect(btn).not.toBeNull();
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(aoi.poster.exportFor).toHaveBeenCalledWith('AHS娃再贩');
  });
});
