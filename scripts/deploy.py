#!/usr/bin/env python3
"""Update Docmost in an existing remote Docker Compose deployment over SSH."""

import argparse
import shlex
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="SSH destination, e.g. user@server")
    parser.add_argument("--directory", required=True, help="Remote Docker Compose directory")
    parser.add_argument("--image-prefix", required=True, help="Image registry/namespace")
    parser.add_argument("--version", required=True, help="Image tag to deploy")
    parser.add_argument("--dry-run", action="store_true", help="Print the SSH command without executing it")
    args = parser.parse_args()

    for name in ("host", "directory", "image_prefix", "version"):
        if not getattr(args, name).strip():
            parser.error(f"--{name.replace('_', '-')} must not be empty")
    if args.host.startswith("-") or any(char.isspace() for char in args.host):
        parser.error("--host must be an SSH destination without options or whitespace")

    remote_script = "\n".join([
        "set -eu",
        f"cd {shlex.quote(args.directory)}",
        f"export IMAGE_PREFIX={shlex.quote(args.image_prefix)}",
        f"export ITIER_VERSION={shlex.quote(args.version)}",
        "docker compose pull docmost",
        "docker compose up -d --no-deps docmost",
    ])
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
