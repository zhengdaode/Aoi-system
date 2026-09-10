import { describe, it, expect, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi } from './helpers/aoi.js';

// v3.9.3 导出链路可用性：①拉图候选链接入 Edge /fetch（Pages/本地唯一已部署代理路径）
// ②第三方组件库本地自托管（摆脱被污染的 jsDelivr）③html2canvas 超时兜底

describe('imageCandidates Edge 通道（v3.9.3）', () => {
  it('配置 https relay：候选链为 直连→/media-proxy→/media-relay→Edge /fetch', () => {
    aoi.bot.config = { enabled: false, relay: 'https://qqrelay.example.supabase.co' };
    const c = aoi.exportSummary.imageCandidates('https://img.cdn1.vip/i/x.webp');
    expect(c[0]).toBe('https://img.cdn1.vip/i/x.webp');
    expect(c[1]).toBe('/media-proxy/img.cdn1.vip/i/x.webp');
    expect(c[2]).toBe('/media-relay/img.cdn1.vip/i/x.webp');
    expect(c[3]).toBe('https://qqrelay.example.supabase.co/fetch/img.cdn1.vip/i/x.webp');
  });

  it('未配置 relay：不产生 Edge 候选（原三通道不变）', () => {
    aoi.bot.config = { enabled: false, relay: '' };
    const c = aoi.exportSummary.imageCandidates('https://esaimg.cdn1.vip/a.png');
    expect(c).toHaveLength(3);
    expect(c.some((u) => String(u).includes('/fetch/'))).toBe(false);
  });

  it('非白名单主机：仅直连（Edge 白名单同样不放行）', () => {
    aoi.bot.config = { enabled: false, relay: 'https://qqrelay.example.supabase.co' };
    expect(aoi.exportSummary.imageCandidates('https://img.example/a.png'))
      .toEqual(['https://img.example/a.png']);
  });
});

describe('组件库本地自托管（v3.9.3）', () => {
  const ROOT = resolve(__dirname, '..'); // 仓库根（tests/ 上一层）
  const VENDOR = ['supabase.js', 'xlsx.full.min.js', 'exceljs.min.js', 'html2canvas.min.js'];

  it('index.html 不再引用 cdn.jsdelivr.net，四个库改走 js/vendor', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    expect(html.includes('cdn.jsdelivr.net')).toBe(false);
    VENDOR.forEach((f) => expect(html).toContain('src="js/vendor/' + f + '"'));
  });

  it('vendor 四件套真实存在且非空壳（各 >100KB）', () => {
    VENDOR.forEach((f) => {
      const st = statSync(resolve(ROOT, 'js/vendor', f));
      expect(st.size).toBeGreaterThan(100000);
    });
  });
});

describe('Aoi.promiseTimeout（v3.9.3）', () => {
  it('及时完成：透传结果', async () => {
    await expect(aoi.promiseTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('超时：reject 并带指定原因', async () => {
    vi.useFakeTimers();
    const p = aoi.promiseTimeout(new Promise(() => {}), 100, '太慢');
    const assertion = expect(p).rejects.toThrow('太慢');
    vi.advanceTimersByTime(101);
    await assertion;
    vi.useRealTimers();
  });

  it('超时后源 promise 才落定：不产生二次落定/未处理拒绝', async () => {
    vi.useFakeTimers();
    let res;
    const p = aoi.promiseTimeout(new Promise((r) => { res = r; }), 100, '超时');
    const assertion = expect(p).rejects.toThrow('超时');
    vi.advanceTimersByTime(101);
    await assertion;
    res('late');
    await Promise.resolve();
    vi.useRealTimers();
  });
});
