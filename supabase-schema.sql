-- =====================================================================
-- Aoi-system · 全新数据模型（团队 / 成员 / 团队数据）
-- 重写自旧 leader_data 单表模型，改为「团队」粒度以支持多人管理。
-- 在 Supabase SQL Editor 中一次性执行。
-- =====================================================================

-- 1. 团队表：一个团一行。v3.10.0 起移除 v2 遗留的 owner_id（auth.users 外键）
--    与 invite_code——v3 管理员体系（admins 表）不再依赖 Supabase Auth，邀请码方案已停用。
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '我的团',
  member_key  text,
  created_at  timestamptz not null default now()
);

-- 迁移：为已存在的团队补充 member_key 字段（新建库已含此列，可安全重复执行）
alter table teams add column if not exists member_key text;
-- v3.10.0 归档 v2 账号体系（顺序敏感：teams/team_data 的策略引用 team_members 表、
-- 其表达式又引用 owner_id 列——必须先删策略，再删表，最后删列；历史值可查 *_bak_20260912 快照表与 git 历史）：
drop policy if exists "teams_select_member" on teams;
drop policy if exists "teams_update_owner" on teams;
drop policy if exists "team_data_select" on team_data;
drop policy if exists "team_data_insert" on team_data;
drop policy if exists "team_data_update" on team_data;
drop table if exists team_members;
alter table teams drop column if exists owner_id;
alter table teams drop column if exists invite_code;

-- 2.（v2 成员表 team_members 已随 v3.10.0 归档移除——v3 的管理员在 admins 表，
--    团员无账号、凭 member_key 匿名访问。被归档代码见 git 历史 v3.9.5 及更早 tag。）

-- 3. 团队数据表：业务数据 blob，后续阶段（订单/活动/批次等）填充
create table if not exists team_data (
  team_id    uuid primary key references teams(id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- 4. 团队数据历史表（v3.4.0 B1）：两个写入口 RPC 在每次覆盖前自动存档旧版本，
--    作为整 blob 覆盖事故（2026-09-06，orders 34→0）的系统性兜底。
--    开 RLS 且无任何策略：anon/authenticated 均不可直读直写，
--    仅经下方 admin_list_team_data_history / admin_get_team_data_history RPC 访问。
create table if not exists team_data_history (
  id        bigint generated always as identity primary key,
  team_id   uuid not null references teams(id) on delete cascade,
  data      jsonb not null,
  source    text not null default 'admin' check (source in ('admin', 'member')),
  saved_at  timestamptz not null default now()
);
create index if not exists team_data_history_team_saved
  on team_data_history (team_id, saved_at desc);
alter table team_data_history enable row level security;

-- =====================================================================
-- RPC（security definer：绕过 RLS，由函数内部校验身份）
-- =====================================================================

-- =====================================================================
-- v2 账号体系遗物已归档（v3.10.0）：create_my_team / join_team_by_code /
-- regenerate_invite_code / regenerate_member_key(auth.uid 版) 随 team_members
-- 表与邀请码方案一并移除。前端（v3 起即）零调用：
--   建团 → admin_bootstrap 首次初始化时自动完成（见下）；
--   密钥重生成 → admin_regenerate_member_key（仅 super）。
-- 被归档代码可在 git 历史（v3.9.5 及更早 tag）查阅。
-- =====================================================================
drop function if exists public.create_my_team(text);
drop function if exists public.join_team_by_code(text);
drop function if exists public.regenerate_invite_code();
drop function if exists public.regenerate_member_key();

-- =====================================================================
-- 团员端匿名访问（security definer 绕过 RLS，内部校验 member_key）
-- 注意：任何持有 member_key 的人都能读/写团队数据，密钥即访问凭证。
-- ⚠️ 线上库重跑验证清单（v1.7.0 起本节函数签名有变更，必须 drop 后重建）：
--   1. 在 Supabase SQL Editor 顺序执行本文件；
--   2. 执行下方「排查 SQL」确认两个 RPC 存在且 anon 有 EXECUTE 权限；
--   3. 确认每个团队在 team_data 有一行（写入 RPC 已改为 upsert 自动补行）。
-- =====================================================================

-- 按团员密钥读取团队名 + 业务数据 blob + 数据版本（匿名，无 auth.uid）
-- drop 再建：create or replace 无法变更返回结构/签名，旧签名残留会导致重跑报错。
-- 注意：用 plpgsql + #variable_conflict use_variable——若用 language sql，
-- `where t.member_key = member_key` 的裸 member_key 会被解析成列名（列优先于参数），
-- 恒为真导致任意密钥都能读到第一个团队（安全漏洞）。
-- v3.4.0 B2 Phase 1：新增可选 p_cn（团员输入的圈名或 QQ 号）。
--   服务端把 addresses / memberMeta / cnChanges 裁剪到本人条目后返回，
--   并回传解析后的 cn；p_cn 为空（旧客户端）时整体剔除这三类 PII 字段。
drop function if exists public.get_team_by_member_key(text);
drop function if exists public.get_team_by_member_key(text, text);
create function public.get_team_by_member_key(member_key text, p_cn text default null)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_row record;
  v_data jsonb;
  v_cn text;
  v_qq_cn text;
begin
  select t.name, coalesce(d.data, '{}'::jsonb) as data, d.updated_at
    into v_row
    from teams t
    left join team_data d on d.team_id = t.id
    where t.member_key = member_key
    limit 1;
  if v_row.name is null then
    return null;
  end if;

  v_data := v_row.data;
  v_cn := p_cn;

  -- 输入可能是 QQ 号：memberMeta 命中则换算为对应 CN
  -- （jsonb_each 返回列名为 key/value，勿用缩写别名——v3.4.0 曾因 k 别名在线上报 42703）
  if v_cn is not null and v_data->'memberMeta' is not null then
    select key into v_qq_cn
    from jsonb_each(v_data->'memberMeta')
    where value->>'qq' = v_cn
    limit 1;
    if v_qq_cn is not null then v_cn := v_qq_cn; end if;
  end if;

  if v_cn is null then
    v_data := v_data - 'addresses' - 'memberMeta' - 'cnChanges';
  else
    v_data := jsonb_set(v_data, '{addresses}',
      coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_data->'addresses', '{}'::jsonb)) where key = v_cn), '{}'::jsonb), true);
    v_data := jsonb_set(v_data, '{memberMeta}',
      coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_data->'memberMeta', '{}'::jsonb)) where key = v_cn), '{}'::jsonb), true);
    v_data := jsonb_set(v_data, '{cnChanges}',
      coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(v_data->'cnChanges', '[]'::jsonb)) e
                where e->>'oldCn' = v_cn or e->>'newCn' = v_cn), '[]'::jsonb), true);
  end if;

  return json_build_object(
    'name', v_row.name,
    'data', v_data,
    'updatedAt', v_row.updated_at,
    'cn', v_cn
  );
