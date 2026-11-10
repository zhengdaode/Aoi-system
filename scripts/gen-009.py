# -*- coding: utf-8 -*-
# 一次性生成器：从 004 提取 aoi_sync/组装主体，生成 009-c-member-and-transfers.sql
import io, re

src004 = io.open('supabase/migrations/004-c-rpc.sql', encoding='utf-8').read()

# ── 1. 提取 v_blob 组装主体（v_blob := ... 到 perform admin_audit 之前）──
start = src004.index('  v_blob :=\n    jsonb_build_object(')
end = src004.index("  perform public.admin_audit(v_admin, 'aoi_get_all',")
body = src004[start:end]

# transfers 段插到 limitPlans 段之前（jsonb_build_object 内）
anchor = "      'limitPlans', coalesce(("
assert body.count(anchor) == 1, 'limitPlans anchor'
transfers_seg = """      'transfers', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', t.id, 'buyer', t.buyer, 'batchId', t.batch_id,
          'toWarehouseId', t.to_warehouse_id, 'reason', t.reason,
          'status', t.status, 'date', t.date
        )) order by t.sort)
        from aoi_transfers t where t.team_id = v_team
      ), '[]'::jsonb),

"""
body = body.replace(anchor, transfers_seg + anchor)

# ── 2. aoi_sync 全文（004 版）+ transfers 管理段 ──
m = re.search(r"create or replace function public\.aoi_sync\(p_token text, p_changes jsonb\)\nreturns jsonb\n.*?end;\n\$\$;", src004, re.S)
assert m, 'aoi_sync not found'
sync_body = m.group(0)
anchor7 = "  -- —— limitPlans / typeMeta / memberMeta / addresses / settings ——"
assert sync_body.count(anchor7) == 1, 'sync anchor7'
transfers_mgmt = """  -- —— transfers（管理端审批/驳回，行级）——
  if p_changes ? 'transfers' then
    if p_changes->'transfers' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'transfers'->'delete')) loop
        delete from aoi_transfers where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'transfers' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'transfers'->'upsert') loop
        insert into aoi_transfers (team_id, id, buyer, batch_id, to_warehouse_id, reason, status, date, sort)
        values (v_team, v_row->>'id', v_row->>'buyer', nullif(v_row->>'batchId',''), nullif(v_row->>'toWarehouseId',''),
                v_row->>'reason', nullif(v_row->>'status',''), v_row->>'date', coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set buyer = excluded.buyer, batch_id = excluded.batch_id, to_warehouse_id = excluded.to_warehouse_id,
              reason = excluded.reason, status = excluded.status, date = excluded.date, sort = excluded.sort;
      end loop;
    end if;
  end if;

"""
sync_body = sync_body.replace(anchor7, transfers_mgmt + anchor7)

assemble_fn = """-- ─────────────── 组装主体（get_all / member_get 共用） ───────────────
create or replace function public.aoi_assemble(v_team uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_blob jsonb;
begin
""" + body + """
  return v_blob;
end;
$$;
"""

get_all_fn = """-- ─────────────── aoi_get_all（瘦身：鉴权 + 组装 + 包装） ───────────────
create or replace function public.aoi_get_all(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin json;
  v_team uuid;
  v_blob jsonb;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  v_team := public.assert_single_team();
  if v_team is null then raise exception '尚未创建团队'; end if;
  v_blob := public.aoi_assemble(v_team);
  perform public.admin_audit(v_admin, 'aoi_get_all',
    jsonb_build_object('bytes', octet_length(v_blob::text)));
  return json_build_object(
    'name', (select t.name from teams t where t.id = v_team),
    'memberKey', (select t.member_key from teams t where t.id = v_team),
    'data', v_blob,
    'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;
"""

