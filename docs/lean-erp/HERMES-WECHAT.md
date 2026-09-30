# Hermes 微信业务接入（工单 11）

当前状态：工单11功能验收完成（2026-09-30），ECS独立测试账库已验证真实微信采购、销售、更正、确认、重复确认及三类通知。
运行 home 为 `/var/lib/hermes-erp`（为避免主网关自动托管，已移出 profiles 目录）。
采购更正、确认与重复确认，以及销售订单、交货收款与重复确认已实测通过。三类通知API投递成功且用户确认收件，复跑未新增相同事件；不宣称 2 核 2 GB 容量验收通过。
最新记录见 `.scratch/lean-erp/deployments/2026-09-30-hermes-live.md`；下面初始准备记录为历史状态。

## 固定版本与源码核对

选择官方 [v2026.9.24](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24)，
annotated tag 指向 commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`。
不自动升级用户现有 Hermes；若现有版本不同，先核对这些协议再决定兼容方式。

2026-09-29 经用户已有 Workbench 连接只读核实，ECS 安装位于 `/root/.hermes/hermes-agent`，
实际 SHA 为 `7cd48733db464471cf7da9501c12748ed9b570dc`（`v2026.7.20-1069-g7cd48733db`）。
此版 hook 同步调用回调；插件用同步 skip + 当前 event loop 上有界任务处理，同时兼容新版本。
旧版发送参数一致，通知 sender 兼容其 `_make_ssl_connector`，不要求 `_new_session`。
以上为最初的源码兼容核对；后续已在此实际运行时完成本文列出的真实模型与微信验收。

- [WeixinAdapter 源码](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/gateway/platforms/weixin.py)：
  iLink 个人微信，`from_user_id` / `message_id` 形成消息身份，MessageEvent 携带 sender/chat；
  无稳定 ID、群消息、媒体消息均不办理业务。账号身份取实际 adapter，而非模型参数。
  长轮询持久化 sync cursor，失败退避，失效会话暂停后重试；这不保证断线期间消息完整重放。
  context token 按 account/peer 落盘；出站通知需要可用登录态及对应会话 token。
- 入站 dedup 仅为短时窗口，且包含按文本去重。插件首次接管绑定 DM 后仅保留 ID 去重，
  否则两笔业务连续回复“确认”会被吞掉。ERP 的 SQLite 消息记录承担跨重启业务幂等。
  必须设置 `text_batch_delay_seconds: 0`，避免多条业务/确认合并为一条 MessageEvent。
- `send()` 每次生成新的 UUID client_id，且会提取 MEDIA/本地路径。这里调用该固定版本的
  `_send_message` 纯文本接口，不解析商品名称中的文件路径；每段 client_id 由持久消息 ID
  派生。接口为私有兼容点，版本升级必须复核。发送成功只表示 API 接受，不表示人已读。
  不声称 iLink 端到端 exactly-once；发送成功但本地 ACK 前崩溃，可能重复显示通知。
- [插件注册](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/website/docs/user-guide/features/plugins.md)：
  `register(ctx)` 注册五个 `erp_*` 草稿工具和 `pre_gateway_dispatch`。
  [hook 协议](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/website/docs/user-guide/features/hooks.md)
  在 Hermes 鉴权之前执行，因此插件独立检查绑定，并对微信事件始终返回 skip；异常也不回落通用 Agent。
  最多八个在途处理任务，超出时丢弃新事件并返回 skip；人工应核对响应，未收到草稿/结果不能视为成功。
- [结构化模型调用](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/website/docs/developer-guide/plugin-llm-access.md)：
  一次 `ctx.llm.acomplete`，30 秒超时，3000 输出 token，无工具循环。
  实际提供方拒绝 `response_format`，因此提示模型返回 JSON 文本，并在本地严格解码与验证，
  不依赖提供方的 structured-output 支持。
  使用用户 Hermes 当前模型；生产启用前仍需确认该提供方的数据保留政策。

## 业务与恢复协议

Node 在 Web 所在进程另开 `127.0.0.1:3101`，共享同一 ErpService。
随机 bearer 密钥只交给可信插件进程；拒绝携带浏览器 Origin 的请求。
反向代理不能发布该端口。Hermes 用户不可读取 ERP SQLite、备份或 ERP 服务用户的文件。
插件只访问允许的 loopback HTTP 路由，不创建数据库连接或执行 shell。

1. `/prepare` 验证 account/sender/chat → actor 绑定，先保存原始消息与当前版本。
2. 自由文本仅能提案；已有草稿时必须使用 `修改：...` 明确更正，其他新意图拒绝覆盖。
   更正失败或超时也撤销旧草稿的可确认展示状态。
3. 模型只接收当前消息、必要的当前命令，以及消息明确命中的少量主数据；显式订单 ID
   最多返回五份相关订单。不会发送全表、历史对话、库存余额、归档、通知或备份。
   ID/金额/单位不足时要求补充，不进行模糊检索的自动接受或毛利原因推测。
4. 五个工具支持采购入库、销售订单、交货、交货收款、收付款。复用业务 schema，单次最多
   五行、16 KiB 命令。只有绑定消息解析期间有工具调用能力，无模型可调用的 confirm 工具。
5. `/complete` 保存确定动作后执行草稿事务，返回完整命令和本地计算的影响摘要。
   摘要超过 24 KiB 时取消草稿并要求走 Web，不截断供确认的业务信息。
6. 插件将完整结果按 1500 字符分段发送；全部成功后 `/displayed` 才记录当前版本已展示。
   操作员回复纯文本 `确认` 才提交；`取消` 只取消草稿。两者都绕过模型。
7. 相同消息 ID 重放返回原结果；不同内容复用同 ID 拒绝。业务事务失败保留 applying
   动作，重试恢复同一动作，不重新解析模型。新的消息到达时先恢复未完成动作并返回它的结果。
   解析中消息超过 60 秒可由后续消息回收，晚到模型结果不能恢复已拒绝事件。
8. 各绑定会话串行处理；部署一个 gateway 和一个 Node 服务实例。模型离线时仍可确认已展示
   草稿，Web 不依赖 Hermes 或模型。schema v11 为消息和展示状态新增两张表。

## 部署

保留现有生产数据。先用独立测试账库与专用 Hermes profile 联调，不把合成业务写入正式账库。
不要向仓库提交 token、真实微信 ID 或环境文件。以下配置需要填入真实环境值。

- ERP 服务和插件环境：`ERP_HERMES_TOKEN`（至少 32 字符随机密钥）、`ERP_HERMES_BINDINGS`
  （JSON 数组，1–2 项，每项为 `accountId/senderId/chatId/actorId`）。actorId 使用实际操作员 ID。
  第一项为通知接收人；两侧绑定必须一致。`ERP_HERMES_PORT` 默认 3101。
- 将 `deploy/lean-erp/hermes/` 复制到专用 profile 的 `plugins/lean-erp/`，在
  `plugins.enabled` 启用 `lean-erp`。schemas.json 由 `node src/erp/hermes/export-schemas.ts` 生成。
- 该微信 profile 限定 ERP 用途，关闭通用 shell/文件/浏览器工具；进程用独立 OS 用户运行。
  配置 `platforms.weixin.extra.dm_policy: allowlist`、`allow_from` 为已绑定用户，
  `group_policy: disabled`、`text_batch_delay_seconds: 0`。通过 Hermes 正常 QR 登录建立会话。
- ERP 仍以 `npm run web:erp` 启动，设置绑定才启用桥接端口。
- 在选定 Hermes 的 Python 环境中单独运行 `python /path/to/lean-erp/notify.py`，仅一个 sender。
  设置同一 `HERMES_HOME`、`WEIXIN_ACCOUNT_ID`、`WEIXIN_TOKEN` 及 ERP 桥接环境；由进程管理器
  负责重启。每分钟调度并发送 pending 通知，发送失败保留，全部分段成功后才 ACK。
  即时提醒最迟下一轮投递；daily/weekly 使用 ERP 已持久化的不可变快照，不经过模型。
  通知以固定事件 ID 去重；同日不反复发送相同 immediate/daily，周报每周期一份。
  日报仅发送待办数量，周报发送本地计算的经营数值，明细在 Web 查询。

## 验证与真实验收记录

```sh
npm run typecheck
node --test test/erp-hermes.test.ts
python -B test/erp-hermes-plugin.test.py
npm test
git diff --check
```

已通过：12 项 TypeScript 桥接测试、8 项 Python 插件契约测试、123 项全量 Node 测试。
覆盖脚本化采购和销售的提出/更正/展示/纯确认、重复投递、第二意图冲突、发送失败、
重启恢复、v10 迁移、HTTP 认证与通知 pending/ACK/去重、模型离线及未绑定身份拒绝。
Python 测试使用真实插件注册和 hook，但替换 Hermes、模型与微信 transport；它不是线上证据。

真实环境证据已记录：采购与销售更正/确认、重复确认、网关主动重启后重复确认、三类通知实际收件及复跑不重复。
Web降级已通过ECS私有网络命名空间内的HTTP采购验收，使用临时账库和测试通行密钥；不等同真人浏览器Passkey验收。
工单功能验收完成。通知sender仍为两次单次验收，未常驻或设置开机自启；生产部署隔离加固、容量压力/长稳验证及任意断网下消息恢复保证均不在已完成结论内。

## ECS 专用 profile 准备记录

用户选择新建专用 profile，未将现有微信/Slate 会话切为 ERP。
通过原安装的 `create_profile('erp', no_alias=True, no_skills=True)` 创建
`/root/.hermes/profiles/erp`，没有 clone 现有 profile、没有生成全局 alias、没有切换 active profile。
插件放在其 `plugins/lean-erp/` 下，包 SHA-256：
`569604453a74c0f9975035e967ac69eff212185ce075197fc3aa8d4927b51e75`。
创建前 MemAvailable 约 826 MiB；创建进程有 128 MiB MemoryMax、25% CPUQuota；结束后约 828 MiB。
原有 `lean-erp.service` 与 `hermes-slate-gateway.service` 均保持 active。
新 profile 没有启动 gateway，也没有迁移线上 ERP 数据库；线上仍使用已有 Web 发布。
正式启用前须重新测量内存，设置独立进程上限与数据库目录隔离，不能以此快照声称容量达标。

人工配置入口（在服务器终端，不把密钥贴到聊天）：

```sh
HERMES_HOME=/root/.hermes/profiles/erp /root/.local/bin/hermes setup
HERMES_HOME=/root/.hermes/profiles/erp /root/.local/bin/hermes gateway setup
```

仅配置模型和 Weixin，不启动网关；随后按本文部署约束启用桥接、身份绑定和通知进程。

微信回复使用中文业务单据，显示名称、数量、元金额和业务影响，不直接展示内部 JSON。“查看草稿”可重新展示待确认单据，不产生新的业务；仍需回复“确认”才入账。

通知验收可使用 `notify.py --once`，发送一批后退出；发送失败非零退出，事件保留待重试。
