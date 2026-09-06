# Aoi-system · 账号系统重设计方案（v3 提案，待批准）

> 2026-09-06 起草。**状态：已批准并实施**（schema + 前端 + relay + 文档，见 CHANGELOG v3.0.0）。
> 背景：作为仅适用于本团的私有项目，现行基于 Supabase Auth 的"自助注册"体系过重。

---

## 一、评估结论：现行账号系统对单团场景约等于负资产

| 现状能力 | 单团自用场景下的实际价值 |
|---|---|
| 邮箱注册 + 确认邮件 | ❌ 无陌生人注册需求，反而制造配置负担（Custom SMTP 配额） |
| 找回密码邮件流程 | ❌ 管理员就团长身边几人，超管重置更直接 |
| 邀请码加入机制 | ❌ 为"多团多管理员自助加入"设计，本团用不上 |
| auth.users + teams.owner_id 外键 | ⚠️ 复杂度来源，且单团下 team_members 表形同虚设 |
| 团员密钥免登录 | ✅ 保留（刚修复完，与本方案正交） |
| 乐观锁 / 掩码回执 | ✅ 保留 |

**结论：可以且值得重设计。** 采用部署者思路：部署时确定超级管理员，应用内添加其他管理员。

## 二、新方案设计（管理员自持凭据，Supabase 只当数据库）

### 数据模型（新增 2 表，现有业务表零改动）

```sql
-- 管理员账号（RLS 无任何策略 = anon/authenticated 均不可直接读写，仅 RPC 内部访问）
create table admins (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password_hash text not null,                -- pgcrypto bcrypt
  role          text not null default 'admin' check (role in ('super','admin')),
  created_at    timestamptz not null default now()
);

-- 会话（token 只存哈希，明文只出现一次 = 登录响应）
create table admin_sessions (
  token_hash  text primary key,               -- sha256(token)
  admin_id    uuid not null references admins(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '30 days'
);
```

### RPC 接口（全部 security definer，内部校验）

| RPC | 说明 |
|-----|------|
| `admin_bootstrap(username, password)` | **仅当 admins 表为空时可用**——部署者首次打开网页时前端检测"无管理员"→ 显示初始化页 → 调用此 RPC 创建超管。密码不经过 git / CI 日志 / 环境变量 |
| `admin_login(username, password)` | pgcrypto `crypt()` 校验 bcrypt 哈希 → 生成随机 token → 存 sha256 → 返回 `{ token, role, expires_at }` |
| `admin_logout(token)` | 删除会话 |
| `admin_create(token, username, password, role)` | **仅 super 角色**可添加管理员 |
| `admin_delete(token, admin_id)` | 仅 super；不能删自己 |
| `admin_save_team_data(token, data, expected_updated_at)` | 替代现在的 `saveTeamData` upsert——token 校验 + 乐观锁 + upsert，业务写唯一入口 |
| 团员端两个 member_key RPC | **保持不变** |

### 前端改动

- `js/auth.js`：登录页改为 用户名+密码；删注册/找回/邮箱逻辑；`getSession()` 恢复改为 `localStorage.aoi_admin_token` 有效期检查。
- `js/data.js`：`saveTeamData` 改调 `admin_save_team_data(token, ...)`（乐观锁不变）；`getTeamData` 改走 `admin_get_team_data(token)` RPC（blob 含 PII，anon 不再放行裸表 select）。
- `js/team.js`：设置页新增"管理员账号管理"卡（仅 super 可见）：列表 / 添加 / 删除。
- 删除：邀请码机制、团队入驻页、`team_members` 相关 UI（数据保留不删）。

### 部署/迁移方案（线上已有 34 条订单数据，blob 不动）

1. **迁移期（一次 SQL）**：执行新版 `supabase-schema.sql`（可重复执行）——新增 admins/admin_sessions 两表 + 新 RPC；旧 auth 表、team_members、旧 RLS 全部保留不动（旧账号自然失效，无数据风险）。
2. **部署新前端** → 首次打开显示"初始化超管"页 → 部署者设置用户名密码。
3. **后续**：超管在设置页添加其他管理员的账号密码。
4. **QQ relay 适配**：`relay.js` 鉴权从"Supabase JWT + team_members 角色"改为"Authorization: Bearer <admin_token> + `admin_verify_session(token)` RPC 查 super/admin"（单独小改）。
5. **回退**：新旧登录并存一个版本期（登录页加"旧邮箱登录"折叠项），确认稳定后删除。

### 安全性对比 Supabase Auth

- 密码存储：pgcrypto `bf`（bcrypt）哈希，等价于主流方案 ✅
- 会话：随机 256bit token + 服务端哈希 + 30 天过期 ✅
- 暴露面：比 auth 更小——admins 表无任何 RLS 策略，anon 只能通过 4 个 RPC 触达 ✅
- 失去的：邮箱找回（改为超管重置 RPC `admin_reset_password(token, admin_id, new_pwd)`）✅ 已覆盖
- 风险点：token 在 localStorage（XSS 风险同现有 Supabase JWT，无恶化）⚠️ 不变

### 工作量估计

schema（0.5d）+ auth/data/team 前端改造（1d）+ relay 适配（0.5d）+ 测试与文档（0.5d）≈ **2.5 个工作日**，可按"schema → 登录 → 数据读写 → 管理员管理 → relay"拆 5 个 commit。

---

## 三、附带解答：Netlify 生产站与 GitHub Pages 测试站共用一个 Supabase 会不会出 bug？

**会，且已经埋着一个真实风险**。同库意味着两层共享：

1. **数据共享（主要风险）**：所有业务数据在同一个 `team_data` blob。你在 GH Pages 测试站登录同一团队做任何写操作（录入、批量删除、改设置），都会**真实写进生产数据**；反过来若测试站代码是旧版，旧版"整 blob 覆盖写"会把新版字段/新写入冲掉——这正是 v1.7.0 修的竞态，双端版本不一致时最容易触发。
2. **账号共享（次要）**：auth.users 同库，测试站注册的用户会混进生产用户列表；SMTP 配额也共用。

**建议（按优先级）**：
- ✅ 最佳：给开发测试单独建一个免费 Supabase 项目，跑一遍 `supabase-schema.sql`，测试站的 `config.js` 指向它——彻底隔离，成本为零。
- ⚠️ 最低限度：测试站**只用 debug 账号**（`debug@aoi.local`，数据走 localStorage 不触网），绝不登录真实团队。
- ❌ 不建议：两站同库混用真实数据。
