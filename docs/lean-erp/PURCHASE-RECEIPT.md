# 第一张工单：采购入库

入口为 `src/erp/service.ts` 的 `ErpService`，使用 Node.js 24 自带的 `node:sqlite`，
无需新增运行依赖。这是供可信应用代码调用的业务入口；尚未提供 HTTP、鉴权、Web/PWA
或 Hermes 工具。不能把这个入口直接暴露到公网。

```sh
npm run typecheck
npm run test:erp
npm run demo:erp
```

演示使用合成数据，创建真实临时 SQLite 文件，输出入库单、库存数量、库存价值、
平均成本、应付和审计证据，退出后清理。业务数据库应置于本地持久目录；构造服务时
传入文件路径，父目录须存在，使用后调用 `close()`。

当前演示已随第二张工单扩展为采购加销售：采购 3 瓶后送达 1 瓶，因此最终库存为
2 瓶、价值为 `200/3` 分、平均成本为 `100/3` 分/瓶，应付仍为 100 分。
只验证采购路径可运行 `node --test test/erp-purchase.test.ts`；`test:erp` 包含全部 ERP 测试。

## 业务接口

- `createProduct({ name, stockUnit }, confirmation)`：最小商品资料。
- `createSupplier({ name }, confirmation)`、`createWarehouse({ name }, confirmation)`。
- `confirmPurchaseReceipt({ supplierId, warehouseId, lines }, confirmation)`：明确确认入库。
- `listMasters(kind)`、`getPurchaseReceipt(id)`、`listPurchaseReceipts()`。
- `getStock(productId, warehouseId)`：数量、库存价值及移动加权平均成本。
- `listOpenPayables(supplierId?)`、`listAuditEvents()`。

每个行项目包含 `productId`、`unit`、`quantity`、`amountCents`。
`quantity` 是正十进制字符串，整数部分最多 18 位，小数部分最多 6 位。
`amountCents` 是该行实际 CNY **总金额**，不是单价：非负整数分字符串，最多 18 位。
示例：`{ productId, unit: '瓶', quantity: '3', amountCents: '100' }` 表示 3 瓶合计 1 元。
金额必须显式填写，零金额可入库，零债务不出现在未结应付查询中。
第一张工单只接受商品的库存单位；第四张工单已增加显式版本化包装换算，见
[包装与管理效期说明](PRODUCT-PACKS-EXPIRY.md)。不猜测包装换算、不拆 VAT。

数量与成本内部使用 BigInt 有理数。查询返回 `{ numerator, denominator }` 字符串对，
数量的单位为库存单位，价值的单位为分，平均成本为分/库存单位。100 分购入 3 瓶，
平均成本为 `100/3` 分/瓶，不提前舍入。本阶段没有需要舍入的派生入账金额。
库存与成本池按商品和仓库隔离，由追加式库存账本重建；后续销售须按出库时成本扣减价值。

`confirmation` 包含 `operationId`、`actorId`、`channel`（`cli`/`web`/`hermes`）、
`confirmationId` 和 `confirmed: true`。这些字段记录可信调用方提供的确认事实，
不构成身份认证；未来适配器须从已认证会话绑定操作者及渠道。
当前不实现第 09 张工单的会话草稿、版本与自然语言确认机制。

同一逻辑确认重试须保留同一 `operationId` 及内容，返回首次结果，包括原始时间及 ID；
更换该键会被视为新业务操作。已用键搭配不同内容、操作者或确认信息会报
`idempotency_conflict`，不修改任何账本。主数据创建也遵循该约定。

## 持久化与边界

SQLite 使用 WAL、外键、FULL 同步及 5 秒锁等待。按版本在事务中初始化和迁移；
每次打开检查版本，可重复执行，未知版本拒绝打开。业务以 `BEGIN IMMEDIATE`
串行写入，将幂等结果、入库单、库存账本、应付账本与审计一次提交。
任一步失败全部回滚；写锁超时报 `BusinessError('busy')`，调用方保留原确认键重试。
业务入口不提供修改或删除已过账记录的方法。

审计保留操作者、渠道、操作与确认 ID、目标记录、动作和服务端时间。
本工单尚无付款，应付余额等于入库产生的应付；付款分配在第 03 张工单实现。
采购订单、缺单待办、包装、效期、冲销、备份恢复、目标服务器资源验证均未由本工单证明。

## 验证记录（2026-09-27）

`test/erp-purchase.test.ts` 经公共业务接口操作临时磁盘 SQLite，不断言内部 SQL。
覆盖完整入库、重复确认与重开迁移、小数数量与分数成本、多行及多仓隔离、超安全整数金额、
零金额、非法输入、主数据类型错配和提交前故障。故障在全部写入后注入，验证原有数据不变、
新增库存/应付/审计/单据全部撤回，并允许使用原操作键重试。

全部验证命令和最终结果记录在第一张工单。此证据属于本地确定性业务测试，
不证明真实模型、ERPNext 集成、生产性能或恢复能力。
