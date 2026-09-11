// v3.11.0 数据信任 + B6 治理：saveTeamData 失败可感知（toast 不吞）/ blob 体积预警 /
// notify.sync 不再静默 / 通知 prune（30 天已发清理 + 500 条上限）/ schema 单团守卫
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi, win } from './helpers/aoi.js';

const origToast = aoi.toast;
const origWarn = win.console.warn;

beforeEach(() => {
  win.localStorage.clear();
  aoi.state.data = { orders: [] };
  aoi._blobWarned = false;
  aoi.notify._syncWarned = false;
  aoi.toast = vi.fn();
  win.console.warn = vi.fn();
});

describe('data.saveTeamData：失败必须可感知（管理端 29 处调用不再静默丢失）', () => {
  function stubSession() {
    aoi.adminLoadSession = () => ({ token: 'tok', username: 'a', role: 'super', expiresAt: 'x' });
  }

  it('RPC 返回 error → toast 提示 + 抛错（调用方后续成功流程跳过）', async () => {
    stubSession();
    aoi.adminUpdatedAt = null;
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: '数据已被他人修改，请刷新后重试' } }) };
    await expect(aoi.saveTeamData({ orders: [] })).rejects.toThrow(/已被他人修改/);
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('数据保存失败'), 'error');
  });

  it('网络异常（rpc 抛错）→ toast 明确「未上传」+ 抛错', async () => {
    stubSession();
    aoi.db = { rpc: vi.fn().mockRejectedValue(new Error('Failed to fetch')) };
    await expect(aoi.saveTeamData({ orders: [] })).rejects.toThrow('Failed to fetch');
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('未上传'), 'error');
  });

  it('成功路径无 error toast', async () => {
    stubSession();
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: 'ts2', error: null }) };
    await aoi.saveTeamData({ orders: [] });
    const errToasts = aoi.toast.mock.calls.filter((c) => c[1] === 'error');
    expect(errToasts).toHaveLength(0);
  });

  it('blob 超 2MB → 警告一次（同会话不重复）', async () => {
    stubSession();
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: 'ts', error: null }) };
    const big = { pad: 'x'.repeat(2 * 1024 * 1024 + 100) };
    await aoi.saveTeamData(big);
    expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('2MB'), 'warning');
    await aoi.saveTeamData(big);
    const warns = aoi.toast.mock.calls.filter((c) => String(c[0]).includes('2MB'));
    expect(warns).toHaveLength(1);
  });
});

describe('notify.sync：失败不再完全静默', () => {
  it('内部异常 → 不抛出 + 每会话一次 toast + 留痕标记', async () => {
    // orders.ensure 会把 batches 规范化为数组，故改为让 buyerSummary 抛错触发 catch
    const origSummary = aoi.approval.buyerSummary;
    aoi.approval.buyerSummary = () => { throw new Error('boom'); };
    aoi.state.data = { batches: [{ id: 'b1' }] };
    try {
      await expect(aoi.notify.sync()).resolves.toBeUndefined();
      expect(aoi.notify._syncWarned).toBe(true); // catch 路径已执行（console.warn 在真浏览器留痕）
      expect(aoi.toast).toHaveBeenCalledWith(expect.stringContaining('自动通知同步失败'), 'warning');
      // 第二次失败不再 toast（每会话一次）
      aoi.toast.mockClear();
      await aoi.notify.sync();
      expect(aoi.toast).not.toHaveBeenCalled();
    } finally {
      aoi.approval.buyerSummary = origSummary;
    }
  });
});

describe('notify.prune：B6 通知治理', () => {
  const day = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

  it('已发超 30 天删除；未发与近期已发保留；返回删除数', () => {
    const d = { notifications: [
      { id: 'a', sent: true, date: day(-40) },   // 已发 40 天前 → 删
      { id: 'b', sent: false, date: day(-40) },  // 未发 40 天前 → 留
      { id: 'c', sent: true, date: day(-5) },    // 已发 5 天前 → 留
      { id: 'd', sent: false, date: day(-1) }    // 留
    ] };
    const removed = aoi.notify.prune(d);
    expect(removed).toBe(1);
    expect(d.notifications.map((n) => n.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('超上限时裁剪到 500：已发先丢、组内最旧先丢', () => {
    const notifications = [];
    // 600 条且全部在 30 天内（避开「已发 30 天清理」规则，纯测上限裁剪）：
    // 300 已发（更老）+ 300 未发 → 裁掉 100 条应全来自已发组的最旧
    for (let i = 0; i < 300; i++) notifications.push({ id: 's' + i, sent: true, date: day(-10) });
    for (let i = 0; i < 300; i++) notifications.push({ id: 'u' + i, sent: false, date: day(-3) });
    const d = { notifications };
    const removed = aoi.notify.prune(d);
    expect(removed).toBe(100);
    expect(d.notifications).toHaveLength(500);
    expect(d.notifications.filter((n) => n.sent)).toHaveLength(200);
    // 已发组里最老的 s0–s99 被丢（同日期按数组序稳定裁剪）
    expect(d.notifications.find((n) => n.id === 's0')).toBeUndefined();
    expect(d.notifications.find((n) => n.id === 's299')).toBeDefined();
    expect(d.notifications.find((n) => n.id === 'u299')).toBeDefined();
  });

  it('未超上限时原样保留', () => {
    const d = { notifications: [ { id: 'x', sent: true, date: day(-1) }, { id: 'y', sent: false, date: day(-1) } ] };
    aoi.notify.prune(d);
    expect(d.notifications).toHaveLength(2);
  });
});

describe('supabase-schema.sql v3.11.0 守护（单团显式化）', () => {
  const schema = readFileSync(resolve(__dirname, '../supabase-schema.sql'), 'utf8');

  it('assert_single_team 存在且超一团报错', () => {
    expect(schema).toMatch(/create or replace function public\.assert_single_team\(\)/);
    expect(schema).toMatch(/检测到多个团队行/);
  });

  it('全部单团 RPC 已改走守卫（1 定义 + 9 调用 = 10 处）；硬编码 limit 1 不再回潮', () => {
    expect((schema.match(/public\.assert_single_team\(\)/g) || [])).toHaveLength(10);
    expect(schema).not.toMatch(/where id = \(select id from teams limit 1\)/);
    // 旧硬编码块（join 后直接 limit 1）不得回潮；团员密钥 RPC 的 where member_key ... limit 1 为合法按键查单行
    expect(schema).not.toMatch(/left join team_data d on d\.team_id = t\.id\s*\r?\n\s*limit 1/);
  });
});
