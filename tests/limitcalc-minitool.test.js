// 谷圈限购计算器（小红书小工具，minitools/limitcalc）三合一测试：
//   1) core.js 算法用例 —— 从 tests/limits.test.js 移植，钉死与主系统 Aoi.limits.planCore 同源
//   2) 小工具容器合规静态扫描 —— zip-artifact-spec / device-capabilities / js-compatibility 关键红线
//   3) jsdom 冒烟 —— index.html + core.js + app.js 真实装配：示例数据 → 计算 → 结果渲染
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const TOOL = resolve(__dirname, '../minitools/limitcalc');
const SRC = resolve(TOOL, 'src');
const htmlSrc = readFileSync(resolve(SRC, 'index.html'), 'utf8');
const cssSrc = readFileSync(resolve(SRC, 'assets/style.css'), 'utf8');
const coreSrc = readFileSync(resolve(SRC, 'assets/core.js'), 'utf8');
const appSrc = readFileSync(resolve(SRC, 'assets/app.js'), 'utf8');

// —— jsdom 装配（容器注入的 window.xhs 不存在 → 存储不可用路径）——
// JSDOM 构造时 readyState 为 loading：先等 DOMContentLoaded（与真实 defer 脚本执行时机一致）再 eval，
// boot 即同步执行，事件绑定完成后再跑用例
const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', url: 'https://minitool.local/' });
const win = dom.window;
const doc = win.document;
let lastConfirmMsg = '';
await new Promise((r) => {
  if (doc.readyState !== 'loading') r();
  else win.addEventListener('DOMContentLoaded', r);
});
win.eval(coreSrc);
win.eval(appSrc);
const CORE = win.LimitCalcCore;