end;
$$;

-- 历史快照保留策略（v3.4.0 B1）：每团保留近 30 天且最多 100 份。
-- 由两个写入口 RPC 在每次保存时顺带调用（保存频率低，无需 pg_cron）。
create or replace function public.team_data_history_prune(p_team_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from team_data_history
  where team_id = p_team_id
    and (saved_at < now() - interval '30 days'
         or id not in (
           select id from team_data_history
           where team_id = p_team_id
           order by saved_at desc, id desc
           limit 100
         ));
$$;

-- 单团模型守卫（v3.11.0 B6）：团队行数 >1 时显式报错，防 admin_* 与 F5 RPC
-- 「select ... from teams limit 1」在误建第二团时静默操作错团。
-- 返回唯一团队的 id（无团队时返回 null，由调用方各自处理）。
create or replace function public.assert_single_team()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from teams) > 1 then
    raise exception '检测到多个团队行——本系统为单团模型，请清理多余 teams 行后重试';
  end if;
  return (select id from teams order by created_at limit 1);
end;
$$;

-- jsonb 数组按 id 合并单条（v3.4.0 B2 辅助）：存在同 id 则整条替换，不存在则追加
create or replace function public.jsonb_array_upsert_by_id(p_array jsonb, p_item jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_item ? 'id' and exists (
      select 1 from jsonb_array_elements(coalesce(p_array, '[]'::jsonb)) o
      where o->>'id' = p_item->>'id')
    then (select coalesce(jsonb_agg(case when o->>'id' = p_item->>'id' then p_item else o end), '[]'::jsonb)
          from jsonb_array_elements(coalesce(p_array, '[]'::jsonb)) o)
    else coalesce(p_array, '[]'::jsonb) || p_item
  end;
$$;

-- 按团员密钥写入业务数据 blob（匿名，覆盖整份数据；密钥即授权）
-- v1.7.0 修复：
--   ① insert ... on conflict upsert —— 旧版只 update，team_data 缺行时
--      影响 0 行仍返回成功，造成"保存成功但什么都没写"（仅团员端复现）；
--   ② 可选乐观锁 expected_updated_at —— 与 team_data.updated_at 不一致时拒绝，
--      防止整 blob 覆盖竞态（"改了又没了"）；
--   ③ 返回写入后的 updated_at，供前端下次写入作为乐观锁版本。
--   ④ plpgsql + #variable_conflict use_variable —— 裸 member_key 按参数解析，
--      否则默认策略下与 teams.member_key 列同名产生 42702 二义性错误。
--   ⑤ v3.4.0 B2 Phase 1：新增可选 p_cn（团员端解析出的圈名）。
--      团员写入从「整份覆盖」改为「按 CN 白名单合并」：
--        可写 = 本人 addresses/memberMeta 条目、本人 orders（整条，实际只差 received）、
--               本人 payments（凭证字段 + 状态上限：已交/已驳回只能由管理端写）、
--               本人 transfers / cnChanges 条目、本人产生的 address/cnchange 通知；
--        其余字段一律以服务端现值为准。
--      v3.10.0：p_cn 为空的「旧版客户端兼容桥」（整份覆盖）已移除——该桥可被持密钥者
--      用省略 p_cn 的方式绕过整个白名单；p_cn 缺失/空/超 64 字符一律拒绝写入。
drop function if exists public.update_team_data_by_member_key(text, jsonb);
drop function if exists public.update_team_data_by_member_key(text, jsonb, timestamptz);
drop function if exists public.update_team_data_by_member_key(text, jsonb, timestamptz, text);
create function public.update_team_data_by_member_key(
  member_key text,
  new_data jsonb,
  expected_updated_at timestamptz default null,
  p_cn text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  target_team_id uuid;
  new_updated_at timestamptz;
  v_old jsonb;
  v_merged jsonb;
  v_arr jsonb;
  v_item jsonb;
  v_existed boolean;
begin
  select t.id into target_team_id from teams t where t.member_key = member_key limit 1;
  if target_team_id is null then
    raise exception '密钥无效';
  end if;

  if expected_updated_at is not null then
    if (select updated_at from team_data where team_id = target_team_id)
        is distinct from expected_updated_at then
      raise exception '数据已被他人修改，请刷新后重试';
    end if;
  end if;

  -- v3.4.0 B1：覆盖前把当前版本存档（team_data 缺行时不存档），并按保留策略清理
  insert into team_data_history (team_id, data, source)
  select team_id, data, 'member' from team_data where team_id = target_team_id;
  perform public.team_data_history_prune(target_team_id);

  -- v3.10.0 安全修复：p_cn 缺失/空/超 64 字符一律拒绝（原「p_cn 为空 = 旧版客户端
  -- 整份覆盖」兼容桥可被持密钥者绕过下方整个白名单，与 2026-09-06 数据事故同模型）。
  -- 现役前端写入必带 p_cn（js/data.js saveTeamDataByMemberKey）。
  if p_cn is null or length(trim(p_cn)) = 0 or length(p_cn) > 64 then
    raise exception '圈名缺失或不合法，已拒绝写入（客户端版本过旧请刷新页面）';
  end if;

  select coalesce(data, '{}'::jsonb) into v_old from team_data where team_id = target_team_id;
  v_merged := v_old;

  -- 本人 addresses / memberMeta 条目
  if new_data ? 'addresses' and new_data->'addresses' ? p_cn then
    v_merged := jsonb_set(v_merged, array['addresses', p_cn], new_data#>array['addresses', p_cn], true);
  end if;
  if new_data ? 'memberMeta' and new_data->'memberMeta' ? p_cn then
    v_merged := jsonb_set(v_merged, array['memberMeta', p_cn], new_data#>array['memberMeta', p_cn], true);
  end if;

  -- 本人 orders（团员端唯一会改的是 received）
  for v_item in select e from jsonb_array_elements(coalesce(new_data->'orders', '[]'::jsonb)) e
                where e->>'buyer' = p_cn and e->>'id' is not null
  loop
    v_merged := jsonb_set(v_merged, '{orders}',
      public.jsonb_array_upsert_by_id(v_merged->'orders', v_item), true);
  end loop;

  -- 本人 payments：凭证字段可写；状态仅接受 待交/待审核（防自批「已交」）
  for v_item in select e from jsonb_array_elements(coalesce(new_data->'payments', '[]'::jsonb)) e
                where e->>'buyer' = p_cn and e->>'id' is not null
  loop
    select exists (
      select 1 from jsonb_array_elements(coalesce(v_merged->'payments', '[]'::jsonb)) o
      where o->>'id' = v_item->>'id'
    ) into v_existed;
    if v_existed then
      v_merged := jsonb_set(v_merged, '{payments}',
        (select coalesce(jsonb_agg(
           case when o->>'id' = v_item->>'id' then
             jsonb_set(
               jsonb_set(jsonb_set(o,
                 '{receipt}', coalesce(v_item->'receipt', o->'receipt')),
                 '{receiptDate}', coalesce(v_item->'receiptDate', o->'receiptDate')),
               '{status}',
                 case when coalesce(v_item->>'status', '') in ('待交', '待审核')
                      then coalesce(v_item->'status', o->'status')
                      else coalesce(o->'status', '"待交"'::jsonb) end)
           else o end), '[]'::jsonb)
         from jsonb_array_elements(coalesce(v_merged->'payments', '[]'::jsonb)) o));
    else
      v_arr := coalesce(v_merged->'payments', '[]'::jsonb) || jsonb_build_object(
        'id', v_item->'id',
        'batchId', v_item->'batchId',
        'buyer', coalesce(v_item->'buyer', to_jsonb(p_cn)),
        'status', case when coalesce(v_item->>'status', '') in ('待交', '待审核')
                       then coalesce(v_item->'status', '"待审核"'::jsonb)
                       else '"待审核"'::jsonb end,
        'receipt', v_item->'receipt',
        'receiptDate', v_item->'receiptDate');
      v_merged := jsonb_set(v_merged, '{payments}', v_arr, true);
    end if;
  end loop;

  -- 本人 transfers / cnChanges 条目（按 id 合并，团长处理的其余条目不受影响）
  for v_item in select e from jsonb_array_elements(coalesce(new_data->'transfers', '[]'::jsonb)) e
                where e->>'buyer' = p_cn and e->>'id' is not null
  loop
    v_merged := jsonb_set(v_merged, '{transfers}',
      public.jsonb_array_upsert_by_id(v_merged->'transfers', v_item), true);
  end loop;
  for v_item in select e from jsonb_array_elements(coalesce(new_data->'cnChanges', '[]'::jsonb)) e
                where (e->>'oldCn' = p_cn or e->>'newCn' = p_cn) and e->>'id' is not null
  loop
    v_merged := jsonb_set(v_merged, '{cnChanges}',
      public.jsonb_array_upsert_by_id(v_merged->'cnChanges', v_item), true);
  end loop;

  -- 仅接受团员产生的 address / cnchange 通知（按 id 合并，催缴/发货等管理端通知不可写）
  for v_item in select e from jsonb_array_elements(coalesce(new_data->'notifications', '[]'::jsonb)) e
                where coalesce(e->>'type', '') in ('address', 'cnchange') and e->>'id' is not null
  loop
    v_merged := jsonb_set(v_merged, '{notifications}',
      public.jsonb_array_upsert_by_id(v_merged->'notifications', v_item), true);
  end loop;

  insert into team_data (team_id, data, updated_at)
  values (target_team_id, v_merged, now())
  on conflict (team_id) do update
    set data = excluded.data, updated_at = excluded.updated_at
  returning updated_at into new_updated_at;

  return new_updated_at;
end;
$$;

-- —— 排查 SQL（线上排障时在 SQL Editor 执行）——
-- ① RPC 是否存在（应返回 2 行；update 那行为三参数签名）：
--   select proname, pg_get_function_arguments(oid)
--   from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('get_team_by_member_key','update_team_data_by_member_key');
-- ② anon 是否有执行权限（均应为 true；注意 has_function_privilege 按签名
--    精确匹配，写入 RPC 必须用三参数签名，两参数会报 42883 does not exist）：
--   select has_function_privilege('anon','public.get_team_by_member_key(text)','EXECUTE'),
--          has_function_privilege('anon','public.update_team_data_by_member_key(text,jsonb,timestamptz)','EXECUTE');
-- ③ 团队密钥是否为 null：select id, name, member_key from teams;
-- ④ v3.4.0 历史快照链路（备份/恢复）：存在性 + 匿名不可直读
--   select proname from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('team_data_history_prune','admin_list_team_data_history','admin_get_team_data_history');
--   select count(*) from team_data_history;  -- security definer 外直查应报权限错误（RLS 无策略）

-- =====================================================================
-- F5 · QQ 机器人双向（独立项目 aoi-qqbot 消费的 3 个只读 RPC）
-- 设计文档：docs/PLAN-F5-QQBOT-BIDIRECTIONAL.md（三·新增 RPC / 附录 / 附录 B）
-- 纪律与团员端 RPC 相同：drop if exists 再 create（可重复执行）；
-- security definer；返回字段白名单——不含整 blob、地址、凭证 URL、他人数据。
-- ① member_lookup_by_qq(p_qq)      查单/进度：QQ→CN 解析后返回本人摘要
-- ② team_summary_for_group()       群内团况：团级聚合（无个人字段）
-- ③ unpaid_members_by_group()      自动催缴：待缴费名单 + botConfig 白名单出参
-- =====================================================================

drop function if exists public.member_lookup_by_qq(text);
create function public.member_lookup_by_qq(p_qq text)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_team text;
  v_data jsonb;
  v_cn text;
  v_batch_dates jsonb;
begin
  select t.name, coalesce(d.data, '{}'::jsonb)
    into v_team, v_data
    from teams t
    left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  if v_team is null or v_data->'memberMeta' is null then
    return null;
  end if;

  -- QQ → CN（jsonb_each 列名为 key/value，勿用缩写别名——v3.4.0 曾因 k 别名报 42703）
  select key into v_cn
  from jsonb_each(v_data->'memberMeta')
  where value->>'qq' = p_qq
  limit 1;
  if v_cn is null then
    return null;
  end if;

  select coalesce(jsonb_object_agg(b->>'id', b->>'date'), '{}'::jsonb)
    into v_batch_dates
  from jsonb_array_elements(coalesce(v_data->'batches', '[]'::jsonb)) b;

  return json_build_object(
    'cn', v_cn,
    'teamName', v_team,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'activity', o->>'activity',
          'typeModel', concat_ws(' - ', o->>'type', o->>'model'),
          'count', o->'count',
          'status', coalesce(o->>'status', '排单中'),
          'shipped', coalesce(o->>'shipped', '未发'),
          'received', coalesce(o->'received', 'false'::jsonb),
          'tracking', o->>'tracking',
          'batchDate', v_batch_dates ->> coalesce(o->>'batchId', '')
        ) order by o->>'id')
      from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) o
      where o->>'buyer' = v_cn
    ), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object(
          'batchId', p->>'batchId',
          'batchDate', v_batch_dates ->> coalesce(p->>'batchId', ''),
          'intlFee', p->'intlFee',
          'payStatus', coalesce(p->>'status', '待交')
        ) order by p->>'batchId')
      from jsonb_array_elements(coalesce(v_data->'payments', '[]'::jsonb)) p
      where p->>'buyer' = v_cn
    ), '[]'::jsonb),
    'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

