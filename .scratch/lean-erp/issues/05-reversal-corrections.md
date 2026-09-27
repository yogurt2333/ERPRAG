# 05 — Posted records are corrected by linked reversal

**What to build:** Give operators a safe way to correct posted purchasing, sales and settlement mistakes. The original record remains immutable; a linked reversal or compensating operation restores stock and money while retaining who corrected what, when, through which channel and why.

**Blocked by:** 02 — Customer order and delivery create receivable and gross profit; 03 — Receipts and payments allocate open obligations.

**Status:** ready-for-agent

- [ ] Posted stock or settlement records cannot be overwritten or physically deleted through public operations.
- [ ] A purchase mistake can be reversed with exact stock, cost and payable effects.
- [ ] A sales mistake can be reversed with exact stock, receivable and gross-profit effects.
- [ ] Receipt/payment allocation can be reversed without losing the original allocation history.
- [ ] Reversal chains retain origin links, actor, channel, timestamp and reason.
- [ ] Repeating a reversal confirmation is idempotent.
- [ ] Failure during reversal leaves both original balances and correction state unchanged.
