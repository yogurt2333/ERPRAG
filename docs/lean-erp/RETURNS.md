# 退货与隔离库存（工单 06）

当前交付是本地 `ErpService` 业务边界与真实 SQLite 事务，schema 6 自动迁移。
数据和测试都是合成场景；Web、Hermes 草稿确认和生产运行仍属于后续工单。

## 关联原单退货

1. `searchReturnCandidates({ kind, partyId, productId, quantity, fromDate, throughDate })`
   按客户／供应商、商品、剩余可退数量和原单过账日期（首尾包含）列出候选原单行。
   `kind` 为 `sale` 或 `purchase`。返回原单 ID、行索引、仓库、时间和剩余数量；
   即使只找到一条，也必须由操作者确认，多个候选不会自动择一。
2. `previewReturn(input)` 读取当下剩余数量，展示金额、原成本、库存、收入、销售成本、
   损失和毛利影响，不写入状态。
3. `confirmReturn(input, confirmation)` 在写事务内重新校验并过账。`input` 示例：

   ```ts
   const input = {
     kind: 'sale', originId: delivery.id, lineIndex: 0,
     quantity: { numerator: '1', denominator: '3' },
     condition: 'saleable', reason: '客户退回，核对原交货单'
   };
   const impact = service.previewReturn(input);
   // 操作者审阅影响后，使用独立 operationId/confirmationId 确认。
   const posted = service.confirmReturn(input, confirmation);
   ```

`lineIndex` 是原入库单／交货单的零基行索引，交货单的行索引不等于订单行索引。
退货数量统一使用**库存单位的正有理数**；采购包装数量从原单快照换算，未来修改包装
不会改变历史数量。每次确认一条原单行，累计退货不得超过原行数量；已冲销原单不可退。

金额以整数分记录：`累计已退金额 = floor(原行金额 × 累计退货数量 / 原行库存数量)`，
本次金额为新旧累计金额的差。例如 3 瓶共 100 分，依次退 1 瓶分别为 33、33、34 分。
此规则使拆分退货与一次全部退货总额一致；不会把浮点误差带入金额。
成本始终按原行记录的成本精确比例冲回，保留分数，不对成本提前舍入。

- 销售退货：减少原应收／形成待退款，冲回原销售收入和原销售成本；
  `saleable` 按原成本恢复原仓库存，绝不使用当前平均成本重算。
- `damaged` 销售退货：确认退货并报损，记录原成本冲回及同额损失，实物不进入可售库存。
  `getSalesTotals()` 的毛利扣除此损失；`getReturnLossTotals()` 单列已知损失供核对。
- 采购退货：按原入库行数量和价值减少库存及应付／形成待收供应商退款。
  当前可用库存不足、价值为负或清空数量后仍残留价值时拒绝，要求先核对依赖业务。
- 退货不会自动重开销售订单欠货，换货需要单独建立订单；原交货事实保持不变。

## 结算与实际退款

退货不代表现金已收付。原义务未结清部分先被退货抵减；
`getReturnRefundBalance({ originId, kind })` 返回超过剩余义务的待退／待收金额，
销售方向为 `outgoing`，采购方向为 `incoming`。
`confirmReturnRefund({ originId, kind, amountCents, reason }, confirmation)`
确认实际退款，可分次但不得超余额；`listReturnRefunds()` 保留独立现金证据。
原付款的超额预收／预付仍由 `getAdvanceBalance()` 单独列示，不混入退货退款。

已产生物理退货的原单禁止全额冲销，防止重复冲回。
尚未发生实际退款时允许冲销原收付款，并动态重算应收应付和待退款。
已经支持实际退款的收付款禁止全额冲销。当前没有实际退款的撤销接口，
不通过删除退款或修改原流水来“修正”账目。

## 来源未确认的收到货物

`receiveQuarantinedReturn({ customerId, productId, warehouseId, quantity, condition, reason }, confirmation)`
登记收到的客户退回实物。`condition` 可为 `unknown`、`saleable`、`damaged`。
来源未确认时均进入逻辑隔离；`listQuarantinedReturns()` 展示原始登记及处置状态，
`listReturnFollowups()` 是由持久化隔离记录生成的待办，重启不会丢失。
登记隔离不改变可售库存、库存估值、应收应付或毛利。

`resolveQuarantinedReturn({ quarantineId, reason, outcome }, confirmation)` 一次处置整笔隔离实物：

- `outcome: { kind: 'linked_return', originId, lineIndex, condition }`：明确关联客户、商品、
  原仓库均一致的销售行，同时执行退货并关闭待办。确认 `damaged` 则同时记录原成本损失。
- `outcome: { kind: 'return_to_sender' }`：实物已退给送回方，关闭隔离，不生成财务影响。
- `outcome: { kind: 'confirmed_loss' }`：确认未知来源实物已损失，关闭隔离，保留未估值损失
  标识；不捏造成本或退款。`getReturnLossTotals().unvaluedQuarantineLosses` 单列这些处置 ID。

关联退货保留 `quarantineId`；原隔离单和追加处置记录都可查询。
隔离处置与关联退货原子提交，不能重复处置。混合来源／混合品相应分笔登记，
当前不支持隔离单部分处置、跨仓关联或未关联采购原单的供应商退货。

## 验证与边界

`test/erp-returns.test.ts` 覆盖历史成本、部分退货尾差、超退、模糊候选、隔离后关联、
未知来源损失、已结算退款、旧结算方案失效、包装快照、冲销依赖、事务故障回滚、
schema 5 升级、重启幂等以及双连接过期方案不能超退。
所有写入复用 `BEGIN IMMEDIATE`、业务校验、幂等确认和操作者审计。
本地日期筛选依据过账日；不声称支持原业务发生日回填、实物批次追踪、
远程模型验证或生产资源验收。
