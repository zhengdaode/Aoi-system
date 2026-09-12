// F9 PCO 目录模块测试（v3.7.0 F9）：解析（文本/富文本）、词典翻译、类型匹配、草稿去重、汇率换算、模板导出结构
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

const CARDS_HTML = `<ul>
  <li class="product-tile"><a href="https://www.pokemoncenter-online.com/products/456789"><img src="https://img.example/456789.jpg" alt="ぬいぐるみ ピカチュウ">ぬいぐるみ ピカチュウ</a><div>3,960円（税込）</div><div>お一人様2個まで</div></li>
  <li class="product-tile"><a href="/products/456790"><img src="/img/456790.jpg" alt="マスコット ゾロア">マスコット ゾロア</a><div>1,980円</div><div>お一人様3個まで</div></li>
</ul>`;

const BOLD_HTML = `<td><span class="m-text-bold">ぬいぐるみ ピカチュウ</span>　3,960円<br>
<span class="m-text-bold">マスコット ゾロア</span>　1,980円</td>`;

const TEXT_INPUT = `発売：2026年9月10日発売予定
ぬいぐるみ ピカチュウ　3,960円
マスコット ゾロア　1,980円
※画像はイメージです`;

beforeEach(() => {
  aoi.state.data = {
    activities: ['测试活动'],
    typeMeta: { '毛绒玩偶': { route: '' }, '挂件': { route: '' } },
    orders: [], batches: [], activityMeta: {}, pcoItems: [],
    calc: { jpyRate: 0.048, jpyMarkup: 0.005 }
  };
  aoi.catalog.draft = [];
  aoi.catalog.matchers = null; // 强制重建（保持用例隔离）
  aoi.saveTeamData = async (d) => { aoi._saved = JSON.parse(JSON.stringify(d)); };
});

const PCO_CARDS_HTML = `<ul class="comltemlist product-grid">
<li class="product" data-pid="4521329439365"><div class="pho"><a href="https://www.pokemoncenter-online.com/4521329439365.html"><img src="https://www.pokemoncenter-online.com/a/img/item/4521329439365/M/x.jpg" alt="A4クリアファイル Pokémon Magic Hour Illusion!"></a></div><div class="txtBox"><p class="txt"><a href="https://www.pokemoncenter-online.com/4521329439365.html">A4クリアファイル Pokémon Magic Hour Illusion!</a></p><p class="price"><a href="https://www.pokemoncenter-online.com/4521329439365.html">385<small>円</small></a></p></div></li>
<li class="product" data-pid="4521329439310"><div class="pho"><a href="https://www.pokemoncenter-online.com/4521329439310.html"><img src="https://www.pokemoncenter-online.com/a/img/item/4521329439310/M/y.jpg" alt="ぬいぐるみ ピカチュウ"></a></div><div class="txtBox"><p class="txt"><a href="https://www.pokemoncenter-online.com/4521329439310.html">ぬいぐるみ ピカチュウ</a></p><p class="price"><a href="https://www.pokemoncenter-online.com/4521329439310.html">3,960<small>円</small></a><span>お一人様2個まで</span></p></div></li>
</ul>`;

describe('parseHtml：PCO 真实结构（li[data-pid]，2026-09-10 实测）', () => {
  it('策略A1：JAN.html 链接 / .txt 名称 / .price 连写价格 / 限购 / 图', () => {
    const items = aoi.catalog.parseHtml(PCO_CARDS_HTML);
    expect(items).toHaveLength(2);
    expect(items[0].jpName).toBe('A4クリアファイル Pokémon Magic Hour Illusion!');
    expect(items[0].priceJpy).toBe(385);
    expect(items[0].url).toBe('https://www.pokemoncenter-online.com/4521329439365.html');
    expect(items[0].image).toContain('/a/img/item/4521329439365/');
    expect(items[1].jpName).toBe('ぬいぐるみ ピカチュウ');
    expect(items[1].priceJpy).toBe(3960);
    expect(items[1].limit).toBe(2);
  });
});

