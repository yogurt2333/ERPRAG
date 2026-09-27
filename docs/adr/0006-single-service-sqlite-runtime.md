# ADR 0006: Use a single service with SQLite for the MVP

Accepted. The lean ERP runs as one TypeScript/Node service with a local SQLite
database in WAL mode; all clients, including Hermes and the future mobile app, use
its business API rather than accessing the database. Model inference remains remote.
This minimizes the 2-core, 2-GB runtime while preserving cross-module transactions.
The trade-off is one writer service, no multi-node high availability, local durable
storage, and mandatory consistent backups plus restore tests. PostgreSQL remains a
future migration when measured concurrency or availability needs justify it.
