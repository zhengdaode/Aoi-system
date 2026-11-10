-- 009-c-member-and-transfers.sql — 方案 C P5：团员端读写 RPC + transfers 表（docs/PLAN-C-SCHEMA-SPLIT.md §三 P5）
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

create or replace function public.aoi_sync(p_token text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin json;
  v_team uuid;
  v_row jsonb;
  v_key text;
  v_arr jsonb;
  v_ord bigint;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  v_team := public.assert_single_team();
  if v_team is null then raise exception '尚未创建团队'; end if;
  if p_changes is null or p_changes = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  -- —— activities（先删后插；删除经 FK 级联子表）——
  if p_changes ? 'activities' then
    if p_changes->'activities' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'activities'->'delete')) loop
        delete from aoi_activities where team_id = v_team and name = v_key;
      end loop;
    end if;
    if p_changes->'activities' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'activities'->'upsert') loop
        insert into aoi_activities (team_id, name, sort_order, ip, status, buy_date, ship_date, ship_date_fuzzy,
                                    deadline, link, cover, remark, created_at, updated_at)
        values (v_team, v_row->>'name', coalesce((v_row->>'sortOrder')::int, 0),
                nullif(v_row->>'ip',''), nullif(v_row->>'status',''),
                nullif(v_row->>'buyDate',''), nullif(v_row->>'shipDate',''), nullif(v_row->>'shipDateFuzzy',''),
                nullif(v_row->>'deadline',''), nullif(v_row->>'link',''), nullif(v_row->>'cover',''), nullif(v_row->>'remark',''),
                nullif(v_row->>'createdAt',''), nullif(v_row->>'updatedAt',''))
        on conflict (team_id, name) do update
          set sort_order = excluded.sort_order, ip = excluded.ip, status = excluded.status,
              buy_date = excluded.buy_date, ship_date = excluded.ship_date, ship_date_fuzzy = excluded.ship_date_fuzzy,
              deadline = excluded.deadline, link = excluded.link, cover = excluded.cover, remark = excluded.remark,
              created_at = excluded.created_at, updated_at = excluded.updated_at;
      end loop;
    end if;
  end if;

  -- —— orders ——
  if p_changes ? 'orders' then
    if p_changes->'orders' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'orders'->'delete')) loop
        delete from aoi_orders where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'orders' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'orders'->'upsert') loop
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
                coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set activity_name = excluded.activity_name, ip = excluded.ip, type = excluded.type, model = excluded.model,
              buyer = excluded.buyer, currency = excluded.currency, price = excluded.price, price_orig = excluded.price_orig,
              count = excluded.count, status = excluded.status, remark = excluded.remark, batch_id = excluded.batch_id,
              intl_fee = excluded.intl_fee, shipped = excluded.shipped, shipped_at = excluded.shipped_at,
              shop_order_id = excluded.shop_order_id, shop_order_no = excluded.shop_order_no,
              ai_aligned = excluded.ai_aligned, sort_order = excluded.sort_order, updated_at = now();
      end loop;
    end if;
  end if;

  -- —— products ——
  if p_changes ? 'products' then
    if p_changes->'products' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'products'->'delete')) loop
        delete from aoi_products where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'products' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'products'->'upsert') loop
        insert into aoi_products (team_id, id, activity_name, type, model, name_orig, ref_image, ref_url,
                                  price, price_orig, currency, "limit", stock, listed, sort)
        values (v_team, v_row->>'id', v_row->>'activity', v_row->>'type', v_row->>'model',
                nullif(v_row->>'nameOrig',''), nullif(v_row->>'refImage',''), nullif(v_row->>'refUrl',''),
                nullif(v_row->>'price','')::numeric, nullif(v_row->>'priceOrig','')::numeric, v_row->>'currency',
                nullif(v_row->>'limit','')::numeric, nullif(v_row->>'stock','')::numeric,
                coalesce((v_row->>'listed')::boolean, false),
                coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set activity_name = excluded.activity_name, type = excluded.type, model = excluded.model,
              name_orig = excluded.name_orig, ref_image = excluded.ref_image, ref_url = excluded.ref_url,
              price = excluded.price, price_orig = excluded.price_orig, currency = excluded.currency,
              "limit" = excluded."limit", stock = excluded.stock, listed = excluded.listed,
              sort = excluded.sort, updated_at = now();
      end loop;
    end if;
  end if;

  -- —— activityBuyers / activityTrackings（整体替换）——
  if p_changes ? 'activityBuyers' then
    for v_key, v_arr in select key, value from jsonb_each(p_changes->'activityBuyers'->'replace') loop
      delete from aoi_activity_buyers where team_id = v_team and activity_name = v_key;
      for v_row in select * from jsonb_array_elements(v_arr) loop
        insert into aoi_activity_buyers (team_id, activity_name, buyer, account, address, sort)
        values (v_team, v_key, v_row->>'buyer', v_row->>'account', v_row->>'address',
                coalesce((v_row->>'sortOrder')::int, 0));
      end loop;
    end loop;
  end if;
  if p_changes ? 'activityTrackings' then
    for v_key, v_arr in select key, value from jsonb_each(p_changes->'activityTrackings'->'replace') loop
      delete from aoi_activity_trackings where team_id = v_team and activity_name = v_key;
      for v_row, v_ord in select v, ord from jsonb_array_elements(v_arr) with ordinality as t(v, ord) loop
        insert into aoi_activity_trackings (team_id, activity_name, tracking_no, sort)
        values (v_team, v_key, v_row #>> '{}', v_ord - 1);
      end loop;
    end loop;
  end if;

  -- —— batches / payments / notifications / announcements / cnChanges / pcoItems ——
  if p_changes ? 'batches' then
    if p_changes->'batches' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'batches'->'delete')) loop
        delete from aoi_batches where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'batches' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'batches'->'upsert') loop
        insert into aoi_batches (team_id, id, name, date, manual_fees, target_amount, weights, sort)
        values (v_team, v_row->>'id', nullif(v_row->>'name',''), nullif(v_row->>'date',''),
                v_row->'manualFees', nullif(v_row->>'targetAmount','')::numeric, v_row->'weights',
                coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set name = excluded.name, date = excluded.date, manual_fees = excluded.manual_fees,
              target_amount = excluded.target_amount, weights = excluded.weights, sort = excluded.sort;
      end loop;
    end if;
  end if;
  if p_changes ? 'payments' then
    if p_changes->'payments' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'payments'->'delete')) loop
        delete from aoi_payments where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'payments' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'payments'->'upsert') loop
        insert into aoi_payments (team_id, id, buyer, batch_id, intl_fee, domestic_fee, status, sort)
        values (v_team, v_row->>'id', v_row->>'buyer', nullif(v_row->>'batchId',''),
                nullif(v_row->>'intlFee','')::numeric, nullif(v_row->>'domesticFee','')::numeric,
                nullif(v_row->>'status',''), coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set buyer = excluded.buyer, batch_id = excluded.batch_id, intl_fee = excluded.intl_fee,
              domestic_fee = excluded.domestic_fee, status = excluded.status, sort = excluded.sort;
      end loop;
    end if;
  end if;
  if p_changes ? 'notifications' then
    if p_changes->'notifications' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'notifications'->'delete')) loop
        delete from aoi_notifications where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'notifications' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'notifications'->'upsert') loop
        insert into aoi_notifications (team_id, id, type, title, body, buyer, batch_id, date, sent, sort)
        values (v_team, v_row->>'id', v_row->>'type', v_row->>'title', v_row->>'body',
                v_row->>'buyer', nullif(v_row->>'batchId',''), v_row->>'date',
                coalesce((v_row->>'sent')::boolean, false), coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set type = excluded.type, title = excluded.title, body = excluded.body, buyer = excluded.buyer,
              batch_id = excluded.batch_id, date = excluded.date, sent = excluded.sent, sort = excluded.sort;
      end loop;
    end if;
  end if;
  if p_changes ? 'announcements' then
    if p_changes->'announcements' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'announcements'->'delete')) loop
        delete from aoi_announcements where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'announcements' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'announcements'->'upsert') loop
        insert into aoi_announcements (team_id, id, date, text, sort)
        values (v_team, v_row->>'id', v_row->>'date', v_row->>'text', coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set date = excluded.date, text = excluded.text, sort = excluded.sort;
      end loop;
    end if;
  end if;
  if p_changes ? 'cnChanges' then
    if p_changes->'cnChanges' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'cnChanges'->'delete')) loop
        delete from aoi_cn_changes where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'cnChanges' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'cnChanges'->'upsert') loop
        insert into aoi_cn_changes (team_id, id, old_cn, new_cn, qq, status, date, sort)
        values (v_team, v_row->>'id', v_row->>'oldCn', v_row->>'newCn', v_row->>'qq',
                v_row->>'status', v_row->>'date', coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set old_cn = excluded.old_cn, new_cn = excluded.new_cn, qq = excluded.qq,
              status = excluded.status, date = excluded.date, sort = excluded.sort;
      end loop;
    end if;
  end if;
  if p_changes ? 'pcoItems' then
    if p_changes->'pcoItems' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'pcoItems'->'delete')) loop
        delete from aoi_pco_items where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'pcoItems' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'pcoItems'->'upsert') loop
        insert into aoi_pco_items (team_id, id, jp_name, name, type, type_suggest, url, image,
                                   price_jpy, price_cny, "limit", sale_date, status, selected, watched, unmatched, first_seen_at, sort)
        values (v_team, v_row->>'id', v_row->>'jpName', v_row->>'name', v_row->>'type', v_row->>'typeSuggest',
                nullif(v_row->>'url',''), nullif(v_row->>'image',''),
                nullif(v_row->>'priceJpy','')::numeric, nullif(v_row->>'priceCny','')::numeric,
                nullif(v_row->>'limit','')::numeric, v_row->>'saleDate', v_row->>'status',
                coalesce((v_row->>'select')::boolean, false), coalesce((v_row->>'watched')::boolean, false),
                v_row->'unmatched', v_row->>'firstSeenAt',
                coalesce((v_row->>'sortOrder')::int, 999999))
        on conflict (team_id, id) do update
          set jp_name = excluded.jp_name, name = excluded.name, type = excluded.type, type_suggest = excluded.type_suggest,
              url = excluded.url, image = excluded.image, price_jpy = excluded.price_jpy, price_cny = excluded.price_cny,
              "limit" = excluded."limit", sale_date = excluded.sale_date, status = excluded.status,
              selected = excluded.selected, watched = excluded.watched, unmatched = excluded.unmatched,
              first_seen_at = excluded.first_seen_at, sort = excluded.sort;
      end loop;
    end if;
  end if;

  -- —— paigu（slots 行级 + logs 替换）——
  if p_changes ? 'paiguSlots' then
    if p_changes->'paiguSlots' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'paiguSlots'->'delete')) loop
        delete from aoi_paigu_slots where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'paiguSlots' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'paiguSlots'->'upsert') loop
        insert into aoi_paigu_slots (team_id, id, activity_name, type, model, sort, order_id, buyer, status, added_at)
        values (v_team, v_row->>'id', v_row->>'activity', coalesce(v_row->>'type',''), coalesce(v_row->>'model',''),
                coalesce((v_row->>'sort')::int, 0), nullif(v_row->>'orderId',''), v_row->>'buyer',
                nullif(v_row->>'status',''), v_row->>'addedAt')
        on conflict (team_id, id) do update
          set activity_name = excluded.activity_name, type = excluded.type, model = excluded.model,
              sort = excluded.sort, order_id = excluded.order_id, buyer = excluded.buyer,
              status = excluded.status, added_at = excluded.added_at;
      end loop;
    end if;
  end if;
  if p_changes ? 'paiguLogs' then
    for v_key, v_arr in select key, value from jsonb_each(p_changes->'paiguLogs'->'replace') loop
      delete from aoi_paigu_logs where team_id = v_team and activity_name = v_key;
      for v_row in select * from jsonb_array_elements(v_arr) loop
        insert into aoi_paigu_logs (team_id, activity_name, at, text)
        values (v_team, v_key, v_row->>'at', v_row->>'text');
      end loop;
    end loop;
  end if;
  if p_changes ? 'paiguMeta' then
    if p_changes->'paiguMeta' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'paiguMeta'->'delete')) loop
        delete from aoi_paigu_meta where team_id = v_team and activity_name = v_key;
      end loop;
    end if;
    if p_changes->'paiguMeta' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'paiguMeta'->'upsert') loop
        insert into aoi_paigu_meta (team_id, activity_name, updated_at)
        values (v_team, v_row->>'activity', v_row->>'updatedAt')
        on conflict (team_id, activity_name) do update set updated_at = excluded.updated_at;
      end loop;
    end if;
  end if;

  -- —— 蓄水池（池行级 + entries/settlements 替换）——
  if p_changes ? 'reservoirs' then
    if p_changes->'reservoirs' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'reservoirs'->'delete')) loop
        delete from aoi_reservoirs where team_id = v_team and id = v_key;
      end loop;
    end if;
    if p_changes->'reservoirs' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'reservoirs'->'upsert') loop
        insert into aoi_reservoirs (team_id, id, name, side_a, side_b, rates)
        values (v_team, v_row->>'id', v_row->>'name', v_row->>'sideA', v_row->>'sideB', v_row->'rates')
        on conflict (team_id, id) do update
          set name = excluded.name, side_a = excluded.side_a, side_b = excluded.side_b, rates = excluded.rates;
      end loop;
    end if;
  end if;
  if p_changes ? 'reservoirEntries' then
    for v_key, v_arr in select key, value from jsonb_each(p_changes->'reservoirEntries'->'replace') loop
      delete from aoi_reservoir_entries where team_id = v_team and reservoir_id = v_key;
      for v_row in select * from jsonb_array_elements(v_arr) loop
        insert into aoi_reservoir_entries (team_id, reservoir_id, id, order_id, side, added_at, sort)
        values (v_team, v_key, v_row->>'id', nullif(v_row->>'orderId',''), coalesce(v_row->>'side','A'),
                v_row->>'addedAt', coalesce((v_row->>'sortOrder')::int, 0));
      end loop;
    end loop;
  end if;
  if p_changes ? 'reservoirSettlements' then
    for v_key, v_arr in select key, value from jsonb_each(p_changes->'reservoirSettlements'->'replace') loop
      delete from aoi_reservoir_settlements where team_id = v_team and reservoir_id = v_key;
      for v_row in select * from jsonb_array_elements(v_arr) loop
        insert into aoi_reservoir_settlements (team_id, reservoir_id, id, direction, currency, amount, date, note, entry_ids, sort)
        values (v_team, v_key, v_row->>'id', v_row->>'direction', v_row->>'currency',
                nullif(v_row->>'amount','')::numeric, v_row->>'date', v_row->>'note', v_row->'entryIds',
                coalesce((v_row->>'sortOrder')::int, 0));
      end loop;
    end loop;
  end if;

  -- —— transfers（管理端审批/驳回，行级）——
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

  -- —— limitPlans / typeMeta / memberMeta / addresses / settings ——
  if p_changes ? 'limitPlans' then
    if p_changes->'limitPlans' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'limitPlans'->'delete')) loop
        delete from aoi_limit_plans where team_id = v_team and activity_name = v_key;
      end loop;
    end if;
    if p_changes->'limitPlans' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'limitPlans'->'upsert') loop
        insert into aoi_limit_plans (team_id, activity_name, payload, updated_at)
        values (v_team, v_row->>'activity', v_row->'payload', now())
        on conflict (team_id, activity_name) do update
          set payload = excluded.payload, updated_at = now();
      end loop;
    end if;
  end if;
  if p_changes ? 'typeMeta' then
    if p_changes->'typeMeta' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'typeMeta'->'delete')) loop
        delete from aoi_type_meta where team_id = v_team and type = v_key;
      end loop;
    end if;
    if p_changes->'typeMeta' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'typeMeta'->'upsert') loop
        insert into aoi_type_meta (team_id, type, route)
        values (v_team, v_row->>'type', v_row->>'route')
        on conflict (team_id, type) do update set route = excluded.route;
      end loop;
    end if;
  end if;
  if p_changes ? 'memberMeta' then
    if p_changes->'memberMeta' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'memberMeta'->'delete')) loop
        delete from aoi_member_meta where team_id = v_team and cn = v_key;
      end loop;
    end if;
    if p_changes->'memberMeta' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'memberMeta'->'upsert') loop
        insert into aoi_member_meta (team_id, cn, qq, extras)
        values (v_team, v_row->>'cn', nullif(v_row->>'qq',''), coalesce(v_row->'extras', '{}'::jsonb))
        on conflict (team_id, cn) do update set qq = excluded.qq, extras = excluded.extras;
      end loop;
    end if;
  end if;
  if p_changes ? 'addresses' then
    if p_changes->'addresses' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'addresses'->'delete')) loop
        delete from aoi_addresses where team_id = v_team and cn = v_key;
      end loop;
    end if;
    if p_changes->'addresses' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'addresses'->'upsert') loop
        insert into aoi_addresses (team_id, cn, address)
        values (v_team, v_row->>'cn', v_row->>'address')
        on conflict (team_id, cn) do update set address = excluded.address;
      end loop;
    end if;
  end if;
  if p_changes ? 'settings' then
    if p_changes->'settings' ? 'delete' then
      foreach v_key in array array(select jsonb_array_elements_text(p_changes->'settings'->'delete')) loop
        delete from aoi_team_settings where team_id = v_team and key = v_key;
      end loop;
    end if;
    if p_changes->'settings' ? 'upsert' then
      for v_row in select * from jsonb_array_elements(p_changes->'settings'->'upsert') loop
        insert into aoi_team_settings (team_id, key, value, updated_at)
        values (v_team, v_row->>'key', v_row->'value', now())
        on conflict (team_id, key) do update set value = excluded.value, updated_at = now();
      end loop;
    end if;
  end if;

  perform public.admin_audit(v_admin, 'aoi_sync',
    jsonb_build_object('sections', (select count(*) from jsonb_object_keys(p_changes)),
                       'bytes', octet_length(p_changes::text)));

  return jsonb_build_object('ok', true, 'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;
-- ─────────────── 组装主体（get_all / member_get 共用） ───────────────
create or replace function public.aoi_assemble(v_team uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_blob jsonb;
begin
  v_blob :=
    jsonb_build_object(
      'activities', coalesce((
        select jsonb_agg(a.name order by a.sort_order)
        from aoi_activities a where a.team_id = v_team
      ), '[]'::jsonb),

      'activityMeta', coalesce((
        select jsonb_object_agg(a.name, jsonb_strip_nulls(jsonb_build_object(
          'ip', a.ip, 'status', a.status,
          'buyDate', a.buy_date, 'shipDate', a.ship_date, 'shipDateFuzzy', a.ship_date_fuzzy,
          'deadline', a.deadline, 'link', a.link, 'cover', a.cover, 'remark', a.remark,
          'createdAt', a.created_at, 'updatedAt', a.updated_at,
          'buyers', (
            select jsonb_agg(jsonb_build_object('buyer', b.buyer, 'account', b.account, 'address', b.address) order by b.sort)
            from aoi_activity_buyers b where b.team_id = a.team_id and b.activity_name = a.name
          ),
          'trackings', (
            select jsonb_agg(b.tracking_no order by b.sort)
            from aoi_activity_trackings b where b.team_id = a.team_id and b.activity_name = a.name
          ),
          'products', (
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', p.id, 'type', p.type, 'model', p.model, 'nameOrig', p.name_orig,
              'refImage', p.ref_image, 'refUrl', p.ref_url,
              'price', p.price, 'priceOrig', p.price_orig, 'currency', p.currency,
              'limit', p."limit", 'stock', p.stock,
              'listed', case when p.listed then 'true'::jsonb else null end
            )) order by p.sort, p.id)
            from aoi_products p where p.team_id = a.team_id and p.activity_name = a.name
          )
        )) order by a.sort_order)
        from aoi_activities a where a.team_id = v_team
      ), '{}'::jsonb),

      'orders', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', o.id, 'ip', o.ip, 'activity', o.activity_name,
          'type', o.type, 'model', o.model, 'buyer', o.buyer,
          'currency', o.currency, 'price', o.price, 'priceOrig', o.price_orig,
          'count', o.count, 'status', o.status, 'remark', o.remark,
          'batchId', o.batch_id, 'intlFee', o.intl_fee,
          'shipped', o.shipped, 'shippedAt', o.shipped_at,
          'shopOrderId', o.shop_order_id, 'shopOrderNo', o.shop_order_no,
          '_aiAligned', o.ai_aligned
        )) order by o.sort_order)
        from aoi_orders o where o.team_id = v_team
      ), '[]'::jsonb),

      'batches', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', b.id, 'name', b.name, 'date', b.date,
          'manualFees', b.manual_fees, 'targetAmount', b.target_amount, 'weights', b.weights
        )) order by b.sort)
        from aoi_batches b where b.team_id = v_team
      ), '[]'::jsonb),

      'payments', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', p.id, 'buyer', p.buyer, 'batchId', p.batch_id,
          'intlFee', p.intl_fee, 'domesticFee', p.domestic_fee, 'status', p.status
        )) order by p.sort)
        from aoi_payments p where p.team_id = v_team
      ), '[]'::jsonb),

      'notifications', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', n.id, 'type', n.type, 'title', n.title, 'body', n.body,
          'buyer', n.buyer, 'batchId', n.batch_id, 'date', n.date,
          'sent', case when n.sent then 'true'::jsonb else null end
        )) order by n.sort)
        from aoi_notifications n where n.team_id = v_team
      ), '[]'::jsonb),

      'announcements', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.date, 'text', a.text) order by a.sort)
        from aoi_announcements a where a.team_id = v_team
      ), '[]'::jsonb),

      'cnChanges', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', c.id, 'oldCn', c.old_cn, 'newCn', c.new_cn, 'qq', c.qq, 'status', c.status, 'date', c.date
        )) order by c.sort)
        from aoi_cn_changes c where c.team_id = v_team
      ), '[]'::jsonb),

      'pcoItems', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', p.id, 'jpName', p.jp_name, 'name', p.name, 'type', p.type, 'typeSuggest', p.type_suggest,
          'url', p.url, 'image', p.image, 'priceJpy', p.price_jpy, 'priceCny', p.price_cny,
          'limit', p."limit", 'saleDate', p.sale_date, 'status', p.status,
          'select', case when p.selected then 'true'::jsonb else null end,
          'watched', case when p.watched then 'true'::jsonb else null end,
          'unmatched', p.unmatched,
          'firstSeenAt', p.first_seen_at
        )) order by p.sort)
        from aoi_pco_items p where p.team_id = v_team
      ), '[]'::jsonb),

      'reservoirs', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', r.id, 'name', r.name, 'sideA', r.side_a, 'sideB', r.side_b, 'rates', r.rates,
          'entries', coalesce((
            select jsonb_agg(jsonb_build_object('id', e.id, 'orderId', e.order_id, 'side', e.side, 'addedAt', e.added_at) order by e.sort)
            from aoi_reservoir_entries e where e.team_id = r.team_id and e.reservoir_id = r.id
          ), '[]'::jsonb),
          'settlements', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', s.id, 'direction', s.direction, 'currency', s.currency, 'amount', s.amount,
              'date', s.date, 'note', s.note, 'entryIds', s.entry_ids
            )) order by s.sort)
            from aoi_reservoir_settlements s where s.team_id = r.team_id and s.reservoir_id = r.id
          ), '[]'::jsonb)
        )) order by r.sort)
        from aoi_reservoirs r where r.team_id = v_team
      ), '[]'::jsonb),

      'transfers', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', t.id, 'buyer', t.buyer, 'batchId', t.batch_id,
          'toWarehouseId', t.to_warehouse_id, 'reason', t.reason,
          'status', t.status, 'date', t.date
        )) order by t.sort)
        from aoi_transfers t where t.team_id = v_team
      ), '[]'::jsonb),

      'limitPlans', coalesce((
        select jsonb_object_agg(l.activity_name, l.payload)
        from aoi_limit_plans l where l.team_id = v_team
      ), '{}'::jsonb),

      'typeMeta', coalesce((
        select jsonb_object_agg(t.type, jsonb_build_object('route', t.route))
        from aoi_type_meta t where t.team_id = v_team
      ), '{}'::jsonb),

      'ips', coalesce((
        select jsonb_agg(i.ip order by i.sort)
        from aoi_ips i where i.team_id = v_team
      ), '[]'::jsonb),

      'memberMeta', coalesce((
        select jsonb_object_agg(m.cn, jsonb_strip_nulls(jsonb_build_object('qq', m.qq) || m.extras))
        from aoi_member_meta m where m.team_id = v_team
      ), '{}'::jsonb),

      'addresses', coalesce((
        select jsonb_object_agg(a.cn, a.address)
        from aoi_addresses a where a.team_id = v_team
      ), '{}'::jsonb)
    );

  -- settings KV（calc/botConfig/imgHost/ipTypes 及一切未映射顶层键）展开进顶层
  v_blob := v_blob || coalesce((
    select jsonb_object_agg(s.key, s.value) from aoi_team_settings s where s.team_id = v_team
  ), '{}'::jsonb);

  -- paigu：按「有 slots / log / meta 行」的活动聚合（空键在前端写入时自建，组装不恢复）
  v_blob = jsonb_set(v_blob, '{paigu}', coalesce((
    select jsonb_object_agg(p.activity_name, jsonb_build_object(
      'updatedAt', m.updated_at,
      'slots', coalesce((
        select jsonb_object_agg(g.key, g.arr)
        from (
          select coalesce(s.type,'') || '|' || coalesce(s.model,'') as key,
                 jsonb_agg(jsonb_build_object(
                   'id', s.id, 'orderId', s.order_id, 'buyer', s.buyer,
                   'status', s.status, 'addedAt', s.added_at
                 ) order by s.sort) as arr
          from aoi_paigu_slots s where s.team_id = p.team_id and s.activity_name = p.activity_name
          group by s.type, s.model
        ) g
      ), '{}'::jsonb),
      'log', coalesce((
        select jsonb_agg(jsonb_build_object('at', l.at, 'text', l.text) order by l.id)
        from aoi_paigu_logs l where l.team_id = p.team_id and l.activity_name = p.activity_name
      ), '[]'::jsonb)
    ))
    from (
      select distinct team_id, activity_name from (
        select team_id, activity_name from aoi_paigu_slots
        union
        select team_id, activity_name from aoi_paigu_logs
        union
        select team_id, activity_name from aoi_paigu_meta
      ) u
    ) p
    left join aoi_paigu_meta m on m.team_id = p.team_id and m.activity_name = p.activity_name
    where p.team_id = v_team
  ), '{}'::jsonb));


  return v_blob;
end;
$$;
-- ─────────────── aoi_get_all（瘦身：鉴权 + 组装 + 包装） ───────────────
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
-- ─────────────── 团员端读取（PII 裁剪，语义复刻 get_team_by_member_key） ───────────────
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
-- ─────────────── 团员端写入（白名单，语义复刻 update_team_data_by_member_key） ───────────────
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
