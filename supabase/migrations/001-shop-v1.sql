-- =====================================================================
-- F12 · C 端商城 RPC（v3.22.0，PLAN-F12 2026-09-30 拍板后实施）
-- ---------------------------------------------------------------------
-- 登录：Supabase Auth 邮箱验证码（前端 signInWithOtp + verifyOtp），
--       C 端取消密钥发放；绑定 CN 后才可见橱窗/可下单
--       （客群=本团成员：CN 须在 orders 或 memberMeta 中存在）。
-- 数据合并（用户拍板：直接并入管理端同一份 blob，不拆业务表）：
--   d.shopOrders[]  C 端订单头（no/金额/唯一尾数/状态/地址快照/备注）
--   d.orders[]      逐商品落单行（buyer=CN + shopOrderId 关联订单头）
--                   ——管理端到货分批/国际费分摊/发货/快递单号全链路零改造
--   d.shopUsers     { [auth.uid]: {cn,email,boundAt} } 登录绑定映射
-- 写入纪律（与 v3.10.0/v3.4.0 同源）：security definer + 服务端算价/限购/截团校验
--   + 写前历史快照（B1）+ team_data 行锁 for update（与 admin 乐观锁写入串行化）。
-- 支付 V1：金额加唯一分位尾数（0.01–0.99）作订单指纹，买家转账免上传凭证，
--   团长侧账单核销（管理端 UI 下一批；过渡期通知中心/订单管理可见新单）。
-- 已知限制：RPC 级限频暂缺（Auth 侧自带邮箱频控兜底；上量前补 Edge 限频）。
-- 橱窗开关语义：商品 listed===true 才可见（缺省下架）；团期 shopOpen===true 或
--   status='进行中' 开放（缺省按活动状态）。
-- =====================================================================

-- 内部辅助：登录买家上下文（含整份 blob，仅限 definer 内部调用——已 revoke public）
create or replace function public.shop_ctx()
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_uid uuid;
  v_team_id uuid;
  v_team text;
  v_data jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '未登录，请先用邮箱验证码登录';
  end if;
  select t.id, t.name, coalesce(d.data, '{}'::jsonb)
    into v_team_id, v_team, v_data
    from teams t
    left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  if v_team_id is null then
    raise exception '团队不存在';
  end if;
  return json_build_object(
    'uid', v_uid,
    'cn', coalesce(v_data->'shopUsers'->v_uid::text->>'cn', ''),
    'bound', coalesce(v_data->'shopUsers'->v_uid::text->>'cn', '') <> '',
    'teamId', v_team_id,
    'teamName', v_team,
    'data', v_data
  );
end;
$$;

-- 我是谁：绑定状态 + 团名 + 收款位（囤货地收款码，V1 支付展示用）
drop function if exists public.shop_me();
create function public.shop_me()
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_uid uuid;
  v_team text;
  v_data jsonb;
  v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '未登录，请先用邮箱验证码登录';
  end if;
  select t.name, coalesce(d.data, '{}'::jsonb)
    into v_team, v_data
    from teams t
    left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  select email into v_email from auth.users where id = v_uid;
  return json_build_object(
    'bound', coalesce(v_data->'shopUsers'->v_uid::text->>'cn', '') <> '',
    'cn', coalesce(v_data->'shopUsers'->v_uid::text->>'cn', ''),
    'email', coalesce(v_email, ''),
    'teamName', v_team,
    'pay', coalesce((
      select jsonb_build_object('name', w->>'name', 'qr', w->>'qrCode')
      from jsonb_array_elements(coalesce(v_data->'warehouses', '[]'::jsonb)) w
      where coalesce(w->>'qrCode', '') <> ''
      limit 1
    ), null)
  );
end;
$$;

