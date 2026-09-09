// v3.6.3 F10-A/B/C · 团员端 QQ 绑定迭代：唯一性校验 / 解绑 / 复制绑定指令
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const KEY = 'MEMBER-KEY-abcdef';
const CN = '小樱';
const QQ = '1234567890';

function setupMember(opts) {
  opts = opts || {};
  aoi.state.data = {
    orders: [{ id: 'o1', buyer: CN, type: '吧唧', model: 'A款', price: 10, count: 2 }],
    memberMeta: opts.memberMeta || {}
  };
  aoi.state.user = null;
  aoi.member.state.key = KEY;
  aoi.member.state.cn = CN;
  aoi.member.state.teamName = '测试团';
  aoi.member.state.updatedAt = null;
  win.localStorage.clear();
  if (opts.debugTeam) win.localStorage.setItem('aoi_debug_team', JSON.stringify({ id: 'debug-team', name: '调试团', member_key: opts.debugTeam }));
}

function renderBind() {
  aoi.member.renderBind(CN);
  return doc.getElementById('memberQqBox').innerHTML;
}

describe('renderBind 双态（F10-C）', () => {
  beforeEach(() => setupMember());

  it('未绑定态：QQ 输入框 + 绑定按钮 + 复制绑定指令按钮', () => {
    const html = renderBind();
    expect(doc.getElementById('memberQq')).toBeTruthy();
    expect(html).toContain('Aoi.member.bindQq()');
    expect(html).toContain('Aoi.member.copyBindCommand()');
  });

  it('已绑定态：显示 QQ + 解绑按钮，无输入框', () => {
    aoi.state.data.memberMeta[CN] = { qq: QQ };
    const html = renderBind();
    expect(html).toContain(QQ);
    expect(html).toContain('Aoi.member.unbindQq()');
    expect(doc.getElementById('memberQq')).toBeNull();
  });
});

describe('bindCommand / copyBindCommand（F10-C）', () => {
  beforeEach(() => setupMember());

  it('bindCommand 用本机登录态密钥拼装指令', () => {
    expect(aoi.member.bindCommand()).toBe('绑定 ' + KEY + ' ' + CN);
  });

  it('copyBindCommand 走 clipboard 写入并 toast 提示', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    win.navigator.clipboard = { writeText: writeText };
    await aoi.member.copyBindCommand();
    expect(writeText).toHaveBeenCalledWith('绑定 ' + KEY + ' ' + CN);
  });

  it('缺少密钥时不拼装、不触碰剪贴板', async () => {
    aoi.member.state.key = null;
    const writeText = vi.fn().mockResolvedValue(undefined);
    win.navigator.clipboard = { writeText: writeText };
    await aoi.member.copyBindCommand();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('bindQq 唯一性校验（F10-A）', () => {
  beforeEach(() => setupMember());

  async function attemptBind(qq, rpcImpl) {
    renderBind();
    doc.getElementById('memberQq').value = qq;
    if (rpcImpl) aoi.db = { rpc: vi.fn(rpcImpl) };
    const persist = vi.fn().mockResolvedValue(undefined);
    aoi.member.persist = persist;
    await aoi.member.bindQq();
    return persist;
  }

  it('QQ 已被其他圈名绑定：拒绝并提示，不落库', async () => {
    const persist = await attemptBind(QQ, function (name, params) {
      expect(name).toBe('member_lookup_by_qq');
      expect(params.p_qq).toBe(QQ);
      return { data: { cn: '别人' } };
    });
    expect(persist).not.toHaveBeenCalled();
    expect(aoi.state.data.memberMeta[CN]).toBeUndefined();
  });

  it('QQ 绑定者就是本人圈名：放行正常写入', async () => {
    const persist = await attemptBind(QQ, () => ({ data: { cn: CN } }));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].memberMeta[CN].qq).toBe(QQ);
  });

  it('校验接口异常时放行（网页绑定不为单点校验阻塞）', async () => {
    const persist = await attemptBind(QQ, () => ({ data: null, error: { message: 'boom' } }));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].memberMeta[CN].qq).toBe(QQ);
  });

  it('debug 团跳过线上校验（不调 RPC），数据走 localStorage', async () => {
    setupMember({ debugTeam: 'DEMO' });
    aoi.member.state.key = 'DEMO'; // debug 判定：输入密钥与 debug 团密钥一致（与 data.js 读写分支同口径）
    renderBind();
    doc.getElementById('memberQq').value = QQ;
    const rpc = vi.fn();
    aoi.db = { rpc: rpc };
    const persist = vi.fn().mockResolvedValue(undefined);
    aoi.member.persist = persist;
    await aoi.member.bindQq();
    expect(rpc).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('unbindQq（F10-B 网页端）', () => {
  beforeEach(() => {
    setupMember({ memberMeta: (function () { const m = {}; m[CN] = { qq: QQ, remark: '副团' }; return m; })() });
  });

  it('确认后 qq 写空且保留 memberMeta 既有字段，重渲染为未绑定态', async () => {
    aoi.confirm = vi.fn().mockResolvedValue(true);
    const persist = vi.fn().mockResolvedValue(undefined);
    aoi.member.persist = persist;
    await aoi.member.unbindQq();
    expect(aoi.confirm).toHaveBeenCalledTimes(1);
    const meta = persist.mock.calls[0][0].memberMeta[CN];
    expect(meta.qq).toBe('');
    expect(meta.remark).toBe('副团');
    expect(renderBind()).toContain('复制绑定指令');
  });

  it('取消确认时不写库', async () => {
    aoi.confirm = vi.fn().mockResolvedValue(false);
    const persist = vi.fn().mockResolvedValue(undefined);
    aoi.member.persist = persist;
    await aoi.member.unbindQq();
    expect(persist).not.toHaveBeenCalled();
  });
});