member_get_fn = """-- ─────────────── 团员端读取（PII 裁剪，语义复刻 get_team_by_member_key） ───────────────
create or replace function public.aoi_member_get(p_member_key text, p_cn text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team uuid;
  v_team_name text;
  v_blob jsonb;
  v_cn text;
  v_qq_cn text;
begin
  select t.id, t.name into v_team, v_team_name from teams t where t.member_key = p_member_key limit 1;
  if v_team is null then return null; end if;

  v_blob := public.aoi_assemble(v_team);
  v_cn := p_cn;

  -- 输入可能是 QQ 号：member_meta.qq 命中换算 CN
  if v_cn is not null then
    select cn into v_qq_cn from aoi_member_meta where team_id = v_team and qq = p_cn limit 1;
    if v_qq_cn is not null then v_cn := v_qq_cn; end if;
  end if;

  if v_cn is null then
    v_blob := v_blob - 'addresses' - 'memberMeta' - 'cnChanges';
  else
    v_blob := jsonb_set(v_blob, '{addresses}',
      coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_blob->'addresses', '{}'::jsonb)) where key = v_cn), '{}'::jsonb), true);
    v_blob := jsonb_set(v_blob, '{memberMeta}',
      coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_blob->'memberMeta', '{}'::jsonb)) where key = v_cn), '{}'::jsonb), true);
    v_blob := jsonb_set(v_blob, '{cnChanges}',
      coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(v_blob->'cnChanges', '[]'::jsonb)) e
                where e->>'oldCn' = v_cn or e->>'newCn' = v_cn), '[]'::jsonb), true);
  end if;

  return json_build_object(
    'name', v_team_name,
    'data', v_blob,
    'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cn', v_cn
  );
end;
$$;
"""

