import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    db.exec('BEGIN IMMEDIATE');
    const version = db.prepare('PRAGMA user_version').get()!.user_version;
    if (![0, 1, 2, 3].includes(Number(version))) throw new Error(`Unsupported ERP schema version: ${version}`);
    if (version === 0) db.exec(`
      CREATE TABLE masters (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('product','supplier','warehouse')),
        name TEXT NOT NULL, stock_unit TEXT,
        CHECK((kind = 'product' AND stock_unit IS NOT NULL) OR (kind != 'product' AND stock_unit IS NULL))
      ) STRICT;
      CREATE TABLE operations (
        id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL
      ) STRICT;
      CREATE TABLE receipts (
        id TEXT PRIMARY KEY REFERENCES operations(id), supplier_id TEXT NOT NULL REFERENCES masters(id),
        warehouse_id TEXT NOT NULL REFERENCES masters(id), document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE stock_ledger (
        receipt_id TEXT NOT NULL REFERENCES receipts(id), line_index INTEGER NOT NULL,
        product_id TEXT NOT NULL REFERENCES masters(id), warehouse_id TEXT NOT NULL REFERENCES masters(id),
        quantity TEXT NOT NULL, value_cents TEXT NOT NULL,
        PRIMARY KEY(receipt_id, line_index)
      ) STRICT;
      CREATE INDEX stock_scope ON stock_ledger(product_id, warehouse_id);
      CREATE TABLE payable_ledger (
        receipt_id TEXT PRIMARY KEY REFERENCES receipts(id), supplier_id TEXT NOT NULL REFERENCES masters(id),
        amount_cents TEXT NOT NULL
      ) STRICT;
      CREATE TABLE audit_events (
        operation_id TEXT PRIMARY KEY REFERENCES operations(id), evidence TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    if (version === 0 || version === 1) db.exec(`
      CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
      CREATE TABLE sales_orders (
        id TEXT PRIMARY KEY REFERENCES operations(id), customer_id TEXT NOT NULL REFERENCES customers(id),
        document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE deliveries (
        id TEXT PRIMARY KEY REFERENCES operations(id), order_id TEXT NOT NULL REFERENCES sales_orders(id),
        document TEXT NOT NULL
      ) STRICT;
      CREATE INDEX delivery_order ON deliveries(order_id);
      CREATE TABLE stock_issues (
        delivery_id TEXT NOT NULL REFERENCES deliveries(id), line_index INTEGER NOT NULL,
        product_id TEXT NOT NULL REFERENCES masters(id), warehouse_id TEXT NOT NULL REFERENCES masters(id),
        quantity TEXT NOT NULL, cost_cents TEXT NOT NULL,
        PRIMARY KEY(delivery_id, line_index)
      ) STRICT;
      CREATE INDEX issue_scope ON stock_issues(product_id, warehouse_id);
      CREATE TABLE receivable_ledger (
        delivery_id TEXT PRIMARY KEY REFERENCES deliveries(id), customer_id TEXT NOT NULL REFERENCES customers(id),
        amount_cents TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 2;
    `);
    if (Number(version) < 3) db.exec(`
      CREATE TABLE settlements (
        id TEXT PRIMARY KEY REFERENCES operations(id),
        kind TEXT NOT NULL CHECK(kind IN ('customer_receipt','supplier_payment')),
        party_id TEXT NOT NULL, document TEXT NOT NULL
      ) STRICT;
      CREATE INDEX settlement_party ON settlements(kind, party_id);
      CREATE TABLE settlement_allocations (
        settlement_id TEXT NOT NULL REFERENCES settlements(id),
        obligation_id TEXT NOT NULL REFERENCES operations(id), amount_cents TEXT NOT NULL,
        PRIMARY KEY(settlement_id, obligation_id)
      ) STRICT;
      CREATE INDEX allocation_obligation ON settlement_allocations(obligation_id);
      PRAGMA user_version = 3;
    `);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}
