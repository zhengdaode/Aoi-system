// v3.10.0 安全止血：escapeHtml 引号转义 / safeUrl 协议白名单 / 团员凭证写入清洗 /
// 商品链接写入口清洗 / 活动平台链接清洗 / schema 守护（p_cn 后门封堵 + 登录防爆破 + v2 归档）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi, win, doc } from './helpers/aoi.js';

beforeEach(() => {
  win.localStorage.clear();
  aoi.state.data = { orders: [] };
});

describe('core.escapeHtml：引号转义（属性插值点不再可突破）', () => {
  it('双引号/单引号转义，文本语义不变', () => {
    expect(aoi.escapeHtml('a"b')).toBe('a&quot;b');
    expect(aoi.escapeHtml("a'b")).toBe('a&#39;b');
    expect(aoi.escapeHtml('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d');
    expect(aoi.escapeHtml(null)).toBe('');
    expect(aoi.escapeHtml(undefined)).toBe('');
  });

  it('含引号的输入放进 value="…" 不再逃逸出属性（事件注入失效）', () => {
    const div = doc.createElement('div');
    div.innerHTML = '<input value="' + aoi.escapeHtml('" onmouseover="alert(1)" x="') + '">';
    expect(div.firstElementChild.getAttribute('onmouseover')).toBeNull();
  });

  it('标签注入照旧被转义', () => {
    const div = doc.createElement('div');
    div.innerHTML = '<p>' + aoi.escapeHtml('<img src=x onerror=alert(1)>') + '</p>';
    expect(div.querySelectorAll('img')).toHaveLength(0);
    expect(div.querySelector('p').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('core.safeUrl：URL 协议白名单', () => {
  it('放行 http/https（含协议相对与站内相对路径）', () => {
    expect(aoi.safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(aoi.safeUrl('http://example.com')).toBe('http://example.com');
    expect(aoi.safeUrl('  https://example.com/x  ')).toBe('https://example.com/x');
    expect(aoi.safeUrl('//cdn.example.com/img.png')).toBe('//cdn.example.com/img.png');
    expect(aoi.safeUrl('/products/123')).toBe('/products/123');
    expect(aoi.safeUrl('gallery/pic.jpg')).toBe('gallery/pic.jpg');
  });

  it('危险协议与空值一律返回空串', () => {
    expect(aoi.safeUrl('javascript:alert(1)')).toBe('');
    expect(aoi.safeUrl('JaVaScRiPt:alert(1)')).toBe('');
    expect(aoi.safeUrl('data:text/html,<b>x</b>')).toBe('');
    expect(aoi.safeUrl('vbscript:MsgBox(1)')).toBe('');
    expect(aoi.safeUrl('')).toBe('');
    expect(aoi.safeUrl(null)).toBe('');
    expect(aoi.safeUrl(undefined)).toBe('');
  });
});

describe('member.submitReceipt：团员凭证写入清洗（存储型 XSS 主向量）', () => {
  it('javascript: 凭证被拒绝、不产生保存', async () => {
    aoi.member.state = { key: 'k1', cn: '小樱', teamName: '团', updatedAt: null };
    const saved = [];
    const origPersist = aoi.member.persist;
    aoi.member.persist = async (d) => { saved.push(d); };
    try {
      await aoi.member.submitReceipt('b1', 'javascript:alert(1)');
      expect(saved).toHaveLength(0);
    } finally {
      aoi.member.persist = origPersist;
    }
  });

  it('https 凭证正常入库且状态为待审核', async () => {
    aoi.member.state = { key: 'k1', cn: '小樱', teamName: '团', updatedAt: null };
    const saved = [];
    const origPersist = aoi.member.persist;
    aoi.member.persist = async (d) => { saved.push(d); return 'ts1'; };
    try {
      await aoi.member.submitReceipt('b1', 'https://img.example.com/r.jpg');
      expect(saved).toHaveLength(1);
      const rec = saved[0].payments.find((p) => p.batchId === 'b1');
      expect(rec.receipt).toBe('https://img.example.com/r.jpg');
      expect(rec.status).toBe('待审核');
    } finally {
      aoi.member.persist = origPersist;
    }
  });
});

describe('商品与活动字段的 URL 写入口清洗', () => {
  it('registerProduct：参考图/跳转链接经 safeUrl（统一入口覆盖信息录入/展开区/目录推入）', async () => {
    const origSave = aoi.saveTeamData;
    aoi.saveTeamData = async () => {};
    try {
      const p = await aoi.orders.registerProduct('活A', {
        type: '吧唧', model: 'X',
        refImage: 'javascript:alert(1)',
        refUrl: 'https://shop.example.com/p1'
      });
      expect(p.refImage).toBe('');
      expect(p.refUrl).toBe('https://shop.example.com/p1');
    } finally {
      aoi.saveTeamData = origSave;
    }
  });

  it('setActivityField：平台链接仅接受 http/https', async () => {
    const origSave = aoi.saveTeamData;
    aoi.saveTeamData = async () => {};
    try {
      await aoi.orders.setActivityField('活A', 'link', 'javascript:alert(1)');
      expect(aoi.state.data.activityMeta['活A'].link).toBe('');
      await aoi.orders.setActivityField('活A', 'link', 'https://pokemoncenter-online.com/p/1');
      expect(aoi.state.data.activityMeta['活A'].link).toBe('https://pokemoncenter-online.com/p/1');
    } finally {
      aoi.saveTeamData = origSave;
    }
  });

  it('warehouse.add：收款码 URL 不合法时拒绝保存，合法时入库', async () => {
    const origSave = aoi.saveTeamData;
    aoi.saveTeamData = async () => {};
    try {
      doc.getElementById('whName').value = '囤货地A';
      doc.getElementById('whQr').value = 'javascript:alert(1)';
      await aoi.warehouse.add();
      expect(aoi.state.data.warehouses || []).toHaveLength(0);

      doc.getElementById('whQr').value = 'https://pay.example.com/qr.png';
      await aoi.warehouse.add();
      expect(aoi.state.data.warehouses).toHaveLength(1);
      expect(aoi.state.data.warehouses[0].qrCode).toBe('https://pay.example.com/qr.png');
    } finally {
      aoi.saveTeamData = origSave;
    }
  });
});

describe('supabase-schema.sql v3.10.0 守护（p_cn 后门 / 登录防爆破 / v2 归档防回退）', () => {
  const schema = readFileSync(resolve(__dirname, '../supabase-schema.sql'), 'utf8');

  it('p_cn 空值整份覆盖桥已封堵：缺失圈名一律拒绝', () => {
    expect(schema).not.toMatch(/v_merged := new_data/); // 兼容桥语句不得回潮
    expect(schema).toMatch(/raise exception '圈名缺失或不合法[^']*'/);
  });

  it('admin_login 防爆破：序列节流（v3.12.0 修正——v3.10.0 的计数 UPDATE 随 raise 回滚从未生效）', () => {
    // 序列必须在基线中预先存在（同事务 create 的序列会随回滚消失，setval 也就无从留存）
    expect(schema).toMatch(/create sequence if not exists admin_lastfail;/);
    expect(schema).toMatch(/尝试过于频繁，请稍后再试/);
    expect(schema).toMatch(/setval\('admin_lastfail', extract\(epoch from now\(\)\)::bigint, true\)/);
    // 事务回滚缺陷防回潮：计数列不得复活（drop 语句与注释提及不受限）
    expect(schema).not.toMatch(/add column if not exists failed_attempts/);
    expect(schema).not.toMatch(/add column if not exists locked_until/);
  });

  it('admin_bootstrap：首次初始化自动建团（v2 create_my_team 归档后的补位）', () => {
    expect(schema).toMatch(/if not exists \(select 1 from teams limit 1\) then/);
  });

  it('v2 账号体系已归档：函数/表/RLS 不再创建且有 drop 收敛语句', () => {
    ['create_my_team', 'join_team_by_code', 'regenerate_invite_code', 'regenerate_member_key', 'is_team_member'].forEach((fn) => {
      expect(schema).not.toMatch(new RegExp('create (or replace )?function public\\.' + fn + '\\b'));
      expect(schema).toMatch(new RegExp('drop function if exists public\\.' + fn));
    });
    expect(schema).not.toMatch(/create table if not exists team_members/);
    expect(schema).toMatch(/drop table if exists team_members;/);
    // Supabase Auth 依赖彻底移除：无可执行 auth.uid()（赋值/查询形态）、无 auth.users 外键、无任何 create policy
    expect(schema).not.toMatch(/:= auth\.uid\(\)/);
    expect(schema).not.toMatch(/select auth\.uid\(\)/);
    expect(schema).not.toMatch(/references auth\.users/);
    expect(schema).not.toMatch(/create policy/);
    // drop 收敛：v2 策略在老库重跑时被移除
    expect(schema).toMatch(/drop policy if exists "teams_select_member" on teams/);
    expect(schema).toMatch(/drop policy if exists "team_data_update" on team_data/);
  });
});
