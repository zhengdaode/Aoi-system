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
  created_at  timestamptz not null default now()
);

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

-- =====================================================================
-- 行级安全策略（RLS）
-- =====================================================================
alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_data enable row level security;

-- teams：成员可读自己所在团队；owner 可更新（改名 / 邀请码由 RPC 负责）
create policy "teams_select_member" on teams for select
  using (exists (
    select 1 from team_members m
    where m.team_id = teams.id and m.user_id = auth.uid()
  ));

create policy "teams_update_owner" on teams for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- team_members：成员可读本团队全部成员；owner 可删除成员。
-- 插入只经 join_team_by_code / create_my_team RPC，故无需 insert 策略。
create policy "members_select" on team_members for select
  using (exists (
    select 1 from team_members m2
    where m2.team_id = team_members.team_id and m2.user_id = auth.uid()
  ));

create policy "members_delete_owner" on team_members for delete
  using (exists (
    select 1 from teams t
    where t.id = team_members.team_id and t.owner_id = auth.uid()
  ));

-- team_data：成员可读写本团队数据
create policy "team_data_select" on team_data for select
  using (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ));

create policy "team_data_insert" on team_data for insert
  with check (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ));

create policy "team_data_update" on team_data for update
  using (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from team_members m
    where m.team_id = team_data.team_id and m.user_id = auth.uid()
  ));
