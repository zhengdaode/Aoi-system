import { describe, it, expect } from 'vitest';
import { doc } from './helpers/aoi.js';

// v3.6.0 S6 回归守护：view-stats 曾被写在 </main> 之后（946 行提前闭合 main，
// 页面尾部多出一个 </main>），导致复盘统计视图脱离 main 内容流。
// v3.7.0 S6：复盘统计自独立 tab 并入总览——守护对象改为总览内的复盘区块。
describe('复盘统计布局（v3.6.0 S6 引入，v3.7.0 S6 并入总览）', () => {
  it('团期复盘区块必须位于 view-overview 内且在 main 内容流中', () => {
    const stats = doc.getElementById('ovStats');
    expect(stats).not.toBeNull();
    expect(stats.closest('main')).not.toBeNull();
    expect(doc.getElementById('view-overview').contains(stats)).toBe(true);
  });

  it('独立 view-stats tab 已移除（导航项与视图均不存在）', () => {
    expect(doc.getElementById('view-stats')).toBeNull();
    expect(doc.querySelector('[data-nav="view-stats"]')).toBeNull();
  });

  it('整页只允许一个 <main>（曾多出的 </main> 已删除）', () => {
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    // 所有 data-view 全部挂在同一个 main 下
    const views = [...doc.querySelectorAll('[data-view]')];
    expect(views.length).toBeGreaterThan(5);
    views.forEach((v) => expect(v.closest('main')).not.toBeNull());
  });
});