// ─────────────────────────────────────────────────────────────
describe('LimitCalcCore.planCore 算法移植（与 Aoi.limits.planCore 同源）', () => {
  // 商品：A 单价 10 剩 5；B 单价 5 剩 10（分配按单价降序逐件给最低额账号）
  const products = [
    { type: '徽章', model: 'A', qty: 5, price: 10 },
    { type: '色纸', model: 'B', qty: 10, price: 5 }
  ];

  it('阶段一全量分配：全部数量分完，均衡后全员包邮（旧逻辑会剩 B×2）', () => {
    const r = CORE.planCore(products, { freeShip: 30, accounts: 3 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts).toHaveLength(3);
    expect(r.accounts.map((a) => a.total)).toEqual([35, 35, 30]);
    r.accounts.forEach((a) => expect(a.reached).toBe(true));
  });

  it('限购数约束：分配与调剂全程受单账号限购约束', () => {
    const withLimit = [{ type: '徽章', model: 'A', qty: 5, price: 10, limit: 2 }, products[1]];
    const r = CORE.planCore(withLimit, { freeShip: 30, accounts: 3 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([35, 35, 30]);
    expect(r.accounts[0].items[0]).toEqual({ type: '徽章', model: 'A', qty: 2, amount: 20 });
  });

  it('每账号最大种类数 maxTypes=1：装不下的进 remaining，调剂牺牲账号集中凑邮', () => {
    const r = CORE.planCore(products, { freeShip: 30, accounts: 3, maxTypes: 1 });
    expect(r.remaining).toEqual([{ type: '色纸', model: 'B', qty: 10 }]);
    r.accounts.forEach((a) => expect(a.items).toHaveLength(1));
    expect(r.accounts.map((a) => a.total)).toEqual([30, 20]);
  });

  it('阶段2a 等价交换：普通挪动无解时 A↔B 净额互换让双账号同时达标', () => {
    const mixed = [{ type: '徽章', model: 'A', qty: 2, price: 10 }, { type: '色纸', model: 'B', qty: 3, price: 7 }];
    const r = CORE.planCore(mixed, { freeShip: 20, accounts: 2 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([21, 20]);
    expect(r.accounts.every((a) => a.reached)).toBe(true);
  });

  it('阶段2b 货值不足：牺牲低额账号把最接近包邮线的顶过线', () => {
    const scarce = [{ type: '徽章', model: 'A', qty: 3, price: 10 }, { type: '色纸', model: 'B', qty: 1, price: 5 }];
    const r = CORE.planCore(scarce, { freeShip: 25, accounts: 2 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([25, 10]);
    expect(r.accounts.filter((a) => a.reached)).toHaveLength(1);
  });

  it('限购卡死调剂：limit=1 时无法集中凑邮，如实输出未达标', () => {
    const r = CORE.planCore([{ type: '徽章', model: 'A', qty: 2, price: 10, limit: 1 }], { freeShip: 20, accounts: 3 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts.map((a) => a.total)).toEqual([10, 10]);
    expect(r.accounts.every((a) => !a.reached)).toBe(true);
  });

  it('包邮金额为 0：只做全量分配，不做包邮调剂', () => {
    const r = CORE.planCore(products, { freeShip: 0, accounts: 1 });
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].total).toBe(100);
    expect(r.accounts[0].reached).toBe(true);   // free<=0 恒视为达标
  });

  it('单账号吃下全部货值', () => {
    const rich = [{ type: '吧唧', model: 'X', qty: 30, price: 12 }];
    const r = CORE.planCore(rich, { freeShip: 100, accounts: 1 });
    expect(r.remaining).toEqual([]);
    expect(r.accounts[0].total).toBe(360);
    expect(r.accounts[0].reached).toBe(true);
  });

  it('roundHalf 0.5 圆整与 toRmb 汇率换算（与 Aoi.calc 同口径移植）', () => {
    expect(CORE.roundHalf(10.3)).toBe(10);
    expect(CORE.roundHalf(10.4)).toBe(10.5);
    expect(CORE.roundHalf(10.6)).toBe(10.5);
    expect(CORE.roundHalf(10.7)).toBe(11);
    const rates = { jpy: { rate: 0.048, markup: 0.005 }, krw: { rate: 0.0052, markup: 0.0001 } };
    expect(CORE.toRmb(100, 'cny', rates)).toBe(100);       // 人民币原样
    expect(CORE.toRmb(500, 'jpy', rates)).toBe(26.5);      // 500 × 0.053 = 26.5
    expect(CORE.toRmb(100, 'jpy', rates)).toBe(5);         // 5.3 → 0.5 圆整 → 5
    expect(CORE.toRmb(1000, 'krw', rates)).toBe(5);        // 5.3 → 5
    expect(CORE.toRmb(800, 'jpy', rates)).toBe(42.5);      // 42.4 → 42.5
  });

  it('core.js 带浏览器 + CommonJS 双通道导出', () => {
    expect(typeof win.LimitCalcCore.planCore).toBe('function');
    expect(coreSrc).toContain('module.exports');
  });
});

// ─────────────────────────────────────────────────────────────
describe('小工具容器合规（zip-artifact-spec / device-capabilities / js-compatibility）', () => {
  // 扫描前剥注释：注释里提及被禁 API 的说明文字不算真实调用
  const jsSrc = (coreSrc + '\n' + appSrc)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, '');
  const cssCode = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');

  it('index.html：viewport 含 viewport-fit=cover；无 type="module"、<base>、<iframe>、<form>', () => {
    expect(htmlSrc).toContain('viewport-fit=cover');
    expect(htmlSrc).not.toMatch(/type\s*=\s*["']module["']/);
    expect(htmlSrc).not.toMatch(/<base\b/i);
    expect(htmlSrc).not.toMatch(/<iframe\b/i);
    expect(htmlSrc).not.toMatch(/<form\b/i);
    expect(htmlSrc).not.toMatch(/<object\b/i);
  });

  it('index.html：脚本全部外置经典脚本，无内联 <script>、无行内 on* 事件', () => {
    const inlineScripts = htmlSrc.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
    expect(inlineScripts).toEqual([]);
    expect(htmlSrc).toMatch(/<script defer src="\.\/assets\/core\.js"><\/script>/);
    expect(htmlSrc).toMatch(/<script defer src="\.\/assets\/app\.js"><\/script>/);
    // 行内事件处理器（on*=）零出现
    expect(htmlSrc).not.toMatch(/\son[a-z]+\s*=\s*["']/);
  });

  it('index.html：零外部 http(s) 资源引用；引用的本地资源都存在', () => {
    expect(htmlSrc).not.toMatch(/https?:\/\//);
    const refs = [...htmlSrc.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    refs.forEach((ref) => {
      expect(existsSync(resolve(SRC, ref.replace(/^\.\//, '')))).toBe(true);
    });
  });

  it('JS：零被禁能力调用（联网/剪贴板/存储回退/Worker/eval/弹窗跳转）', () => {
    const banned = [
      /\bfetch\s*\(/, /XMLHttpRequest/, /new\s+WebSocket\s*\(/, /new\s+EventSource\s*\(/,
      /navigator\.clipboard/, /document\.execCommand\s*\(/,
      /localStorage/, /sessionStorage/, /indexedDB/,
      /new\s+(Shared)?Worker\s*\(/, /navigator\.serviceWorker/,
      /navigator\.geolocation/, /navigator\.bluetooth|navigator\.usb|navigator\.hid|navigator\.serial/,
      /\beval\s*\(/, /new\s+Function\s*\(/, /WebAssembly\./,
      /window\.open\s*\(/, /window\.prompt\s*\(/,
      /location\.(href|assign)/, /target\s*=\s*["']_blank/,
      /navigator\.storage\.persist/, /<iframe/i
    ];
    banned.forEach((re) => {
      expect(jsSrc).not.toMatch(re);
    });
  });

  it('JS：ES2017 语法基线（无可选链/空值合并/对象展开/无参 catch/顶层 await）', () => {
    expect(jsSrc).not.toMatch(/\?\./);            // 可选链（ES2020）
    expect(jsSrc).not.toMatch(/\?\?/);            // 空值合并（ES2020）
    expect(jsSrc).not.toMatch(/\{\s*\.\.\./);     // 对象展开（ES2018）
    expect(jsSrc).not.toMatch(/catch\s*\{/);      // 无参 catch（ES2019）
    expect(jsSrc).not.toMatch(/for\s+await/);     // 异步迭代（ES2018）
    expect(jsSrc).not.toMatch(/^\s*(import|export)\s/m); // ESM 语法（容器要求经典脚本）
    expect(appSrc).not.toMatch(/async\s+/);       // 本工具逻辑全同步，保持最简
  });

  it('CSS：Chrome 61 基线（无 Flex gap/aspect-ratio/clamp/:has/dvh/backdrop-filter）', () => {
    expect(cssCode).not.toMatch(/(^|[^-])gap\s*:/);
    expect(cssCode).not.toMatch(/aspect-ratio/);
    expect(cssCode).not.toMatch(/(clamp|min|max)\s*\(/);
    expect(cssCode).not.toMatch(/:has\s*\(/);
    expect(cssCode).not.toMatch(/\bdvh\b|\bsvh\b|\blvh\b/);
    expect(cssCode).not.toMatch(/backdrop-filter/);
    expect(cssCode).not.toMatch(/@container/);
    // 安全区必须用 var(--safe-area-inset-*, env(...)) 组合而非裸 env
    expect(cssCode).toMatch(/var\(--safe-area-inset-bottom,\s*env\(safe-area-inset-bottom/);
  });

  it('预览反馈修订已落实：示例功能与首屏说明占位文案全部移除', () => {
    expect(htmlSrc).not.toContain('填入示例');
    expect(htmlSrc).not.toContain('按限购把排单数量分给多个账号');
    expect(htmlSrc).not.toContain('如：8.23');
    expect(htmlSrc).not.toContain('如 吧唧');
    expect(htmlSrc).not.toContain('hero-sub');
    expect(appSrc).not.toMatch(/fillExample|EXAMPLE/);
    expect(cssSrc).not.toContain('hero-sub');
  });
});

// ─────────────────────────────────────────────────────────────
describe('jsdom 冒烟：手动填写 → 计算 → 结果渲染', () => {
  it('手动填写商品与设置后计算渲染结果（算法用例同源数据：35/35/30 全员包邮）', () => {
    // 两行商品：徽章×5 ¥10、色纸×10 ¥5，包邮 30、账号 3
    const row0 = doc.querySelector('#productList .prow');
    row0.querySelector('.p-name').value = '徽章';
    row0.querySelector('.p-qty').value = '5';
    row0.querySelector('.p-price').value = '10';
    doc.getElementById('btnAdd').click();
    const row1 = doc.querySelector('#productList .prow:last-child');
    row1.querySelector('.p-name').value = '色纸';
    row1.querySelector('.p-qty').value = '10';
    row1.querySelector('.p-price').value = '5';
    doc.getElementById('inFree').value = '30';
    doc.getElementById('inAccounts').value = '3';
    doc.getElementById('btnCompute').click();
    const box = doc.getElementById('resultBox');
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain('账号 1');
    expect(box.textContent).toContain('已达包邮');
    expect(doc.getElementById('resultSummary').textContent).toContain('3/3 达标包邮');
    // 3 个账号卡 + 无剩余未分配
    expect(doc.querySelectorAll('#resultCards .acard')).toHaveLength(3);
    expect(doc.getElementById('resultRemain').hidden).toBe(true);
    // 存储不可用（无 window.xhs）→ 保存状态给出说明
    expect(doc.getElementById('saveStatus').textContent).toContain('不支持本地保存');
  });

  it('种类上限卡死场景渲染剩余未分配预警', () => {
    // 徽章×3 + 色纸×10，每账号最多 1 种、账号 3、包邮线 30 → 色纸无处安放进 remaining；
    // 货值不足全员包邮 → 阶段2b 牺牲其余账号把账号1顶过线（¥30 达标）
    win.confirm = function () { return true; };  // stub jsdom 未实现的 confirm
    doc.getElementById('btnClear').click();
    expect(doc.querySelectorAll('#productList .prow')).toHaveLength(1);
    const rows = [];
    rows.push(doc.querySelector('#productList .prow'));
    doc.getElementById('btnAdd').click();
    rows.push(doc.querySelector('#productList .prow:last-child'));
    rows[0].querySelector('.p-name').value = '徽章';
    rows[0].querySelector('.p-qty').value = '3';
    rows[0].querySelector('.p-price').value = '10';
    rows[1].querySelector('.p-name').value = '色纸';
    rows[1].querySelector('.p-qty').value = '10';
    rows[1].querySelector('.p-price').value = '5';
    doc.getElementById('inFree').value = '30';
    doc.getElementById('inAccounts').value = '3';
    doc.getElementById('inMaxTypes').value = '1';
    doc.getElementById('btnCompute').click();
    const acards = doc.querySelectorAll('#resultCards .acard');
    expect(acards).toHaveLength(1);
    expect(acards[0].textContent).toContain('徽章 ×3');
    expect(acards[0].textContent).toContain('已达包邮');
    expect(doc.getElementById('resultRemain').hidden).toBe(false);
    expect(doc.getElementById('resultRemain').textContent).toContain('剩余未分配');
    expect(doc.getElementById('resultRemain').textContent).toContain('色纸');
  });

  it('外币单价商品：折算人民币参与计算并保留原币展示', () => {
    win.confirm = function () { return true; };
    doc.getElementById('btnClear').click();
    const row = doc.querySelector('#productList .prow');
    row.querySelector('.p-name').value = '吧唧';
    row.querySelector('.p-qty').value = '2';
    row.querySelector('.p-price').value = '500';
    row.querySelector('.p-cur').value = 'jpy';
    doc.getElementById('inFree').value = '0';
    doc.getElementById('inAccounts').value = '1';
    doc.getElementById('btnCompute').click();
    const card = doc.querySelector('#resultCards .acard');
    expect(card.textContent).toContain('¥53.00');      // 500×0.053=26.5/件 → ×2 = 53
    expect(card.textContent).toContain('JP¥1,000');    // 原币 500×2，千分位
    expect(card.textContent).toContain('外币合计');
    expect(doc.getElementById('resultSummary').textContent).toContain('分配 1 个账号');
  });

  it('包邮线外币：按汇率折算人民币判断包邮状态', () => {
    win.confirm = function () { return true; };
    doc.getElementById('btnClear').click();
    const row = doc.querySelector('#productList .prow');
    row.querySelector('.p-name').value = '立牌';
    row.querySelector('.p-qty').value = '1';
    row.querySelector('.p-price').value = '10000';
    row.querySelector('.p-cur').value = 'jpy';
    doc.getElementById('inFree').value = '800';
    doc.getElementById('freeCur').value = 'jpy';
    doc.getElementById('inAccounts').value = '1';
    doc.getElementById('btnCompute').click();
    // 包邮线 JP¥800 × 0.053 = 42.4 → 0.5 圆整 42.5；商品 10000×0.053=530 → 达标
    const card = doc.querySelector('#resultCards .acard');
    expect(card.textContent).toContain('已达包邮');
    expect(doc.getElementById('resultSummary').textContent).toContain('JP¥800');
    expect(doc.getElementById('resultSummary').textContent).toContain('¥42.50');
  });

  it('导出：无 Canvas / 容器桥的环境给出可读提示', async () => {
    doc.getElementById('btnExport').click();   // jsdom 无 2D context → 生成图片提示
    await Promise.resolve();                    // onExport 经 preload().then 微任务后弹 toast
    await Promise.resolve();
    expect(doc.getElementById('toast').textContent).toContain('不支持');
  });

  it('商品图片：行内缩略位可设置，结果条目带图', () => {
    win.confirm = function () { return true; };
    doc.getElementById('btnClear').click();
    const row = doc.querySelector('#productList .prow');
    expect(row.querySelector('.p-thumb')).toBeTruthy();
    row._imgData = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    row.querySelector('.p-name').value = '吧唧';
    row.querySelector('.p-qty').value = '2';
    row.querySelector('.p-price').value = '10';
    doc.getElementById('inAccounts').value = '1';
    doc.getElementById('btnCompute').click();
    const img = doc.querySelector('#resultCards .acard-item-img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toContain('data:image/gif');
  });

  it('复制商品：整行复用（含图片）并插入其后', () => {
    win.confirm = function (msg) { lastConfirmMsg = msg; return true; };
    doc.getElementById('btnClear').click();
    const row = doc.querySelector('#productList .prow');
    row.querySelector('.p-name').value = '吧唧';
    row.querySelector('.p-qty').value = '2';
    row.querySelector('.p-price').value = '10';
    row.querySelector('.p-cur').value = 'jpy';
    row._imgData = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    row.querySelector('.p-copy').click();
    const rows = doc.querySelectorAll('#productList .prow');
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector('.p-name').value).toBe('吧唧');
    expect(rows[1].querySelector('.p-qty').value).toBe('2');
    expect(rows[1].querySelector('.p-price').value).toBe('10');
    expect(rows[1].querySelector('.p-cur').value).toBe('jpy');
    expect(rows[1]._imgData).toContain('data:image/gif');
    expect(rows[1].querySelector('.p-thumb-img')).toBeTruthy();
  });

  it('完全一致商品：计算前确认，取消不计算，确认后合并为一条', () => {
    win.confirm = function (msg) { lastConfirmMsg = msg; return true; };
    doc.getElementById('btnClear').click();
    const row = doc.querySelector('#productList .prow');
    row.querySelector('.p-name').value = '吧唧';
    row.querySelector('.p-qty').value = '2';
    row.querySelector('.p-price').value = '10';
    doc.getElementById('btnAdd').click();
    const row2 = doc.querySelector('#productList .prow:last-child');
    row2.querySelector('.p-name').value = '吧唧';
    row2.querySelector('.p-qty').value = '2';
    row2.querySelector('.p-price').value = '10';
    doc.getElementById('inFree').value = '0';
    doc.getElementById('inAccounts').value = '1';
    // 取消确认 → 不出结果
    win.confirm = function (msg) { lastConfirmMsg = msg; return false; };
    doc.getElementById('btnCompute').click();
    expect(doc.getElementById('resultBox').hidden).toBe(true);
    // 确认 → 合并为同一条 ×4
    win.confirm = function (msg) { lastConfirmMsg = msg; return true; };
    doc.getElementById('btnCompute').click();
    expect(lastConfirmMsg).toContain('完全一致');
    expect(doc.querySelectorAll('#resultCards .acard')).toHaveLength(1);
    const card = doc.querySelector('#resultCards .acard');
    expect(card.textContent).toContain('吧唧 ×4');
    expect(card.textContent).toContain('¥40.00');
  });

  it('同名不同价商品：自动加权合并为一条（无需确认）', () => {
    win.confirm = function (msg) { lastConfirmMsg = msg; return true; };
    doc.getElementById('btnClear').click();
    const row = doc.querySelector('#productList .prow');
    row.querySelector('.p-name').value = '徽章';
    row.querySelector('.p-qty').value = '1';
    row.querySelector('.p-price').value = '10';
    doc.getElementById('btnAdd').click();
    const row2 = doc.querySelector('#productList .prow:last-child');
    row2.querySelector('.p-name').value = '徽章';
    row2.querySelector('.p-qty').value = '1';
    row2.querySelector('.p-price').value = '20';
    doc.getElementById('inAccounts').value = '1';
    doc.getElementById('btnCompute').click();
    // 单价不同 → 非完全一致，不触发确认弹窗
    expect(lastConfirmMsg).not.toContain('完全一致');
    const card = doc.querySelector('#resultCards .acard');
    expect(card.textContent).toContain('徽章 ×2');
    expect(card.textContent).toContain('¥30.00');   // 加权均价 15 × 2
  });

  it('计算引擎未加载时启动给出可读失败提示并禁用计算按钮', async () => {
    const dom2 = new JSDOM(htmlSrc, { runScripts: 'outside-only', url: 'https://minitool.local/' });
    await new Promise((r) => {
      if (dom2.window.document.readyState !== 'loading') r();
      else dom2.window.addEventListener('DOMContentLoaded', r);
    });
    dom2.window.eval(appSrc); // 只加载 app.js，模拟 core.js 加载失败
    const btn = dom2.window.document.getElementById('btnCompute');
    expect(btn.disabled).toBe(true);
    expect(dom2.window.document.getElementById('resultBox').hidden).toBe(false);
    expect(dom2.window.document.getElementById('resultSummary').textContent).toContain('计算引擎未加载');
  });
});

// ─────────────────────────────────────────────────────────────
describe('构建与素材脚本', () => {
  it('build.mjs / brand.mjs 语法可执行（node --check）', () => {
    execFileSync(process.execPath, ['--check', resolve(TOOL, 'build.mjs')]);
    execFileSync(process.execPath, ['--check', resolve(TOOL, 'brand.mjs')]);
  });
});
