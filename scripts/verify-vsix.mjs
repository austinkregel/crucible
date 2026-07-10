#!/usr/bin/env node
/**
 * Smoke-test a packaged .vsix before it is published.
 *
 * The failure this exists to catch: the extension bundle externalizes
 * @lancedb/lancedb (a native module) and code-chunk, so a vsix that omits them
 * -- as `vsce package --no-dependencies` did -- installs fine and then throws
 * on activation. Names alone are enough to catch that, so this reads the zip
 * central directory directly and needs no dependencies (it runs on macOS,
 * Linux and Windows runners alike).
 *
 * Usage: node scripts/verify-vsix.mjs <file.vsix> <vsce-target>
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const [file, target] = process.argv.slice(2);
if (!file || !target) {
  console.error('usage: verify-vsix.mjs <file.vsix> <vsce-target>');
  process.exit(1);
}

// vsce target -> the lancedb optional dependency that provides its binary.
const LANCEDB_PACKAGE = {
  'darwin-arm64': '@lancedb/lancedb-darwin-arm64',
  'linux-x64': '@lancedb/lancedb-linux-x64-gnu',
  'linux-arm64': '@lancedb/lancedb-linux-arm64-gnu',
  'win32-x64': '@lancedb/lancedb-win32-x64-msvc',
  'win32-arm64': '@lancedb/lancedb-win32-arm64-msvc',
};

const buf = readFileSync(file);

/** Locate the End Of Central Directory record by scanning backwards. */
function findEocd(b) {
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not a zip archive: no EOCD record');
}

const eocd = findEocd(buf);
const entryCount = buf.readUInt16LE(eocd + 10);
let ptr = buf.readUInt32LE(eocd + 16);

const entries = new Map(); // name -> { localHeaderOffset }
for (let i = 0; i < entryCount; i++) {
  if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('corrupt central directory');
  const nameLen = buf.readUInt16LE(ptr + 28);
  const extraLen = buf.readUInt16LE(ptr + 30);
  const commentLen = buf.readUInt16LE(ptr + 32);
  const localHeaderOffset = buf.readUInt32LE(ptr + 42);
  const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
  entries.set(name, { localHeaderOffset });
  ptr += 46 + nameLen + extraLen + commentLen;
}

/** Decompress a single entry (stored or deflated). */
function readEntry(name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`entry not found: ${name}`);
  const o = entry.localHeaderOffset;
  if (buf.readUInt32LE(o) !== 0x04034b50) throw new Error(`corrupt local header: ${name}`);
  const method = buf.readUInt16LE(o + 8);
  const compressedSize = buf.readUInt32LE(o + 18);
  const nameLen = buf.readUInt16LE(o + 26);
  const extraLen = buf.readUInt16LE(o + 28);
  const start = o + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported compression method ${method} for ${name}`);
}

const names = [...entries.keys()];
const has = (pred) => names.some(pred);

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

console.log(`Verifying ${file} (target=${target}, ${names.length} entries)\n`);

// 1. The extension entrypoint declared by package.json main.
check('entrypoint dist/extension/index.js present', entries.has('extension/dist/extension/index.js'));

// 2. The webview assets.
check('webview assets present', has((n) => n.startsWith('extension/dist/webview/')));

// 3. Externalized runtime dependencies must ship, or activation throws.
const lancedbPkg = LANCEDB_PACKAGE[target];
check(`lancedb package known for target`, Boolean(lancedbPkg), lancedbPkg ?? 'unmapped target');
if (lancedbPkg) {
  check(
    `native binary for ${lancedbPkg}`,
    has((n) => n.startsWith(`extension/node_modules/${lancedbPkg}/`) && n.endsWith('.node')),
  );
}
check('code-chunk present', has((n) => n.startsWith('extension/node_modules/code-chunk/')));

// 4. The manifest must actually declare the platform we built for.
const manifest = readEntry('extension.vsixmanifest').toString('utf8');
check(
  `manifest declares TargetPlatform="${target}"`,
  manifest.includes(`TargetPlatform="${target}"`),
);

// 5. Foreign prebuilds should have been pruned.
const foreignPrebuild = names.find(
  (n) => /\/prebuilds\/([^/]+)\//.test(n) && !n.includes(`/prebuilds/${target}/`),
);
check('no foreign native prebuilds', !foreignPrebuild, foreignPrebuild ?? '');

// 6. No development artifacts.
check('no coverage/ directory', !has((n) => n.startsWith('extension/coverage/')));
check('no TypeScript sources', !has((n) => n.endsWith('.ts') && !n.endsWith('.d.ts')));

console.log();
if (failures.length) {
  console.error(`${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('vsix looks installable.');