describe('parseText：PCO 连写形态（名称与价格间无空格）', () => {
  it('名称直接衔接价格也能解析', () => {
    const items = aoi.catalog.parseText('ぬいぐるみ ピカチュウ3,960円');
    expect(items).toHaveLength(1);
    expect(items[0].jpName).toBe('ぬいぐるみ ピカチュウ');
    expect(items[0].priceJpy).toBe(3960);
  });
});

describe('parseText：逐行「名称　X,XXX円」', () => {
  it('解析名称与含税价，忽略无价格行', () => {
    const items = aoi.catalog.parseText(TEXT_INPUT);
    expect(items).toHaveLength(2);
    expect(items[0].jpName).toBe('ぬいぐるみ ピカチュウ');
    expect(items[0].priceJpy).toBe(3960);
    expect(items[1].jpName).toBe('マスコット ゾロア');
    expect(items[1].priceJpy).toBe(1980);
  });
  it('提取発売日', () => {
    const items = aoi.catalog.parseText(TEXT_INPUT);
    expect(items[0].saleDate).toBe('9月10日発売');
  });
  it('剥离行首项目符号', () => {
    const items = aoi.catalog.parseText('・ぬいぐるみ ピカチュウ　3,960円');
    expect(items).toHaveLength(1);
    expect(items[0].jpName).toBe('ぬいぐるみ ピカチュウ');
  });
});

describe('parseHtml：富文本粘贴', () => {
  it('策略A：商品卡（链接/价格/限购/图片）', () => {
    const items = aoi.catalog.parseHtml(CARDS_HTML);
    expect(items).toHaveLength(2);
    expect(items[0].jpName).toBe('ぬいぐるみ ピカチュウ');
    expect(items[0].priceJpy).toBe(3960);
    expect(items[0].limit).toBe(2);
    expect(items[0].image).toBe('https://img.example/456789.jpg');
    expect(items[0].url).toContain('/products/456789');
    expect(items[1].limit).toBe(3);
  });
  it('策略B：詳細表加粗名称 + 同行价格', () => {
    const items = aoi.catalog.parseHtml(BOLD_HTML);
    expect(items).toHaveLength(2);
    expect(items[0].jpName).toBe('ぬいぐるみ ピカチュウ');
    expect(items[1].priceJpy).toBe(1980);
  });
  it('策略C：整页无结构文本回落 parseText', () => {
    const items = aoi.catalog.parseHtml('<div>' + TEXT_INPUT.split('\n').join('<br>') + '</div>');
    expect(items).toHaveLength(2);
  });
});

describe('translateName：词典翻译（无 LLM）', () => {
  it('品类 + 英文系列名保留 + 官方种名', () => {
    const r = aoi.catalog.translateName('ぬいぐるみ Pokémon Magic Hour Illusion! ピカチュウ');
    expect(r.cn).toBe('毛绒玩偶 Pokémon Magic Hour Illusion! 皮卡丘');
    expect(r.type).toBe('毛绒玩偶');
    expect(r.unmatched).toHaveLength(0);
  });
  it('类型建议映射到已有 typeMeta（包含匹配）', () => {
    expect(aoi.catalog.matchTypeKey('毛绒玩偶')).toBe('毛绒玩偶');
    aoi.state.data.typeMeta = { '毛绒': { route: '' } };
    expect(aoi.catalog.matchTypeKey('毛绒玩偶')).toBe('毛绒');
  });
  it('未识别片段保留原文并收集', () => {
    const r = aoi.catalog.translateName('もっちりパンケーキ風ポーチ');
    expect(r.cn).toBe('もっちり松饼風收纳包');
    expect(r.unmatched).toContain('もっちり');
    expect(r.unmatched).toContain('風');
  });
  it('地区形态前缀（アローラ + 种名）', () => {
    const r = aoi.catalog.translateName('マスコット アローラライチュウ');
    expect(r.cn).toBe('挂件 阿罗拉雷丘');
  });
  it('短语整段替换（Pokémon accessory）', () => {
    const r = aoi.catalog.translateName('Pokémon accessory リング56 クロバット');
    expect(r.cn).toContain('宝可梦饰品');
    expect(r.cn).toContain('叉字蝠');
  });
});

