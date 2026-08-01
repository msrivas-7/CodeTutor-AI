import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAdvisories, evaluateAudit } from './production-dependency-audit.mjs';

const report = {
  vulnerabilities: {
    parent: { severity: 'high', via: ['child'] },
    child: {
      severity: 'high',
      via: [{ source: 42, severity: 'high', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }],
    },
  },
};

test('collectAdvisories follows npm transitive vulnerability references', () => {
  assert.deepEqual(collectAdvisories('parent', report.vulnerabilities), [
    { id: 'GHSA-AAAA-BBBB-CCCC', severity: 'high' },
  ]);
});

test('audit exceptions require an exact version and remain time bounded', () => {
  const base = {
    report,
    lock: { packages: {
      'node_modules/parent': { version: '1.2.3' },
      'node_modules/child': { version: '4.5.6' },
    } },
    exceptions: [{
      advisoryId: 'GHSA-AAAA-BBBB-CCCC',
      packages: ['parent', 'child'],
      versions: { parent: '1.2.3', child: '4.5.6' },
      expiresAt: '2026-08-31',
      reason: 'Test-only sufficiently specific risk decision explanation.',
    }],
  };

  assert.deepEqual(evaluateAudit({ ...base, today: '2026-07-30' }), {
    findings: [],
    staleExceptions: [],
  });
  assert.match(
    evaluateAudit({ ...base, today: '2026-09-01' }).findings[0],
    /exception expired/,
  );
  assert.match(
    evaluateAudit({ ...base, lock: { packages: {
      'node_modules/parent': { version: '1.2.4' },
      'node_modules/child': { version: '4.5.6' },
    } }, today: '2026-07-30' }).findings[0],
    /GHSA-AAAA-BBBB-CCCC/,
  );
});
