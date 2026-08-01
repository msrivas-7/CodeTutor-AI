import { describe, expect, it } from "vitest";
import {
  DISTRIBUTION_ATTRIBUTION_KEY,
  captureDistributionAttribution,
  parseDistributionAttribution,
  readDistributionAttribution,
} from "./attribution";

function memoryStorage(initial?: unknown) {
  const data = new Map<string, string>();
  if (initial !== undefined) {
    data.set(DISTRIBUTION_ATTRIBUTION_KEY, JSON.stringify(initial));
  }
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
}

describe("distribution attribution", () => {
  it("accepts only the bounded organic contract", () => {
    expect(
      parseDistributionAttribution(
        "?utm_source=organic&utm_medium=lesson_page&utm_campaign=python-fundamentals&utm_content=variables",
      ),
    ).toEqual({
      source: "organic",
      medium: "lesson_page",
      campaign: "python-fundamentals",
      content: "variables",
    });
    expect(
      parseDistributionAttribution(
        "?utm_source=google&utm_medium=cpc&utm_campaign=anything",
      ),
    ).toBeNull();
  });

  it("requires a valid public token for share attribution", () => {
    expect(
      parseDistributionAttribution(
        "?utm_source=share&utm_medium=lesson_share&utm_campaign=python-fundamentals&utm_content=hello-world&share_ref=23456789abcd",
      ),
    ).toEqual({
      source: "share",
      medium: "lesson_share",
      campaign: "python-fundamentals",
      content: "hello-world",
      shareRef: "23456789abcd",
    });
    expect(
      parseDistributionAttribution(
        "?utm_source=share&utm_medium=lesson_share&utm_campaign=python-fundamentals&utm_content=hello-world&share_ref=raw-token-with-punctuation",
      ),
    ).toBeNull();
  });

  it("keeps the first touch and strips only acquisition keys", () => {
    const storage = memoryStorage();
    const replacements: string[] = [];
    const first = captureDistributionAttribution(
      {
        pathname: "/try/lesson/python-fundamentals/hello-world",
        search:
          "?utm_source=organic&utm_medium=category_page&utm_campaign=learn-to-code&contextGuide=1",
        hash: "#editor",
      },
      { replaceState: (_data, _unused, url) => replacements.push(String(url)) },
      storage,
    );
    expect(first.source).toBe("organic");
    expect(replacements).toEqual([
      "/try/lesson/python-fundamentals/hello-world?contextGuide=1#editor",
    ]);

    captureDistributionAttribution(
      {
        pathname: "/",
        search:
          "?utm_source=share&utm_medium=lesson_share&utm_campaign=python-fundamentals&utm_content=hello-world&share_ref=23456789abcd",
        hash: "",
      },
      { replaceState: () => undefined },
      storage,
    );
    expect(readDistributionAttribution(storage)).toEqual(first);
  });

  it("fails closed to direct when stored data is malformed", () => {
    expect(readDistributionAttribution(memoryStorage({ source: "google" }))).toEqual({
      source: "direct",
    });
    expect(
      readDistributionAttribution(
        memoryStorage({
          source: "organic",
          medium: "lesson_page",
          campaign: "python-fundamentals",
          referrer: "https://example.test/private",
        }),
      ),
    ).toEqual({ source: "direct" });
  });
});
