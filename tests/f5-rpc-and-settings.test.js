// v3.5.0 F5-M4 · 设置页 botConfig 扩展（adminQq / qrUrl）持久化 + 3 个 QQ 机器人 RPC schema 守护
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi, doc } from './helpers/aoi.js';

function setInputs(values) {
  const set = (id, v) => { const el = doc.getElementById(id); if (el) el.value = v; };
  const chk = doc.getElementById('botEnabled');
  if (chk) chk.checked = !!values.enabled;
  set('botRelay', values.relay || '');
  set('botGroupId', values.groupId || '');
  set('botAdminQq', values.adminQq || '');
  set('botQrUrl', values.qrUrl || '');
}

describe('Aoi.bot 设置页扩展：botConfig.adminQq / botConfig.qrUrl 读写持久化', () => {
  beforeEach(() => {
    aoi.state.data = { orders: [], memberMeta: {} };
    aoi.state.user = null;
  });

  it('saveSettings 把管理员转发 QQ 与二维码 URL 写入 blob.botConfig', async () => {
    setInputs({ enabled: false, relay: 'https://relay.example.com', groupId: '999', adminQq: '10086', qrUrl: 'https://img.example.com/qr.png' });
    const saved = [];
    aoi.saveTeamData = async (d) => { saved.push(d); };
    await aoi.bot.saveSettings();
    expect(saved).toHaveLength(1);
    expect(saved[0].botConfig).toEqual({
      enabled: false,
      relay: 'https://relay.example.com',
      groupId: '999',
      adminQq: '10086',
      qrUrl: 'https://img.example.com/qr.png'
    });
  });

  it('load 从 blob 回填新字段；未配置时为空串（旧数据兼容）', () => {
    aoi.state.data = { orders: [], botConfig: { enabled: true, relay: 'https://r.example.com', groupId: '1', adminQq: '10086', qrUrl: 'https://img.example.com/qr.png' } };
    aoi.bot.load();
    expect(aoi.bot.config.adminQq).toBe('10086');
    expect(aoi.bot.config.qrUrl).toBe('https://img.example.com/qr.png');

    aoi.state.data = { orders: [], botConfig: { enabled: true, relay: 'https://r.example.com', groupId: '1' } };
    aoi.bot.load();
    expect(aoi.bot.config.adminQq).toBe('');
    expect(aoi.bot.config.qrUrl).toBe('');
  });

  it('renderSettings 把 botConfig 回填到设置页输入框（含上传控件目标 botQrUrl）', () => {
    aoi.state.data = { orders: [], botConfig: { enabled: true, relay: 'https://r.example.com', groupId: '1', adminQq: '10010', qrUrl: 'https://img.example.com/qr2.png' } };
    aoi.bot.renderSettings();
    expect(doc.getElementById('botAdminQq').value).toBe('10010');
    expect(doc.getElementById('botQrUrl').value).toBe('https://img.example.com/qr2.png');
  });

  it('设置页存在新控件：botAdminQq 输入框 + 二维码上传控件（Aoi.img.fill 目标 botQrUrl）', () => {
    expect(doc.getElementById('botAdminQq')).toBeTruthy();
    expect(doc.getElementById('botQrUrl')).toBeTruthy();
    expect(doc.querySelector('input[onchange="Aoi.img.fill(this, \'botQrUrl\')"]')).toBeTruthy();
  });
});

describe('supabase-schema.sql 守护：F5 的 3 个机器人 RPC 已合入', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase-schema.sql'), 'utf8');

  it('三个 RPC 均为 drop 重建 + security definer + 白名单出参', () => {
    expect(sql).toContain('drop function if exists public.member_lookup_by_qq(text)');
    expect(sql).toContain('create function public.member_lookup_by_qq(p_qq text)');
    expect(sql).toContain('drop function if exists public.team_summary_for_group()');
    expect(sql).toContain('create function public.team_summary_for_group()');
    expect(sql).toContain('drop function if exists public.unpaid_members_by_group()');
    expect(sql).toContain('create function public.unpaid_members_by_group()');
    // 行为关键片段
    expect(sql).toContain("value->>'qq' = p_qq");        // QQ→CN 解析
    expect(sql).toContain("'{botConfig,qrUrl}'");        // settings 白名单出参
    expect(sql).toContain("'{botConfig,adminQq}'");
  });

  it('jsonb_each 不得使用 k 别名（v3.4.0 线上 42703 事故纪律）', () => {
    expect(sql).not.toMatch(/jsonb_each\s*\(\s*[^)]*\bas\s+k\b/);
  });
});
