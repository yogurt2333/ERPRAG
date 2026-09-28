# ERP Rule Audit

> 本仓库包含只读价格规则审计，以及轻量经销 ERP 的 SQLite 采购入库、客户订单、交货与收付款核销闭环；支持版本化包装、临时商品资料待办、管理效期、关联冲销、部分退货、隔离处置、盘点调整、调拨、报损，以及持久待办与确定性提醒摘要、版本化操作草稿与幂等确认。
> ERP 其余功能仍待实现，两套上下文的测试证据分别记录。参见
> [上下文地图](CONTEXT-MAP.md)与[轻量 ERP MVP 设计](docs/lean-erp/MVP-DESIGN.md)。

轻量 ERP：`npm run demo:erp` 运行合成采购、部分交货及收付款演示，`npm run test:erp` 验证真实
临时 SQLite 数据库上的业务行为。接口、数值约定与当前范围见
[采购入库使用说明](docs/lean-erp/PURCHASE-RECEIPT.md)、[订单交货使用说明](docs/lean-erp/SALES-DELIVERY.md)
与[收付款核销说明](docs/lean-erp/SETTLEMENT.md)、[包装与管理效期说明](docs/lean-erp/PRODUCT-PACKS-EXPIRY.md)、[冲销说明](docs/lean-erp/REVERSALS.md)、[退货与隔离说明](docs/lean-erp/RETURNS.md)、[盘点调拨与报损说明](docs/lean-erp/INVENTORY.md)、[待办提醒与摘要说明](docs/lean-erp/FOLLOWUPS.md)、[操作草稿与确认协议](docs/lean-erp/DRAFTS.md)。

基于真实 ERP 页面结构设计的**合成业务演示**。TypeScript / Node.js + Pi，
只读调查销售价格规则，不连接生产 ERP，不包含原始 HTML 或客户数据。

## 运行

Node.js 24+，先 `npm ci`。

```sh
npm run typecheck
npm test
npm run demo
npm run demo:report
npm run evaluate:offline
```

demo 输出四组 JSON：conflict、discount 为 violation，conversion 为 compliant，
overlap 为 inconclusive。每条结果引用订单行及版本化规则；effectiveCents 是精确
分数，单位为分，例如 35999/2 表示 179.995 元，不提前四舍五入。

## 范围与业务约定

字段参考用户提供的 ERP 页面：价格管控、销售订单、商品管理。阈值与行为是本项目
设定，并非原系统漏洞或原系统实际拦截规则。来源页面未提交。
第一版只审计订单实际价格，不模拟取价引擎，不实现利润/返佣/授信/审批。

单价为对应销售单位的整数分；数量和基本单位换算因子为正整数。
discountBps 表示应付比例（9000 即九折）；taxBps 表示税率（1300 即 13%）。
先去税并应用行折扣，再按各行不含税金额分摊整单优惠（discountCents 为不含税优惠），
最后除以数量和换算因子；阈值采用不含税基本单位价格。日期端点包含在有效期内。
赠品、缺失信息、无适用规则和规则重叠均不能宣称合规。
总体报告保留所有行：有违规则 violation，否则有未知则 inconclusive，否则 compliant。

## 检索和 Pi

检索提供中文分词关键词基线及 Ollama embeddinggemma 向量候选检索，先过滤
账套/日期，再返回版本化政策片段。向量使用内存余弦排序；Agent 以关键词重叠
作为保守接纳门槛，未接纳候选单独标记。这不是经过校准的相关性判断，可能漏掉
完全无词面重叠的相关片段，也可能接纳仅有泛词重叠的无关片段。
Pi 使用官方 @earendil-works/pi-agent-core；两个只读工具是 search_policies、audit_order。
运行时上限默认 8 次工具、6 个模型回合、30 秒；本地 CLI 默认 180 秒以容纳冷启动。
模型自然语言输出单独放 unverifiedModelCommentary，并标记 commentaryVerified: false，
不能覆盖 report。auditExplanation 是直接从输入与计算结果生成的中文说明，包含实际
折扣、整单优惠、单位、税价及来源；不会读取模型文本。completed 表示取得政策证据
与工具报告，不代表模型解释已被验证。失败/不完整运行若已有 auditExplanation，
它仅是部分工具结果，不能把整个调查视为完成。

离线测试使用真实 Pi 运行时和脚本化模型传输，不使用 API key，不证明真实模型效果。
真实本机 smoke run 已完成，模型为 qwen3.5:9b + embeddinggemma。复现时，临时
设置以下环境变量后执行 `npm run investigate`：

- ERP_MODEL_BASE_URL：选定服务的 API 根地址（通常以 /v1 结尾）。
- ERP_MODEL_ID：支持工具调用的模型 ID。
- ERP_MODEL_API_KEY：服务密钥，本地无鉴权服务可省略。
- ERP_EMBED_MODEL：设为 embeddinggemma 启用本地向量检索；不设则使用关键词。
- ERP_TIMEOUT_MS：可选，总运行时限（毫秒），CLI 默认 180000。

没有默认云服务。聊天地址用 http://127.0.0.1:11434/v1，聊天模型 qwen3.5:9b；
embedding 固定通过本机 http://127.0.0.1:11434/api/embed。
网络命令按本机 AGENTS.md 临时设置代理，
本地模型地址应配置 NO_PROXY。示例 cost 为占位值，不能用于费用统计。

## 工作记录

- CONTEXT.md：业务词汇与范围。
- .scratch/price-audit/spec.md：规格。
- .scratch/price-audit/issues/：第一轮四张任务单。
- .scratch/evidence-quality/：第二轮说明与负例评测规格、任务。
- docs/adr/：架构决策。

`npm run evaluate` 使用本地 embeddinggemma；`npm run evaluate:offline` 不访问模型。
第二轮仍为 3 段政策，评测扩展至 6 正例、8 负例（含其他账套与失效日期）。
过滤泛词后：关键词与接纳结果正例首位命中 5/6，向量候选 6/6；负例中原始向量
候选有 5/8 返回非空结果，接纳结果为 0/8，跨范围泄漏为 0。
这是开发烟测，非独立保留集；不能推导生产准确率或向量检索普遍优于基线。
纯语义改写仍可能被词法门槛拦截，泛词清单也不保证拒绝所有无关问题。

真实运行发现模型解释曾捏造 10% 折扣并错误声明缺少单位/税价信息，虽然工具报告
正确。因此未验证说明不能作为审计结论展示；使用 auditExplanation、report 和 sources。
来源 ID/version 重复的规则输入会返回无法判定，避免跨账套误引。见验证记录。

接口参考：[Ollama embed](https://docs.ollama.com/api/embed)、
[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)。
