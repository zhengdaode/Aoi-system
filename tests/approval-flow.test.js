import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aoi, doc } from './helpers/aoi.js';

const BATCH = { id: 'b1', date: '2026-09-01' };

function setup(payments) {
  aoi.state.data = {
    batches: [BATCH],
    activities: ['CP27'],
    ips: [],
    orders: [
      { id: 'o1', batchId: 'b1', buyer: '小樱', type: '吧唧', model: 'A款', price: 10, count: 2, status: '已到货' },
      { id: 'o2', batchId: 'b1', buyer: '小明', type: '色纸', model: 'B款', price: 5, count: 1, status: '已到货' },
      { id: 'o3', batchId: null, buyer: '小樱', type: '吧唧', model: 'A款', price: 10, count: 1, status: '未到货' }
    ],
    payments: JSON.parse(JSON.stringify(payments))
  };
  aoi.saveTeamData = async (d) => { aoi.state.data = d; };
}

describe('Aoi.approval 交费审批', () => {
  beforeEach(() => {
    aoi.state.user = { id: 'boss', username: 'boss', role: 'super' };
    // select.value 仅在存在对应 option 时生效，先注入再选中（模拟 refillBatches 后的状态）
    const sel = doc.getElementById('approvalBatch');
    sel.innerHTML = '<option value="b1">批次 b1</option>';
    sel.value = 'b1';
  });

  it('buyerSummary：只汇总本批次订单货款，无记录时状态默认待交', () => {
    setup([]);
    const rows = aoi.approval.buyerSummary('b1');
    expect(rows.length).toBe(2); // 批次外订单不计入
    const sakura = rows.find(r => r.buyer === '小樱');
    expect(sakura.goods).toBe(20);
    expect(sakura.status).toBe('待交');
  });

  it('buyerSummary：已有交费记录时透传状态与国际费', () => {
    setup([{ id: 'p1', batchId: 'b1', buyer: '小明', status: '已交', intlFee: 3.5 }]);
    const rows = aoi.approval.buyerSummary('b1');
    const ming = rows.find(r => r.buyer === '小明');
    expect(ming.status).toBe('已交');
    expect(ming.intlFee).toBe(3.5);
  });

  it('render：审批表渲染买家与统计行', () => {
    setup([{ id: 'p1', batchId: 'b1', buyer: '小明', status: '已交' }]);
    aoi.approval.render();
    const html = doc.getElementById('approvalTbody').innerHTML;
    expect(html).toContain('小樱');
    expect(html).toContain('小明');
    expect(doc.getElementById('approvalStat').textContent).toContain('共 2 人 · 已交 1');
  });

  it('setStatus：确认后写入交费记录', async () => {
    setup([]);
    aoi.confirm = vi.fn().mockResolvedValue(true);
    await aoi.approval.setStatus('b1', '小明', '已交');
    const rec = aoi.approval.getRecord('b1', '小明');
    expect(rec.status).toBe('已交');
    expect(aoi.confirm).toHaveBeenCalledTimes(1);
  });

  it('setStatus：确认弹窗取消则不写入', async () => {
    setup([]);
    aoi.confirm = vi.fn().mockResolvedValue(false);
    await aoi.approval.setStatus('b1', '小明', '已交');
    expect(aoi.approval.getRecord('b1', '小明')).toBeNull();
  });

  it('remind：催缴名单只含待交/已驳回，已交不出现', () => {
    setup([{ id: 'p1', batchId: 'b1', buyer: '小明', status: '已交', intlFee: 3.5 }]);
    aoi.approval.remind();
    const text = doc.getElementById('approvalRemind').value;
    expect(text).toContain('小樱');
    expect(text).not.toContain('小明');
  });

  it('copyRemind：复用 Aoi.copyText 复制催缴名单', () => {
    setup([]);
    aoi.approval.remind();
    aoi.copyText = vi.fn().mockResolvedValue();
    aoi.approval.copyRemind();
    expect(aoi.copyText).toHaveBeenCalledWith(doc.getElementById('approvalRemind').value);
  });

  it('refillBatches：批次下拉由通用填充逻辑生成并带订单计数', () => {
    setup([]);
    aoi.orders.batchCount = vi.fn().mockReturnValue(3);
    aoi.approval.refillBatches();
    const sel = doc.getElementById('approvalBatch');
    expect(sel.innerHTML).toContain('value="b1"');
    expect(sel.innerHTML).toContain('（3）');
  });
});
