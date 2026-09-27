# ADR 0008: Archive only verified closed periods

Accepted. The live database normally retains 24 months. Disk use warns at 70% and
may propose an archive at 80%, but archival requires operator confirmation. Only
complete closed months may move to encrypted off-server storage; open receivables,
payables, active batches and unresolved exceptions remain live. Live deletion occurs
only after upload integrity is verified, and the system retains a searchable index,
current balances and enough provenance to restore the archive. Restore drills are
part of the backup contract.
