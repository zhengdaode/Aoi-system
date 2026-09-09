// 测试 harness：把 index.html 装入 jsdom，再按顺序 eval js/ 模块，
// 使各模块在带完整 DOM 的 window.Aoi 命名空间下可被单测调用。
// 用法：
//   import { aoi } from './helpers/aoi.js';
//   aoi.state.data = { ... };  // 预置数据
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(__dirname, '../..');

const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  url: 'https://aoi.local/'
});

const w = dom.window;

// 首列点击事件委托等模块加载即执行的代码依赖的元素在 index.html 中已存在。
// Supabase JS 库走 CDN 不会加载，测试中需要时由用例自行 stub Aoi.db。

// 模块加载顺序：与 index.html 底部 <script> 顺序严格一致（config.js 除外，由用例 stub）
const MODULES = [
  'js/core.js',
  'js/data.js',
  'js/auth.js',
  'js/team.js',
  'js/import.js',
  'js/orders.js',
  'js/calc.js',
  'js/intl.js',
  'js/approval.js',
  'js/shipping.js',
  'js/member.js',
  'js/notify.js',
  'js/bot.js',
  'js/limits.js',
  'js/warehouse.js',
  'js/stats.js',
  'js/image-upload.js',
  'js/summary-export.js'
];

const loadErrors = [];
for (const m of MODULES) {
  try {
    w.eval(readFileSync(resolve(ROOT, m), 'utf8'));
  } catch (e) {
    loadErrors.push(m + ': ' + e.message);
  }
}

if (loadErrors.length) {
  // 加载失败直接抛出，避免用例在残缺命名空间上误报通过/失败
  throw new Error('js 模块加载失败：\n' + loadErrors.join('\n'));
}

// 导出 window 上的 Aoi 与 DOM，供用例预置数据 / 断言
export const aoi = w.Aoi;
export const win = w;
export const doc = w.document;