describe('草稿：去重合并 + 汇率换算', () => {
  it('同名商品二次导入合并不重复，缺字段回填', () => {
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960 }]);
    const r = aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: null, limit: 2 }]);
    expect(r).toEqual({ added: 0, updated: 1 });
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0].priceJpy).toBe(3960);
    expect(aoi.catalog.draft[0].limit).toBe(2);
  });
  it('日元价不再自动换算人民币（v3.15.0 S4：价格策略移交活动管理）', () => {
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960 }]);
    expect(aoi.catalog.draft[0].priceCny).toBeUndefined();
    expect(aoi.catalog.priceCnyOf).toBeUndefined();
  });
  it('推入活动商品主档走 registerProduct 同构字段（人民币价仅人工填写时才推）', async () => {
    const pushed = [];
    const orig = aoi.orders.registerProduct;
    aoi.orders.registerProduct = async (activity, input) => { pushed.push({ activity, input }); return { id: 'x' }; };
    try {
      aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960, limit: 2, url: 'https://x/p/1', image: 'https://img.example/1.jpg' }]);
      doc.getElementById('catPushActivity').innerHTML = '<option value="测试活动" selected>测试活动</option>';
      await aoi.catalog.pushSelected();
      expect(pushed).toHaveLength(1);
      expect(pushed[0].activity).toBe('测试活动');
      expect(pushed[0].input).toMatchObject({
        type: '毛绒玩偶', model: '毛绒玩偶 皮卡丘', currency: 'jpy',
        priceOrig: 3960, limit: 2,
        refUrl: 'https://x/p/1', refImage: 'https://img.example/1.jpg'
      });
      expect(pushed[0].input.price).toBeUndefined(); // 不再自动生成人民币价
      // 人工在校对表里填写了人民币价（经 collectEdits 读回）→ 才随主档推入
      doc.querySelector('#catDraftTbody tr[data-id] .cat-price').value = '210';
      pushed.length = 0;
      doc.getElementById('catPushActivity').innerHTML = '<option value="测试活动" selected>测试活动</option>';
      await aoi.catalog.pushSelected();
      expect(pushed[0].input.price).toBe(210);
    } finally {
      aoi.orders.registerProduct = orig;
    }
  });
});

