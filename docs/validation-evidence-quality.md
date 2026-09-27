# 第二轮验证：证据说明与负例检索

日期：2026-09-17。所有输入仍为合成演示数据，未连接生产 ERP。

## 已完成

- CLI `npm run demo:report` 输出中文说明，直接依据输入及确定性计算生成。
- Agent 返回 auditExplanation，与 unverifiedModelCommentary 分开。
- 新增稳定 reasonCode，解释实际缺失信息；金额精确显示，比例独立格式化。
- 重复 rule ID/version 的快照返回 inconclusive，防止跨账套来源混淆。
- Agent 与评测共用 retrievePolicies；过滤泛词，未将余弦候选自动提升为证据。

## 验证

- `npm run typecheck` 通过；`npm test` 28 passed / 0 failed。
- 回归覆盖真实模型曾捏造的折扣/缺失项、重复来源、分数金额和泛词误召回。
- 本地 qwen3.5:9b + embeddinggemma 的 Pi run：completed、2 次工具调用、
  report=violation、commentaryVerified=false；中文说明正确显示无行折扣、
  172.80 元有效单价、180.00 元限价以及税率/单位。
- 本轮临时启动的 Ollama 服务在验证后已结束；没有改动开机启动配置。
- 本地原始记录在被 git 忽略的 artifacts/live-investigation-v2.json、
  artifacts/evaluation-local-v2.json 和 artifacts/audit-report.md。

## 检索开发集结果

语料只有 3 段政策；6 正例，8 负例，其中两个负例为范围排除。

| 路径 | 正例 Top-1 | 负例返回非空 | 跨范围返回 |
| --- | --- | --- | --- |
| 关键词 | 5/6 | 0/8 | 0 |
| 原始向量候选 | 6/6 | 5/8 | 0 |
| 接纳结果 | 5/6 | 0/8 | 0 |

向量负例非空表示候选噪声，不代表这些结果被 Agent 接纳。泛词过滤去掉了仅凭
“的”而碰巧命中的正例；完全无词面重叠的改写仍可能被词法门槛拒绝。
负例参与开发，非独立保留集；不得宣称生产准确率或已完成相关性阈值校准。

## 双路审查

Standards：重复引用导致跨账套限价混入解释，已修复并复核；百分比格式建议已处理。
Spec：发现同一重复引用问题，已补回归并复核。两路均无剩余阻断发现。

## 仍未完成

文档导入/切块、持久化向量索引、独立评测集及相关性校准、UI、生产接入。
模型自由文本未经过事实核验。Git name/email 仍未配置，未创建提交。
