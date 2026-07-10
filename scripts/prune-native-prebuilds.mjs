#!/usr/bin/env node
/**
 * Strip prebuilt native binaries for platforms other than the one we're
 * packaging for.
 *
 * tree-sitter grammars (pulled in by code-chunk) ship `prebuilds/<platform>-<arch>/`
 * directories for every platform they support. A platform-specific vsix only
 * ever loads one of them, so the rest are dead weight -- around 30 MB.
 *
 * Usage: node scripts/prune-native-prebuilds.mjs <vsce-target> [--dry-run]
 *   e.g. node scripts/prune-native-prebuilds.mjs darwin-arm64
 *
 * vsce target names (darwin-arm64, linux-x64, win32-x64) match prebuildify's
 * directory naming, so the target is used verbatim.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!target || target.startsWith('--')) {
  console.error('usage: prune-native-prebuilds.mjs <vsce-target> [--dry-run]');
  process.exit(1);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total;
}

const prebuildDirs = [];
function findPrebuilds(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable or a broken symlink; nothing to prune
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'prebuilds') prebuildDirs.push(join(dir, entry.name));
    else findPrebuilds(join(dir, entry.name));
  }
}

findPrebuilds('node_modules');

// Validate before deleting anything: a typo'd target would otherwise match no
// directory and prune every prebuild, leaving a vsix that cannot load.
const providesTarget = prebuildDirs.filter((d) => readdirSync(d).includes(target));
if (prebuildDirs.length > 0 && providesTarget.length === 0) {
  console.error(`error: no prebuilds/${target} directory found -- is "${target}" a valid target?`);
  process.exit(1);
}

let removed = 0;
let freed = 0;

for (const prebuilds of prebuildDirs) {
  for (const entry of readdirSync(prebuilds, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === target) continue;
    const victim = join(prebuilds, entry.name);
    freed += dirSize(victim);
    removed++;
    if (!dryRun) rmSync(victim, { recursive: true, force: true });
  }
}

const verb = dryRun ? 'Would remove' : 'Removed';
console.log(
  `${verb} ${removed} foreign prebuild dir(s), freeing ${(freed / 1048576).toFixed(1)} MB ` +
    `(kept "${target}" in ${providesTarget.length} package(s))`,
);
