import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Env, openDatabase } from "./connection.ts";

// Staff-managed milk choices. Options are created and updated, never deleted:
// isAvailable = false takes one off the list. The default option (Normal süt)
// comes from migration 0005 and is never changed here. Nothing here touches
// orders or order_items.

// Same bound as the milk_options.id column.
const MAX_MILK_OPTION_ID_LENGTH = 64;
// A collision of 64 random bits is not expected; the bound only guarantees
// the loop ends even with a broken generator.
const MAX_ID_ATTEMPTS = 5;

export interface MilkOption {
  id: string;
  name: string;
  surchargeKurus: number;
  isDefault: boolean;
  isAvailable: boolean;
}

// Already validated by the caller (src/admin/milk-option-input.ts).
export interface MilkOptionFields {
  name: string;
  surchargeKurus: number;
}

export interface MilkOptionPatch {
  surchargeKurus?: number;
  isAvailable?: boolean;
}

export type UpdateMilkOptionResult =
  | { status: "updated"; milkOption: MilkOption }
  | { status: "not_found" }
  | { status: "default_option" };

interface MilkOptionRow {
  id: string;
  name: string;
  surcharge_kurus: number;
  is_default: number;
  is_available: number;
}

const SELECT_COLUMNS = "id, name, surcharge_kurus, is_default, is_available";

// Column names come only from this list, never from request keys.
const PATCH_COLUMNS: readonly (readonly [keyof MilkOptionPatch, string])[] = [
  ["surchargeKurus", "surcharge_kurus"],
  ["isAvailable", "is_available"],
];

// 16 lowercase hex characters: URL-safe and within the 1-64 id rule.
export function generateMilkOptionId(): string {
  return randomBytes(8).toString("hex");
}

function isMilkOptionId(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_MILK_OPTION_ID_LENGTH;
}

function toMilkOption(row: MilkOptionRow): MilkOption {
  return {
    id: row.id,
    name: row.name,
    surchargeKurus: Number(row.surcharge_kurus),
    isDefault: row.is_default === 1,
    isAvailable: row.is_available === 1,
  };
}

function toColumnValue(field: keyof MilkOptionPatch, value: MilkOptionPatch[keyof MilkOptionPatch]): number {
  if (field === "isAvailable") {
    return value === true ? 1 : 0;
  }
  return value as number;
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

// The options a customer can pick from: the default first, then staff order.
export function getAvailableMilkOptions(db: DatabaseSync): MilkOption[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM milk_options WHERE is_available = 1 ORDER BY is_default DESC, sort_order, id`,
    )
    .all() as unknown as MilkOptionRow[];
  return rows.map(toMilkOption);
}

// Every option, the removed ones included, in the same order: what staff
// manage on the milk options page.
export function getMilkOptions(db: DatabaseSync): MilkOption[] {
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM milk_options ORDER BY is_default DESC, sort_order, id`)
    .all() as unknown as MilkOptionRow[];
  return rows.map(toMilkOption);
}

// An id outside the column's bounds never reaches SQLite.
export function findMilkOptionById(db: DatabaseSync, id: string): MilkOption | null {
  if (!isMilkOptionId(id)) {
    return null;
  }
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM milk_options WHERE id = ?`).get(id) as MilkOptionRow | undefined;
  return row === undefined ? null : toMilkOption(row);
}

// Inserts an available, non-default option at the end of the list. The id
// check, the position and the insert run under one write lock, so two
// parallel creates never share an id or a position.
export function createMilkOption(
  db: DatabaseSync,
  fields: MilkOptionFields,
  generateId: () => string = generateMilkOptionId,
): MilkOption {
  return inTransaction(db, () => {
    let id: string | undefined;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && id === undefined; attempt += 1) {
      const candidate = generateId();
      if (isMilkOptionId(candidate) && db.prepare("SELECT 1 FROM milk_options WHERE id = ?").get(candidate) === undefined) {
        id = candidate;
      }
    }
    if (id === undefined) {
      throw new Error("Could not generate an unused milk option id");
    }
    const { next } = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM milk_options").get() as {
      next: number;
    };
    db.prepare(
      `INSERT INTO milk_options (id, name, surcharge_kurus, is_default, is_available, sort_order)
       VALUES (?, ?, ?, 0, 1, ?)`,
    ).run(id, fields.name, fields.surchargeKurus, Number(next));
    return findMilkOptionById(db, id) as MilkOption;
  });
}

// Writes only the fields present in the patch, so a surcharge edit in one tab
// never overwrites an availability change from another. The default option is
// refused under the same write lock, and the UPDATE itself skips a default
// row, so it stays 0 kuruş and available whatever the caller sends.
export function updateMilkOption(db: DatabaseSync, id: string, patch: MilkOptionPatch): UpdateMilkOptionResult {
  if (!isMilkOptionId(id)) {
    return { status: "not_found" };
  }
  return inTransaction(db, () => {
    const existing = findMilkOptionById(db, id);
    if (existing === null) {
      return { status: "not_found" };
    }
    if (existing.isDefault) {
      return { status: "default_option" };
    }
    const present = PATCH_COLUMNS.filter(([field]) => patch[field] !== undefined);
    if (present.length > 0) {
      db.prepare(
        `UPDATE milk_options SET ${present.map(([, column]) => `${column} = ?`).join(", ")} WHERE id = ? AND is_default = 0`,
      ).run(...present.map(([field]) => toColumnValue(field, patch[field])), id);
    }
    return { status: "updated", milkOption: findMilkOptionById(db, id) as MilkOption };
  });
}

// The functions below open the existing database (never create it), do one
// operation and always close the connection. Errors propagate to the caller.

export function readAvailableMilkOptions(env: Env = process.env): MilkOption[] {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return getAvailableMilkOptions(db);
  } finally {
    db?.close();
  }
}

export function readMilkOptions(env: Env = process.env): MilkOption[] {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return getMilkOptions(db);
  } finally {
    db?.close();
  }
}

export function addMilkOption(fields: MilkOptionFields, env: Env = process.env): MilkOption {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return createMilkOption(db, fields);
  } finally {
    db?.close();
  }
}

export function editMilkOption(id: string, patch: MilkOptionPatch, env: Env = process.env): UpdateMilkOptionResult {
  if (!isMilkOptionId(id)) {
    return { status: "not_found" };
  }
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return updateMilkOption(db, id, patch);
  } finally {
    db?.close();
  }
}
