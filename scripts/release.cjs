const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { config, version } = require('../package.json');

const env = {
  ...process.env,
  IMAGE_PREFIX: process.env.IMAGE_PREFIX || config.image_prefix,
  DEPLOY_HOST: process.env.DEPLOY_HOST || config.deploy_host,
  DEPLOY_DIR: process.env.DEPLOY_DIR || config.deploy_dir,
  ITIER_VERSION: process.env.ITIER_VERSION || version,
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
    '--version', env.ITIER_VERSION,
  ]],
};

const action = process.argv[2];
if (!Object.hasOwn(commands, action)) {
  console.error('Usage: node scripts/release.cjs docker-build|docker-push|deploy [options]');
  process.exit(1);
}

const [command, args] = commands[action];
const result = spawnSync(command, [...args, ...process.argv.slice(3)], {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
