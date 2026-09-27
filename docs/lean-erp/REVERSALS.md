# 已过账记录冲销

工单 05 实现本地 `ErpService` 的整单纠错；不是实物退货、部分退货或生产 Web/Hermes 接口。
原采购、交货、收付款及核销行保持不变。SQLite schema 5 新增关联冲销记录，余额查询合并原记录与冲销影响。

```ts
const correction = { kind: 'sale', originId: 'delivery-id', reason: '交货录入错误' };
service.previewReversal(correction); // 展示库存、债权债务、收付款、预收预付、核销与毛利影响
service.confirmReversal(correction, {
  operationId: 'correction-id', actorId: 'operator-id', channel: 'cli',
  confirmationId: 'confirmation-id', confirmed: true
});
```

- `kind` 为 `purchase`、`sale` 或 `settlement`，必须填写原因。
- 采购按原入库数量快照和原金额冲回，历史包装版本不受新版本影响。
- 销售按原交货成本恢复库存，冲回应收、收入和毛利，并恢复订单待交数量。
- 收付款冲回整个原收付款及全部核销和超额预收/预付；原核销历史仍可查。
- 已核销单据先冲销相关收付款。交货并收款的两个子记录共享 ID，通过 `kind` 区分，先冲销收款再冲销交货；不隐式撤销另一笔资金记录。
- 采购冲销不能造成负库存、负价值或零数量非零价值。存在这些依赖时先冲销相关交货；不重算既有销售成本。
- 同一原记录同一种类只能冲销一次；原确认重试返回已保存结果，换操作 ID 再冲销则报冲突。
- 冲销记录保留原单链接、操作人、渠道、确认 ID、时间、原因和精确影响；不支持直接冲销冲销单。更正后使用新的正常业务操作重新入账。

`listReversals()` 查询更正历史；原单列表仍包含被冲销的记录，不能直接相加作为当前余额。
使用 `getStock()`、`listOpenReceivables()`、`listOpenPayables()`、`listOpenObligations()`、
`getAdvanceBalance()` 和 `getSalesTotals()` 读取冲销后的结果。管理效期列表排除已整单冲销的采购。
`getSalesTotals()` 是销售收入减原交货成本的经营毛利汇总，不是会计净利润。
`cashCents` 表示原收付款金额的撤销量，收款/付款方向由原单 `kind` 确定。

确认时在同一个 `BEGIN IMMEDIATE` 事务中重新校验依赖、写更正记录和审计证据。
后置失败会同时回滚更正、审计和幂等键。数据库连接不向业务调用方暴露，没有通用改表或删除接口。
未来交互层仍需实现当前草稿管理与认证；这里的 actor/channel 来自可信应用边界。

验证：`npm run typecheck`、`npm run test:erp`。独立冲销测试覆盖精确成本、包装快照、
两类收付款、合并业务、冲销顺序、非法输入、估值冲突、故障回滚、重开重试和双连接重复冲销。
