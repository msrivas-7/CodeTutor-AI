// Phase 23 P1 #6: account-deletion audit trail.
// Tests the SQL shape produced by `insertDeletedAccount` against a
// mocked db client. Real-DB coverage is implicit — the migration ships
// with the route's e2e test, and the route happy path exercises the
// real insert via the route-test suite (with its own DB cleanup).

import { afterEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.fn();
vi.mock("./client.js", () => ({
  db: () => sqlMock,
}));

const { insertDeletedAccount } = await import("./deletedAccounts.js");

afterEach(() => {
  sqlMock.mockReset();
});

describe("insertDeletedAccount", () => {
  it("writes user_id_hashed + email + reason; defaults reason to self_service", async () => {
    sqlMock.mockResolvedValueOnce([]);
    await insertDeletedAccount({
      userIdHashed: "h_abc123",
      email: "alex@example.com",
    });
    expect(sqlMock).toHaveBeenCalledTimes(1);
    // postgres.js tagged-template invocation: first arg is the strings
    // array, subsequent args are the interpolated values. Check the
    // values are passed in order: user_id_hashed, email, reason.
    const callArgs = sqlMock.mock.calls[0];
    const interpolated = callArgs.slice(1);
    expect(interpolated).toEqual([
      "h_abc123",
      "alex@example.com",
      "self_service",
    ]);
  });

  it("forwards an explicit reason override", async () => {
    sqlMock.mockResolvedValueOnce([]);
    await insertDeletedAccount({
      userIdHashed: "h_xyz999",
      email: "operator-action@example.com",
      reason: "operator_mod",
    });
    const interpolated = sqlMock.mock.calls[0].slice(1);
    expect(interpolated[2]).toBe("operator_mod");
  });

  it("propagates DB errors to the caller (not swallowed)", async () => {
    sqlMock.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(
      insertDeletedAccount({
        userIdHashed: "h_user",
        email: "user@example.com",
      }),
    ).rejects.toThrow("connection terminated");
  });
});