member_sync_fn = """-- ─────────────── 团员端写入（白名单，语义复刻 update_team_data_by_member_key） ───────────────
create or replace function public.aoi_member_sync(
  p_member_key text,
  p_data jsonb,
  p_cn text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_team uuid;
  v_cn text;
  v_qq_cn text;
  v_row jsonb;
  v_item jsonb;
  v_meta jsonb;
begin
  select t.id into v_team from teams t where t.member_key = p_member_key limit 1;
  if v_team is null then raise exception '密钥无效'; end if;

  -- p_cn 校验（缺失/空/超长拒绝，防旧客户端整包覆盖）
  if p_cn is null or length(trim(p_cn)) = 0 or length(p_cn) > 64 then
    raise exception '圈名缺失或不合法，已拒绝写入（客户端版本过旧请刷新页面）';
  end if;
  v_cn := p_cn;
  select cn into v_qq_cn from aoi_member_meta where team_id = v_team and qq = p_cn limit 1;
  if v_qq_cn is not null then v_cn := v_qq_cn; end if;

  -- 本人 addresses 条目
  if p_data ? 'addresses' and p_data->'addresses' ? v_cn then
    insert into aoi_addresses (team_id, cn, address)
    values (v_team, v_cn, p_data#>>array['addresses', v_cn])
    on conflict (team_id, cn) do update set address = excluded.address;
  end if;

  -- 本人 memberMeta 条目
  if p_data ? 'memberMeta' and p_data->'memberMeta' ? v_cn then
    v_meta := p_data#>array['memberMeta', v_cn];
    insert into aoi_member_meta (team_id, cn, qq, extras)
    values (v_team, v_cn, v_meta->>'qq', coalesce(v_meta - 'qq', '{}'::jsonb))
    on conflict (team_id, cn) do update set qq = excluded.qq, extras = excluded.extras;
  end if;

  -- 本人 orders（行级覆盖，语义同旧 jsonb_array_upsert_by_id；团员不改顺序——sort 不动）
  for v_row in select e from jsonb_array_elements(coalesce(p_data->'orders', '[]'::jsonb)) e
                where e->>'buyer' = v_cn and e->>'id' is not null
  loop
    insert into aoi_orders (team_id, id, activity_name, ip, type, model, buyer, currency, price, price_orig,
                            count, status, remark, batch_id, intl_fee, shipped, shipped_at,
                            shop_order_id, shop_order_no, ai_aligned, sort_order)
    values (v_team, v_row->>'id', v_row->>'activity', nullif(v_row->>'ip',''), v_row->>'type', v_row->>'model',
            v_row->>'buyer', v_row->>'currency',
            nullif(v_row->>'price','')::numeric, nullif(v_row->>'priceOrig','')::numeric,
            coalesce(nullif(v_row->>'count','')::numeric, 1),
            nullif(v_row->>'status',''), nullif(v_row->>'remark',''), nullif(v_row->>'batchId',''),
            nullif(v_row->>'intlFee','')::numeric,
            nullif(v_row->>'shipped',''), nullif(v_row->>'shippedAt',''),
            nullif(v_row->>'shopOrderId',''), nullif(v_row->>'shopOrderNo',''),
            v_row->'_aiAligned',
            (select coalesce(max(sort_order), 0) + 1 from aoi_orders where team_id = v_team))
    on conflict (team_id, id) do update
      set activity_name = excluded.activity_name, ip = excluded.ip, type = excluded.type, model = excluded.model,
          buyer = excluded.buyer, currency = excluded.currency, price = excluded.price, price_orig = excluded.price_orig,
          count = excluded.count, status = excluded.status, remark = excluded.remark, batch_id = excluded.batch_id,
          intl_fee = excluded.intl_fee, shipped = excluded.shipped, shipped_at = excluded.shipped_at,
          shop_order_id = excluded.shop_order_id, shop_order_no = excluded.shop_order_no,
          ai_aligned = excluded.ai_aligned, updated_at = now();
  end loop;

  -- 本人 payments：凭证字段可写；状态仅接受 待交/待审核（防自批「已交」）
  for v_item in select e from jsonb_array_elements(coalesce(p_data->'payments', '[]'::jsonb)) e
                where e->>'buyer' = v_cn and e->>'id' is not null
  loop
    if exists (select 1 from aoi_payments where team_id = v_team and id = v_item->>'id') then
      update aoi_payments set
        receipt = coalesce(v_item->>'receipt', receipt),
        receipt_date = coalesce(v_item->>'receiptDate', receipt_date),
        status = case when coalesce(v_item->>'status','') in ('待交','待审核')
                      then v_item->>'status' else status end
      where team_id = v_team and id = v_item->>'id';
    else
      insert into aoi_payments (team_id, id, batch_id, buyer, status, receipt, receipt_date, sort)
      values (v_team, v_item->>'id', nullif(v_item->>'batchId',''),
              coalesce(v_item->>'buyer', v_cn),
              case when coalesce(v_item->>'status','') in ('待交','待审核')
                   then v_item->>'status' else '待审核' end,
              v_item->>'receipt', v_item->>'receiptDate',
              (select coalesce(max(sort), 0) + 1 from aoi_payments where team_id = v_team));
    end if;
  end loop;

  -- 本人 transfers（按 id upsert，语义同旧整行覆盖）
  for v_item in select e from jsonb_array_elements(coalesce(p_data->'transfers', '[]'::jsonb)) e
                where e->>'buyer' = v_cn and e->>'id' is not null
  loop
    insert into aoi_transfers (team_id, id, buyer, batch_id, to_warehouse_id, reason, status, date, sort)
    values (v_team, v_item->>'id', v_cn, nullif(v_item->>'batchId',''), nullif(v_item->>'toWarehouseId',''),
            v_item->>'reason', coalesce(v_item->>'status','待处理'), v_item->>'date',
            (select coalesce(max(sort), 0) + 1 from aoi_transfers where team_id = v_team))
    on conflict (team_id, id) do update
      set batch_id = excluded.batch_id, to_warehouse_id = excluded.to_warehouse_id,
          reason = excluded.reason, status = excluded.status, date = excluded.date;
  end loop;

  -- 本人 cnChanges（按 id upsert）
  for v_item in select e from jsonb_array_elements(coalesce(p_data->'cnChanges', '[]'::jsonb)) e
                where (e->>'oldCn' = v_cn or e->>'newCn' = v_cn) and e->>'id' is not null
  loop
    insert into aoi_cn_changes (team_id, id, old_cn, new_cn, qq, status, date, sort)
    values (v_team, v_item->>'id', v_item->>'oldCn', v_item->>'newCn', v_item->>'qq',
            v_item->>'status', v_item->>'date',
            (select coalesce(max(sort), 0) + 1 from aoi_cn_changes where team_id = v_team))
    on conflict (team_id, id) do update
      set old_cn = excluded.old_cn, new_cn = excluded.new_cn, qq = excluded.qq,
          status = excluded.status, date = excluded.date;
  end loop;

  -- 仅接受团员产生的 address / cnchange 通知
  for v_item in select e from jsonb_array_elements(coalesce(p_data->'notifications', '[]'::jsonb)) e
                where coalesce(e->>'type', '') in ('address', 'cnchange') and e->>'id' is not null
  loop
    insert into aoi_notifications (team_id, id, type, title, body, buyer, batch_id, date, sent, sort)
    values (v_team, v_item->>'id', v_item->>'type', v_item->>'title', v_item->>'body',
            v_item->>'buyer', nullif(v_item->>'batchId',''), v_item->>'date', false,
            (select coalesce(max(sort), 0) + 1 from aoi_notifications where team_id = v_team))
    on conflict (team_id, id) do update
      set type = excluded.type, title = excluded.title, body = excluded.body, buyer = excluded.buyer,
          batch_id = excluded.batch_id, date = excluded.date;
  end loop;

  perform public.admin_audit(jsonb_build_object('username', 'member:' || v_cn), 'aoi_member_sync',
    jsonb_build_object('cn', v_cn, 'bytes', octet_length(p_data::text)));

  return jsonb_build_object('ok', true, 'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;
"""

