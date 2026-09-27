# 第四张工单：包装、临时商品与管理效期

业务入口仍为 `ErpService`，所有写操作要求现有 `confirmation`，在同一 SQLite
事务中保存业务状态、幂等结果和操作者审计。使用合成数据验证，不连接生产 ERP。

- `createProduct({ name, stockUnit }, confirmation)` 创建最小商品，同时保存资料待办。
- `getProduct(productId)` 返回资料、修订号及 `provisional`。
- `updateProductDetails({ productId, expectedRevision, aliases, specification, barcode, shelfLifeDays }, confirmation)`
  更新同一商品的完整扩展资料。未知字段用 `null`，别名用数组；不改商品 ID 或库存单位。
  过期修订号拒绝写入，别名不用于自动选择或创建商品。
- `definePackUnit({ productId, unit, expectedVersion, stockUnits: { numerator, denominator } }, confirmation)`
  追加包装版本。首次 `expectedVersion: 0`，后续填当前版本。分子、分母均为正整数字符串，
  表示每个包装单位包含多少库存单位。`listPackVersions(productId)` 查询历史版本。
- `listProductFollowups()` 查询持久化资料待办；缺少规格、保质期或包装换算时保持 open，
  补齐后 resolved。条码和别名可省略，不制造必填待办。暂不支持“不适用”豁免和提醒投递。

例如先定义“箱 → 12 瓶”，收货行填写
`{ productId, unit: '箱', packVersion: 1, quantity: '2', amountCents: '2400' }`。
库存增加 24 瓶、库存价值及应付增加 2400 分。换算和数量全程使用有理数，金额是行总金额。
包装行必须显式指定已有版本；旧版本仍可明确选用，新版本不改写旧收货。
库存单位收货无需版本。销售目前仍使用库存单位。

收货行可带 `earliestProductionDate: '2026-09-01'`，表示该收货行所代表批次的最早生产日期。
过账时保存库存数量、换算、保质期天数和管理效期快照。
管理效期 = 最早生产日期 + 保质期天数（UTC 日历日，不额外减一天）。
资料不全则效期为 `null`；以后补资料不会推断或重写已经过账的批次效期。

`listManagedExpiry()` 逐收货行查询，`summarizeManagedExpiry('2026-10-01')` 汇总截至当天
的到期收货行数和未知效期行数。二者始终返回 `operational_estimate`：这是**运营管理估计**，
不是每件商品的精确到期事实。这里统计历史收货行，不代表当前剩余库存或可售批次数；
批次出库分配、近效期提醒和每日摘要留给后续库存及提醒工单。

数据库从 schema 3 事务迁移到 4，为旧商品建立未知资料及待办，不修改旧收货或库存。
旧收货缺少快照时，查询保持未知，绝不按当前资料重新计算历史。

验证：2026-09-28，`npm run typecheck`、`npm test`（57 passed / 0 failed，其中 ERP 29 项）、
`npm run demo:erp` 通过。新增六项真实临时 SQLite 行为测试覆盖精确换算、历史版本、
商品补全、重启持久性、日期边界、非法输入、失败回滚及 schema 3 升级。
