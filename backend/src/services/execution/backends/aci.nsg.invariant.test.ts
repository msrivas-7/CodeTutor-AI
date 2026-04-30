// P0-5b (audit fix): static counterpart of the e2e S1f scenario
// ("ACI container → curl 10.20.1.X must fail").
//
// The runtime test is impossible in CI without real Azure infra (an ACI
// container, a VNet, a peer host on 10.20.1.X). This test instead asserts
// the same invariant against the Bicep source: the ACI subnet NSG must
// NOT permit any learner-originated outbound traffic, including back to
// the VM subnet. Combined with the cost-cap and reservation tests, this
// closes the audit's P0-5 finding even though the live network probe
// is deferred to a future "Azure-backed e2e" runner.
//
// What this test specifically catches:
//   1. The previous AllowReplyToVmSubnet rule reappearing (it lets ACI
//      containers reach 22/SSH, 9000/Caddy admin, the metrics port, etc.
//      on the VM subnet — Azure NSGs are stateful, so it was redundant
//      AND insecure).
//   2. Any new Outbound Allow rule with a wide port range.
//   3. The DenyAllOutbound rule being weakened or removed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../../../");
const NETWORK_BICEP_PATH = path.join(
  REPO_ROOT,
  "infra/azure/modules/network.bicep",
);

function readNetworkBicep(): string {
  // Strip Bicep `// ...` line comments so the invariant assertions only
  // see real source. Without this, a comment referencing the deleted
  // rule by name (legitimate documentation) would trigger false-positive
  // failures in "rule must not exist" checks.
  const raw = readFileSync(NETWORK_BICEP_PATH, "utf8");
  return raw
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

// Walks the file looking for the aciNsg resource block and returns the
// raw text inside its `securityRules` array. Bicep doesn't have a real
// AST exposed at this layer, so a tightly-scoped substring extraction
// is the pragmatic shape — exact rule semantics get asserted by the
// caller against this slice, not against the whole file.
function extractAciNsgBlock(src: string): string {
  const aciNsgIdx = src.indexOf("resource aciNsg ");
  expect(aciNsgIdx).toBeGreaterThan(-1);
  const after = src.slice(aciNsgIdx);
  // Find the matching close brace of the resource. Track nesting depth
  // through `{` and `}` so nested objects don't close us early.
  let depth = 0;
  let endIdx = -1;
  let started = false;
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (c === "{") {
      depth++;
      started = true;
    } else if (c === "}") {
      depth--;
      if (started && depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  expect(endIdx).toBeGreaterThan(0);
  return after.slice(0, endIdx);
}

describe("ACI NSG invariants (P0-5b — static S1f)", () => {
  it("AllowReplyToVmSubnet rule must not exist — Azure NSGs are stateful", () => {
    const block = extractAciNsgBlock(readNetworkBicep());
    expect(block).not.toContain("AllowReplyToVmSubnet");
  });

  it("DenyAllOutbound rule exists at priority 4096", () => {
    const block = extractAciNsgBlock(readNetworkBicep());
    expect(block).toContain("DenyAllOutbound");
    // Look for the priority literal close to the rule. The block is
    // small and the priorities differ across rules, so a scoped
    // substring check is sufficient. We assert the priority appears
    // in the same outbound block (within 200 chars of the name).
    const denyIdx = block.indexOf("DenyAllOutbound");
    expect(denyIdx).toBeGreaterThan(-1);
    const window = block.slice(denyIdx, denyIdx + 400);
    expect(window).toContain("priority: 4096");
    expect(window).toMatch(/direction:\s*'Outbound'/);
    expect(window).toMatch(/access:\s*'Deny'/);
  });

  it("no Outbound Allow rules in the ACI NSG", () => {
    const block = extractAciNsgBlock(readNetworkBicep());
    // Each rule has both `direction:` and `access:` lines. Find every
    // rule and check that no rule has both Outbound + Allow.
    const directions = block.match(/direction:\s*'(Inbound|Outbound)'/g) ?? [];
    const accesses = block.match(/access:\s*'(Allow|Deny)'/g) ?? [];
    expect(directions.length).toBe(accesses.length);
    for (let i = 0; i < directions.length; i++) {
      const isOutbound = directions[i].includes("Outbound");
      const isAllow = accesses[i].includes("Allow");
      // The whole point of the deny posture: zero outbound allows.
      expect(isOutbound && isAllow).toBe(false);
    }
  });

  it("AllowAgentFromVmSubnet inbound rule exists (port 5757)", () => {
    // Smoke check the legitimate path that S1f does NOT block: backend
    // to ACI agent on port 5757 from the VM subnet must still be allowed.
    const block = extractAciNsgBlock(readNetworkBicep());
    expect(block).toContain("AllowAgentFromVmSubnet");
    const agentIdx = block.indexOf("AllowAgentFromVmSubnet");
    const window = block.slice(agentIdx, agentIdx + 600);
    expect(window).toMatch(/direction:\s*'Inbound'/);
    expect(window).toMatch(/access:\s*'Allow'/);
    expect(window).toMatch(/destinationPortRange:\s*'5757'/);
  });
});
