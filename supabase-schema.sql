-- =====================================================================
-- Aoi-system · 全新数据模型（团队 / 成员 / 团队数据）
-- 重写自旧 leader_data 单表模型，改为「团队」粒度以支持多人管理。
-- 在 Supabase SQL Editor 中一次性执行。
-- =====================================================================

-- 1. 团队表：一个团一行，owner 为团长（超级管理员）
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null default '我的团',
  invite_code text,
  member_key  text,
  created_at  timestamptz not null default now()
);

-- 迁移：为已存在的团队补充 member_key 字段（新建库已含此列，可安全重复执行）
alter table teams add column if not exists member_key text;

-- 2. 成员表：团长 + 管理员，user 可属于多个团队（phase 0+1 仅使用首个团队）
create table if not exists team_members (
  team_id    uuid not null references teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'admin' check (role in ('owner', 'admin')),
  email      text,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

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

-- 创建我的团；已属于某团队则直接返回该团队 id
create or replace function public.create_my_team(team_name text default '我的团')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  existing_team_id uuid;
  new_team_id uuid;
  caller_email text;
begin
  if caller is null then
    raise exception '未登录';
  end if;

  select team_id into existing_team_id
  from team_members where user_id = caller limit 1;
  if existing_team_id is not null then
    return existing_team_id;
  end if;

  insert into teams (owner_id, name)
  values (caller, team_name)
  returning id into new_team_id;

  select email into caller_email from auth.users where id = caller;

  insert into team_members (team_id, user_id, role, email)
  values (new_team_id, caller, 'owner', caller_email);

  insert into team_data (team_id) values (new_team_id);

  return new_team_id;
end;
$$;

-- 通过邀请码加入团队（成为管理员）
create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_team_id uuid;
  caller_email text;
begin
  if caller is null then
    raise exception '未登录';
  end if;

  select id into target_team_id from teams where invite_code = code;
  if target_team_id is null then
    raise exception '邀请码无效';
  end if;

  select email into caller_email from auth.users where id = caller;

  insert into team_members (team_id, user_id, role, email)
  values (target_team_id, caller, 'admin', caller_email)
  on conflict (team_id, user_id) do nothing;

  return target_team_id;
end;
$$;

-- 团长重新生成邀请码
create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  team_id uuid;
  new_code text := substr(md5(random()::text), 1, 8);
begin
  if caller is null then
    raise exception '未登录';
  end if;

  select id into team_id from teams where owner_id = caller limit 1;
  if team_id is null then
    raise exception '仅团长可生成邀请码';
  end if;

  update teams set invite_code = new_code where id = team_id;
  return new_code;
end;
$$;

-- 团长重新生成团员密钥（团员端免登录访问口令）
create or replace function public.regenerate_member_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  team_id uuid;
  new_code text := substr(md5(random()::text), 1, 8);
begin
  if caller is null then
    raise exception '未登录';
  end if;

  select id into team_id from teams where owner_id = caller limit 1;
  if team_id is null then
    raise exception '仅团长可生成团员密钥';
  end if;

  update teams set member_key = new_code where id = team_id;
  return new_code;
end;
$$;

-- =====================================================================
-- 团员端匿名访问（security definer 绕过 RLS，内部校验 member_key）
-- 注意：任何持有 member_key 的人都能读/写团队数据，密钥即访问凭证。
-- ⚠️ 线上库重跑验证清单（v1.7.0 起本节函数签名有变更，必须 drop 后重建）：
--   1. 在 Supabase SQL Editor 顺序执行本文件；
--   2. 执行下方「排查 SQL」确认两个 RPC 存在且 anon 有 EXECUTE 权限；
--   3. 确认每个团队在 team_data 有一行（写入 RPC 已改为 upsert 自动补行）。
-- =====================================================================

-- 按团员密钥读取团队名 + 业务数据 blob + 数据版本（匿名，无 auth.uid）
-- drop 再建：create or replace 无法变更返回结构，旧签名残留会导致重跑报错。
-- 注意：用 plpgsql + #variable_conflict use_variable——若用 language sql，
-- `where t.member_key = member_key` 的裸 member_key 会被解析成列名（列优先于参数），
-- 恒为真导致任意密钥都能读到第一个团队（安全漏洞）。
drop function if exists public.get_team_by_member_key(text);
create function public.get_team_by_member_key(member_key text)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_variable
begin
  return (
    select json_build_object(
      'name', t.name,
      'data', coalesce(d.data, '{}'::jsonb),
      'updatedAt', d.updated_at
    )
    from teams t
    left join team_data d on d.team_id = t.id
    where t.member_key = member_key
    limit 1
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

-- 按团员密钥写入业务数据 blob（匿名，覆盖整份数据；密钥即授权）
-- v1.7.0 修复：
--   ① insert ... on conflict upsert —— 旧版只 update，team_data 缺行时
--      影响 0 行仍返回成功，造成"保存成功但什么都没写"（仅团员端复现）；
--   ② 可选乐观锁 expected_updated_at —— 与 team_data.updated_at 不一致时拒绝，
--      防止整 blob 覆盖竞态（"改了又没了"）；
--   ③ 返回写入后的 updated_at，供前端下次写入作为乐观锁版本。
--   ④ plpgsql + #variable_conflict use_variable —— 裸 member_key 按参数解析，
--      否则默认策略下与 teams.member_key 列同名产生 42702 二义性错误。
drop function if exists public.update_team_data_by_member_key(text, jsonb);
drop function if exists public.update_team_data_by_member_key(text, jsonb, timestamptz);
create function public.update_team_data_by_member_key(
  member_key text,
  new_data jsonb,
  expected_updated_at timestamptz default null
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

  insert into team_data (team_id, data, updated_at)
  values (target_team_id, new_data, now())
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
-- 行级安全策略（RLS）
-- =====================================================================
alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_data enable row level security;

-- teams：成员可读自己所在团队；owner 可更新（改名 / 邀请码由 RPC 负责）
-- RLS 策略：drop if exists 后重建，保证本文件在老库上可安全重复执行
-- （create policy 不支持 IF NOT EXISTS，不先 drop 会在二次执行时报
--   "policy already exists" 并导致整个脚本回滚）
drop policy if exists "teams_select_member" on teams;
create policy "teams_select_member" on teams for select
  using (exists (
    select 1 from team_members m
    where m.team_id = teams.id and m.user_id = auth.uid()
  ));

drop policy if exists "teams_update_owner" on teams;
create policy "teams_update_owner" on teams for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- team_members：成员可读本团队全部成员；owner 可删除成员。
-- 插入只经 join_team_by_code / create_my_team RPC，故无需 insert 策略。
-- 成员身份判断（security definer 绕过 RLS，避免 members_select 自引用递归）
create or replace function public.is_team_member(t uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from team_members m
    where m.team_id = t and m.user_id = auth.uid()
  );
end;
$$;

drop policy if exists "members_select" on team_members;
create policy "members_select" on team_members for select
  using (public.is_team_member(team_members.team_id));

drop policy if exists "members_delete_owner" on team_members;
create policy "members_delete_owner" on team_members for delete
  using (exists (
    select 1 from teams t
    where t.id = team_members.team_id and t.owner_id = auth.uid()
  ));

-- team_data：成员可读写本团队数据
drop policy if exists "team_data_select" on team_data;
create policy "team_data_select" on team_data for select
  using (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ));

drop policy if exists "team_data_insert" on team_data;
create policy "team_data_insert" on team_data for insert
  with check (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ));

drop policy if exists "team_data_update" on team_data;
create policy "team_data_update" on team_data for update
  using (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ));

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

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + interval '30 days';
  insert into admin_sessions (token_hash, admin_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_id, v_expires);

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

