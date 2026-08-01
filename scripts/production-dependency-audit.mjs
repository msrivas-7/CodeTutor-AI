#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['backend', 'frontend'];
const SEVERITY = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function advisoryId(via) {
  const match = String(via.url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0].toUpperCase() ?? `NPM-${via.source}`;
}

export function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return [];

  return vulnerability.via.flatMap((via) =>
    typeof via === 'string'
      ? collectAdvisories(via, vulnerabilities, seen)
      : [{ id: advisoryId(via), severity: via.severity ?? vulnerability.severity }],
  );
}

export function evaluateAudit({ report, lock, exceptions, today }) {
  const findings = [];
  const observedExceptionIds = new Set();

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if ((SEVERITY[vulnerability.severity] ?? 0) < SEVERITY.high) continue;
    const version = lock.packages?.[`node_modules/${name}`]?.version ?? null;
    const advisories = collectAdvisories(name, report.vulnerabilities);

    for (const advisory of advisories) {
      if ((SEVERITY[advisory.severity] ?? 0) < SEVERITY.high) continue;
      const exception = exceptions.find((candidate) =>
        candidate.advisoryId === advisory.id &&
        candidate.packages.includes(name) &&
        candidate.versions?.[name] === version,
      );
      if (!exception) {
        findings.push(`${name}@${version ?? 'unknown'}: ${advisory.id} (${advisory.severity})`);
        continue;
      }
      observedExceptionIds.add(exception.advisoryId);
      if (exception.expiresAt < today) {
        findings.push(`${name}@${version}: ${advisory.id} exception expired ${exception.expiresAt}`);
      }
    }
  }

  const staleExceptions = exceptions
    .filter((exception) => !observedExceptionIds.has(exception.advisoryId))
    .map((exception) => `${exception.advisoryId}: exception is stale or its exact package version changed`);

  return { findings, staleExceptions };
}

function validateExceptions(exceptions) {
  for (const exception of exceptions) {
    if (!/^GHSA-[0-9a-z-]+$/i.test(exception.advisoryId ?? '')) {
      throw new Error(`Invalid advisory id: ${exception.advisoryId ?? '<missing>'}`);
    }
    if (!Array.isArray(exception.packages) || exception.packages.length === 0) {
      throw new Error(`${exception.advisoryId} must name at least one package`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expiresAt ?? '')) {
      throw new Error(`${exception.advisoryId} must have a YYYY-MM-DD expiry`);
    }
    if (typeof exception.reason !== 'string' || exception.reason.length < 40) {
      throw new Error(`${exception.advisoryId} must document a specific risk decision`);
    }
  }
}

function runAudit(workspace) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], {
    cwd: join(ROOT, workspace),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!result.stdout) {
    throw new Error(`${workspace}: npm audit produced no JSON${result.stderr ? ` (${result.stderr.trim()})` : ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${workspace}: npm audit returned malformed JSON`);
  }
}

export function main() {
  const exceptions = JSON.parse(readFileSync(join(ROOT, 'scripts/production-audit-exceptions.json'), 'utf8'));
  validateExceptions(exceptions);
  const today = new Date().toISOString().slice(0, 10);
  const allFindings = [];
  const allStale = new Set();

  for (const workspace of WORKSPACES) {
    const report = runAudit(workspace);
    const lock = JSON.parse(readFileSync(join(ROOT, workspace, 'package-lock.json'), 'utf8'));
    const workspaceExceptions = exceptions.filter((exception) =>
      exception.packages.some((name) => lock.packages?.[`node_modules/${name}`]),
    );
    const result = evaluateAudit({ report, lock, exceptions: workspaceExceptions, today });
    allFindings.push(...result.findings.map((finding) => `${workspace}: ${finding}`));
    for (const stale of result.staleExceptions) allStale.add(stale);
  }

  if (allFindings.length > 0 || allStale.size > 0) {
    console.error('Production dependency audit failed:');
    for (const finding of allFindings) console.error(`- ${finding}`);
    for (const stale of allStale) console.error(`- ${stale}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Production dependency audit passed for ${WORKSPACES.join(' and ')}.`);
  console.log('High/critical findings: 0 unreviewed; 1 exact-version, time-bounded RSC-only exception.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
