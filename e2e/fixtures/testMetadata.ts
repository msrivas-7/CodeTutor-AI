import type { TestDetails } from "@playwright/test";

export type TestRisk = "p0" | "p1" | "p2";
export type TestOwner =
  | "accessibility"
  | "auth"
  | "editor"
  | "growth"
  | "learning"
  | "platform"
  | "security"
  | "share"
  | "tutor";
export type TestBrowser = "chromium" | "firefox" | "webkit";
export type TestDevice = "desktop" | "phone" | "tablet";

export type QuarantineState =
  | { state: "none" }
  | {
      state: "active";
      issue: string;
      expires: string;
    };

interface CriticalTestMetadata {
  risk: TestRisk;
  owner: TestOwner;
  browsers: readonly TestBrowser[];
  devices: readonly TestDevice[];
  quarantine: QuarantineState;
}

/**
 * Source-owned metadata for the advisory Release 1D critical lane.
 *
 * Every dimension is required at the call site so a new critical test cannot
 * silently inherit an incorrect risk, owner, browser, device, or quarantine
 * assumption. The shadow contract rejects active quarantine in this lane.
 */
export function criticalTest(metadata: CriticalTestMetadata): TestDetails {
  const quarantine =
    metadata.quarantine.state === "none"
      ? {
          tag: "@quarantine:none",
          annotation: { type: "quarantine", description: "none" },
        }
      : {
          tag: "@quarantine:active",
          annotation: {
            type: "quarantine",
            description: `${metadata.quarantine.issue}; expires ${metadata.quarantine.expires}`,
          },
        };

  return {
    tag: [
      "@lane:critical",
      `@risk:${metadata.risk}`,
      `@owner:${metadata.owner}`,
      ...metadata.browsers.map((browser) => `@browser:${browser}`),
      ...metadata.devices.map((device) => `@device:${device}`),
      quarantine.tag,
    ],
    annotation: [
      { type: "risk", description: metadata.risk },
      { type: "owner", description: metadata.owner },
      { type: "browser", description: metadata.browsers.join(",") },
      { type: "device", description: metadata.devices.join(",") },
      quarantine.annotation,
    ],
  };
}
