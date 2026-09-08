// F5-M7 · 排发表 xlsx 私发管理员：Aoi.bot.exportShipping 组包 + setShipped 自动触发钩子
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

function setup(orders) {
  aoi.state.data = {
    batches: [{ id: 'b1', date: '2026-09-01' }],
    activities: ['CP27'],
    ips: [],
    typeMeta: { '吧唧': { route: '广东' }, '色纸': { route: '北京' } },
    orders: JSON.parse(JSON.stringify(orders)),
    warehouses: [{ id: 'w1', name: '广东站', qrCode: '' }],
    payments: []
  };
  aoi.saveTeamData = async (d) => { aoi.state.data = d; };
}

const ORDERS = [
  { id: 'o1', batchId: 'b1', buyer: '小樱', type: '吧唧', model: 'A款', price: 10, count: 2, status: '已到货', shipped: '已发', tracking: 'SF001', warehouseId: 'w1' },
  { id: 'o2', batchId: 'b1', buyer: '小明', type: '色纸', model: 'B款', price: 5, count: 1, status: '已到货' }
];

function enableBot() {
  aoi.bot.config.enabled = true;
  aoi.bot.config.relay = 'https://relay.example.com';
  aoi.bot.config.groupId = '999';
  aoi.bot.config.adminQq = '10086';
}

describe('Aoi.bot.exportShipping（F5-H① 排发表私发管理员）', () => {
  beforeEach(() => {
    setup(ORDERS);
    aoi.state.user = { id: 'boss', username: 'boss', role: 'super' };
    aoi.adminSaveSession({ token: 't'.repeat(64), role: 'super', username: 'boss', expiresAt: '2099-01-01T00:00:00Z' });
    enableBot();
  });

  it('按 Aoi.ship.export 同款字段组包，POST <relay>/onebot/export-shipping，targetQq=adminQq', async () => {
    const calls = [];
    win.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ ok: true, name: '排发_2026-09-01.xlsx', rows: 2 }) };
    });
    const r = await aoi.bot.exportShipping('b1');
    expect(r).toEqual({ ok: true, name: '排发_2026-09-01.xlsx', rows: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://relay.example.com/onebot/export-shipping');
    const body = JSON.parse(calls[0].init.body);
    expect(body.batchId).toBe('b1');
    expect(body.batchDate).toBe('2026-09-01');
    expect(body.targetQq).toBe('10086');
    expect(body.rows).toEqual([
      { '购买者': '小樱', '制品': '吧唧 - A款', '发货线路': '广东', '数量': 2, '囤货地': '广东站', '快递单号': 'SF001', '合照': '', '状态': '已发' },
      { '购买者': '小明', '制品': '色纸 - B款', '发货线路': '北京', '数量': 1, '囤货地': '', '快递单号': '', '合照': '', '状态': '未发' }
    ]);
  });

  it('未配置管理员转发 QQ / 机器人未接入时抛引导性错误', async () => {
    aoi.bot.config.adminQq = '';
    await expect(aoi.bot.exportShipping('b1')).rejects.toThrow(/管理员转发 QQ/);
    aoi.bot.config.enabled = false;
    await expect(aoi.bot.exportShipping('b1')).rejects.toThrow(/未接入/);
  });

  it('relay 非 2xx 时抛出带状态码的错误', async () => {
    win.fetch = vi.fn(async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }));
    await expect(aoi.bot.exportShipping('b1')).rejects.toThrow(/502/);
  });
});

describe('Aoi.ship.setShipped 排发钩子（F5-H①：设为已发后自动私发排发表）', () => {
  beforeEach(() => {
    setup(ORDERS);
    aoi.state.user = { id: 'boss', username: 'boss', role: 'super' };
    aoi.notify.sync = vi.fn();
    aoi.overview.render = vi.fn();
    enableBot();
  });

  async function shipFirst() {
    // shipBatch 是 select：先填充选项再选中（用例间共享 DOM，不能依赖其他文件的填充）
    aoi.orders.batchCount = vi.fn().mockReturnValue(2);
    aoi.ship.refillBatches();
    doc.getElementById('shipBatch').value = 'b1';
    aoi.ship.render();
    const cb = doc.querySelector('.ship-check');
    cb.checked = true;
    doc.getElementById('shipStatus').value = '已发';
    await aoi.ship.setShipped();
  }

  it('批量设为已发后调用 exportShipping(batchId) 一次（异步不阻塞）', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    aoi.bot.exportShipping = spy;
    await shipFirst();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('b1');
    expect(aoi.notify.sync).toHaveBeenCalled();
  });

  it('未配置 adminQq 时钩子静默跳过（不调用、不报错）', async () => {
    aoi.bot.config.adminQq = '';
    const spy = vi.fn().mockResolvedValue({ ok: true });
    aoi.bot.exportShipping = spy;
    await shipFirst();
    expect(spy).not.toHaveBeenCalled();
    expect(aoi.state.data.orders.find(o => o.id === 'o1').shipped).toBe('已发');
  });

  it('exportShipping 失败不影响设为已发本身（异步 catch，不向上抛）', async () => {
    const spy = vi.fn().mockRejectedValue(new Error('网络炸了'));
    aoi.bot.exportShipping = spy;
    await shipFirst();
    await new Promise(r => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(aoi.state.data.orders.find(o => o.id === 'o1').shipped).toBe('已发');
  });
});