describe('导出到小程序（v3.15.0 S6：迁入活动管理，数据源=活动商品主档）', () => {
  function stubXlsx() {
    const captured = {};
    win.XLSX = {
      utils: {
        aoa_to_sheet: (aoa) => ({ aoa }),
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; captured.sheetName = name; }
      },
      writeFile: (wb, fname) => { captured.fname = fname; captured.aoa = wb.Sheets[wb.SheetNames[0]].aoa; }
    };
    return captured;
  }
  function seedProducts(products) {
    aoi.state.data.activityMeta = { '测试活动': { products, buyers: [], trackings: [] } };
    aoi.state.data.activities = ['测试活动'];
  }

  it('结构：说明 6 行 + 表头第 7 行 + 数据自第 8 行；价格取主档人民币价；文件名带活动名', async () => {
    const captured = stubXlsx();
    seedProducts([
      { id: 'p1', type: '毛绒玩偶', model: '皮卡丘', price: 210 },
      { id: 'p2', type: '挂件', model: '索罗亚', price: 105 }
    ]);
    await aoi.orders.exportMiniProgram('测试活动');
    const aoa = captured.aoa;
    expect(captured.sheetName).toBe('Sheet1');
    expect(captured.fname).toBe('测试活动-小程序商品导入表.xlsx');
    expect(aoa).toHaveLength(6 + 1 + 2);
    expect(aoa[0][0]).toContain('【使用说明】');
    expect(aoa[5][0]).toContain('【是否冻结】');
    expect(aoa[6]).toEqual(['谷子分类（选填）', '谷子名称（必填）', '价格（必填）', '库存（选填）', '冻结（选填：是或否）', '采购状态（选填）']);
    expect(aoa[7]).toEqual(['毛绒玩偶', '皮卡丘', 210, '', '', '备货中']);
    delete win.XLSX;
  });
  it('缺价商品：确认后按计算器汇率临时换算写入导出表，不改商品主档', async () => {
    const captured = stubXlsx();
    aoi.state.data.calc = { jpyRate: 0.048, jpyMarkup: 0.005 };
    aoi.confirm = async () => true;
    seedProducts([{ id: 'p1', type: '挂件', model: '索罗亚', priceOrig: 1000, currency: 'jpy' }]);
    await aoi.orders.exportMiniProgram('测试活动');
    expect(captured.aoa[7][2]).toBe(53); // 1000 × 0.053
    expect(aoi.state.data.activityMeta['测试活动'].products[0].price).toBeUndefined();
    delete win.XLSX;
  });
  it('缺价商品：取消确认则中止导出', async () => {
    let written = false;
    win.XLSX = { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => { written = true; } };
    aoi.confirm = async () => false;
    seedProducts([{ id: 'p1', type: '挂件', model: '索罗亚', priceOrig: 1000, currency: 'jpy' }]);
    await aoi.orders.exportMiniProgram('测试活动');
    expect(written).toBe(false);
    delete win.XLSX;
  });
  it('缺 XLSX 组件时报错不抛异常', async () => {
    delete win.XLSX;
    seedProducts([]);
    await expect(aoi.orders.exportMiniProgram('测试活动')).resolves.toBeUndefined();
  });
});

describe('v3.8.0 修复：推入新活动 / 重复回填 / 删活动级联删订单', () => {
  it('pushSelected 支持直接新建活动（写入 d.activities）', async () => {
    const pushed = [];
    const orig = aoi.orders.registerProduct;
    aoi.orders.registerProduct = async (activity, input) => { pushed.push(activity); return { id: 'x' }; };
    try {
      aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960 }]);
      doc.getElementById('catNewActivity').value = '全新活动';
      await aoi.catalog.pushSelected();
    } finally {
      aoi.orders.registerProduct = orig;
    }
    expect(aoi.state.data.activities).toContain('全新活动');
    expect(pushed[0]).toBe('全新活动');
    expect(doc.getElementById('catNewActivity').value).toBe('');
  });
  it('registerProduct 重复型号：补充缺失字段而非跳过', async () => {
    aoi.state.data.activityMeta['测试活动'] = { products: [{ id: 'e1', type: '毛绒玩偶', model: '毛绒玩偶 皮卡丘', refImage: '', refUrl: '' }], buyers: [], trackings: [] };
    const r = await aoi.orders.registerProduct('测试活动', {
      type: '毛绒玩偶', model: '毛绒玩偶 皮卡丘', refUrl: 'https://x/p/1',
      price: 210, priceOrig: 3960, currency: 'jpy', limit: 2
    });
    expect(r).toBeTruthy();
    const list = aoi.state.data.activityMeta['测试活动'].products;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ refUrl: 'https://x/p/1', price: 210, priceOrig: 3960, currency: 'jpy', limit: 2 });
  });
  it('removeActivity：级联删除该活动的订单/商品主档/限购计划（可撤销）', async () => {
    aoi.state.data = {
      activities: ['万圣节', '其他活动'],
      orders: [
        { id: 'o1', activity: '万圣节', buyer: 'A', type: '毛绒', model: 'M1', count: 1 },
        { id: 'o2', activity: '万圣节', buyer: 'B', type: '徽章', model: 'M2', count: 2 },
        { id: 'o3', activity: '其他活动', buyer: 'A', type: '毛绒', model: 'M1', count: 1 },
        { id: 'o4', activity: '其他活动', buyer: 'B', type: '徽章', model: 'M2', count: 1 }
      ],
      activityMeta: {
        '万圣节': { products: [{ id: 'p1', type: '毛绒', model: 'M1' }], buyers: [], trackings: [] },
        '其他活动': { products: [], buyers: [], trackings: [] }
      },
      limitPlans: { '万圣节': { items: [] } },
      typeMeta: {}, batches: [], pcoItems: [], calc: { jpyRate: 0.048, jpyMarkup: 0.005 }
    };
    aoi.confirm = async () => true;
    aoi.orders.renderActivities = () => {}; aoi.orders.refillDatalists = () => {};
    aoi.orders.refillActivities = () => {}; aoi.orders.render = () => {};
    await aoi.orders.removeActivity('万圣节');
    expect(aoi.state.data.activities).toEqual(['其他活动']);
    expect(aoi.state.data.orders.map(o => o.id)).toEqual(['o3', 'o4']);
    expect(aoi.state.data.activityMeta['万圣节']).toBeUndefined();
    expect(aoi.state.data.limitPlans['万圣节']).toBeUndefined();
    expect(aoi.undo.snapshot).toBeTruthy();
  });
});

