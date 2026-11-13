import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

from deploy import build_remote_script


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / "service ' with spaces"
        self.directory.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'commands.log'
        docker = self.bin / 'docker'
        docker.write_text(
            '#!/bin/sh\n'
            'printf "%s|%s|%s\\n" "$VERSION" "$IMAGE_PREFIX" "$*" >> "$DEPLOY_TEST_LOG"\n'
            'if [ "${DEPLOY_TEST_PULL_FAIL:-0}" = 1 ]; then\n'
            '  case "$*" in pull\\ *|compose\\ pull\\ *) exit 17 ;; esac\n'
            'fi\n'
        )
        docker.chmod(0o755)
        self.args = SimpleNamespace(
            directory=str(self.directory),
            image_prefix='registry.example/team',
            version='1.2.3',
        )

    def run_deploy(self, **extra_env):
        return subprocess.run(
            ['sh', '-c', build_remote_script(self.args)],
            env={**os.environ, 'PATH': f'{self.bin}:{os.environ["PATH"]}',
                 'DEPLOY_TEST_LOG': str(self.log), **extra_env},
            capture_output=True, text=True,
        )

    def create_nebula(self):
        public = self.root / 'public'
        public.mkdir()
        for name in ['app.sh', 'image_config.py']:
            (public / name).touch()
        (self.directory / 'run.sh').write_text(
            '#!/bin/bash\nprintf "run\\n" >> "$DEPLOY_TEST_LOG"\n'
        )

    def test_compose_uses_version_and_updates_only_docmost(self):
        for filename in ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']:
            with self.subTest(filename=filename):
                config = self.directory / filename
                config.touch()
                result = self.run_deploy()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.log.read_text().splitlines(), [
                    '1.2.3|registry.example/team|compose config --quiet',
                    '1.2.3|registry.example/team|compose pull docmost',
                    '1.2.3|registry.example/team|compose up -d --no-deps docmost',
                ])
                config.unlink()
                self.log.unlink()

    def test_nebula_pulls_then_updates_only_image_settings(self):
        self.create_nebula()
        env_file = self.directory / '.env'
        env_file.write_text(
            '# deployment\nIMAGE_NAME=old/image\nexport IMAGE_VERSION=old # previous release\n'
            'APP_SECRET="preserve this value"\nDATABASE_URL=postgresql://existing/db\n'
        )
        env_file.chmod(0o600)
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(env_file.read_text(),
                         '# deployment\nIMAGE_NAME=registry.example/team/docmost\nIMAGE_VERSION=1.2.3\n'
                         'APP_SECRET="preserve this value"\nDATABASE_URL=postgresql://existing/db\n')
        self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.log.read_text().splitlines(), [
            '1.2.3|registry.example/team|pull registry.example/team/docmost:1.2.3', 'run',
        ])

    def test_nebula_appends_missing_image_settings(self):
        self.create_nebula()
        env_file = self.directory / '.env'
        env_file.write_text('APP_URL=https://example.test')
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(env_file.read_text(),
                         'APP_URL=https://example.test\nIMAGE_NAME=registry.example/team/docmost\n'
                         'IMAGE_VERSION=1.2.3\n')

    def test_pull_failure_preserves_configuration_and_does_not_restart(self):
        self.create_nebula()
        env_file = self.directory / '.env'
        original = 'IMAGE_NAME=old/image\nIMAGE_VERSION=old\n'
        env_file.write_text(original)
        result = self.run_deploy(DEPLOY_TEST_PULL_FAIL='1')
        self.assertEqual(result.returncode, 17)
        self.assertEqual(env_file.read_text(), original)
        self.assertNotIn('\nrun\n', self.log.read_text())

    def test_nebula_preserves_env_symlink(self):
        self.create_nebula()
        target = self.root / 'service.env'
        target.write_text('IMAGE_NAME=old/image\nIMAGE_VERSION=old\n')
        target.chmod(0o600)
        env_file = self.directory / '.env'
        env_file.symlink_to(target)
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(env_file.is_symlink())
        self.assertEqual(target.read_text(),
                         'IMAGE_NAME=registry.example/team/docmost\nIMAGE_VERSION=1.2.3\n')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.root.glob('.env.deploy-*')), [])

    def test_missing_env_does_not_pull_or_restart(self):
        self.create_nebula()
        result = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('existing .env', result.stderr)
        self.assertFalse(self.log.exists())

    def test_missing_deployment_reports_directory_without_running_docker(self):
        result = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Check DEPLOY_DIR', result.stderr)
        self.assertIn(str(self.directory), result.stderr)
        self.assertFalse(self.log.exists())

    def test_unrecognized_run_script_is_not_executed(self):
        (self.directory / 'run.sh').write_text('exit 55\n')
        result = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('supported Nebula', result.stderr)
        self.assertFalse(self.log.exists())


if __name__ == '__main__':
    unittest.main()
