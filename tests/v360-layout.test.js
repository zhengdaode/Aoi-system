import { describe, it, expect } from 'vitest';
import { doc } from './helpers/aoi.js';

// v3.6.0 S6 回归守护：view-stats 曾被写在 </main> 之后（946 行提前闭合 main，
// 页面尾部多出一个 </main>），导致复盘统计视图脱离 main 内容流、
// 无 p-6 内边距、布局与其他 tab 不一致。
describe('复盘统计视图布局（v3.6.0 S6）', () => {
  it('view-stats 必须位于 main 内容流内（与其他 data-view 同级）', () => {
    const stats = doc.getElementById('view-stats');
    expect(stats).not.toBeNull();
    expect(stats.closest('main')).not.toBeNull();
    // 与其他视图同属一个父容器（main 直接子级）
    const limits = doc.getElementById('view-limits');
    expect(stats.parentElement).toBe(limits.parentElement);
  });

  it('整页只允许一个 <main>（曾多出的 </main> 已删除）', () => {
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    // 所有 data-view 全部挂在同一个 main 下
    const views = [...doc.querySelectorAll('[data-view]')];
    expect(views.length).toBeGreaterThan(5);
    views.forEach((v) => expect(v.closest('main')).not.toBeNull());
  });
});
