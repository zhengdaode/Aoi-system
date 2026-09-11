// v3.4.0 B2 Phase 1：团员密钥与 PII 隔离——读裁剪传参、写白名单传参、enter 解析链、schema 守护
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi, win, doc } from './helpers/aoi.js';

const realConfirm = aoi.confirm;

beforeEach(() => {
  win.localStorage.clear();
  aoi.state.user = null;
  aoi.member.state = { key: null, cn: null, teamName: null, updatedAt: null };
  doc.getElementById('member-entry').classList.remove('hidden');
  doc.getElementById('member-board').classList.add('hidden');
  aoi.confirm = realConfirm;
});

describe('data.js：读/写 RPC 的 p_cn 传参', () => {
  it('getTeamDataByMemberKey：携带输入（圈名或 QQ 号）作为 p_cn', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { name: '团', data: {}, updatedAt: null, cn: '小樱' }, error: null });
    aoi.db = { rpc };
    await aoi.getTeamDataByMemberKey('k1', '小樱');
    expect(rpc).toHaveBeenCalledWith('get_team_by_member_key', { member_key: 'k1', p_cn: '小樱' });
  });

  it('getTeamDataByMemberKey：不传输入时不带 p_cn（旧调用兼容）', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    aoi.db = { rpc };
    await aoi.getTeamDataByMemberKey('k1');
    expect(rpc).toHaveBeenCalledWith('get_team_by_member_key', { member_key: 'k1' });
  });

  it('saveTeamDataByMemberKey：携带本人 CN 供服务端白名单合并', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'ts1', error: null });
    aoi.db = { rpc };
    await aoi.saveTeamDataByMemberKey('k1', { orders: [] }, 'ts0', '小樱');
    expect(rpc).toHaveBeenCalledWith('update_team_data_by_member_key', {
      member_key: 'k1', new_data: { orders: [] }, expected_updated_at: 'ts0', p_cn: '小樱'
    });
  });
});

describe('member.enter：服务端解析链（PII 裁剪后的看板进入）', () => {
  it('服务端已解析 CN（QQ 号输入映射为圈名）→ 直接进入看板', async () => {
    doc.getElementById('memberKey').value = 'k1';
    doc.getElementById('memberId').value = '12345';
    aoi.db = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          name: '测试团', updatedAt: '2026-09-08T00:00:00Z', cn: '小樱',
          data: { orders: [{ id: 'o1', buyer: '小樱', type: '吧唧', model: 'A', count: 1 }] }
        }, error: null
      })
    };
    await aoi.member.enter();
    expect(aoi.member.state.cn).toBe('小樱');
    expect(aoi.member.state.key).toBe('k1');
    expect(doc.getElementById('member-board').classList.contains('hidden')).toBe(false);
  });

  it('服务端未解析（cn 原样返回）且本地也解析不到 → 拒绝进入', async () => {
    doc.getElementById('memberKey').value = 'k1';
    doc.getElementById('memberId').value = '不存在的人';
    aoi.db = {
      rpc: vi.fn().mockResolvedValue({
        data: { name: '测试团', updatedAt: null, cn: '不存在的人', data: { orders: [] } }, error: null
      })
    };
    await aoi.member.enter();
    expect(aoi.member.state.cn).toBeNull();
    expect(doc.getElementById('member-board').classList.contains('hidden')).toBe(true);
  });

  it('密钥无效（RPC 返回 null）→ 提示且不进入', async () => {
    doc.getElementById('memberKey').value = 'bad';
    doc.getElementById('memberId').value = '小樱';
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    await aoi.member.enter();
    expect(aoi.member.state.cn).toBeNull();
    expect(doc.getElementById('member-board').classList.contains('hidden')).toBe(true);
  });
});

describe('supabase-schema.sql B2 守护（读裁剪 / 写白名单 / 密钥强度防回退）', () => {
  const schema = readFileSync(resolve(__dirname, '../supabase-schema.sql'), 'utf8');

  it('读 RPC：两参数签名 + 三类 PII 裁剪 + cn 回传', () => {
    expect(schema).toMatch(/create function public\.get_team_by_member_key\(member_key text, p_cn text default null\)/);
    expect(schema).toMatch(/v_data := v_data - 'addresses' - 'memberMeta' - 'cnChanges'/);
    // jsonb_each 的列名是 key/value——守护禁止缩写别名（v3.4.0 曾因 k 别名线上 42703）
    expect(schema.match(/jsonb_object_agg\(key, value\) from jsonb_each/g) || []).toHaveLength(2);
    expect(schema).not.toMatch(/jsonb_object_agg\(k, v\)/);
    expect(schema).not.toMatch(/select k into/);
    expect(schema).toMatch(/select key into v_qq_cn/);
    expect(schema).toMatch(/'cn', v_cn/);
  });

  it('写 RPC：四参数签名 + 白名单合并 + 状态上限（防自批已交）', () => {
    expect(schema).toMatch(/p_cn text default null\r?\n\)\r?\nreturns timestamptz/);
    // v3.10.0：p_cn 为空的「旧客户端兼容桥」已封堵——缺失圈名一律拒绝（守护见 v310-security）
    expect(schema).not.toMatch(/v_merged := new_data/);
    expect(schema).toMatch(/raise exception '圈名缺失或不合法/);
    // 状态上限：只有 待交/待审核 能被团员写入
    expect(schema.match(/in \('待交', '待审核'\)/g) || []).toHaveLength(2);
    // 通知只接受团员产生的两类
    expect(schema).toMatch(/in \('address', 'cnchange'\)/);
    // 本人条目按 id 合并（orders/transfers/cnChanges/notifications 走 upsert 辅助）
    expect(schema.match(/public\.jsonb_array_upsert_by_id\(/g) || []).toHaveLength(5); // 1 定义 + 4 调用
  });

  it('辅助函数与密钥强度（128bit 随机）', () => {
    expect(schema).toMatch(/create or replace function public\.jsonb_array_upsert_by_id/);
    // v3.10.0：v2 的 regenerate_member_key(auth.uid 版) 已归档，仅剩 admin_regenerate_member_key 一处
    expect(schema.match(/encode\(extensions\.gen_random_bytes\(16\), 'hex'\)/g) || []).toHaveLength(1);
  });
});
