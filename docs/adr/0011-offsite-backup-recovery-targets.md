# ADR 0011: Keep off-server backups with bounded recovery loss

Accepted. The ERP targets at most one hour of data loss and restoration within four
hours after loss of the primary server. SQLite backups are encrypted and copied off
server at least hourly, with a daily full backup, seven daily and eight weekly restore
points. Cold archives remain separate. Backup integrity is checked monthly and an
actual restore is exercised quarterly; recovery keys are not stored only on the
primary server.
