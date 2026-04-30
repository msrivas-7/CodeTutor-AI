// P1-1 (audit fix): the systemConfig writers MUST wrap their work in
// `sql.begin(...)` and call `set_config('app.allow_system_config_write',
// 'true', true)` BEFORE the actual write. Without that opt-in, the
// guard_system_config_writes BEFORE trigger (in migration
// 20260430060000_system_config_writer_gate.sql) rejects with
// ERRCODE 42501.
//
// This test fakes postgres.js so we can observe the call shape without
// a live DB. The point is to catch a regression where someone "fixes"
// the trigger noise by removing the SET LOCAL — which would re-open
// the defense-in-depth hole the migration was meant to close.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeQuery {
  template: string;
}

const sqlCalls: FakeQuery[] = [];
const beginCalls: FakeQuery[][] = []; // each beginCall is a list of queries inside that transaction

// Fake `tx` and `sql` — both behave like the postgres.js `Sql` callable
// but record what was templated. The `begin` callback receives a fresh
// `tx` whose calls go into a per-transaction list, so we can assert the
// SET LOCAL came BEFORE the INSERT/DELETE within the same transaction.
function makeTx(into: FakeQuery[]): unknown {
  const tx = (parts: TemplateStringsArray, ..._values: unknown[]) => {
    into.push({ template: parts.join("?") });
    return Promise.resolve([]);
  };
  // postgres.js exposes `.json()` on the sql object for JSONB casting.
  (tx as unknown as { json: unknown }).json = (v: unknown) => v;
  return tx;
}

const fakeSql = ((parts: TemplateStringsArray, ..._values: unknown[]) => {
  sqlCalls.push({ template: parts.join("?") });
  return Promise.resolve([]);
}) as unknown as {
  (parts: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  begin: (cb: (tx: unknown) => Promise<void>) => Promise<void>;
  json: (v: unknown) => unknown;
};
fakeSql.begin = async (cb: (tx: unknown) => Promise<void>) => {
  const txQueries: FakeQuery[] = [];
  beginCalls.push(txQueries);
  await cb(makeTx(txQueries));
};
fakeSql.json = (v: unknown) => v;

vi.mock("./client.js", () => ({
  db: () => fakeSql,
}));

const { setSystemConfig, clearSystemConfig } = await import("./systemConfig.js");

describe("systemConfig writers — guard_system_config_writes opt-in (P1-1)", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
    beginCalls.length = 0;
  });
  afterEach(() => {
    sqlCalls.length = 0;
    beginCalls.length = 0;
  });

  it("setSystemConfig wraps the upsert in a transaction with the admin opt-in", async () => {
    await setSystemConfig({
      key: "aci_overflow_enabled",
      value: false,
      setBy: "test-admin",
      reason: "P1-1 test",
    });

    // Exactly one transaction was opened.
    expect(beginCalls).toHaveLength(1);
    const tx = beginCalls[0];

    // First query inside the transaction is the SET LOCAL opt-in. Using
    // set_config(..., true) is equivalent to SET LOCAL but works inside
    // a tagged-template invocation cleanly.
    expect(tx[0].template).toContain("set_config");
    expect(tx[0].template).toContain("app.allow_system_config_write");

    // Second query is the actual upsert. Order matters — the gate must
    // be set BEFORE the write fires, otherwise the trigger rejects.
    expect(tx[1].template).toContain("INSERT INTO public.system_config");
    expect(tx[1].template).toContain("ON CONFLICT");

    // No raw queries outside the transaction.
    expect(sqlCalls).toHaveLength(0);
  });

  it("clearSystemConfig wraps the delete in a transaction with the admin opt-in", async () => {
    await clearSystemConfig("aci_max_overflow");

    expect(beginCalls).toHaveLength(1);
    const tx = beginCalls[0];
    expect(tx[0].template).toContain("set_config");
    expect(tx[0].template).toContain("app.allow_system_config_write");
    expect(tx[1].template).toContain("DELETE FROM public.system_config");
    expect(sqlCalls).toHaveLength(0);
  });
});
