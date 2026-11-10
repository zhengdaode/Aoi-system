import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win } from './helpers/aoi.js';

// v3.35.0：本文件守护 blob 旧通道（回退路径）——P4 切换后须显式指定 DATA_MODE
beforeEach(() => { aoi.DATA_MODE = 'blob'; });

describe('Aoi.explainRpcError 错误分类（团员端排障关键）', () => {
  it('RPC 不存在 → 提示重跑 supabase-schema.sql', () => {
    const msg = aoi.explainRpcError('Could not find the function get_team_by_member_key in the schema cache', '团员端读取');
    expect(msg).toContain('RPC 不存在');
    expect(msg).toContain('supabase-schema.sql');
  });

  it('乐观锁冲突 → 提示刷新', () => {
    expect(aoi.explainRpcError('数据已被他人修改，请刷新后重试', '团员端写入')).toContain('已被他人修改');
  });

  it('密钥无效 → 提示向团长确认', () => {
    expect(aoi.explainRpcError('密钥无效', '团员端读取')).toContain('向团长确认');
  });

  it('网络错误 → 提示检查网络', () => {
    expect(aoi.explainRpcError('Failed to fetch', '团员端读取')).toContain('网络');
  });

  it('未知错误 → 返回 null（由调用方拼接原始信息）', () => {
    expect(aoi.explainRpcError('some other error', '团员端读取')).toBeNull();
  });
});

describe('Aoi.getTeamDataByMemberKey / saveTeamDataByMemberKey', () => {
  beforeEach(() => {
    win.localStorage.clear();
    aoi.member.state = { key: null, cn: null, teamName: null, updatedAt: null };
  });

  it('getTeamDataByMemberKey：RPC 不存在时抛出分类错误（不再吞成密钥无效）', async () => {
    aoi.db = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Could not find the function in the schema cache' } })
    };
    await expect(aoi.getTeamDataByMemberKey('abc')).rejects.toThrow(/RPC 不存在/);
  });

  it('getTeamDataByMemberKey：data 为 null（密钥不匹配）返回 null', async () => {
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    expect(await aoi.getTeamDataByMemberKey('bad-key')).toBeNull();
  });

  it('getTeamDataByMemberKey：成功时透传 name/data/updatedAt', async () => {
    aoi.db = {
      rpc: vi.fn().mockResolvedValue({ data: { name: '测试团', data: { orders: [] }, updatedAt: '2026-09-06T00:00:00Z' }, error: null })
    };
    const res = await aoi.getTeamDataByMemberKey('k1');
    expect(res.name).toBe('测试团');
    expect(res.updatedAt).toBe('2026-09-06T00:00:00Z');
  });

  it('saveTeamDataByMemberKey：传乐观锁版本时携带 expected_updated_at，并返回新版本', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '2026-09-06T01:00:00Z', error: null });
    aoi.db = { rpc };
    const newTs = await aoi.saveTeamDataByMemberKey('k1', { orders: [] }, '2026-09-06T00:00:00Z');
    expect(rpc).toHaveBeenCalledWith('update_team_data_by_member_key', {
      member_key: 'k1',
      new_data: { orders: [] },
      expected_updated_at: '2026-09-06T00:00:00Z'
    });
    expect(newTs).toBe('2026-09-06T01:00:00Z');
  });

  it('saveTeamDataByMemberKey：写入 RPC 缺失时抛出分类错误', async () => {
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Could not find the function update_team_data_by_member_key' } }) };
    await expect(aoi.saveTeamDataByMemberKey('k1', {})).rejects.toThrow(/RPC 不存在/);
  });

  it('debug（DEMO 密钥）路径走 localStorage 且不触 RPC', async () => {
    win.localStorage.setItem('aoi_debug_team', JSON.stringify({ name: '调试团', member_key: 'DEMO' }));
    win.localStorage.setItem('aoi_debug_data', '{}');
    const rpc = vi.fn();
    aoi.db = { rpc };
    const res = await aoi.getTeamDataByMemberKey('DEMO');
    expect(res.name).toBe('调试团');
    await aoi.saveTeamDataByMemberKey('DEMO', { orders: [1] });
    expect(JSON.parse(win.localStorage.getItem('aoi_debug_data'))).toEqual({ orders: [1] });
    expect(rpc).not.toHaveBeenCalled();
  });
});
