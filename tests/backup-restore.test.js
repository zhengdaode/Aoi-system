// v3.4.0 B1/F4：数据备份与恢复（本地备份文件 + 服务端 blob 历史快照）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi, win, doc } from './helpers/aoi.js';

const realConfirm = aoi.confirm;
const realSaveTeamData = aoi.saveTeamData;
const realRefreshViews = aoi.refreshViews;

beforeEach(() => {
  win.localStorage.clear();
  aoi.state.user = null;
  aoi.state.team = { id: 't1', name: '测试团' };
  aoi.state.data = { orders: [], notifications: [] };
  aoi.confirm = realConfirm;
  aoi.saveTeamData = realSaveTeamData;
  aoi.refreshViews = realRefreshViews;
});
afterEach(() => {
  aoi.confirm = realConfirm;
  aoi.saveTeamData = realSaveTeamData;
  aoi.refreshViews = realRefreshViews;
});

describe('Aoi.backup.buildExport / parseImport（备份文件结构与校验）', () => {
  it('buildExport：含 kind/version/exportedAt/teamName/data 元信息', () => {
    const data = { orders: [{ id: 'o1' }] };
    const payload = aoi.backup.buildExport(data);
    expect(payload.kind).toBe('aoi-backup');
    expect(payload.version).toBe(1);
    expect(payload.teamName).toBe('测试团');
    expect(payload.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.data).toBe(data);
  });

  it('parseImport：合法备份原样通过', () => {
    const payload = { kind: 'aoi-backup', version: 1, exportedAt: '2026-09-08T10:00:00Z', teamName: 'x', data: { orders: [] } };
    expect(aoi.backup.parseImport(JSON.stringify(payload))).toEqual(payload);
  });

  it('parseImport：非 JSON 抛「不是有效的 JSON」', () => {
    expect(() => aoi.backup.parseImport('not json{')).toThrow(/不是有效的 JSON/);
  });

  it('parseImport：缺备份标识或 data 字段时拒绝（防任意 JSON 覆盖数据）', () => {
    expect(() => aoi.backup.parseImport(JSON.stringify({ foo: 1 }))).toThrow(/不是本系统导出的备份/);
    expect(() => aoi.backup.parseImport(JSON.stringify({ kind: 'aoi-backup' }))).toThrow(/不是本系统导出的备份/);
    expect(() => aoi.backup.parseImport(JSON.stringify({ kind: 'other', data: {} }))).toThrow(/不是本系统导出的备份/);
  });
});

describe('Aoi.backup.download（本地备份下载）', () => {
  it('创建 JSON blob 下载链接并提示成功', () => {
    const created = [];
    const revoked = [];
    const origCreate = win.URL.createObjectURL;
    const origRevoke = win.URL.revokeObjectURL;
    win.URL.createObjectURL = (b) => { created.push(b); return 'blob:mock'; };
    win.URL.revokeObjectURL = (u) => revoked.push(u);
    const click = win.HTMLAnchorElement.prototype.click;
    win.HTMLAnchorElement.prototype.click = vi.fn();

    aoi.backup.download();

    expect(created).toHaveLength(1);
    expect(revoked).toContain('blob:mock');
    win.URL.createObjectURL = origCreate;
    win.URL.revokeObjectURL = origRevoke;
    win.HTMLAnchorElement.prototype.click = click;
  });
});

describe('Aoi.backup.restoreFromObject（统一恢复流程）', () => {
  it('确认后走 saveTeamData 写回、更新 state.data 并刷新视图', async () => {
    const payload = { kind: 'aoi-backup', data: { orders: [{ id: 'o1' }, { id: 'o2' }] }, exportedAt: '2026-09-08T10:00:00Z' };
    const save = vi.fn().mockResolvedValue('2026-09-08T11:00:00Z');
    const refresh = vi.fn();
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.saveTeamData = save;
    aoi.refreshViews = refresh;
    aoi.state.data = { orders: [{ id: 'old' }] };

    await aoi.backup.restoreFromObject(payload);

    expect(aoi.confirm).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(payload.data);
    expect(aoi.state.data).toBe(payload.data);
    expect(refresh).toHaveBeenCalled();
  });

  it('取消确认时不写入', async () => {
    const save = vi.fn();
    aoi.confirm = vi.fn().mockResolvedValue(false);
    aoi.saveTeamData = save;

    await aoi.backup.restoreFromObject({ kind: 'aoi-backup', data: { orders: [] } });

    expect(save).not.toHaveBeenCalled();
  });
});

