// F9 PCO 目录模块测试（v3.7.0 F9）：解析（文本/富文本）、词典翻译、类型匹配、草稿去重、汇率换算、模板导出结构
import { describe, it, expect, beforeEach } from 'vitest';
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
  it('日元价按计算器汇率换算人民币（roundHalf）', () => {
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960 }]);
    expect(aoi.catalog.priceCnyOf(aoi.catalog.draft[0])).toBe(210); // 3960 × 0.053 = 209.88 → 210
  });
  it('推入活动商品主档走 registerProduct 同构字段', async () => {
    const pushed = [];
    aoi.orders.registerProduct = async (activity, input) => { pushed.push({ activity, input }); return { id: 'x' }; };
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960, limit: 2, url: 'https://x/p/1', image: 'https://img.example/1.jpg' }]);
    doc.getElementById('catPushActivity').innerHTML = '<option value="测试活动" selected>测试活动</option>';
    await aoi.catalog.pushSelected();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].activity).toBe('测试活动');
    expect(pushed[0].input).toMatchObject({
      type: '毛绒玩偶', model: '毛绒玩偶 皮卡丘', currency: 'jpy',
      price: 210, priceOrig: 3960, limit: 2,
      refUrl: 'https://x/p/1', refImage: 'https://img.example/1.jpg'
    });
  });
});

describe('小程序模板导出', () => {
  it('结构：说明 6 行 + 表头第 7 行 + 数据自第 8 行；Sheet 名 Sheet1', () => {
    const captured = {};
    win.XLSX = {
      utils: {
        aoa_to_sheet: (aoa) => ({ aoa }),
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; captured.sheetName = name; }
      },
      writeFile: (wb, fname) => { captured.fname = fname; captured.aoa = wb.Sheets[wb.SheetNames[0]].aoa; }
    };
    aoi.catalog.addToDraft([
      { jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960 },
      { jpName: 'マスコット ゾロア', priceJpy: 1980 }
    ]);
    const btn = doc.createElement('button');
    btn.setAttribute('data-name', '小程序商品导入表');
    aoi.catalog.exportTemplate(btn);
    const aoa = captured.aoa;
    expect(captured.sheetName).toBe('Sheet1');
    expect(captured.fname).toBe('小程序商品导入表.xlsx');
    expect(aoa).toHaveLength(6 + 1 + 2);
    expect(aoa[0][0]).toContain('【使用说明】');
    expect(aoa[1][0]).toContain('【注意事项】');
    expect(aoa[5][0]).toContain('【是否冻结】');
    expect(aoa[6]).toEqual(['谷子分类（选填）', '谷子名称（必填）', '价格（必填）', '库存（选填）', '冻结（选填：是或否）', '采购状态（选填）']);
    expect(aoa[7]).toEqual(['毛绒玩偶', '毛绒玩偶 皮卡丘', 210, '', '', '备货中']);
    expect(aoa[8][1]).toBe('挂件 索罗亚');
    delete win.XLSX;
  });
  it('缺 XLSX 组件时报错不抛异常', () => {
    delete win.XLSX;
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960 }]);
    expect(() => aoi.catalog.exportTemplate(doc.createElement('button'))).not.toThrow();
  });
});

describe('保存到目录 + 渲染', () => {
  it('save 并入 d.pcoItems（同构结构），渲染目录表', async () => {
    aoi.catalog.addToDraft([{ jpName: 'ぬいぐるみ ピカチュウ', priceJpy: 3960, url: 'https://x/p/1' }]);
    await aoi.catalog.save();
    expect(aoi.state.data.pcoItems).toHaveLength(1);
    expect(aoi.state.data.pcoItems[0]).toMatchObject({ jpName: 'ぬいぐるみ ピカチュウ', name: '毛绒玩偶 皮卡丘', type: '毛绒玩偶', priceJpy: 3960, watched: true });
    aoi.catalog.renderCatalogList();
    const tbody = doc.getElementById('catTableTbody');
    expect(tbody.querySelectorAll('tr')).toHaveLength(1);
  });
  it('抓取通道未配置时引导粘贴导入（不发起请求）', async () => {
    doc.getElementById('catGrabUrl').value = 'https://www.pokemoncenter-online.com/search/?q=test';
    let fetched = false;
    win.fetch = async () => { fetched = true; return { ok: true }; };
    await aoi.catalog.grab();
    expect(fetched).toBe(false);
  });
});
