// v3.35.2 回归：index.html/shop.html <script> 标签与 harness MODULES 漂移检测
// 背景：v3.35.0 新增 js/blob-diff.js 并在 data.js 调用 Aoi.blobDiff，但漏挂 index.html
// script 标签——测试 harness 显式 eval MODULES 全绿，真实浏览器却每次保存抛
// "Aoi.blobDiff is not a function"（在 try 之外，无 toast），全部管理端写入静默失败。
// 本测试钉死：harness 列出的每个模块必须被至少一个页面 <script> 加载。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MODULES } from './helpers/aoi.js';

const ROOT = resolve(__dirname, '..');

// 从页面 HTML 提取本地 js 模块 script 标签（js/ 开头，排除 vendor）
function pageModules(file) {
  const html = readFileSync(resolve(ROOT, file), 'utf8');
  const out = [];
  const re = /<script\s+src="(js\/[^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].startsWith('js/vendor/')) out.push(m[1]);
  }
  return out;
}

describe('v3352 页面 script 标签与 harness MODULES 一致', () => {
  const tags = new Set([...pageModules('index.html'), ...pageModules('shop.html')]);

  it('harness MODULES 的每个模块都被某个页面 <script> 加载', () => {
    const missing = MODULES.filter((m) => !tags.has(m));
    expect(missing, '未挂 script 标签的模块（真实浏览器将缺定义）: ' + missing.join(', ')).toEqual([]);
  });

  it('js/blob-diff.js 必须由 index.html 显式加载（本次故障的直接回归钉）', () => {
    expect(pageModules('index.html')).toContain('js/blob-diff.js');
  });

  it('页面标签不引用 harness 之外的未知本地模块（防孤儿标签/拼写错）', () => {
    const known = new Set(MODULES.concat(['js/config.js']));
    const unknown = [...tags].filter((t) => !known.has(t));
    expect(unknown, '页面存在 harness 未覆盖的 script 标签: ' + unknown.join(', ')).toEqual([]);
  });
});