-- 绑定圈名（首次登录后）：CN 须在本团存在；一个 CN 仅可绑一个登录账号（幂等重绑放行）
drop function if exists public.shop_bind_cn(text);
create function public.shop_bind_cn(p_cn text)
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_uid uuid;
  v_email text;
  v_team_id uuid;
  v_data jsonb;
  v_owner text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '未登录，请先用邮箱验证码登录';
  end if;
  p_cn := btrim(coalesce(p_cn, ''));
  if p_cn = '' or length(p_cn) > 64 then
    raise exception '圈名不合法';
  end if;

  select t.id, coalesce(d.data, '{}'::jsonb)
    into v_team_id, v_data
    from teams t
    left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  if v_team_id is null then
    raise exception '团队不存在';
  end if;

  -- 客群=本团成员：CN 必须在系统里存在（有订单或已登记 memberMeta）
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) o
    where o->>'buyer' = p_cn
  ) and not exists (
    select 1 from jsonb_each(coalesce(v_data->'memberMeta', '{}'::jsonb)) m
    where m.key = p_cn
  ) then
    raise exception '未找到圈名「%」——商城仅对本团成员开放，请确认与团长登记的圈名一致', p_cn;
  end if;

  select key into v_owner
    from jsonb_each(coalesce(v_data->'shopUsers', '{}'::jsonb))
    where value->>'cn' = p_cn
    limit 1;
  if v_owner is not null and v_owner <> v_uid::text then
    raise exception '圈名「%」已绑定其他登录账号，如需换绑请联系团长', p_cn;
  end if;
  if v_data->'shopUsers'->v_uid::text->>'cn' = p_cn then
    return json_build_object('cn', p_cn);  -- 幂等：重复绑定同一 CN
  end if;

  insert into team_data_history (team_id, data, source)
    select v_team_id, data, 'shop' from team_data where team_id = v_team_id;
  perform public.team_data_history_prune(v_team_id);

  select email into v_email from auth.users where id = v_uid;
  v_data := jsonb_set(v_data, array['shopUsers', v_uid::text],
    jsonb_build_object('cn', p_cn, 'email', coalesce(v_email, ''),
      'boundAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), true);
  update team_data set data = v_data, updated_at = now() where team_id = v_team_id;
  return json_build_object('cn', p_cn);
end;
$$;

-- 橱窗：开放团期 + 已上架商品（服务端过滤，buyer 侧拿不到未上架/未开放内容）
drop function if exists public.shop_get_catalog();
create function public.shop_get_catalog()
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_ctx json;
  v_data jsonb;
  v_acts jsonb;
  v_prods jsonb;
  v_act_name text;
  v_meta jsonb;
  v_p jsonb;
  v_sold int;
begin
  v_ctx := public.shop_ctx();
  if not coalesce((v_ctx->>'bound')::boolean, false) then
    raise exception '请先绑定圈名';
  end if;
  v_data := v_ctx->'data';

  v_acts := '[]'::jsonb;
  v_prods := '[]'::jsonb;
  for v_act_name, v_meta in select key, value from jsonb_each(coalesce(v_data->'activityMeta', '{}'::jsonb)) loop
    -- 团期开放：shopOpen 显式开关优先，缺省按活动状态=进行中
    if not coalesce((v_meta->>'shopOpen')::boolean, v_meta->>'status' = '进行中') then
      continue;
    end if;
    v_acts := v_acts || jsonb_build_object(
      'name', v_act_name, 'ip', coalesce(v_meta->>'ip', ''),
      'status', coalesce(v_meta->>'status', ''),
      'shipDate', coalesce(v_meta->>'shipDate', ''),
      'shipDateFuzzy', coalesce(v_meta->>'shipDateFuzzy', ''),
      'shipEst', coalesce(v_meta->>'shipEst', ''),
      'blurb', coalesce(v_meta->>'shopBlurb', ''));
    for v_p in select e from jsonb_array_elements(coalesce(v_meta->'products', '[]'::jsonb)) e
               where (e->>'listed')::boolean is true and e->'price' is not null
    loop
      select coalesce(sum((o->>'count')::int), 0) into v_sold
        from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) o
        where o->>'activity' = v_act_name
          and o->>'type' = v_p->>'type' and o->>'model' = v_p->>'model';
      v_prods := v_prods || jsonb_build_object(
        'id', v_p->>'id', 'act', v_act_name, 'ip', coalesce(v_meta->>'ip', ''),
        'type', v_p->>'type', 'model', v_p->>'model', 'nameOrig', coalesce(v_p->>'nameOrig', ''),
        'refImage', coalesce(v_p->>'refImage', ''), 'refUrl', coalesce(v_p->>'refUrl', ''),
        'price', v_p->'price', 'priceOrig', v_p->'priceOrig', 'currency', coalesce(v_p->>'currency', ''),
        'limit', v_p->'limit', 'sold', v_sold);
    end loop;
  end loop;

  return json_build_object(
    'teamName', v_ctx->>'teamName',
    'activities', v_acts,
    'products', v_prods,
    'pay', coalesce((
      select jsonb_build_object('name', w->>'name', 'qr', w->>'qrCode')
      from jsonb_array_elements(coalesce(v_data->'warehouses', '[]'::jsonb)) w
      where coalesce(w->>'qrCode', '') <> ''
      limit 1
    ), null)
  );
end;
$$;

-- 下单：服务端算价/限购/截团校验 → shopOrders 订单头 + 逐商品 orders 行
drop function if exists public.shop_place_order(jsonb, text, text);
create function public.shop_place_order(p_items jsonb, p_addr text, p_remark text)
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_uid uuid;
  v_cn text;
  v_team_id uuid;
  v_data jsonb;
  v_updated timestamptz;
  v_item jsonb;
  v_qty int;
  v_act_name text;
  v_meta jsonb;
  v_p jsonb;
  v_found boolean;
  v_line jsonb;
  v_lines jsonb;
  v_total numeric;
  v_count int;
  v_tail int;
  v_no text;
  v_oid text;
  v_existing int;
  v_pay_count int;
  v_addr_old text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '未登录，请先用邮箱验证码登录';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '购物清单为空';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception '单笔订单商品种类过多（超过 30 种）';
  end if;
  p_addr := btrim(coalesce(p_addr, ''));
  if p_addr = '' or length(p_addr) > 300 then
    raise exception '请填写收货地址（300 字以内）';
  end if;
  p_remark := left(btrim(coalesce(p_remark, '')), 200);

  select t.id into v_team_id from teams t where t.id = public.assert_single_team();
  if v_team_id is null then
    raise exception '团队不存在';
  end if;
  select coalesce(d.data, '{}'::jsonb) into v_data
    from team_data d where d.team_id = v_team_id for update;  -- 与管理端写入串行化
  if v_data is null then
    v_data := '{}'::jsonb;
  end if;

  v_cn := v_data->'shopUsers'->v_uid::text->>'cn';
  if coalesce(v_cn, '') = '' then
    raise exception '请先绑定圈名';
  end if;

  -- 待付款订单上限（防呆：过多未支付单占用限购额度）
  select count(*) into v_pay_count
    from jsonb_array_elements(coalesce(v_data->'shopOrders', '[]'::jsonb)) s
    where s->>'cn' = v_cn and s->>'status' = '待付款';
  if v_pay_count >= 5 then
    raise exception '待付款订单已达 5 笔，请先完成支付或在「我的订单」取消';
  end if;

  -- 逐项校验并按主档价计价（价格一律服务端算，前端金额仅展示）
  v_lines := '[]'::jsonb;
  v_total := 0;
  v_count := 0;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty < 1 or v_qty > 99 then
      raise exception '数量不合法';
    end if;
    v_found := false;
    for v_act_name, v_meta in select key, value from jsonb_each(coalesce(v_data->'activityMeta', '{}'::jsonb)) loop
      exit when v_found;
      if not coalesce((v_meta->>'shopOpen')::boolean, v_meta->>'status' = '进行中') then
        continue;
      end if;
      for v_p in select e from jsonb_array_elements(coalesce(v_meta->'products', '[]'::jsonb)) e
                 where e->>'id' = v_item->>'pid'
      loop
        v_found := true;
        if (v_p->>'listed')::boolean is not true then
          raise exception '商品「%-%」已下架', v_p->>'type', v_p->>'model';
        end if;
        if v_p->'price' is null then
          raise exception '商品「%-%」未登记售价，暂不可购买', v_p->>'type', v_p->>'model';
        end if;
        if v_p->'limit' is not null then
          select coalesce(sum((o->>'count')::int), 0) into v_existing
            from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) o
            where o->>'buyer' = v_cn and o->>'activity' = v_act_name
              and o->>'type' = v_p->>'type' and o->>'model' = v_p->>'model';
          if v_existing + v_qty > (v_p->>'limit')::int then
            raise exception '「%-%」限购 % 件，你已订 % 件', v_p->>'type', v_p->>'model', v_p->>'limit', v_existing;
          end if;
        end if;
        v_line := jsonb_build_object(
          'pid', v_p->>'id', 'activity', v_act_name, 'ip', coalesce(v_meta->>'ip', ''),
          'type', v_p->>'type', 'model', v_p->>'model',
          'price', v_p->'price', 'priceOrig', v_p->'priceOrig', 'currency', coalesce(v_p->>'currency', ''),
          'qty', v_qty);
        v_lines := v_lines || v_line;
        v_total := v_total + (v_p->>'price')::numeric * v_qty;
        v_count := v_count + v_qty;
        exit;
      end loop;
    end loop;
    if not v_found then
      raise exception '商品不存在或所在团期已截团';
    end if;
  end loop;
  if v_count > 99 then
    raise exception '单笔订单件数过多（超过 99 件）';
  end if;

  -- V1 支付：唯一尾数 = 订单指纹（买家按此金额转账，账单按尾数自动核销）
  v_tail := 1 + floor(random() * 98)::int;
  loop
    v_no := 'GD' || to_char(now(), 'YYYYMMDD') || '-' || lpad((10000 + floor(random() * 89999))::int::text, 5, '0');
    exit when not exists (
      select 1 from jsonb_array_elements(coalesce(v_data->'shopOrders', '[]'::jsonb)) s
      where s->>'no' = v_no
    );
  end loop;
  v_oid := gen_random_uuid()::text;

  insert into team_data_history (team_id, data, source)
    select v_team_id, data, 'shop' from team_data where team_id = v_team_id;
  perform public.team_data_history_prune(v_team_id);

  v_data := jsonb_set(v_data, '{shopOrders}',
    coalesce(v_data->'shopOrders', '[]'::jsonb) || jsonb_build_object(
      'id', v_oid, 'no', v_no, 'cn', v_cn, 'status', '待付款',
      'items', v_lines, 'total', round(v_total, 2), 'tail', v_tail,
      'paidTotal', round(v_total + v_tail / 100.0, 2),
      'addr', p_addr, 'remark', p_remark,
      'createdAt', to_char(now(), 'YYYY-MM-DD HH24:MI')), true);

  -- 逐商品落 orders（buyer=CN，管理端到货分批/国际费/发货全链路零改造）
  for v_line in select e from jsonb_array_elements(v_lines) e loop
    v_data := jsonb_set(v_data, '{orders}',
      coalesce(v_data->'orders', '[]'::jsonb) || jsonb_build_object(
        'id', gen_random_uuid()::text,
        'ip', v_line->>'ip',
        'activity', v_line->>'activity',
        'type', v_line->>'type',
        'model', v_line->>'model',
        'price', v_line->'price',
        'priceOrig', v_line->'priceOrig',
        'currency', coalesce(v_line->>'currency', ''),
        'count', v_line->'qty',
        'buyer', v_cn,
        'status', '未到货',
        'paid', false,
        'shipped', '未发',
        'tracking', '',
        'received', false,
        'shopOrderId', v_oid,
        'shopOrderNo', v_no), true);
  end loop;

  -- 地址沿用 d.addresses 语义：下单地址同步（发货管理可见），下次下单预填
  v_addr_old := v_data->'addresses'->>v_cn;
  if coalesce(v_addr_old, '') <> p_addr then
    v_data := jsonb_set(v_data, array['addresses', v_cn], to_jsonb(p_addr), true);
  end if;

  -- 通知团长（复用 notify 模型）
  v_data := jsonb_set(v_data, '{notifications}',
    coalesce(v_data->'notifications', '[]'::jsonb) || jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'shop',
      'buyer', v_cn,
      'batchId', null,
      'title', '新商城订单 待收款',
      'body', v_no || ' ¥' || round(v_total + v_tail / 100.0, 2) || '（' || v_cn || '，' || v_count || ' 件）',
      'date', to_char(now(), 'YYYY-MM-DD'),
      'sent', false), true);

  update team_data set data = v_data, updated_at = now()
    where team_id = v_team_id
    returning updated_at into v_updated;

  return json_build_object(
    'no', v_no, 'total', round(v_total, 2), 'tail', v_tail,
    'paidTotal', round(v_total + v_tail / 100.0, 2),
    'count', v_count, 'updatedAt', v_updated);
