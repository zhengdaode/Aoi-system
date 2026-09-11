// v3.12.0：B3 审计日志（表/RPC 接线/仅 super 查询清理/UI 挂钩）+ B4 推送链路加固
// （Edge UPSTREAM env 化、body/响应上限、重定向逐跳校验；relay 同款 + 审计端点 + 限频）
// + B5 迁移机制（schema_migrations 表 + sb.js --migrate）+ CSP 收紧。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aoi, win, doc } from './helpers/aoi.js';

const ROOT = resolve(__dirname, '..');
const schema = readFileSync(resolve(ROOT, 'supabase-schema.sql'), 'utf8');
const edge = readFileSync(resolve(ROOT, 'supabase/functions/qq-relay/index.ts'), 'utf8');
const relay = readFileSync(resolve(ROOT, 'relay/relay.js'), 'utf8');
const netlify = readFileSync(resolve(ROOT, 'netlify.toml'), 'utf8');
const sbjs = readFileSync(resolve(ROOT, 'scripts/sb.js'), 'utf8');

beforeEach(() => {
  win.localStorage.clear();
  aoi.toast = vi.fn();
});

describe('B3 审计日志：schema 守护', () => {
  it('审计表 + 写入辅助存在，RLS 开启无策略', () => {
    expect(schema).toMatch(/create table if not exists admin_audit_log/);
    expect(schema).toMatch(/create or replace function public\.admin_audit\(p_admin jsonb, p_action text/);
    expect(schema).toMatch(/alter table admin_audit_log enable row level security/);
  });

  it('关键 RPC 全部接线审计（登录成功/登出/账号变更/密钥/改名/保存摘要）', () => {
    // 注：登录「失败」不留审计行——raise 会回滚同事务的 insert（防爆破走序列节流）
    expect(schema).toMatch(/admin_audit\(jsonb_build_object\('id', v_admin\.id, 'username', v_admin\.username\), 'login'\)/);
    expect(schema).toMatch(/'logout'\)/);
    expect(schema).toMatch(/'admin_create'/);
    expect(schema).toMatch(/'admin_delete'/);
    expect(schema).toMatch(/'admin_reset_password'/);
    expect(schema).toMatch(/'change_password'/);
    expect(schema).toMatch(/'regenerate_member_key'\)/);
    expect(schema).toMatch(/'rename_team'/);
    expect(schema).toMatch(/'save_team_data',\s*\r?\n?\s*jsonb_build_object\('orders'/); // 只记摘要不落全文
    expect(schema).toMatch(/'bootstrap'\)/);
  });

  it('查询/清理 RPC 存在且仅 super', () => {
    expect(schema).toMatch(/create or replace function public\.admin_list_audit_log\(p_token text, p_limit int default 100\)/);
    expect(schema).toMatch(/create or replace function public\.admin_clear_audit_log\(p_token text\)/);
    expect(schema.match(/仅超级管理员可查看审计日志|仅超级管理员可清理审计日志/g) || []).toHaveLength(2);
    expect(schema).toMatch(/at < now\(\) - interval '90 days'/); // 90 天保留窗口
  });
});

describe('B3 审计日志：前端挂钩（team.js auditMgmt）', () => {
  it('renderSettings 对 super 显示审计卡并触发渲染', async () => {
    aoi.state.team = { id: 't', name: '团' };
    aoi.state.role = 'super';
    aoi.state.user = { isDebug: true };
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    aoi.db = { rpc };
    aoi.renderSettings();
    expect(doc.getElementById('auditSection').classList.contains('hidden')).toBe(false);
    await new Promise((r) => setTimeout(r, 0)); // 等异步渲染
    expect(doc.getElementById('auditList').textContent).toContain('调试模式');
  });

  it('auditMgmt.render 携带 token 调 admin_list_audit_log 并渲染行', async () => {
    aoi.state.user = { isDebug: false };
    aoi.adminLoadSession = () => ({ token: 'tok' });
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 1, username: 'boss', action: 'save_team_data', detail: { orders: 5, bytes: 1024 }, at: '2026-09-12T01:02:03+00' }],
      error: null
    });
    aoi.db = { rpc };
    await aoi.auditMgmt.render();
    expect(rpc).toHaveBeenCalledWith('admin_list_audit_log', { p_token: 'tok', p_limit: 50 });
    expect(doc.getElementById('auditList').textContent).toContain('boss');
    expect(doc.getElementById('auditList').textContent).toContain('save_team_data');
  });
});

describe('B4 推送链路加固（文本守护）', () => {
  it('Edge Function：UPSTREAM 走 env（不再硬编码 IP）、POST/响应有上限、重定向逐跳校验', () => {
    expect(edge).toMatch(/Deno\.env\.get\('RELAY_UPSTREAM'\)/);
    expect(edge).not.toMatch(/47\.101\.194\.103/); // 仓库不再硬编码 relay IP
    expect(edge).toMatch(/64 \* 1024/);
    expect(edge).toMatch(/10 \* 1024 \* 1024/);
    expect(edge).toMatch(/redirect: 'manual'/);
    expect(edge).toMatch(/redirect host not allowed/);
  });

  it('relay：body/消息上限、限频、审计端点、重定向逐跳校验、注释为 systemd', () => {
    expect(relay).toMatch(/MAX_BODY = 64 \* 1024/);
    expect(relay).toMatch(/message too long \(max 4500 chars\)/);
    expect(relay).toMatch(/max 60\/min/);
    expect(relay).toMatch(/\/audit/);
    expect(relay).toMatch(/redirect host not allowed/);
    expect(relay).toMatch(/redirect: 'manual'/);
    expect(relay).toMatch(/systemctl restart qq-relay/);
    expect(relay).not.toMatch(/pm2 start relay\.js --name qq-relay && pm2 save/);
  });

  it('netlify.toml：connect-src 收紧为白名单（无裸 https:）、移除 jsdelivr', () => {
    expect(netlify).toMatch(/connect-src 'self' https:\/\/\*\.supabase\.co https:\/\/static\.zwlhome\.com/);
    expect(netlify).not.toMatch(/connect-src[^;]*https:;/);
    expect(netlify).not.toMatch(/jsdelivr/);
    expect(netlify).toMatch(/script-src 'self' 'unsafe-inline' https:\/\/cdn\.tailwindcss\.com;/); // Tailwind 仍 CDN（运行时 JIT）
  });
});

describe('B5 迁移机制', () => {
  it('schema_migrations 表存在；sb.js 具备 --migrate 且对象单元格 JSON 展开', () => {
    expect(schema).toMatch(/create table if not exists schema_migrations/);
    expect(sbjs).toMatch(/'--migrate'/);
    expect(sbjs).toMatch(/schema_migrations/);
    expect(sbjs).toMatch(/function cellStr/); // [object Object] 待修项已修
    expect(sbjs).not.toMatch(/String\(r\[c\] == null \? 'NULL' : r\[c\]\)/);
  });
});