describe('Aoi.listDataHistory / getDataHistorySnapshot（服务端历史快照 RPC 包装）', () => {
  it('debug 模式返回空列表且不触 RPC', async () => {
    aoi.state.user = { username: 'debug', isDebug: true };
    const rpc = vi.fn();
    aoi.db = { rpc };
    expect(await aoi.listDataHistory()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('携带 admin token 调 admin_list_team_data_history 并透传列表', async () => {
    aoi.state.user = { username: 'boss' };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    const list = [{ id: 1, source: 'admin', savedAt: '2026-09-08T10:00:00Z', ordersCount: 3, bytes: 2048 }];
    const rpc = vi.fn().mockResolvedValue({ data: list, error: null });
    aoi.db = { rpc };

    const res = await aoi.listDataHistory(10);

    expect(rpc).toHaveBeenCalledWith('admin_list_team_data_history', { p_token: 'tok', p_limit: 10 });
    expect(res).toEqual(list);
  });

  it('RPC 不存在时给出可操作提示（提示重跑 schema）', async () => {
    aoi.state.user = { username: 'boss' };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Could not find the function admin_list_team_data_history' } }) };
    await expect(aoi.listDataHistory()).rejects.toThrow(/RPC 不存在/);
  });

  it('getDataHistorySnapshot：传 p_id 取回快照全文', async () => {
    aoi.state.user = { username: 'boss' };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    const snap = { data: { orders: [1] }, savedAt: '2026-09-08T10:00:00Z', source: 'member' };
    const rpc = vi.fn().mockResolvedValue({ data: snap, error: null });
    aoi.db = { rpc };

    const res = await aoi.getDataHistorySnapshot(7);

    expect(rpc).toHaveBeenCalledWith('admin_get_team_data_history', { p_token: 'tok', p_id: 7 });
    expect(res).toEqual(snap);
  });
});

describe('Aoi.backup.renderHistory / restoreSnapshot（设置页备份卡）', () => {
  it('debug 模式列表提示无服务端历史', async () => {
    aoi.state.user = { username: 'debug', isDebug: true };
    await aoi.backup.renderHistory();
    expect(doc.getElementById('backupHistoryList').innerHTML).toContain('无服务端历史快照');
  });

  it('列表渲染摘要（时间/来源/订单数/体积）与恢复按钮', async () => {
    aoi.state.user = { username: 'boss' };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    aoi.db = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ id: 5, source: 'member', savedAt: '2026-09-08T09:30:00Z', ordersCount: 12, bytes: 4096 }],
        error: null
      })
    };

    await aoi.backup.renderHistory();

    const html = doc.getElementById('backupHistoryList').innerHTML;
    expect(html).toContain('2026-09-08 09:30:00');
    expect(html).toContain('团员保存');
    expect(html).toContain('12 单');
    expect(html).toContain('4 KB');
    expect(html).toContain('data-bk-restore="5"');
  });

  it('RPC 失败时错误显示在列表内（不弹全局异常）', async () => {
    aoi.state.user = { username: 'boss' };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    aoi.db = { rpc: vi.fn().mockRejectedValue(new Error('网络连接失败，请检查网络后重试')) };

    await aoi.backup.renderHistory();

    expect(doc.getElementById('backupHistoryList').innerHTML).toContain('网络');
  });

  it('restoreSnapshot：确认后取快照全文并经 saveTeamData 写回', async () => {
    const save = vi.fn().mockResolvedValue('ts2');
    aoi.confirm = vi.fn().mockResolvedValue(true);
    aoi.saveTeamData = save;
    aoi.state.user = { username: 'boss' };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    aoi.db = {
      rpc: vi.fn().mockImplementation(function (name) {
        if (name === 'admin_get_team_data_history') {
          return Promise.resolve({ data: { data: { orders: [{ id: 'snap' }] }, savedAt: '2026-09-08T08:00:00Z', source: 'admin' }, error: null });
        }
        return Promise.resolve({ data: [], error: null }); // renderHistory 的列表调用
      })
    };

    await aoi.backup.restoreSnapshot(5);

    // refreshViews 会就地补齐缺失结构（同 undo.restore 行为），故断言引用同源 + 关键字段
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe(aoi.state.data);
    expect(aoi.state.data.orders[0].id).toBe('snap');
  });
});

describe('supabase-schema.sql 历史快照链路守护（防 RPC/表定义回退）', () => {
  const schema = readFileSync(resolve(__dirname, '../supabase-schema.sql'), 'utf8');

  it('历史表与索引、RLS 定义存在', () => {
    expect(schema).toMatch(/create table if not exists team_data_history/);
    expect(schema).toMatch(/create index if not exists team_data_history_team_saved/);
    expect(schema).toMatch(/alter table team_data_history enable row level security/);
  });

  it('两个写入口 RPC 都在覆盖前存档（admin + member 双来源）并调用保留策略', () => {
    expect(schema).toMatch(/insert into team_data_history \(team_id, data, source\)\s*\n\s*select team_id, data, 'admin' from team_data/);
    expect(schema).toMatch(/insert into team_data_history \(team_id, data, source\)\s*\n\s*select team_id, data, 'member' from team_data/);
    expect(schema.match(/team_data_history_prune\(target_team_id\)/g) || []).toHaveLength(2);
  });

  it('保留策略与两个读取 RPC 存在', () => {
    expect(schema).toMatch(/create or replace function public\.team_data_history_prune/);
    expect(schema).toMatch(/create or replace function public\.admin_list_team_data_history/);
    expect(schema).toMatch(/create or replace function public\.admin_get_team_data_history/);
  });
});
