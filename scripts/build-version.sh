#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ $# -ne 0 ]] && { [[ $# -ne 2 ]] || [[ "$1" != "--bump" && "$1" != "--set" ]]; }; then
  echo "Usage: bash scripts/build-version.sh [--bump patch|minor|major | --set x.y.z]" >&2
  exit 1
fi

node - "$@" <<'NODE'
const fs = require('node:fs');

const [operation, value] = process.argv.slice(2);
const files = ['package.json', 'apps/client/package.json', 'apps/server/package.json'];
const packages = files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }));
const current = packages[0].data.version;

if (!operation) {
  console.log(current);
  process.exit(0);
}

if (operation === '--bump' && !['patch', 'minor', 'major'].includes(value)) {
  console.error('Bump must be patch, minor, or major');
  process.exit(1);
}

const input = operation === '--set' ? value : current;
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(input);
if (!match) {
  console.error(`Expected an x.y.z version, received: ${input}`);
  process.exit(1);
}

let [major, minor, patch] = match.slice(1).map(Number);
if (operation === '--bump' && value === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (operation === '--bump' && value === 'minor') {
  minor += 1;
  patch = 0;
} else if (operation === '--bump') {
  patch += 1;
}

if (![major, minor, patch].every(Number.isSafeInteger)) {
  console.error('Version components must be safe integers');
  process.exit(1);
}

const version = `${major}.${minor}.${patch}`;
for (const { file, data } of packages) {
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
console.log(version);
NODE
