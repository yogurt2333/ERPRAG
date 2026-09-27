# ADR 0003: ERPNext owns business state and rules

Status: superseded by ADR 0005.

Accepted. ERPNext and its custom application remain the system of record for
inventory, receivables, payables, payments, gross profit and durable business
follow-ups. Hermes and WeChat provide a conversational handle that proposes and
confirms operations through validated tools; neither chat history nor model memory
owns business state or replaces ERP rules. This preserves business truth when the
agent, channel or conversation is unavailable or replaced.
