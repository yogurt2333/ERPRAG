import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    db.exec('BEGIN IMMEDIATE');
    const version = db.prepare('PRAGMA user_version').get()!.user_version;
    if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9].includes(Number(version))) throw new Error(`Unsupported ERP schema version: ${version}`);
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
    if (Number(version) < 4) db.exec(`
      CREATE TABLE product_details (
        product_id TEXT PRIMARY KEY REFERENCES masters(id), revision INTEGER NOT NULL, document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE pack_versions (
        product_id TEXT NOT NULL REFERENCES masters(id), unit TEXT NOT NULL, version INTEGER NOT NULL,
        document TEXT NOT NULL, PRIMARY KEY(product_id, unit, version)
      ) STRICT;
      CREATE TABLE product_followups (
        product_id TEXT PRIMARY KEY REFERENCES masters(id), missing_fields TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','resolved'))
      ) STRICT;
      INSERT INTO product_details SELECT id, 1, '{"aliases":[],"specification":null,"barcode":null,"shelfLifeDays":null}' FROM masters WHERE kind = 'product';
      INSERT INTO product_followups SELECT id, '["specification","shelfLifeDays","packUnits"]', 'open' FROM masters WHERE kind = 'product';
      PRAGMA user_version = 4;
    `);
    if (Number(version) < 5) db.exec(`
      CREATE TABLE reversals (
        id TEXT PRIMARY KEY REFERENCES operations(id),
        origin_id TEXT NOT NULL REFERENCES operations(id),
        kind TEXT NOT NULL CHECK(kind IN ('purchase','sale','settlement')),
        document TEXT NOT NULL, UNIQUE(origin_id, kind)
      ) STRICT;
      PRAGMA user_version = 5;
    `);
    if (Number(version) < 6) db.exec(`
      CREATE TABLE returns (
        id TEXT PRIMARY KEY REFERENCES operations(id), origin_id TEXT NOT NULL REFERENCES operations(id),
        document TEXT NOT NULL
      ) STRICT;
      CREATE INDEX return_origin ON returns(origin_id);
      CREATE TABLE quarantines (
        id TEXT PRIMARY KEY REFERENCES operations(id), document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE quarantine_resolutions (
        id TEXT PRIMARY KEY REFERENCES operations(id), quarantine_id TEXT NOT NULL UNIQUE REFERENCES quarantines(id),
        document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE return_refunds (
        id TEXT PRIMARY KEY REFERENCES operations(id), origin_id TEXT NOT NULL REFERENCES operations(id), document TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 6;
    `);
    if (Number(version) < 7) db.exec(`
      CREATE TABLE stocktakes (
        id TEXT PRIMARY KEY REFERENCES operations(id), document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE inventory_operations (
        id TEXT PRIMARY KEY REFERENCES operations(id),
        stocktake_id TEXT UNIQUE REFERENCES stocktakes(id), document TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 7;
    `);
    if (Number(version) < 8) db.exec(`
      CREATE TABLE followups (id TEXT PRIMARY KEY, document TEXT NOT NULL) STRICT;
      CREATE TABLE followup_history (id INTEGER PRIMARY KEY, document TEXT NOT NULL) STRICT;
      CREATE TABLE notification_events (id TEXT PRIMARY KEY, document TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0) STRICT;
      PRAGMA user_version = 8;
    `);
    if (Number(version) < 9) db.exec(`
      CREATE TABLE operation_drafts (scope TEXT NOT NULL, version INTEGER NOT NULL, document TEXT NOT NULL,
        PRIMARY KEY(scope, version)) STRICT;
      CREATE TABLE draft_events (scope TEXT NOT NULL, event_id TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(scope, event_id)) STRICT;
      PRAGMA user_version = 9;
    `);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}
