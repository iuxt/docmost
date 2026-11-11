#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ $# -ne 0 ]] && { [[ $# -ne 2 ]] || [[ "$1" != "--bump" ]] || [[ ! "$2" =~ ^(patch|minor|major)$ ]]; }; then
  echo "Usage: bash scripts/build-version.sh [--bump patch|minor|major]" >&2
  exit 1
fi

node - "${2:-}" <<'NODE'
const fs = require('node:fs');

const bump = process.argv[2];
const files = ['package.json', 'apps/client/package.json', 'apps/server/package.json'];
const packages = files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }));
const current = packages[0].data.version;

if (!bump) {
  console.log(current);
  process.exit(0);
}

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Bump must be patch, minor, or major');
  process.exit(1);
}

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
  console.error(`Expected a major.minor.patch version, received: ${current}`);
  process.exit(1);
}

let [, major, minor, patch] = match.map(Number);
if (bump === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const version = `${major}.${minor}.${patch}`;
for (const { file, data } of packages) {
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(version);
NODE