drop function if exists public.team_summary_for_group();
create function public.team_summary_for_group()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_team text;
  v_data jsonb;
  v_orders jsonb;
  v_payments jsonb;
  v_total int;
  v_paid int;
  v_stage text;
begin
  select t.name, coalesce(d.data, '{}'::jsonb)
    into v_team, v_data
    from teams t
    left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  if v_team is null then
    return null;
  end if;

  select coalesce(v_data->'orders', '[]'::jsonb), coalesce(v_data->'payments', '[]'::jsonb)
    into v_orders, v_payments;

  select count(*) into v_total
  from jsonb_object_keys(coalesce(v_data->'memberMeta', '{}'::jsonb));

  -- 已缴费：有已到货订单，且其所有到货批次均有「已交」记录
  select count(*) into v_paid
  from jsonb_object_keys(coalesce(v_data->'memberMeta', '{}'::jsonb)) k
  where exists (
        select 1 from jsonb_array_elements(v_orders) o
        where o->>'buyer' = k and o->>'batchId' is not null)
    and not exists (
        select 1 from jsonb_array_elements(v_orders) o
        where o->>'buyer' = k and o->>'batchId' is not null
          and not exists (
            select 1 from jsonb_array_elements(v_payments) p
            where p->>'buyer' = k and p->>'batchId' = o->>'batchId' and p->>'status' = '已交'));

  -- 团阶段：排单 → 到货 → 交费 → 排发 → 收尾
  if not exists (select 1 from jsonb_array_elements(v_orders) o) then
    v_stage := '排单';
  elsif exists (
        select 1 from jsonb_array_elements(v_orders) o
        where coalesce(o->>'status', '') <> '已到货' or o->>'batchId' is null) then
    v_stage := case when exists (
                select 1 from jsonb_array_elements(v_orders) o
                where o->>'status' = '已到货' and o->>'batchId' is not null)
              then '到货' else '排单' end;
  elsif exists (
        select 1 from jsonb_array_elements(v_orders) o
        where o->>'batchId' is not null
          and not exists (
            select 1 from jsonb_array_elements(v_payments) p
            where p->>'buyer' = o->>'buyer' and p->>'batchId' = o->>'batchId'
              and p->>'status' = '已交')) then
    v_stage := '交费';
  elsif exists (
        select 1 from jsonb_array_elements(v_orders) o
        where coalesce(o->>'shipped', '未发') <> '已发') then
    v_stage := '排发';
  else
    v_stage := '收尾';
  end if;

  return json_build_object(
    'teamName', v_team,
    'stage', v_stage,
    'totalMembers', v_total,
    'paidCount', v_paid,
    'unpaidCount', greatest(v_total - v_paid, 0),
    -- blob 无 DDL 字段：恒 null，relay 侧据此省略该行
    'deadline', null,
    'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

drop function if exists public.unpaid_members_by_group();
create function public.unpaid_members_by_group()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_team text;
  v_data jsonb;
  v_orders jsonb;
  v_payments jsonb;
  v_batch_dates jsonb;
  v_unpaid jsonb;
begin
  select t.name, coalesce(d.data, '{}'::jsonb)
    into v_team, v_data
    from teams t
    left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  if v_team is null then
    return null;
  end if;

  select coalesce(v_data->'orders', '[]'::jsonb), coalesce(v_data->'payments', '[]'::jsonb)
    into v_orders, v_payments;

  select coalesce(jsonb_object_agg(b->>'id', b->>'date'), '{}'::jsonb)
    into v_batch_dates
  from jsonb_array_elements(coalesce(v_data->'batches', '[]'::jsonb)) b;

  -- 未清批次：成员有该批次的已到货订单，且该批次无「已交」记录
  with unpaid_batches as (
    select e.key as cn, e.value->>'qq' as qq, o->>'batchId' as batch_id
    from jsonb_each(coalesce(v_data->'memberMeta', '{}'::jsonb)) e
    join jsonb_array_elements(v_orders) o
      on o->>'buyer' = e.key and o->>'batchId' is not null
    where not exists (
      select 1 from jsonb_array_elements(v_payments) p
      where p->>'buyer' = e.key and p->>'batchId' = o->>'batchId' and p->>'status' = '已交')
    group by e.key, e.value->>'qq', o->>'batchId'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'cn', g.cn,
           'qq', g.qq,
           'amount', coalesce(amt.total, 0),
           'batchDates', bd.dates,
           'deadline', null::text
         ) order by g.cn), '[]'::jsonb)
    into v_unpaid
  from (
    select cn, max(qq) as qq
    from unpaid_batches
    group by cn
  ) g
  left join lateral (
    select sum((p->>'intlFee')::numeric) as total
    from jsonb_array_elements(v_payments) p
    where p->>'buyer' = g.cn
      and coalesce(p->>'status', '待交') <> '已交'
      and p->>'batchId' in (select u.batch_id from unpaid_batches u where u.cn = g.cn)
  ) amt on true
  left join lateral (
    select jsonb_agg(distinct v_batch_dates ->> u.batch_id) as dates
    from unpaid_batches u
    where u.cn = g.cn
  ) bd on true;

  return json_build_object(
    'teamName', v_team,
    'unpaid', v_unpaid,
    -- botConfig 白名单出参：只暴露二维码 URL 与管理员转发 QQ
    'settings', jsonb_build_object(
      'qrUrl', v_data#>>'{botConfig,qrUrl}',
      'adminQq', v_data#>>'{botConfig,adminQq}'
    ),
    'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

-- —— F5 RPC 排查 SQL（线上排障时在 SQL Editor 执行）——
-- ① 三个 RPC 存在且 anon 可执行（均应 true）：
--   select has_function_privilege('anon','public.member_lookup_by_qq(text)','EXECUTE'),
--          has_function_privilege('anon','public.team_summary_for_group()','EXECUTE'),
--          has_function_privilege('anon','public.unpaid_members_by_group()','EXECUTE');
-- ② 行为抽查：
--   select public.member_lookup_by_qq('<某已绑定 QQ>');   -- 只含本人 orders/fees
--   select public.team_summary_for_group();               -- 只含聚合字段
--   select public.unpaid_members_by_group();              -- unpaid + settings(qrUrl/adminQq)

-- =====================================================================
-- 行级安全策略（RLS）
-- =====================================================================
alter table teams enable row level security;
alter table team_data enable row level security;

-- v3.10.0 归档 v2 账号体系：team_members 表（已 drop）与其 RLS、is_team_member、
-- teams/team_data 的成员读写策略一并移除。teams / team_data 保留 RLS 且无任何策略
-- = 拒绝一切匿名/authenticated 直读直写；全部访问只经 security definer RPC
-- （admin_* 与团员密钥两函数）。drop if exists 保证老库重跑可收敛。
drop policy if exists "teams_select_member" on teams;
drop policy if exists "teams_update_owner" on teams;
drop policy if exists "team_data_select" on team_data;
drop policy if exists "team_data_insert" on team_data;
drop policy if exists "team_data_update" on team_data;
drop function if exists public.is_team_member(uuid);

-- =====================================================================
-- v3 管理员账号体系（用户名+密码自持凭据，脱离 Supabase Auth）
-- 设计：docs/PLAN-AUTH-REDESIGN.md
-- 安全模型：admins / admin_sessions 开启 RLS 且无任何策略
--   → anon / authenticated 均不可直接读写，仅经下方 security definer RPC。
--   参数一律 p_ 前缀，避免与列同名触发 42702 二义性。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists admins (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password_hash text not null,
  role          text not null default 'admin' check (role in ('super','admin')),
  created_at    timestamptz not null default now()
);

create table if not exists admin_sessions (
  token_hash  text primary key,                 -- sha256(token)，明文 token 只在登录响应出现一次
  admin_id    uuid not null references admins(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);

alter table admins enable row level security;
alter table admin_sessions enable row level security;

-- v3.12.0 登录防爆破节流序列：记录最近一次登录失败的 epoch（setval 写盘即时生效、
-- 不随事务回滚——这是它相对普通表列的关键差异；序列本身必须在基线中预先存在，
-- 若在同事务内 create 则会随回滚消失）。登录失败后 5 秒内的后续登录直接拒绝。
create sequence if not exists admin_lastfail;

-- v3.12.0：v3.10.0 的 failed_attempts / locked_until 列退役——同事务回滚缺陷使
-- 「失败计数 + raise」从未生效；登录防爆破改走序列节流（admin_login 内，回滚免疫）
alter table admins drop column if exists failed_attempts;
alter table admins drop column if exists locked_until;

-- —— v3.12.0 B3 后半：审计日志 ——
-- 多管理员共用一份 blob，出事必须能回答「谁在什么时候改了什么」（2026-09-06 取证靠全库人工穷举）。
-- RLS 开启且无策略：仅经下方 security definer RPC 读写。
create table if not exists admin_audit_log (
  id        bigint generated always as identity primary key,
  admin_id  uuid,
  username  text,
  action    text not null,
  detail    jsonb,
  at        timestamptz not null default now()
);
create index if not exists admin_audit_log_at on admin_audit_log (at desc);
alter table admin_audit_log enable row level security;

-- 审计写入辅助（各 admin_* RPC 内调用；失败登录传 null id 的合成对象）。
-- 参数用 jsonb（调用侧 jsonb_build_object 返回 jsonb；json/jsonb 无隐式转换，v3.12.0 线上探针修正）
create or replace function public.admin_audit(p_admin jsonb, p_action text, p_detail jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into admin_audit_log (admin_id, username, action, detail)
  values ((p_admin->>'id')::uuid, p_admin->>'username', p_action, p_detail);
$$;

-- —— v3.12.0 B5：schema 迁移版本表（scripts/sb.js --migrate 按序执行 supabase/migrations/
--    NNN-xxx.sql 中未应用的脚本并在此登记；本全量文件保持可独立重跑的基线）——
create table if not exists schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;

-- 会话校验（内部辅助 + relay 鉴权入口）：返回 {id, username, role} 或 null
create or replace function public.admin_verify_session(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  delete from admin_sessions where expires_at < now();  -- 顺手清理过期会话
  return (
    select json_build_object('id', a.id, 'username', a.username, 'role', a.role)
    from admin_sessions s join admins a on a.id = s.admin_id
    where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
      and s.expires_at > now()
    limit 1
  );
end;
$$;

-- 初始化超管：仅当不存在任何管理员时可用（部署者首次打开网页调用）
create or replace function public.admin_bootstrap(p_username text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_count int;
  v_id uuid;
  v_token text;
  v_expires timestamptz;
begin
  select count(*) into v_count from admins;
  if v_count > 0 then
    raise exception '管理员已初始化，请直接登录';
  end if;
  if p_username is null or length(trim(p_username)) < 2 then
    raise exception '用户名至少 2 个字符';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception '密码至少 6 位';
  end if;

  insert into admins (username, password_hash, role)
  values (trim(p_username), crypt(p_password, gen_salt('bf')), 'super')
  returning id into v_id;

  -- v3.10.0：首次初始化时顺带建团（v2 的 create_my_team 已归档，v3 前端无建团入口——
  -- 全新部署此前会卡死在「尚未创建团队」）。存量库已有团队行，此分支不触发。
  if not exists (select 1 from teams limit 1) then
    insert into teams (name) values ('我的团');
    insert into team_data (team_id) select id from teams order by created_at limit 1;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + interval '30 days';
  insert into admin_sessions (token_hash, admin_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_id, v_expires);

  perform public.admin_audit(jsonb_build_object('id', v_id, 'username', trim(p_username)), 'bootstrap');

  return json_build_object('token', v_token, 'role', 'super', 'username', trim(p_username), 'expiresAt', v_expires);
end;
$$;

-- 是否已初始化（登录页据此决定显示初始化还是登录）
create or replace function public.admin_initialized()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from admins limit 1);
$$;

-- 登录（v3.10.0 引入防爆破；v3.12.0 修正——原「失败计数 UPDATE + raise」在同一事务内，
-- 抛错时计数一并回滚、锁定从未生效。现改用序列记录最近失败时刻：setval 非事务性、
-- 回滚免疫，失败后 5 秒内的新尝试直接拒绝，把爆破速率压到 0.2 次/秒（叠加 bcrypt 慢哈希））
create or replace function public.admin_login(p_username text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin admins%rowtype;
  v_token text;
  v_expires timestamptz;
  v_lastfail bigint;
begin
  if p_username is null or p_password is null then
    raise exception '请输入用户名和密码';
  end if;
  delete from admin_sessions where expires_at < now();
  delete from admin_audit_log where at < now() - interval '90 days'; -- 审计保留 90 天（v3.12.0）
  select * into v_admin from admins where username = trim(p_username) limit 1;

  -- 防爆破节流（全局单序列：单团部署仅数名管理员，任一失败后 5 秒冷却可接受）
  select coalesce(last_value, 0) into v_lastfail from pg_sequences where sequencename = 'admin_lastfail';
  if v_lastfail > 1 and extract(epoch from now()) - v_lastfail < 5 then
    raise exception '尝试过于频繁，请稍后再试';
  end if;

  if v_admin.id is null or v_admin.password_hash <> crypt(p_password, v_admin.password_hash) then
    -- setval 不随本事务回滚——失败时刻真实留存（审计行会随 raise 回滚，故失败不留审计行）
    perform setval('admin_lastfail', extract(epoch from now())::bigint, true);
    raise exception '用户名或密码错误';
  end if;
  perform setval('admin_lastfail', 1, false); -- 登录成功即解除冷却
  perform public.admin_audit(jsonb_build_object('id', v_admin.id, 'username', v_admin.username), 'login');
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + interval '30 days';
  insert into admin_sessions (token_hash, admin_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_admin.id, v_expires);
  return json_build_object('token', v_token, 'role', v_admin.role, 'username', v_admin.username, 'expiresAt', v_expires);
end;
$$;

-- 退出（删除会话；v3.12.0 起审计）
create or replace function public.admin_logout(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  select json_build_object('id', a.id, 'username', a.username)
    into v_admin
    from admin_sessions s join admins a on a.id = s.admin_id
    where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
    limit 1;
  delete from admin_sessions where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  perform public.admin_audit(v_admin, 'logout');
  return true;
end;
$$;

-- 管理员列表（仅 super）
create or replace function public.admin_list(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可查看账号列表'; end if;
  return coalesce(json_agg(json_build_object('id', id, 'username', username, 'role', role, 'createdAt', created_at) order by created_at), '[]'::json)
    from admins;
end;
$$;

-- 添加管理员（仅 super）
create or replace function public.admin_create(p_token text, p_username text, p_password text, p_role text default 'admin')
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
  v_id uuid;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可添加管理员'; end if;
  if p_role not in ('super','admin') then raise exception '角色不合法'; end if;
  if p_username is null or length(trim(p_username)) < 2 then raise exception '用户名至少 2 个字符'; end if;
  if p_password is null or length(p_password) < 6 then raise exception '密码至少 6 位'; end if;
  insert into admins (username, password_hash, role)
  values (trim(p_username), crypt(p_password, gen_salt('bf')), p_role)
  returning id into v_id;
  perform public.admin_audit(v_admin, 'admin_create', jsonb_build_object('target', trim(p_username), 'role', p_role));
  return json_build_object('id', v_id, 'username', trim(p_username), 'role', p_role);
end;
$$;

-- 删除管理员（仅 super；不能删自己，且不能删掉最后一个 super）
create or replace function public.admin_delete(p_token text, p_admin_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
  v_target admins%rowtype;
  v_super_count int;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可删除管理员'; end if;
  if v_admin->>'id' = p_admin_id::text then raise exception '不能删除自己的账号'; end if;
  select * into v_target from admins where id = p_admin_id limit 1;
  if v_target.id is null then raise exception '账号不存在'; end if;
  if v_target.role = 'super' then
    select count(*) into v_super_count from admins where role = 'super';
    if v_super_count <= 1 then raise exception '不能删除最后一个超级管理员'; end if;
  end if;
  delete from admins where id = p_admin_id;
  perform public.admin_audit(v_admin, 'admin_delete', jsonb_build_object('target', v_target.username));
  return true;
end;
$$;

-- 重置任意管理员密码（仅 super）
create or replace function public.admin_reset_password(p_token text, p_admin_id uuid, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可重置密码'; end if;
  if p_new_password is null or length(p_new_password) < 6 then raise exception '密码至少 6 位'; end if;
  update admins set password_hash = crypt(p_new_password, gen_salt('bf')) where id = p_admin_id;
  delete from admin_sessions where admin_id = p_admin_id;  -- 踢下线
  perform public.admin_audit(v_admin, 'admin_reset_password',
    jsonb_build_object('target', (select username from admins where id = p_admin_id)));
  return true;
end;
$$;

-- 修改自己的密码
create or replace function public.admin_change_password(p_token text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if p_new_password is null or length(p_new_password) < 6 then raise exception '密码至少 6 位'; end if;
  update admins set password_hash = crypt(p_new_password, gen_salt('bf'))
  where id = (v_admin->>'id')::uuid;
  perform public.admin_audit(v_admin, 'change_password');
  return true;
end;
$$;

-- 读取团队数据（单团：teams 取一行；返回 {name, memberKey, data, updatedAt}）
create or replace function public.admin_get_team_data(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
  v_row record;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  select t.name, t.member_key, d.data, d.updated_at
    into v_row
    from teams t left join team_data d on d.team_id = t.id
    where t.id = public.assert_single_team();
  if v_row is null then raise exception '尚未创建团队'; end if;
  return json_build_object(
    'name', v_row.name,
    'memberKey', v_row.member_key,
    'data', coalesce(v_row.data, '{}'::jsonb),
    'updatedAt', v_row.updated_at
  );
end;
$$;

-- 保存团队数据（token 校验 + 乐观锁 + upsert；管理端业务写唯一入口）
create or replace function public.admin_save_team_data(
  p_token text,
  p_data jsonb,
  p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
  target_team_id uuid;
  new_updated_at timestamptz;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  target_team_id := public.assert_single_team(); -- v3.11.0 B6：单团守卫（原 limit 1 硬编码）
  if target_team_id is null then raise exception '尚未创建团队'; end if;

  if p_expected_updated_at is not null then
    if (select updated_at from team_data where team_id = target_team_id)
        is distinct from p_expected_updated_at then
      raise exception '数据已被他人修改，请刷新后重试';
    end if;
  end if;

  -- v3.4.0 B1：覆盖前把当前版本存档（team_data 缺行时不存档），并按保留策略清理
  insert into team_data_history (team_id, data, source)
  select team_id, data, 'admin' from team_data where team_id = target_team_id;
  perform public.team_data_history_prune(target_team_id);

  insert into team_data (team_id, data, updated_at)
  values (target_team_id, p_data, now())
  on conflict (team_id) do update
    set data = excluded.data, updated_at = excluded.updated_at
  returning updated_at into new_updated_at;

  -- v3.12.0 B3：保存审计——只记摘要（订单条数/体积），不落全文，控制膨胀
  perform public.admin_audit(v_admin, 'save_team_data',
    jsonb_build_object('orders', coalesce(jsonb_array_length(p_data->'orders'), 0), 'bytes', octet_length(p_data::text)));

  return new_updated_at;
end;
$$;

-- blob 历史快照列表（v3.4.0 B1；摘要不含数据全文，供设置页「数据备份与恢复」卡展示/回滚）
create or replace function public.admin_list_team_data_history(p_token text, p_limit int default 20)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  return coalesce(json_agg(row_to_json(x) order by x."savedAt" desc), '[]'::json)
  from (
    select h.id, h.source, h.saved_at as "savedAt",
           coalesce(jsonb_array_length(h.data -> 'orders'), 0) as "ordersCount",
           octet_length(h.data::text) as "bytes"
    from team_data_history h
    where h.team_id = public.assert_single_team()
    limit greatest(coalesce(p_limit, 20), 1)
  ) x;
end;
$$;

-- 读取单份历史快照全文（恢复 = 取回后走 admin_save_team_data 写回，覆盖前又会自动存档）
create or replace function public.admin_get_team_data_history(p_token text, p_id bigint)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
  v_row team_data_history%rowtype;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  select * into v_row from team_data_history where id = p_id limit 1;
  if v_row.id is null then raise exception '快照不存在'; end if;
  return json_build_object('data', v_row.data, 'savedAt', v_row.saved_at, 'source', v_row.source);
end;
$$;

-- 重新生成团员密钥（仅 super；替代原 auth.uid() 版本）
create or replace function public.admin_regenerate_member_key(p_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可重新生成团员密钥'; end if;
  -- v3.4.0 B2：128bit 随机（v2 的 auth.uid 版 regenerate_member_key 已随 v3.10.0 归档）
  update teams set member_key = encode(extensions.gen_random_bytes(16), 'hex') where id = public.assert_single_team();
  perform public.admin_audit(v_admin, 'regenerate_member_key');
  return (select member_key from teams where id = public.assert_single_team());
end;
$$;

-- 修改团名（替代原 RLS owner 版本）
create or replace function public.admin_rename_team(p_token text, p_name text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception '团名不能为空'; end if;
  update teams set name = trim(p_name) where id = public.assert_single_team();
  perform public.admin_audit(v_admin, 'rename_team', jsonb_build_object('name', trim(p_name)));
  return trim(p_name);
end;
$$;

-- 审计日志列表（仅 super；v3.12.0 B3，设置页「审计记录」卡）
create or replace function public.admin_list_audit_log(p_token text, p_limit int default 100)
returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_admin json;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可查看审计日志'; end if;
  return coalesce(json_agg(row_to_json(x) order by x."at" desc), '[]'::json)
  from (
    select id, admin_id, username, action, detail, at
    from admin_audit_log
    limit greatest(coalesce(p_limit, 100), 1)
  ) x;
end;
$$;

-- 审计清理（仅 super；删除 90 天前记录；登录时也会顺带清理同窗口）
create or replace function public.admin_clear_audit_log(p_token text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_admin json;
  v_deleted bigint;
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可清理审计日志'; end if;
  with d as (
    delete from admin_audit_log where at < now() - interval '90 days' returning 1
  )
  select count(*) into v_deleted from d;
  perform public.admin_audit(v_admin, 'clear_audit_log', jsonb_build_object('deleted', v_deleted));
  return v_deleted;
end;
$$;
