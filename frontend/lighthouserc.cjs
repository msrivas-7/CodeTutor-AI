module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      isSinglePageApplication: true,
      url: ["http://localhost/", "http://localhost/why-not-chatgpt"],
      numberOfRuns: 3,
      settings: {
        chromeFlags: "--headless --no-sandbox --disable-dev-shm-usage",
        maxWaitForLoad: 90_000,
      },
    },
    assert: {
      includePassedAssertions: true,
      assertions: {
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 2_500, aggregationMethod: "median" },
        ],
        "cumulative-layout-shift": [
          "error",
          { maxNumericValue: 0.1, aggregationMethod: "median" },
        ],
        // Lighthouse cannot produce field INP without real-user traffic.
        // Total Blocking Time is the maintained lab proxy until a production
        // cohort exists; the production runbook records the planned switch.
        "total-blocking-time": [
          "error",
          { maxNumericValue: 200, aggregationMethod: "median" },
        ],
        "categories:performance": [
          "error",
          { minScore: 0.85, aggregationMethod: "median" },
        ],
        "resource-summary:script:size": [
          "error",
          { maxNumericValue: 700_000, aggregationMethod: "median" },
        ],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./lhci-reports",
    },
  },
};
