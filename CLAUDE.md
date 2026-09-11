# Aoi-system · Agent 交接文档

> 谷圈团购排单系统。纯 HTML/CSS/原生 JS 单页应用 + Supabase（无框架、无构建）。
> 业务概念沿用原作者（秋洛，CC BY-NC-SA 4.0）；代码与数据模型全量重写为原创。

## 文档索引（先读，勿重抄）

| 文档 | 内容 |
|------|------|
| `AGENTS.md` | **工作规范入口**：注意事项（每次改动必须 commit / 测试全绿）+ 架构速览 |
| `docs/ROADMAP.md` | **当前路线图**：2026-09 十项问题迭代计划 + P0 团员侧线上故障分析 |
| `docs/STATUS.md` | 权威状态：已完成阶段、数据模型、已知限制 |
| `README.md` | 功能、部署、安全、项目结构 |
| `docs/design/DESIGN.md` / `docs/design/DESIGN-claude.md` | 视觉设计规范（后者为 Claude 分析版） |
| `docs/design/PRODUCT.md` | 产品定位 |
| `docs/IMPROVEMENT_PLAN.md`（已移至 `docs/archive/`） | v1.4.0 时期改进计划（历史归档） |

## 本次交接重点：QQ 机器人接入

### 现状（2026-09-07 更新：已完整接入并上线）

- **已接入**：v1.7.0 完成 `js/bot.js` → relay → NapCat 全链路；v3.1.0 升级双通道推送（自动私聊已绑定者 + 群@全员兜底，未绑定用圈名文字 @）+ 公告一键推群。`enabled=false` 占位时代已结束。
- 集成点 `js/bot.js` → `Aoi.bot`：`config`（设置页保存 relay 地址 + 群号）+ `sendPrivate` / `sendGroup` / `pushAll`（OneBot v11 HTTP API，经 relay 转发）。
- 通知源 `js/notify.js`（`Aoi.notify`）按「类型 × 买家 × 批次」去重生成催缴 / 发货通知，可直接推。
- 私聊推送依赖 `d.memberMeta[cn].qq`（`js/member.js` 团员端可选绑定）；未绑定的由 `pushAll` 并入群发兜底。

### 协议端：用 NapCat，别用代码注释里的 Go-Cqhttp

- Go-Cqhttp 已于 2023 年停更归档，`js/bot.js` 注释里的写法已过时。
- NapCat（Docker 镜像 `mlikiowa/napcat-docker`）实现 OneBot v11，含 HTTP API。
- Docker 部署，`--network host`（与 relay 同机时走 localhost 直连，免公网暴露）。

### 安全红线：纯前端不能直连 NapCat

- 本项目部署到公网静态站，`js/config.js` 运行时对任何访客可见。
- 若把 `httpApi` + `token` 写进前端，任何访客可读到 token、冒充机器人发任意消息。
- 必须加一层服务端 relay，token 只存服务端。**已定型双通道并存（v3.12.0 起）**：① ECS relay `relay/relay.js`（http://47.101.194.103:8080，v4 双向 + `/fetch` 白名单代理 + v3.12.0 加固：body/消息上限、限频、`/audit` 推送审计；部署用 systemd `qq-relay.service`）；② Supabase Edge Function `supabase/functions/qq-relay/index.ts`（https 入口，UPSTREAM 经 env `RELAY_UPSTREAM` 注入，经 `scripts/deploy-edge.js` 部署/`--secret` 设置 env）。历史方案备查：
  1. **Supabase Edge Function**（项目已用 Supabase，零新增基建）——token 存 Edge Function env，暴露最小鉴权端点（团长登录态或共享 secret），校验后转发 NapCat。
  2. **NapCat 同机小 relay**——NapCat 不公网开放时，在它所在的 VPS 上放个几行的转发服务，前端打这个服务。
- 浏览器 `fetch` → relay → NapCat，顺带解决 CORS。

### 接入落地清单（✅ 全部已实施：v1.7.0 接入，v3.1.0 双通道）

1. 服务器部署 NapCat（Docker，`--network host`），登录机器人 QQ，开 HTTP API + access token。
2. 写 relay（Supabase Edge Function 或 VPS 小服务），token 存 env，做鉴权。
3. 改 `js/bot.js`：把 `sendPrivate` / `sendGroup` 的 TODO 改成 fetch 到 relay（**不直接打 NapCat**）。
4. 团长设置页填：relay 地址 + 群号；token 永不下发前端。
5. 私聊前确保买家绑定 QQ（`memberMeta[cn].qq`），否则走群发兜底。

### 运维要点

- NapCat 配置 `packetBackend: "disable"`（合并转发 / 长文类消息会踩；纯文本影响小，建议默认设上）。
- 端口错开并用 `ss -tlnp | grep <port>` 验证（NapCat HTTP API / WebUI / relay 各占一个）。
- 查日志：`docker logs napcat --tail 50`。

### 凭证纪律（与项目安全规则一致）

- 所有 token / 密钥走服务端 env 或密钥管理，禁止写入 `js/config.js`（会下发到浏览器）或提交进仓库。
- QQ 号属 PII：`d.memberMeta[cn].qq` 与收件地址一样随整份团队 blob 返回，任何持 `member_key` 者可读；正式商用前需服务端字段隔离（详见 `docs/STATUS.md`「已知限制」）。
