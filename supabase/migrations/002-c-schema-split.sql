-- 002-c-schema-split.sql — 方案 C：业务数据拆规范表（docs/PLAN-C-SCHEMA-SPLIT.md §二）
-- 幂等：create if not exists / add column if not exists。
-- 设计要点：
--   · 全表带 team_id uuid not null references teams(id)（当前单团，为多团留路）；
--   · 业务行 id 保留原 blob 形态（o_xxx / p_xxx / s_xxx text 主键），前端零映射；
--   · 活动以名称引用（orders.activity 等，与现状一致），aoi_activities 主键 (team_id, name)；
--   · 无 id 的子行（buyers/trackings/entries/settlements）迁移时生成 uuid；
--   · 复合低频结构用 jsonb（limitPlans 内容 / batches 费用参数 / settings KV）；
--   · RLS 全 deny：访问一律走 security definer RPC（aoi_get_all / aoi_sync / member 系，P3 落地）；
--   · 旧 team_data 行只读保留 = 回退锚点（DATA_MODE 开关切回即回到 blob 通道）。

-- ─────────────── 活动（activities + activityMeta 活动级字段合一）───────────────
create table if not exists aoi_activities (
  team_id      uuid not null references teams(id),
  name         text not null,
  sort_order   int  not null default 0,
  ip           text,
  status       text,
  buy_date     text,
  ship_date    text,
  ship_date_fuzzy text,
  deadline     text,
  link         text,
  cover        text,
  remark       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (team_id, name)
);

-- ─────────────── 活动子行（buyers / trackings，现无数据，结构预建）───────────────
create table if not exists aoi_activity_buyers (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  activity_name text not null,
  buyer       text,
  account     text,
  address     text,
  sort        int not null default 0
);
create table if not exists aoi_activity_trackings (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  activity_name text not null,
  tracking_no text not null,
  sort        int not null default 0
);

-- ─────────────── 商品主档 ───────────────
create table if not exists aoi_products (
  team_id     uuid not null references teams(id),
  id          text not null,                       -- 保留 p_xxx
  activity_name text not null,
  type        text,
  model       text,
  name_orig   text,
  ref_image   text,
  ref_url     text,
  price       numeric,
  price_orig  numeric,
  currency    text,
  "limit"     numeric,
  stock       numeric,
  listed      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (team_id, id)
);
create unique index if not exists aoi_products_activity_type_model_uidx
  on aoi_products (team_id, activity_name, coalesce(type,''), coalesce(model,''));

-- ─────────────── 订单 ───────────────
create table if not exists aoi_orders (
  team_id     uuid not null references teams(id),
  id          text not null,                       -- 保留 o_xxx
  activity_name text not null,
  ip          text,
  type        text,
  model       text,
  buyer       text,
  currency    text,
  price       numeric,
  price_orig  numeric,
  count       numeric not null default 1,
  status      text,
  remark      text,
  batch_id    text,
  intl_fee    numeric,
  shipped     text,
  shipped_at  text,
  shop_order_id text,
  shop_order_no text,
  ai_aligned  boolean not null default false,
  sort_order  int  not null default 0,             -- 录入顺序（现 blob 数组序）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (team_id, id)
);
create index if not exists aoi_orders_activity_idx on aoi_orders (team_id, activity_name);
create index if not exists aoi_orders_batch_idx    on aoi_orders (team_id, batch_id);
create index if not exists aoi_orders_buyer_idx    on aoi_orders (team_id, buyer);

-- ─────────────── 批次 / 交费 ───────────────
create table if not exists aoi_batches (
  team_id     uuid not null references teams(id),
  id          text not null,
  name        text,
  date        text,
  manual_fees jsonb,
  target_amount numeric,
  weights     jsonb,
  created_at  timestamptz not null default now(),
  primary key (team_id, id)
);
create table if not exists aoi_payments (
  team_id     uuid not null references teams(id),
  id          text not null,
  buyer       text,
  batch_id    text,
  intl_fee    numeric,
  domestic_fee numeric,
  status      text,
  created_at  timestamptz not null default now(),
  primary key (team_id, id)
);
create index if not exists aoi_payments_batch_idx on aoi_payments (team_id, batch_id);

-- ─────────────── 通知 / 公告 / 改圈名 ───────────────
create table if not exists aoi_notifications (
  team_id     uuid not null references teams(id),
  id          text not null,
  type        text,
  title       text,
  body        text,
  buyer       text,
  batch_id    text,
  date        text,
  sent        boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (team_id, id)
);
create table if not exists aoi_announcements (
  team_id     uuid not null references teams(id),
  id          text not null,
  date        text,
  text        text,
  primary key (team_id, id)
);
create table if not exists aoi_cn_changes (
  team_id     uuid not null references teams(id),
  id          text not null,
  old_cn      text,
  new_cn      text,
  qq          text,
  status      text,
  date        text,
  primary key (team_id, id)
);