describe('v3.15.0 S7：已存目录下线（pcoItems 停写）', () => {
  it('save/renderCatalogList/toggleWatch/removeSaved/grab/saveDispatch/exportTemplate 不复存在', () => {
    ['save', 'renderCatalogList', 'toggleWatch', 'removeSaved', 'grab', 'saveDispatch', 'exportTemplate', 'TEMPLATE_NOTES']
      .forEach(function (k) { expect(aoi.catalog[k]).toBeUndefined(); });
  });
});

describe('v3.9.4 ChatGPT 翻译工作流：parseAi + 草稿直入中文译名', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
    aoi.catalog.draft = [];
    aoi.state.data = { activities: [], orders: [], typeMeta: { '毛绒玩偶': {}, '亚克力立牌': {} }, pcoItems: [], calc: { jpyRate: 0.048, jpyMarkup: 0.005 } };
  });

  const AI_TABLE = [
    '好的，以下是整理结果：',
    '',
    '| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| ピカチュウ ぬいぐるみ | 皮卡丘 毛绒玩偶 | 毛绒玩偶 | 4,180 | 3 | 11月8日発売 |',
    '| **リザードン アクリルスタンド** | 喷火龙 亚克力立牌 | 亚克力立牌 | 1,650 |  |  |'
  ].join('\n');

  it('parseAi：Markdown 表格按表头映射列（千分位/加粗/空单元格/代码围栏）', () => {
    const items = aoi.catalog.parseAi('```markdown\n' + AI_TABLE + '\n```');
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      jpName: 'ピカチュウ ぬいぐるみ', name: '皮卡丘 毛绒玩偶', type: '毛绒玩偶',
      priceJpy: 4180, limit: 3, saleDate: '11月8日発売', image: '', url: ''
    });
    expect(items[1]).toEqual({
      jpName: 'リザードン アクリルスタンド', name: '喷火龙 亚克力立牌', type: '亚克力立牌',
      priceJpy: 1650, limit: '', saleDate: '', image: '', url: ''
    });
  });

  it('parseAi：TSV 无表头按固定列序兜底；列名被改写时按关键字识别', () => {
    const tsv = 'ピカチュウ バッジ\t皮卡丘 徽章\t徽章\t880\t5';
    expect(aoi.catalog.parseAi(tsv)).toEqual([
      { jpName: 'ピカチュウ バッジ', name: '皮卡丘 徽章', type: '徽章', priceJpy: 880, limit: 5, saleDate: '', image: '', url: '' }
    ]);
    const renamed = '| 原文 | 译名 | 品类 | 价格 | | |\n| --- | --- | --- | --- | --- | --- |\n| イーブイ ぬいぐるみ | 伊布 毛绒玩偶 | 毛绒玩偶 | 3960 | 2 |  |';
    const items = aoi.catalog.parseAi(renamed);
    expect(items[0].jpName).toBe('イーブイ ぬいぐるみ');
    expect(items[0].name).toBe('伊布 毛绒玩偶');
    expect(items[0].priceJpy).toBe(3960);
  });

  it('parseAi：非表格文本返回 null（调用方回落原解析）', () => {
    expect(aoi.catalog.parseAi('ぬいぐるみ ピカチュウ 3,960円\nイーブイ マスコット 1,320円')).toBeNull();
    expect(aoi.catalog.parseAi('')).toBeNull();
  });

  it('addToDraft：AI 中文译名/类型直入草稿，不依赖词典、无未识别高亮；类型匹配 typeMeta', () => {
    aoi.catalog.addToDraft([{ jpName: 'ピカチュウ ぬいぐるみ', name: '皮卡丘 毛绒玩偶', type: '毛绒玩偶', priceJpy: 4180, limit: 3 }]);
    expect(aoi.catalog.draft[0]).toMatchObject({ name: '皮卡丘 毛绒玩偶', type: '毛绒玩偶', priceJpy: 4180, limit: 3, unmatched: [] });
    // 类型词表外 → 原样保留（校对工作台可改），未给中文名时仍走词典
    aoi.catalog.addToDraft([{ jpName: 'リザードン フィギュア', name: '喷火龙 手办', type: '手办（新）' }]);
    expect(aoi.catalog.draft[1].type).toBe('手办（新）');
    // 无中文名 → 词典翻译兜底（物种 品类 语序），未收录片段进 unmatched
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウ ぬいぐるみ', priceJpy: 3960 }]);
    expect(aoi.catalog.draft[2].name).toBe('メガシンカ 皮卡丘 毛绒玩偶');
    expect(aoi.catalog.draft[2].unmatched).toContain('メガシンカ');
  });

  it('importPaste：AI 表格优先解析并写入草稿（toast 注明 AI 表格）', () => {
    doc.getElementById('catPaste').value = AI_TABLE;
    aoi.catalog.importPaste();
    expect(aoi.catalog.draft).toHaveLength(2);
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('AI 翻译表格'), 'success');
    expect(doc.getElementById('catPaste').value).toBe('');
  });

  it('copyPrompt：clipboard 可用时写入 AI_PROMPT 全文', async () => {
    const written = [];
    const orig = win.navigator.clipboard;
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: (t) => { written.push(t); return Promise.resolve(); } }, configurable: true });
    try {
      aoi.catalog.copyPrompt();
      await new Promise((r) => setTimeout(r, 0));
      expect(written).toHaveLength(1);
      expect(written[0]).toBe(aoi.catalog.AI_PROMPT);
      expect(written[0]).toContain('| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 |');
      expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('提示词已复制'), 'success');
    } finally {
      Object.defineProperty(win.navigator, 'clipboard', { value: orig, configurable: true });
    }
  });
});

