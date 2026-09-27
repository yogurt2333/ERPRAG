# ADR 0004: Expose business operations, not generic ERP access

Accepted. The mobile app reaches the system over public HTTPS through a narrow,
authenticated business API; generic database access and internal service methods are
not the app contract. Writes use validated operation drafts, explicit confirmation,
idempotency and audit records. Hermes uses the same business-operation boundary from
inside the server. This avoids coupling clients to storage internals and limits the
impact of a stolen client credential.
