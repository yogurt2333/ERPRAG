# Web/PWA 与 Passkey（工单 10）

本工单提供独立于 Hermes、微信和远程模型的网页业务入口。`src/erp/web/server.ts`
负责 HTTP 契约，`auth.ts` 负责身份；所有业务写入仍调用 `ErpService.handleDraft`。
金额、库存、结算和草稿算法没有在 Web 中复制。SQLite 从 v9 正向迁移到 v10，
新增 `web_auth` 和 `web_security_events`，与业务库一起备份。

## 启动

Node.js 24+，先执行 `npm ci`。设置稳定 HTTPS 域名，不使用生产裸 IP 或临时隧道。
RP ID 自动取该 origin 的 hostname，origin 必须不带尾斜线、路径或登录信息。
下例使用 Git Bash，域名必须替换为自己的地址；代理配置不写入仓库。

```bash
export ERP_WEB_ORIGIN=https://erp.example.com
export ERP_DB=/absolute/path/to/erp.sqlite
export ERP_PORT=3100
npm run web:erp -- bootstrap '操作员姓名'
npm run web:erp
```

`bootstrap` 仅限服务器终端使用：输出有效期十分钟的一次性随机凭证；重新生成会使
上次凭证失效。已有操作员后禁止生成。不要将此终端输出放入日志采集、截图或提交。
网页“首次启用 / 接受邀请”输入凭证并注册 Passkey，随后离线保存八个恢复码。
第一次使用前建议再添加另一设备或安全密钥上的备用 Passkey。

Node 只监听 `127.0.0.1:3100`，由同机 HTTPS 反向代理终止 TLS。示例 Caddy 配置：