-- 登录
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
begin
  if p_username is null or p_password is null then
    raise exception '请输入用户名和密码';
  end if;
  delete from admin_sessions where expires_at < now();
  select * into v_admin from admins where username = trim(p_username) limit 1;
  if v_admin.id is null or v_admin.password_hash <> crypt(p_password, v_admin.password_hash) then
    raise exception '用户名或密码错误';
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + interval '30 days';
  insert into admin_sessions (token_hash, admin_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_admin.id, v_expires);
  return json_build_object('token', v_token, 'role', v_admin.role, 'username', v_admin.username, 'expiresAt', v_expires);
end;
$$;

-- 退出（删除会话）
create or replace function public.admin_logout(p_token text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  delete from admin_sessions where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  select true;
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
    limit 1;
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
  select t.id into target_team_id from teams t limit 1;
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
    where h.team_id = (select id from teams order by created_at limit 1)
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
  new_code text := substr(md5(random()::text), 1, 8);
begin
  v_admin := public.admin_verify_session(p_token);
  if v_admin is null then raise exception '会话已过期，请重新登录'; end if;
  if v_admin->>'role' <> 'super' then raise exception '仅超级管理员可重新生成团员密钥'; end if;
  update teams set member_key = new_code where id = (select id from teams limit 1);
  return new_code;
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
  update teams set name = trim(p_name) where id = (select id from teams limit 1);
  return trim(p_name);
end;
$$;
