# 第二张工单：客户订单与交货

这是本地业务服务闭环，使用真实 SQLite；演示数据全部合成。
`npm run demo:erp` 展示采购入库后部分交货，`npm run test:erp` 验证业务行为。

## 公共操作

- `createCustomer({ name }, confirmation)` 创建客户。
- `createSalesOrder({ customerId, warehouseId, lines }, confirmation)` 记录需求。
  每行包含 `productId、unit、quantity、amountCents`；数量允许超过库存。
- `changeSalesOrder({ orderId, expectedRevision, order }, confirmation)` 整体替换尚未交货的订单。
- `cancelSalesOrder({ orderId, expectedRevision }, confirmation)` 取消尚未交货的订单。
- `confirmDelivery({ orderId, expectedRevision, lines }, confirmation)` 确认实际交货。
  每行包含从零开始的 `orderLineIndex`、本次 `quantity` 和本次实际成交 `amountCents`。
  同次请求不可重复引用同一订单行，可选择部分行或部分数量。

`confirmation` 与采购入库一致，含操作 ID、确认 ID、操作者、渠道和 `confirmed: true`。
重试必须复用完整请求及确认上下文；同 ID 不同内容被拒绝。
订单修改增加 revision，交货必须携带当前版本；交货数量还会在写事务内重新检查。
首次交货后不允许直接修改或取消订单，后续冲销工单负责更正。

## 数值与事务

数量为最多六位小数的正十进制字符串，单位必须等于商品库存单位。
金额为非负整数分字符串，使用 CNY；订单金额表达原约定，交货金额是本次明确确认的实际金额，
允许与订单金额不同。系统不会自动按比例分摊订单金额或偷偷舍入；调用方必须提供本次金额。
零金额交货仍确认库存成本及可能的负毛利，但不产生未结应收。

订单不预占库存、不产生应收；`getOrderFulfillment` 返回每行已交数量和剩余待交量
（backorder 指全部未履行量，不仅是当前缺货量），以及 open/partial/fulfilled/cancelled 状态。
取消订单保留历史订购数量，但待交量归零。

交货在 `BEGIN IMMEDIATE` 事务内重新检查订单和库存，按商品、仓库计算当时的移动加权成本。
重复商品行合并消耗同一可用量，不能逐行绕过负库存检查。
出库、成本快照、交货单、应收、毛利、确认去重及审计一起提交或一起回滚。
成本与毛利使用 `{ numerator, denominator }` 精确分数，单位为分，不提前舍入。
经营毛利 = 本次实际收入 − 出库成本，不代表会计净利润。
后续采购不会改变历史交货成本。

查询：`getSalesOrder`、`listSalesOrders`、`getOrderFulfillment`、`getDelivery`、
`listDeliveries(orderId?)`、`listOpenReceivables(customerId?)`、`getStock`、`listAuditEvents`。
已完成订单仍保留原记录的 open 状态；是否已交齐以 `getOrderFulfillment` 的派生状态为准。

数据库从 v1 自动迁移至 v2，保留原采购、应付、库存及操作记录；新增客户、订单、交货、出库及应收表。
本工单没有收款核销、装车、车载库存、在途流程、HTTP/UI、身份认证或 Hermes 集成。
操作者与渠道目前由可信调用方传入，尚不是认证证据。