```caddyfile
erp.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

以上是 Caddy 示例；2026-09-29 已在用户 ECS 上使用现有 Nginx 部署独立 HTTPS 试运行站点，
见 [小内存部署说明](../../deploy/lean-erp/README.md)。真实设备 Passkey 注册仍需用户完成。
生产防火墙不应暴露 Node 端口或 SQLite 文件。必须使用配置的完整 HTTPS origin
访问网页；不会为 HTTP 开发模式降低 Cookie 安全属性。使用已有受信任本地 HTTPS
代理可以调试；浏览器验收脚本自建临时 localhost TLS 服务。

## 使用

1. Passkey 登录后，在“办理业务”选择操作，填写中文表单。商品和往来方引用来自当前记录。
2. 点击“生成影响预览”，查看预计单据、变更前后和校验结果；此时不改业务账本。
3. 确认过账或取消。重新填写后可生成新版本；过时页面不能确认另一版本。
4. “业务记录”查看库存、应收应付、收付款、退货、隔离、盘点、待办与审计。
5. “账户安全”完成近期验证后，可以添加备用凭据、撤销凭据、重置恢复码、
   撤销所有设备会话或邀请第二位操作员。两位操作员权限相同，各自身份和草稿隔离。

提供 24 种草稿表单，包括主数据、采购、订单、交货、组合交货收款、核销、冲销、
退货/隔离/退款、盘点/调拨/报损、商品资料/包装和待办。服务端 schema 生成表单，
仍由领域入口执行最终严格验证。金额以 CNY 分填写，精确库存/成本以分数展示。
保质期日期标明管理估计。每位操作员的 Web 使用一个持久工作区，多个标签页通过
版本检查避免覆盖；重新登录可以查看当前草稿。提交结果不明时保留同一 eventId
重试，跨页再次确认同一已过账版本也不会重复写账。

PWA manifest 和 service worker 只缓存公开页面及静态依赖，不缓存 API、业务数据、
恢复码或认证材料。API 返回 `Cache-Control: no-store`。离线停止业务提交，
不承诺离线经营或后台自动补交；恢复网络后重新核对草稿。所有内容通过 DOM
`textContent` 显示，主数据不会成为 HTML。

## 身份与请求边界

- 使用固定版本 SimpleWebAuthn server 14.0.3 / browser 14.0.0，遵循其
  [服务端验证接口](https://simplewebauthn.dev/docs/packages/server)和
  [浏览器接口](https://simplewebauthn.dev/docs/packages/browser)。要求 resident key、
  user presence 和 user verification，验证 challenge、origin、RP、签名和计数器；
  额外拒绝 cross-origin client data。支持 ES256 / RS256。
- challenge 有效五分钟，绑定 `__Host-erp-flow` HttpOnly Cookie，消费后不能重放。
  注册还必须持有一次性授权或本人的近期认证会话。公共端点不能指定任意用户身份。
- `__Host-erp-session` 是 256-bit 随机会话令牌；服务端只存 SHA-256 摘要，
  Cookie 为 host-only、Secure、HttpOnly、SameSite=Strict、Path=/。
  八小时绝对过期，不滑动续期；重新认证会替换会话。退出立即撤销。
- 管理动作要求五分钟内 Passkey 验证。邀请还绑定签发人的有效近期会话，
  验证提交时重新核对授权和两人上限。撤销凭据会撤销本人的所有会话，禁止删除最后一把。
- 八个恢复码各含 256-bit 随机量，库里只存摘要。使用一次即消费并撤销现有会话，
  仅授予十分钟的替换凭据权限，不能直接读写业务。替换注册成功后撤销旧凭据，
  轮换恢复码，并在新 Passkey 完成用户验证后创建正常会话。注册取消可在授权期限内重试。
- 业务 actor 从服务器会话取得，channel 固定 `web`；不信任请求中的 actor、
  channel、SQL 或方法名。所有 POST 必须带精确 Origin 和 JSON Content-Type，
  拒绝跨站 Fetch Metadata、未知 envelope 字段、超过 256 KiB 的请求。
- CSP 禁止嵌入、第三方脚本和内联脚本；不返回 CORS 授权。每个 socket 来源每分钟
  最多 120 次 POST，同时最多四个凭据验证；不信任 `X-Forwarded-*`。
  同机代理后的两个操作员共用这一额度，反向代理可另行配置外层限流。
- 注册、登录、恢复、撤销和恢复码轮换有独立安全审计，不记录凭证或恢复码明文。
  业务审计保留真实 actor、channel、draftVersion 和 confirmationId。

归档删除、备份恢复仍属于工单 13，本工单没有这些 API。将来必须复用
`auth.session(token, true)` 的近期验证守卫；不存在绕过守卫的占位执行端点。

## 验证

```bash
npm run typecheck
npm run test:web
npm test
git diff --check
```

- Web 契约套件 8 项：真实临时 SQLite、CBOR 注册、P-256 签名认证，验证负例、
  会话与恢复、并发消费/邀请、权限隔离、Origin/CSRF、请求边界、草稿幂等、
  v9 迁移和重开持久性。没有 mock 掉 Passkey 验证器。
- 全量 110 项测试通过，包含原业务与只读审计测试；类型检查通过。
- `test/erp-web.browser.mjs` 是独立 Chromium 验收脚本，不加入默认无浏览器测试。
  环境需已有 Playwright、Chromium 和 OpenSSL；可配置 `PLAYWRIGHT_MODULE`
  （Playwright ESM 入口 URL）、`CHROMIUM_PATH` 和 `OPENSSL`（可执行文件路径）。
  然后运行 `node test/erp-web.browser.mjs`。脚本使用临时自签名证书和合成数据，
  在浏览器测试上下文允许该证书，生产服务没有忽略证书的配置。
- 已执行 Chromium 虚拟认证器测试：实际页面注册/登录、商品/采购/销售/结算/
  退货/报损/待办草稿确认、390px 手机布局、离线拒绝提交。截图输出到忽略目录
  `artifacts/erp-web-desktop.png` 与 `artifacts/erp-web-mobile.png`，不含真实 ERP 数据。

尚未验证真实手机/硬件密钥、跨平台同步或安装到主屏后的设备兼容性；HTTPS 试运行部署
已验证，不等于正式账本上线验收。
记录查询目前返回本地完整投影；大数据量分页及 2 核 2 GB 资源证明仍在后续工单。
本工单的本地与虚拟认证器证据不代表生产就绪、真实模型验证或 Hermes 集成。
