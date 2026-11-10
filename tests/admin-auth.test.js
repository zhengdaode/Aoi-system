import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, win, doc } from './helpers/aoi.js';

// v3.35.0：本文件守护 blob 旧通道（回退路径）——P4 切换后须显式指定 DATA_MODE
beforeEach(() => { aoi.DATA_MODE = 'blob'; });

const SESSION = { token: 't'.repeat(64), role: 'super', username: 'boss', expiresAt: '2099-01-01T00:00:00Z' };

function doc_set(id, v) { doc.getElementById(id).value = v; }

describe('Aoi v3 管理员会话（脱离 Supabase Auth）', () => {
  beforeEach(() => {
    win.localStorage.clear();
    aoi.adminClearSession();
    aoi.state.user = null;
    aoi.state.data = {};
  });

  it('adminSaveSession/LoadSession：持久化与恢复', () => {
    aoi.adminSaveSession(SESSION);
    aoi.adminSession = null; // 模拟页面刷新
    expect(aoi.adminLoadSession()).toEqual(SESSION);
  });

  it('过期会话自动失效', () => {
    aoi.adminSaveSession({ ...SESSION, expiresAt: '2000-01-01T00:00:00Z' });
    aoi.adminSession = null;
    expect(aoi.adminLoadSession()).toBeNull();
  });

  it('login：调 admin_login 并保存会话、进入应用', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: SESSION, error: null });
    aoi.db = { rpc };
    aoi.enterApp = vi.fn().mockResolvedValue(undefined);
    doc_set('loginUsername', 'boss');
    doc_set('loginPassword', 'secret123');
    await aoi.auth.login();
    expect(rpc).toHaveBeenCalledWith('admin_login', { p_username: 'boss', p_password: 'secret123' });
    expect(aoi.adminLoadSession()).toEqual(SESSION);
    expect(aoi.enterApp).toHaveBeenCalled();
  });

  it('login：服务端报错时不保存会话', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: '用户名或密码错误' } });
    aoi.db = { rpc };
    aoi.enterApp = vi.fn().mockResolvedValue(undefined);
    doc_set('loginUsername', 'boss');
    doc_set('loginPassword', 'wrong');
    await aoi.auth.login();
    expect(aoi.adminLoadSession()).toBeNull();
  });

  it('debug 账号短路：不触 RPC 直接进入应用', async () => {
    const rpc = vi.fn();
    aoi.db = { rpc };
    aoi.enterApp = vi.fn().mockResolvedValue(undefined);
    doc_set('loginUsername', 'debug');
    doc_set('loginPassword', 'debug123');
    await aoi.auth.login();
    expect(rpc).not.toHaveBeenCalled();
    expect(aoi.enterApp).toHaveBeenCalled();
    expect(aoi.state.user.isDebug).toBe(true);
  });

  it('logout：调 admin_logout 并清空会话', async () => {
    aoi.adminSaveSession(SESSION);
    aoi.state.user = { username: 'boss' };
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    aoi.db = { rpc };
    await aoi.auth.logout();
    expect(rpc).toHaveBeenCalledWith('admin_logout', { p_token: SESSION.token });
    expect(aoi.adminLoadSession()).toBeNull();
    expect(aoi.state.data).toEqual({});
  });
});

describe('Aoi.saveTeamData（v3：token RPC + 乐观锁）', () => {
  beforeEach(() => {
    win.localStorage.clear();
    aoi.adminClearSession();
    aoi.state.user = { username: 'boss', role: 'super' };
  });

  it('携带 token 与当前数据版本，成功后更新版本', async () => {
    aoi.adminSaveSession(SESSION);
    aoi.adminUpdatedAt = 'v1';
    const rpc = vi.fn().mockResolvedValue({ data: 'v2', error: null });
    aoi.db = { rpc };
    await aoi.saveTeamData({ orders: [1] });
    expect(rpc).toHaveBeenCalledWith('admin_save_team_data', {
      p_token: SESSION.token,
      p_data: { orders: [1] },
      p_expected_updated_at: 'v1'
    });
    expect(aoi.adminUpdatedAt).toBe('v2');
  });

  it('无会话时抛错而不写库', async () => {
    const rpc = vi.fn();
    aoi.db = { rpc };
    await expect(aoi.saveTeamData({})).rejects.toThrow(/会话已失效/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('版本冲突：清空本地版本并抛可读错误', async () => {
    aoi.adminSaveSession(SESSION);
    aoi.adminUpdatedAt = 'stale';
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: '数据已被他人修改，请刷新后重试' } }) };
    await expect(aoi.saveTeamData({})).rejects.toThrow(/已被他人修改/);
    expect(aoi.adminUpdatedAt).toBeNull();
  });

  it('debug 模式走 localStorage 不触 RPC', async () => {
    win.localStorage.setItem('aoi_debug_team', JSON.stringify({ name: '调试团', member_key: 'DEMO' }));
    aoi.state.user = { username: 'debug', isDebug: true };
    const rpc = vi.fn();
    aoi.db = { rpc };
    await aoi.saveTeamData({ orders: [1] });
    expect(JSON.parse(win.localStorage.getItem('aoi_debug_data'))).toEqual({ orders: [1] });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('Aoi.adminMgmt 管理员账号管理（v3-④）', () => {
  beforeEach(() => {
    win.localStorage.clear();
    aoi.adminSaveSession(SESSION);
    aoi.state.user = { username: 'boss', role: 'super' };
    aoi.saveTeamData = vi.fn().mockResolvedValue(undefined);
  });

  it('render 列出账号并标注自己', async () => {
    aoi.db = { rpc: vi.fn().mockResolvedValue({ data: [
      { id: 'a1', username: 'boss', role: 'super' },
      { id: 'a2', username: 'helper', role: 'admin' }
    ], error: null }) };
    await aoi.adminMgmt.render();
    const html = doc.getElementById('adminMgmtList').innerHTML;
    expect(html).toContain('boss');
    expect(html).toContain('· 我');
    expect(html).toContain('data-am-del="a2"');
    expect(html).not.toContain('data-am-del="a1"'); // 不能删自己
  });

  it('add 调 admin_create 并刷新列表', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'a3', username: 'newbie', role: 'admin' }, error: null });
    aoi.db = { rpc };
    doc_set('amUsername', 'newbie');
    doc_set('amPassword', 'password6');
    doc.getElementById('amRole').value = 'admin';
    await aoi.adminMgmt.add();
    expect(rpc).toHaveBeenCalledWith('admin_create', {
      p_token: SESSION.token, p_username: 'newbie', p_password: 'password6', p_role: 'admin'
    });
  });

  it('remove 调 admin_delete', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    aoi.db = { rpc };
    aoi.confirm = vi.fn().mockResolvedValue(true);
    await aoi.adminMgmt.remove('a2', 'helper');
    expect(rpc).toHaveBeenCalledWith('admin_delete', { p_token: SESSION.token, p_admin_id: 'a2' });
  });
});