header = """-- 009-c-member-and-transfers.sql — 方案 C P5：团员端读写 RPC + transfers 表（docs/PLAN-C-SCHEMA-SPLIT.md §三 P5）
-- ① aoi_transfers 表（团员转账申请，行结构 = warehouse.js 团员提交：id/buyer/batchId/toWarehouseId/reason/status/date）
-- ② aoi_payments 补凭证列 receipt/receipt_date（团员交费凭证 URL，白名单字段）
-- ③ aoi_assemble(v_team)：组装主体抽离（aoi_get_all / aoi_member_get 共用），含 transfers 段
-- ④ aoi_get_all 重建（瘦身调 assemble）
-- ⑤ aoi_member_get(p_member_key, p_cn)：组装 + PII 裁剪（语义复刻 get_team_by_member_key）
-- ⑥ aoi_member_sync(p_member_key, p_data, p_cn)：白名单写入新表（语义复刻 update_team_data_by_member_key）
-- ⑦ aoi_sync 补 transfers 管理段
-- 行级覆盖语义，无整包乐观锁（expected_updated_at 兼容签名弃用）。

create table if not exists aoi_transfers (
  team_id     uuid not null references teams(id),
  id          text not null,
  buyer       text,
  batch_id    text,
  to_warehouse_id text,
  reason      text,
  status      text,
  date        text,
  sort        int not null default 0,
  primary key (team_id, id)
);
alter table aoi_payments add column if not exists receipt text;
alter table aoi_payments add column if not exists receipt_date text;

"""

io.open('supabase/migrations/009-c-member-and-transfers.sql', 'w', encoding='utf-8', newline='').write(
    header + sync_body + '\n' + assemble_fn + get_all_fn + member_get_fn + member_sync_fn)
print('009 written, bytes =', len((header + sync_body + assemble_fn + get_all_fn + member_get_fn + member_sync_fn)))
