#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const API_ROOT = process.env.GITHUB_API_URL || "https://api.github.com";

export function selectPackageVersions(
  versions,
  { tag = null, olderThanMs = null, keepNewest = 0, now = Date.now() } = {},
) {
  const newestFirst = [...versions].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );

  if (tag) {
    return newestFirst.filter((version) =>
      (version.metadata?.container?.tags ?? []).includes(tag),
    );
  }

  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
    throw new Error("Provide either --tag or a non-negative --older-than-hours value");
  }

  const protectedIds = new Set(
    newestFirst.slice(0, Math.max(0, keepNewest)).map((version) => version.id),
  );
  const cutoff = now - olderThanMs;
  return newestFirst.filter(
    (version) =>
      !protectedIds.has(version.id) && Date.parse(version.updated_at) < cutoff,
  );
}

function parseArgs(argv) {
  const options = { requireMatch: false, keepNewest: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-match") {
      options.requireMatch = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    index += 1;
    if (arg === "--owner") options.owner = value;
    else if (arg === "--package") options.package = value;
    else if (arg === "--tag") options.tag = value;
    else if (arg === "--older-than-hours") options.olderThanHours = Number(value);
    else if (arg === "--keep-newest") options.keepNewest = Number(value);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.owner || !options.package) {
    throw new Error("--owner and --package are required");
  }
  if (options.tag && options.olderThanHours !== undefined) {
    throw new Error("--tag and --older-than-hours are mutually exclusive");
  }
  if (!options.tag && !Number.isFinite(options.olderThanHours)) {
    throw new Error("Provide --tag or --older-than-hours");
  }
  if (!Number.isInteger(options.keepNewest) || options.keepNewest < 0) {
    throw new Error("--keep-newest must be a non-negative integer");
  }
  return options;
}

function nextLink(header) {
  if (!header) return null;
  const match = header
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part));
  return match?.match(/^<([^>]+)>/)?.[1] ?? null;
}

async function githubRequest(url, token, init = {}) {
  const response = await fetch(url.startsWith("http") ? url : `${API_ROOT}${url}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? "GET"} ${url} failed (${response.status}): ${body}`);
  }
  return response;
}

async function listVersions(path, token) {
  const versions = [];
  let next = `${API_ROOT}${path}?per_page=100`;
  while (next) {
    const response = await githubRequest(next, token);
    versions.push(...(await response.json()));
    next = nextLink(response.headers.get("link"));
  }
  return versions;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");

  const ownerResponse = await githubRequest(
    `/users/${encodeURIComponent(options.owner)}`,
    token,
  );
  const owner = await ownerResponse.json();
  const scope = owner.type === "Organization" ? "orgs" : "users";
  const packagePath = `/${scope}/${encodeURIComponent(options.owner)}/packages/container/${encodeURIComponent(options.package)}`;
  const versions = await listVersions(`${packagePath}/versions`, token);
  const selected = selectPackageVersions(versions, {
    tag: options.tag,
    olderThanMs:
      options.olderThanHours === undefined
        ? null
        : options.olderThanHours * 60 * 60 * 1000,
    keepNewest: options.keepNewest,
  });

  if (options.requireMatch && selected.length === 0) {
    throw new Error(`No ${options.package} version matched tag ${options.tag}`);
  }

  for (const version of selected) {
    await githubRequest(`${packagePath}/versions/${version.id}`, token, {
      method: "DELETE",
    });
  }
  console.log(
    JSON.stringify({
      package: options.package,
      deleted: selected.map((version) => version.id),
      matched: selected.length,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