end;
$$;

-- 我的订单：shopOrders 订单头 + 关联 orders 行推导进度（到货/发货/单号）
drop function if exists public.shop_get_my_orders();
create function public.shop_get_my_orders()
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_ctx json;
  v_cn text;
  v_data jsonb;
  v_head jsonb;
  v_rows jsonb;
  v_out jsonb;
  v_oid text;
  v_arrived int;
  v_shipped int;
  v_received int;
  v_total int;
begin
  v_ctx := public.shop_ctx();
  if not coalesce((v_ctx->>'bound')::boolean, false) then
    raise exception '请先绑定圈名';
  end if;
  v_cn := v_ctx->>'cn';
  v_data := v_ctx->'data';

  v_out := '[]'::jsonb;
  for v_head in select s from jsonb_array_elements(coalesce(v_data->'shopOrders', '[]'::jsonb)) s
                where s->>'cn' = v_cn
                order by s->>'createdAt' desc, s->>'no' desc loop
    v_oid := v_head->>'id';
    select jsonb_agg(o) into v_rows
      from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) o
      where o->>'shopOrderId' = v_oid;
    select count(*) into v_total
      from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x;
    select count(*) into v_arrived
      from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x where x->>'status' = '已到货';
    select count(*) into v_shipped
      from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x where x->>'shipped' = '已发';
    select count(*) into v_received
      from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x where (x->>'received')::boolean is true;
    v_out := v_out || jsonb_build_object(
      'no', v_head->>'no', 'status', v_head->>'status',
      'total', v_head->'total', 'paidTotal', v_head->'paidTotal', 'tail', v_head->'tail',
      'addr', v_head->>'addr', 'remark', v_head->>'remark', 'createdAt', v_head->>'createdAt',
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', x->>'type', 'model', x->>'model', 'qty', x->'qty', 'price', x->'price')
          order by x->>'type')
        from jsonb_array_elements(coalesce(v_head->'items', '[]'::jsonb)) x), '[]'::jsonb),
      'progress', jsonb_build_object(
        'arrived', v_arrived, 'shipped', v_shipped, 'received', v_received, 'lines', v_total,
        'trackings', coalesce((
          select jsonb_agg(distinct x->>'tracking')
          from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x
          where coalesce(x->>'tracking', '') <> ''), '[]'::jsonb)));
  end loop;
  return json_build_object('cn', v_cn, 'teamName', v_ctx->>'teamName', 'orders', v_out);
