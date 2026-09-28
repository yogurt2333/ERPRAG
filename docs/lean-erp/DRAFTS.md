# 操作草稿、确认与幂等（工单 09）

`ErpService.handleDraft(context, action)` 是供未来 Web/Hermes 适配器使用的业务写入口。
本工单实现 SQLite 内的确定性协议，不包含自然语言解析、HTTP 鉴权、微信收发或真实模型验证。
现有直接写方法保留为可信内部领域操作和测试入口，不能注册为客户端可直接调用的工具。

## 调用协议

```ts
const context = {
  actorId: 'operator-1', channel: 'hermes' as const,
  conversationId: 'private-chat', eventId: 'channel-message-1',
};
const response = erp.handleDraft(context, {
  action: 'propose',
  command: { kind: 'purchase_receipt', input: receiptInput },
});
// 展示 response.draft.summary，保留返回的 version。
// “改成两箱”：适配器解析为完整的新 input，并携带刚看到的版本。
erp.handleDraft({ ...context, eventId: 'channel-message-2' }, {
  action: 'propose', expectedVersion: 1,
  command: { kind: 'purchase_receipt', input: correctedReceiptInput },
});
// 操作员只需回复“确认”；不必输入草稿编号。
erp.handleDraft({ ...context, eventId: 'channel-message-3' }, { action: 'confirm' });
// 取消同理使用 { action: 'cancel' }；可携带 expectedVersion 防止旧页面操作。
```

身份、channel、conversationId 和稳定的 eventId 必须由可信适配器提供，不能由模型指定。
重试必须保留原 eventId。首次提案可不带 expectedVersion，已有会话版本后的替换必须带版本。
同一操作者、渠道、会话只有最高版本是当前草稿；历史版本保留。不同操作者和渠道互相隔离。
操作类型为显式白名单，不接受内部方法名、SQL、任意字段更新或模型计算的最终余额。
输入最多 256 KiB，业务字段继续使用各领域现有的严格 schema。

## 支持的操作

| kind | 业务动作 |
| --- | --- |
| purchase_receipt | 采购入库 |
| sales_order / change_sales_order / cancel_sales_order | 客户订单新增、修改、取消 |
| delivery / delivery_and_receipt | 交货、交货并收款 |
| settlement | 确定性最早到期核销，余额转预收/预付 |
| allocated_settlement | 使用已审阅的指定核销分配和余款处理 |
| reversal | 关联冲销 |
| return / quarantine_return / resolve_quarantine / return_refund | 退货、隔离接收、处置、退款 |
| stocktake / resolve_stocktake / transfer / loss | 盘点、盘点处理、调拨、报损 |
| product / supplier / customer / warehouse | 基础资料新增 |
| product_details / pack_unit / followup_decision | 商品资料、包装版本、待办决策 |

`input` 对应现有业务方法的输入结构；`settlement` 对应 `previewSettlement` 的输入，
`allocated_settlement` 对应 `confirmSettlement` 的输入。模型不能直接提交库存、成本或毛利结果。

## 摘要与事务

预演在 SQLite 写事务的 savepoint 内调用同一套业务校验与计算，采集结果后回滚全部
业务、库存、结算、待办、提醒、审计和操作幂等记录；最终只保存草稿及消息处理结果。
`summary.projection` 给出业务单据投影，`summary.changes` 给出相关往来方、商品、单位、
仓库以及库存、应收应付、结算、隔离和退款的前后值。金额仍以分、精确分数表示。
无变化类别的 before/after 为空；通过验证时 validationFindings 为空，失败返回具体原因。
预演中的新建主数据 ID 和时间是投影值，正式业务引用必须使用确认返回的 result。

确认采用 `BEGIN IMMEDIATE`，重新执行验证，将业务结果、审计、草稿状态和确认消息结果
一起提交。审计记录 actor、channel、confirmationId、conversationId、draftVersion 和业务引用。
异常在提交前回滚全部变化；锁竞争返回 busy，可使用同一 eventId 重试。
迁移版本为 9；草稿、版本和消息结果跨进程重启保存。

当前保守地使用整个追加式 operations 账本的最新序号作为业务状态版本，并检查 UTC 日期
（与当前领域默认过账日期一致）。其他业务写入或跨日后，待确认草稿失效，必须重新提案、展示、确认。
这可能因无关业务产生额外确认，但不会静默改变已审阅的库存成本或核销分配。

同一 eventId 和相同内容返回历史结果，即使之后出现新草稿也不会确认新草稿。
同一 eventId 换内容返回 idempotency_conflict。同一已过账草稿换一个确认 eventId 仍返回原结果。
确认已取消草稿、旧版本、失效状态和业务验证失败返回 rejected 及 review_latest/create_draft 下一步。
失败的业务内容修正会让原待确认草稿失效，避免误确认修正前内容；取消已过账记录不会冲销它。

## 验证与边界

`node --test test/erp-drafts.test.ts`：11 项真实临时 SQLite 行为测试，覆盖预演无副作用、
版本替换、消息重放、消息冲突、跨会话隔离、取消、失败修正、状态变化、原子回滚、
组合交货收款、核销与调拨、v8 迁移、重启恢复、独立 Worker 并发确认和跨日失效。

预演目前扫描本地库存及结算投影；尚未声称达到目标 2 核 2 GB 容量和延迟要求。
未来适配器应向操作员展示摘要后才转发确认，并保证同一会话的入站消息有序处理。
真实 Hermes 消息身份、重复投递与解析效果仍须在相应集成工单中验证。
