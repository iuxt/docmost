#!/usr/bin/env python3
"""Update an existing remote Docmost Compose or Nebula deployment over SSH."""

import argparse
import shlex
import subprocess
import textwrap


UPDATE_IMAGE_ENV = textwrap.dedent("""\
    import os
    import re
    import shlex
    import stat
    import sys
    import tempfile
    from pathlib import Path

    path = Path('.env').resolve()
    contents = path.read_text()
    for key, value in zip(('IMAGE_NAME', 'IMAGE_VERSION'), sys.argv[1:]):
        pattern = re.compile(r'(?m)^[ \\t]*(?:export[ \\t]+)?' + key + r'[ \\t]*=.*$')
        replacement = key + '=' + shlex.quote(value)
        if pattern.search(contents):
            contents = pattern.sub(lambda match: replacement, contents)
        else:
            if contents and not contents.endswith('\\n'):
                contents += '\\n'
            contents += replacement + '\\n'
    metadata = path.stat()
    fd, temporary = tempfile.mkstemp(prefix='.env.deploy-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(output.fileno(), stat.S_IMODE(metadata.st_mode))
            output.write(contents)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
""")


def build_remote_script(args):
    image_name = f"{args.image_prefix}/docmost"
    update_env = (
        f"python3 - {shlex.quote(image_name)} {shlex.quote(args.version)} <<'DOCMOST_IMAGE_ENV'\n"
        f"{UPDATE_IMAGE_ENV}DOCMOST_IMAGE_ENV"
    )
    return "\n".join([
        "set -eu",
        f"cd {shlex.quote(args.directory)}",
        f"export IMAGE_PREFIX={shlex.quote(args.image_prefix)}",
        f"export VERSION={shlex.quote(args.version)}",
        "if [ -f compose.yaml ] || [ -f compose.yml ] || "
        "[ -f docker-compose.yaml ] || [ -f docker-compose.yml ]; then",
        "  docker compose config --quiet",
        "  docker compose pull docmost",
        "  docker compose up -d --no-deps docmost",
        "elif [ -f run.sh ] && [ -f ../public/app.sh ] && "
        "[ -f ../public/image_config.py ]; then",
        "  if [ ! -f .env ]; then",
        "    printf '%s\\n' 'Deployment requires an existing .env file in the Nebula service directory.' >&2",
        "    exit 1",
        "  fi",
        # Pull first so a missing tag or registry failure leaves configuration intact.
        f"  docker pull {shlex.quote(image_name + ':' + args.version)}",
        update_env,
        "  bash ./run.sh",
        "else",
        "  printf '%s\\n' \"No Compose file or supported Nebula run.sh deployment found in $(pwd). Check DEPLOY_DIR.\" >&2",
        "  exit 1",
        "fi",
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="SSH destination, e.g. user@server")
    parser.add_argument("--directory", required=True, help="Remote Compose or Nebula service directory")
    parser.add_argument("--image-prefix", required=True, help="Image registry/namespace")
    parser.add_argument("--version", required=True, help="Image tag to deploy")
    parser.add_argument("--dry-run", action="store_true", help="Print the SSH command without executing it")
    args = parser.parse_args()

    for name in ("host", "directory", "image_prefix", "version"):
        if not getattr(args, name).strip():
            parser.error(f"--{name.replace('_', '-')} must not be empty")
    if args.host.startswith("-") or any(char.isspace() for char in args.host):
        parser.error("--host must be an SSH destination without options or whitespace")

    remote_script = build_remote_script(args)
    command = ["ssh", "--", args.host, f"sh -c {shlex.quote(remote_script)}"]
    if args.dry_run:
        print(shlex.join(command))
        return

    try:
        subprocess.run(command, check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Deployment failed: {error}\n")


if __name__ == "__main__":
    main()
