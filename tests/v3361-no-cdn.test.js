// v3.36.1 回归：全站禁止外部 CDN script 标签（第三方 CDN 单点可用性故障防回潮）
// 背景：index.html 一直从 cdn.tailwindcss.com 加载 Play CDN（运行时 JS，负责在浏览器
// 现场生成全部 Tailwind 工具类含 hidden）。2026-11-20 用户实测该 CDN 间歇不可达，
// 所有工具类失效 → 全部 screen 同时可见、布局坍塌（css/styles.css 自定义样式不受影响，
// 故仍有按钮配色）。修复 = tailwindcss 3.4.17 自托管 js/vendor/tailwindcss.js。
// 此前 jsDelivr 四库已于 v3.9.3 自托管（同因），本测试钉死「第三方脚本一律先自托管」。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(__dirname, '..');

function readPage(file) {
  return readFileSync(resolve(ROOT, file), 'utf8');
}

// 提取页面全部 <script src="..."> 标签（含外部与本地）
function scriptSrcs(html) {
  const out = [];
  const re = /<script\s+src="([^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const PAGES = ['index.html', 'shop.html'];

describe('v3361 全站零外部 CDN script 标签', () => {
  it.each(PAGES)('%s 不引用任何 http(s) 外部脚本（第三方 CDN 依赖必须自托管）', (file) => {
    const external = scriptSrcs(readPage(file)).filter((s) => /^https?:\/\//i.test(s));
    expect(external, '发现外部 script 标签（大陆网络对第三方 CDN 间歇不可达，历史已两次踩坑）: ' + external.join(', ')).toEqual([]);
  });

  it('js/vendor/tailwindcss.js 存在且非空（自托管副本本体）', () => {
    const p = resolve(ROOT, 'js/vendor/tailwindcss.js');
    expect(existsSync(p), 'js/vendor/tailwindcss.js 不存在').toBe(true);
    expect(statSync(p).size, 'tailwindcss.js 是空文件').toBeGreaterThan(100000);
  });

  it('index.html 经 js/vendor/tailwindcss.js 加载 Tailwind', () => {
    expect(scriptSrcs(readPage('index.html'))).toContain('js/vendor/tailwindcss.js');
  });

  it('自托管副本内容完整（包含 Play CDN 版本标记 3.4.17）', () => {
    const body = readFileSync(resolve(ROOT, 'js/vendor/tailwindcss.js'), 'utf8');
    expect(body.includes('3.4.17'), '副本不含 3.4.17 版本标记，疑似下载不完整或换版未同步').toBe(true);
  });
});
