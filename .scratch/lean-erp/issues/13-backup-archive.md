# 13 — Off-server backup, recovery and cold archive

**What to build:** Protect the business from VPS loss and fixed-disk exhaustion. The system creates consistent encrypted off-server backups, restores into a clean environment, identifies archive-eligible closed periods, proposes a reviewable archive, and removes live detail only after verification and operator confirmation.

**Blocked by:** 05 — Posted records are corrected by linked reversal; 06 — Returns use original evidence or quarantined stock; 07 — Stocktake, transfer, loss and concurrent stock protection; 08 — Durable follow-ups, reminders and summaries.

**Status:** ready-for-agent

- [ ] A database under normal writes can produce a consistent encrypted backup without corrupting WAL state.
- [ ] Backups are copied off-server at least hourly with daily full restore points and the agreed retention policy.
- [ ] Recovery keys are not stored only with the primary database.
- [ ] A clean restore recreates business queries, balances, audit evidence and current drafts/follow-ups within the RTO procedure.
- [ ] Open obligations, active batches and unresolved exceptions prevent dependent periods from being classified as closed.
- [ ] Archive proposal shows scope and impact; failed upload or integrity verification prevents live deletion.
- [ ] Confirmed archival retains a searchable live index and enough opening/balance provenance for current operations and later restore.
