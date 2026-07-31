import { loadAndVerifyEvalDatasetGovernance } from "./evalGovernance.js";

try {
  const count = await loadAndVerifyEvalDatasetGovernance();
  console.log(`[eval-governance] ${count} trusted cases have explicit non-traffic provenance`);
} catch (err) {
  console.error(
    `[eval-governance] failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
}
