const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { config, version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const env = {
  ...process.env,
  IMAGE_PREFIX: process.env.IMAGE_PREFIX || config.image_prefix,
  DEPLOY_HOST: process.env.DEPLOY_HOST || config.deploy_host,
  DEPLOY_DIR: process.env.DEPLOY_DIR || config.deploy_dir,
  VERSION: process.env.VERSION || version,
  DOCKER_CACHE_DIR: process.env.DOCKER_CACHE_DIR || '.buildx-cache',
};

const commands = {
  'docker-build': ['docker', ['buildx', 'bake', '--load']],
  'docker-push': ['docker', [
    'buildx', 'bake', '--push',
    '--set', 'docmost.output=type=image,oci-mediatypes=false,oci-artifact=false',
  ]],
  deploy: ['python3', [
    'scripts/deploy.py',
    '--host', env.DEPLOY_HOST,
    '--directory', env.DEPLOY_DIR,
    '--image-prefix', env.IMAGE_PREFIX,
    '--version', env.VERSION,
  ]],
};

const action = process.argv[2];
if (!Object.hasOwn(commands, action)) {
  console.error('Usage: node scripts/release.cjs docker-build|docker-push|deploy [options]');
  process.exit(1);
}

// A fresh cache has no index yet. Always export it, but only import once it exists.
if (action === 'docker-build' || action === 'docker-push') {
  const cacheIndex = path.resolve(root, env.DOCKER_CACHE_DIR, 'index.json');
  if (fs.statSync(cacheIndex, { throwIfNoEntry: false })?.isFile()) {
    commands[action][1].push('--set', `docmost.cache-from=type=local,src=${env.DOCKER_CACHE_DIR}`);
  }
}

const commandArgs = [];
let versionArgs;
const options = process.argv.slice(3);
for (let i = 0; i < options.length; i += 1) {
  const [option, ...inlineValue] = options[i].split('=');
  if (action !== 'docker-push' || !['--bump', '--version'].includes(option)) {
    commandArgs.push(options[i]);
    continue;
  }
  const value = inlineValue.length ? inlineValue.join('=') : options[++i];
  if (!value || versionArgs || process.env.VERSION) {
    console.error('Specify one of --bump patch|minor|major, --version x.y.z, or VERSION.');
    process.exit(1);
  }
  versionArgs = [option === '--version' ? '--set' : '--bump', value];
}

// Bump before building so the image tag and the embedded app versions agree.
// Keep explicit tag overrides available for republishing an existing version.
let originalPackages;
if (action === 'docker-push' && !process.env.VERSION) {
  originalPackages = ['package.json', 'apps/client/package.json', 'apps/server/package.json']
    .map((file) => {
      const filename = path.join(root, file);
      return { filename, contents: fs.readFileSync(filename) };
    });
  process.on('exit', (code) => {
    if (code !== 0) {
      for (const { filename, contents } of originalPackages) {
        fs.writeFileSync(filename, contents);
      }
      console.error(`Release failed; restored package versions to ${version}.`);
    }
  });

  const bump = spawnSync('bash', ['scripts/build-version.sh', ...(versionArgs || ['--bump', 'patch'])], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (bump.error) console.error(bump.error.message);
  if (bump.status !== 0) process.exit(bump.status ?? 1);
  env.VERSION = bump.stdout.trim();
  console.log(`Release version: ${version} -> ${env.VERSION}`);
}

const [command, args] = commands[action];
const result = spawnSync(command, [...args, ...commandArgs], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