end;
$$;

-- 取消订单：仅待付款；订单头与关联 orders 行一并移除
drop function if exists public.shop_cancel_order(text);
create function public.shop_cancel_order(p_no text)
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_ctx json;
  v_cn text;
  v_team_id uuid;
  v_data jsonb;
  v_head jsonb;
  v_updated timestamptz;
begin
  v_ctx := public.shop_ctx();
  if not coalesce((v_ctx->>'bound')::boolean, false) then
    raise exception '请先绑定圈名';
  end if;
  v_cn := v_ctx->>'cn';
  v_team_id := v_ctx->>'teamId';

  select coalesce(d.data, '{}'::jsonb) into v_data
    from team_data d where d.team_id = v_team_id for update;
  if v_data is null then
    v_data := '{}'::jsonb;
  end if;

  select s into v_head
    from jsonb_array_elements(coalesce(v_data->'shopOrders', '[]'::jsonb)) s
    where s->>'no' = p_no and s->>'cn' = v_cn;
  if v_head is null then
    raise exception '订单不存在';
  end if;
  if v_head->>'status' <> '待付款' then
    raise exception '仅待付款订单可取消，如需售后请联系团长';
  end if;

  insert into team_data_history (team_id, data, source)
    select v_team_id, data, 'shop' from team_data where team_id = v_team_id;
  perform public.team_data_history_prune(v_team_id);

  v_data := jsonb_set(v_data, '{shopOrders}',
    coalesce((select jsonb_agg(s)
      from jsonb_array_elements(coalesce(v_data->'shopOrders', '[]'::jsonb)) s
      where s->>'no' <> p_no), '[]'::jsonb), true);
  v_data := jsonb_set(v_data, '{orders}',
    coalesce((select jsonb_agg(o)
      from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) o
      where coalesce(o->>'shopOrderId', '') <> v_head->>'id'), '[]'::jsonb), true);
  v_data := jsonb_set(v_data, '{notifications}',
    coalesce(v_data->'notifications', '[]'::jsonb) || jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'shop',
      'buyer', v_cn,
      'batchId', null,
      'title', '商城订单已取消',
      'body', p_no || '（' || v_cn || '）买家已取消',
      'date', to_char(now(), 'YYYY-MM-DD'),
      'sent', false), true);

  update team_data set data = v_data, updated_at = now()
    where team_id = v_team_id
    returning updated_at into v_updated;
  return json_build_object('ok', true, 'updatedAt', v_updated);
end;
$$;

-- 权限：shop_ctx 含整份 blob 仅限 definer 内部；六个对外 RPC 仅 authenticated
revoke execute on function public.shop_ctx() from public, anon, authenticated;
revoke execute on function public.shop_me() from public, anon;
revoke execute on function public.shop_bind_cn(text) from public, anon;
revoke execute on function public.shop_get_catalog() from public, anon;
revoke execute on function public.shop_place_order(jsonb, text, text) from public, anon;
revoke execute on function public.shop_get_my_orders() from public, anon;
revoke execute on function public.shop_cancel_order(text) from public, anon;
grant execute on function public.shop_me() to authenticated;
grant execute on function public.shop_bind_cn(text) to authenticated;
grant execute on function public.shop_get_catalog() to authenticated;
grant execute on function public.shop_place_order(jsonb, text, text) to authenticated;
grant execute on function public.shop_get_my_orders() to authenticated;
grant execute on function public.shop_cancel_order(text) to authenticated;