describe('v3.9.5 两步导入：页面粘贴带图 + AI 表格按日文原名合并，图片不丢', () => {
  beforeEach(() => {
    aoi.toast = vi.fn();
    aoi.catalog.draft = [];
    aoi.state.data = { activities: [], orders: [], typeMeta: { '毛绒玩偶': {}, '亚克力立牌': {} }, pcoItems: [], calc: { jpyRate: 0.048, jpyMarkup: 0.005 } };
  });

  it('页面先、AI 后：合并为一行——图片/链接/价格/限购保留，AI 译名覆盖词典草稿并清掉未识别高亮', () => {
    // ① 页面整页复制粘贴（富文本解析产物：带图/链接/价格/限购，名称走词典、含未识别片段）
    aoi.catalog.addToDraft([{ jpName: 'メガシンカ ピカチュウ ぬいぐるみ', priceJpy: 4180, limit: 3, image: 'https://img.example/p1.jpg', url: 'https://x/p/1' }]);
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0].unmatched.length).toBeGreaterThan(0);
    expect(aoi.catalog.draft[0].name).toContain('メガシンカ'); // 词典兜底保留原文
    // ② ChatGPT 表格粘贴 → 按「日文原名」对齐合并
    const ai = aoi.catalog.parseAi(
      '| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 |\n'
      + '| --- | --- | --- | --- | --- | --- |\n'
      + '| メガシンカ ピカチュウ ぬいぐるみ | 皮卡丘 毛绒玩偶 | 毛绒玩偶 | 4,180 | 3 | 11月8日発売 |'
    );
    const r = aoi.catalog.addToDraft(ai);
    expect(r).toEqual({ added: 0, updated: 1 });
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0]).toMatchObject({
      jpName: 'メガシンカ ピカチュウ ぬいぐるみ',
      name: '皮卡丘 毛绒玩偶',          // AI 译名覆盖词典草稿
      type: '毛绒玩偶',
      image: 'https://img.example/p1.jpg', // 图片/链接保留
      url: 'https://x/p/1',
      priceJpy: 4180, limit: 3,        // 价格/限购以页面数据为准，不被空值冲掉
      unmatched: []                    // 名称已 AI 化，未识别高亮清除
    });
  });

  it('AI 先、页面后：按日文原名对齐不产生重复行，图片/链接/限购回填，AI 译名不被词典冲掉', () => {
    aoi.catalog.addToDraft([{ jpName: 'リザードン アクリルスタンド', name: '喷火龙 亚克力立牌', type: '亚克力立牌', priceJpy: 1650 }]);
    aoi.catalog.addToDraft([{ jpName: 'リザードン アクリルスタンド', priceJpy: null, limit: 2, image: 'https://img.example/p2.jpg', url: 'https://x/p/2' }]);
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0]).toMatchObject({
      name: '喷火龙 亚克力立牌', type: '亚克力立牌',
      image: 'https://img.example/p2.jpg', url: 'https://x/p/2', limit: 2
    });
  });

  it('parseAiHtml：ChatGPT 页面渲染表格（text/html <table>）还原为管道行解析；无 AI 表头返回 null', () => {
    const html = '<table><tr><th>日文原名</th><th>中文名</th><th>类型</th><th>日元价</th><th>限购</th><th>発売日</th></tr>'
      + '<tr><td>イーブイ ぬいぐるみ</td><td>伊布 毛绒玩偶</td><td>毛绒玩偶</td><td>3,960</td><td>2</td><td></td></tr></table>';
    const items = aoi.catalog.parseAiHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ jpName: 'イーブイ ぬいぐるみ', name: '伊布 毛绒玩偶', type: '毛绒玩偶', priceJpy: 3960, limit: 2 });
    expect(aoi.catalog.parseAiHtml('<div>没有表格</div>')).toBeNull();
  });

  it('importPaste：ChatGPT 渲染表格以富文本（<table>）粘进文本框也能按 AI 表格解析合并', () => {
    aoi.catalog.addToDraft([{ jpName: 'イーブイ ぬいぐるみ', priceJpy: 3960, image: 'https://img.example/e1.jpg', url: 'https://x/p/3' }]);
    doc.getElementById('catPaste').value = '<table><tr><th>日文原名</th><th>中文名</th><th>类型</th><th>日元价</th></tr>'
      + '<tr><td>イーブイ ぬいぐるみ</td><td>伊布 毛绒玩偶</td><td>毛绒玩偶</td><td>3,960</td></tr></table>';
    aoi.catalog.importPaste();
    expect(aoi.catalog.draft).toHaveLength(1);
    expect(aoi.catalog.draft[0]).toMatchObject({ name: '伊布 毛绒玩偶', image: 'https://img.example/e1.jpg' });
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('AI 翻译表格'), 'success');
  });

  it('提示词（v3.15.0 S9）：日文原名是对齐键，商品链接/图片链接两列可输出且禁止编造', () => {
    expect(aoi.catalog.AI_PROMPT).toContain('按「日文原名」逐行合并');
    expect(aoi.catalog.AI_PROMPT).toContain('| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 | 商品链接 | 图片链接 |');
    expect(aoi.catalog.AI_PROMPT).toContain('一字不差');
    expect(aoi.catalog.AI_PROMPT).toContain('绝不允许编造');
  });
});
