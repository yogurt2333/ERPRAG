# 收付款与核销（工单 03）

本地可信业务边界 `ErpService` 使用真实 SQLite。金额均为 CNY 整数分字符串，
计算使用 BigInt；原应收应付记录不改写，未结余额由原金额减去独立核销记录得到。
这是合成数据验证的账本核心，尚未接入 HTTP、身份认证、Web/PWA 或 Hermes。

## 预览、调整和确认

```ts
const input = { kind: 'customer_receipt', partyId: customer.id, amountCents: '140' };
const proposal = erp.previewSettlement(input);
// 展示 proposal.allocations、excessCents、excessKind，操作员确认后：
const posted = erp.confirmSettlement(proposal, confirmation);

// 指定单据或改分配：先生成并展示新方案，再确认这个方案。
const overridden = erp.previewSettlement(input, [
  { obligationId: delivery.id, amountCents: '100' }
]);
// 此方案只核销指定交货单 100 分，另 40 分作为客户预收。
// erp.confirmSettlement(overridden, anotherConfirmation);
```

供应商付款使用 `kind: 'supplier_payment'`、供应商 `partyId` 和采购入库单 ID。
`confirmation` 沿用前两张工单的 operationId、actorId、channel、confirmationId、confirmed。
一次业务操作使用一个稳定 operationId；以原请求重复确认返回原结果，修改请求后
复用同一 ID 返回 `idempotency_conflict`。

不传第二个参数时按到期日升序分配，同一天按单据 ID 升序，结果稳定可复核。
采购入库和交货可传真实日历日期 `dueDate: '2026-10-01'`；未提供时用 UTC 记账日期，
`listOpenObligations({ kind, partyId })` 用 `dueDateSource: 'posting_date'` 明示默认值。
旧数据库中的历史单据也遵循该规则，不回填或伪造合同账期。
单次最多核销 500 张单据；超过时需拆分或明确指定分配，不静默漏掉仍应分配的欠款。

预览不写库。确认必须带明确 allocations 和展示过的 excessCents/excessKind，
不会重新自动分配到其他单据。事务中重新校验对象归属、未结余额、正数金额、
重复单据和总额；过期方案若超过剩余余额，返回 `conflict`，需重新预览确认。
已确认分配保存在收付款记录及审计事件 `allocationDecision` 中。
本阶段提供结构化预览/确认接口；会话草稿持久化和版本绑定由工单 09 实现。

## 独立预收与预付

超出指定核销的金额分别保留为 `customer_advance`、`supplier_prepayment`。
没有欠款时整笔保留；也可显式传 `[]` 生成全额预收/预付方案。
`getAdvanceBalance({ kind, partyId })` 查询余额，`listSettlements()` 查询收付款及分配记录。
`listOpenReceivables()`、`listOpenPayables()` 返回核销后的未结余额，零余额单据不再列出。
本工单只负责形成和查询预收预付，尚无将历史预收预付转抵未来单据的操作，也不自动转抵。
冲销和更正仍属于工单 05。

## 交货并收款

```ts
const combined = {
  delivery: { orderId: order.id, expectedRevision: order.revision,
    lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '100' }] },
  amountCents: '120'
};
const impact = erp.previewDeliveryAndReceipt(combined);
// 展示交货金额、成本、毛利及收款核销 100 分、预收 20 分后确认：
const result = erp.confirmDeliveryAndReceipt(combined, confirmation);
```

这个组合操作明确核销本次交货，旧欠款保持原状；收款不足则留下本次交货余欠，
超额形成预收。若需分配旧欠款，使用独立收款方案明确分配。
交货单和收款单在各自表中独立保存，共享操作 ID；收款还保存 `linkedDeliveryId`。
共享 ID 表示同一次确认，不表示交货与收款是同一账本分录。
SQLite 单事务覆盖库存、应收、收款、核销、幂等结果及审计。任一步失败全部回滚。
成本在提交时按当前库存重新计算；完整草稿快照的过期控制留给工单 09。

## 验证

2026-09-27，本地 Windows、真实临时 SQLite、合成数据：

- `npm run typecheck` 通过。
- `npm test`：51 passed / 0 failed，其中 ERP 23 项，既有只读审计上下文 28 项。
- 新增 10 项测试覆盖双方到期分配、部分核销、预收预付、人工改分配、跨对象拒绝、
  陈旧方案、精确大金额、日期校验、重启重试、组合操作、故障回滚、schema 2 升级。
- 两个独立 SQLite 连接并发核销同一笔欠款：一个成功，一个 `conflict`，无重复核销。
- `npm run demo:erp`：应收 50 分收款 30 分余欠 20 分；应付 100 分付款 120 分形成预付 20 分。

这些检查不证明生产部署、备份恢复、真实模型或 Hermes 集成已完成。
