import { describe, it, expect } from "vitest";
import type { User } from "@supabase/supabase-js";
import { resolveFirstName } from "./resolveFirstName";

// Helper: fabricate the minimal User shape resolveFirstName actually
// touches. The full Supabase User type has ~20 fields none of which we
// care about here, so the cast keeps test setup cheap.
function u(meta: Record<string, unknown>): User {
  return { user_metadata: meta } as unknown as User;
}

describe("resolveFirstName", () => {
  it("prefers our own signup-form first_name when present", () => {
    expect(
      resolveFirstName(u({ first_name: "Mehul", given_name: "GoogleName" })),
    ).toBe("Mehul");
  });

  it("falls back to Google's given_name", () => {
    expect(resolveFirstName(u({ given_name: "Ada" }))).toBe("Ada");
  });

  it("splits GitHub's `name` on whitespace and takes the first token", () => {
    expect(resolveFirstName(u({ name: "Grace Hopper" }))).toBe("Grace");
  });

  it("splits full_name when that's the only thing available", () => {
    expect(resolveFirstName(u({ full_name: "Alan Turing" }))).toBe("Alan");
  });

  it("returns 'there' when no usable name is in metadata", () => {
    expect(resolveFirstName(u({}))).toBe("there");
  });

  it("returns 'there' when user is null (signed-out shell render)", () => {
    expect(resolveFirstName(null)).toBe("there");
  });

  it("ignores empty strings instead of returning them", () => {
    expect(
      resolveFirstName(u({ first_name: "", given_name: "  ", name: "Ken" })),
    ).toBe("Ken");
  });
});
