# `ops/` — local-only operator notes

Everything in this directory is **gitignored** except this file and any
`*.example.md` templates. That's deliberate: it's where we keep live
operational state (current deployer CIDR, last-known-good backup job IDs,
specific rotation dates, scratch notes from incidents) that we want
available next time we're on-call, but don't want in a public repo where
it'd give an attacker a free recon pass.

## What belongs here

- `runbook-values.local.md` — per-machine copy of concrete values the
  public runbook refers to abstractly. Start from
  `runbook-values.example.md`.
- Restore-drill logs — `restore-drill-2026-04-22.md` etc. Quarterly drill
  output goes here so the next drill can diff against the last one.
- Oncall handoff scratchpads.
- Raw command logs from incident response (before they're summarized into
  a committable postmortem).

## What does NOT belong here

- Secrets. Secrets go in Azure Key Vault. `ops/` is on your laptop; it's
  not a secrets vault.
- Code. If a script is load-bearing enough to run twice, commit it under
  `infra/scripts/` instead.
- Anything that needs to survive laptop loss without your backup. Time
  Machine / iCloud / similar covers this dir, but assume nothing here is
  replicated to the team.

## First-time setup

```bash
cp ops/runbook-values.example.md ops/runbook-values.local.md
# Then edit runbook-values.local.md with real values.
```

The public runbook in [`infra/azure/README.md`](../infra/azure/README.md)
(section "Runbooks") references `ops/runbook-values.local.md` for every
value that's better kept local.
