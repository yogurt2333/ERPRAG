# 盘点、调拨、报损与并发库存保护

第七张工单交付本地 `ErpService` 业务边界和真实 SQLite 事务，数据库自动升级到
schema 7。所有写操作沿用显式 `Confirmation`、持久幂等键和操作者审计。
Web/Hermes 页面与工具适配仍属于后续工单。

## 盘点及来源补录

`recordStocktake({ productId, warehouseId, physicalQuantity, reason }, confirmation)`
保存实物数量、记录时的账面数量与价值、差异及时间，不改变库存。
数量使用最小库存单位的精确分数 `{ numerator, denominator }`，允许实盘为零。
通过 `listStocktakes()` 查询历史盘点。

先调用 `previewStocktakeResolution(input)` 展示结果，再确认
`confirmStocktakeResolution(input, confirmation)`。input 包含 `stocktakeId`、
`reason` 和以下一种 outcome：

- `{ kind: 'restored_source', sourceId }`：发现漏记采购入库或交货时，先通过
  `confirmPurchaseReceipt` 或 `confirmDelivery` 确认真实来源业务，再关联其操作 ID。
  也支持关联通过原入口补录的退货、报损或调拨。来源必须在盘点后记入；采购与交货来源不能已经冲销或退货，并对相同商品和仓库产生恰好等于盘点差异
  的数量变动；当前库存也必须等于实盘数量。关联本身不再次变动库存或债权债务。
  不回填虚构过账时间。当前一次关联一个来源；多个漏单先逐笔补录，再重新盘点。
- `{ kind: 'adjustment' }`：确认无法还原来源后，以原因说明追加差异分录。
  账面数量或价值已变更会拒绝旧盘点，要求重新盘点。已有库存按当前移动平均成本
  计价，不接受覆盖成本。零库存盘盈须额外提供 `openingUnitCostCents`（每最小库存
  单位的整数分成本），原因中说明估值依据；没有依据时不能凭空估值。

一次盘点只能处理一次。数量相符时允许零差异结案；原盘点和原业务记录保持不变。
盘点差异调整价值单独列示，不自动归为报损或销售成本。

## 调拨与报损

`previewTransfer` / `confirmTransfer` 接收
`{ productId, warehouseId, destinationId, quantity, reason }`。
两个仓库必须不同；源仓按其移动平均成本转出，目标仓以同一精确价值转入。
两个方向属于同一操作、同一事务，全仓数量和价值不变。

`previewLoss` / `confirmLoss` 接收
`{ productId, warehouseId, quantity, reason }`，按当前平均成本扣减可售库存，
损失独立于销售成本。未定价隔离退货继续使用第六张工单的处置入口。
全部分录、原因和操作者可通过 `listInventoryOperations()` 查询。

`getInventoryTotals()` 返回：

- `lossCents`：库存报损与已定价损坏退货的已知损失。
- `adjustmentValueCents`：盘点调整的净价值，独立列示。
- `grossProfitAfterKnownLossCents`：销售净收入减退货调整后的销售成本，再减已知损失。
  损坏退货损失只扣一次，不包含盘点调整、税费或经营费用，不代表会计净利润。
- `unvaluedQuarantineLosses`：尚无原始成本依据的隔离损失操作 ID；不能将其解释为零损失。

## 原子性与并发

确认时先取得 `BEGIN IMMEDIATE` 写事务，再检查最新库存、计算成本和写入业务、
幂等结果及审计。库存不足返回 `BusinessError('insufficient_stock')`。
写锁等待最多 5 秒，SQLite BUSY/LOCKED 错误转换为 `BusinessError('busy')`，
调用方可以用相同确认与操作 ID 重试。失败会回滚所有业务分录和幂等记录。
该业务错误约定覆盖确认调用；数据库启动/迁移错误仍由服务启动方处理。

验证：`test/erp-inventory.test.ts` 覆盖盘点预览与补录、过期盘点、空库存估值、
精确调拨、报损与退货损失汇总、失败回滚、重启幂等、schema 6 升级、真实写锁超时
及两个 worker 独立连接同时调拨/报损；交货并发由 `test/erp-sales.test.ts` 覆盖。
这些是本地 SQLite 行为证据，不是生产负载或 2 核 2 GB 验证。