-- ─────────────── PCO 目录（监控标记） ───────────────
create table if not exists aoi_pco_items (
  team_id     uuid not null references teams(id),
  id          text not null,
  jp_name     text,
  name        text,
  type        text,
  type_suggest text,
  url         text,
  image       text,
  price_jpy   numeric,
  price_cny   numeric,
  "limit"     numeric,
  sale_date   text,
  status      text,
  selected    boolean not null default false,
  watched     boolean not null default false,
  unmatched   boolean not null default false,
  first_seen_at text,
  primary key (team_id, id)
);

-- ─────────────── 蓄水池（池 + entries + settlements） ───────────────
create table if not exists aoi_reservoirs (
  team_id     uuid not null references teams(id),
  id          text not null,
  name        text,
  side_a      text,
  side_b      text,
  rates       jsonb,
  primary key (team_id, id)
);
create table if not exists aoi_reservoir_entries (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  reservoir_id text not null,
  order_id    text,
  side        text not null check (side in ('A','B')),
  added_at    text
);
create table if not exists aoi_reservoir_settlements (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  reservoir_id text not null,
  amount      numeric,
  currency    text,
  direction   text,
  note        text,
  marked_order_ids jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists aoi_res_entries_res_idx on aoi_reservoir_entries (team_id, reservoir_id);
create index if not exists aoi_res_settle_res_idx  on aoi_reservoir_settlements (team_id, reservoir_id);

-- ─────────────── 排谷表（排位拆行 + 日志） ───────────────
create table if not exists aoi_paigu_slots (
  team_id     uuid not null references teams(id),
  id          text not null,                       -- 保留 s_xxx
  activity_name text not null,
  type        text,
  model       text,
  sort        int  not null default 0,             -- 该商品列内位次
  order_id    text,                                -- 关联订单（手动排位为 null）
  buyer       text,
  status      text,
  added_at    text,
  primary key (team_id, id)
);
create index if not exists aoi_paigu_slots_act_idx on aoi_paigu_slots (team_id, activity_name);
create table if not exists aoi_paigu_logs (
  id          bigserial primary key,
  team_id     uuid not null references teams(id),
  activity_name text not null,
  at          text,
  text        text
);

-- ─────────────── 限购计划（复合结构整体 jsonb） ───────────────
create table if not exists aoi_limit_plans (
  team_id     uuid not null references teams(id),
  activity_name text not null,
  payload     jsonb not null default '{}'::jsonb,  -- {limits, items, remaining, freeCur, freeShip, ...} 整体
  updated_at  timestamptz not null default now(),
  primary key (team_id, activity_name)
);

-- ─────────────── 基础数据（类型 / IP / 团员元数据 / 地址） ───────────────
create table if not exists aoi_type_meta (
  team_id     uuid not null references teams(id),
  type        text not null,
  route       text,
  primary key (team_id, type)
);
create table if not exists aoi_ips (
  team_id     uuid not null references teams(id),
  ip          text not null,
  sort        int not null default 0,
  primary key (team_id, ip)
);
create table if not exists aoi_member_meta (
  team_id     uuid not null references teams(id),
  cn          text not null,
  qq          text,
  extras      jsonb not null default '{}'::jsonb,
  primary key (team_id, cn)
);
create table if not exists aoi_addresses (
  team_id     uuid not null references teams(id),
  cn          text not null,
  address     text,
  primary key (team_id, cn)
);

-- ─────────────── 团级设置 KV（calc / botConfig / imgHost / ipTypes / 未来配置） ───────────────
create table if not exists aoi_team_settings (
  team_id     uuid not null references teams(id),
  key         text not null,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (team_id, key)
);

-- ─────────────── C 端商城（V1 预建空表；shop RPC v3.36 适配） ───────────────
create table if not exists aoi_shop_users (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  auth_uid    uuid unique,                          -- auth.users.id（邮箱 OTP 登录）
  email       text,
  cn          text unique                           -- 绑定圈名（一人一账号）
);
create table if not exists aoi_shop_orders (
  team_id     uuid not null references teams(id),
  id          text not null,
  user_id     uuid,
  product_id  text,
  activity_name text,
  qty         numeric not null default 1,
  price       numeric,
  currency    text,
  tail_no     text,                                 -- 唯一尾数
  status      text not null default '待付款',
  created_at  timestamptz not null default now(),
  primary key (team_id, id)
);

-- ─────────────── RLS：全 deny（访问一律走 security definer RPC） ───────────────
do $$
declare t text;
begin
  foreach t in array array[
    'aoi_activities','aoi_activity_buyers','aoi_activity_trackings','aoi_products','aoi_orders',
    'aoi_batches','aoi_payments','aoi_notifications','aoi_announcements','aoi_cn_changes',
    'aoi_pco_items','aoi_reservoirs','aoi_reservoir_entries','aoi_reservoir_settlements',
    'aoi_paigu_slots','aoi_paigu_logs','aoi_limit_plans','aoi_type_meta','aoi_ips',
    'aoi_member_meta','aoi_addresses','aoi_team_settings','aoi_shop_users','aoi_shop_orders'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;
