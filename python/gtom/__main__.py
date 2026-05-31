"""Launcher for the gtom CLI.

`pip install gtom` installs this Python wrapper plus a self-contained,
esbuild-produced JavaScript bundle of the gtom CLI. This module locates the
user's Node.js runtime and executes the bundle, forwarding all arguments,
stdio, and the exit code.

Node.js >= 18 is a documented runtime prerequisite (gtom is a JS tool).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

NODE_MIN_MAJOR = 18
_NODE_HELP = (
    "gtom requires Node.js >= {min} — install it from https://nodejs.org/"
).format(min=NODE_MIN_MAJOR)


def _bundle_path() -> str:
    """Return the absolute path to the bundled CLI JavaScript file."""
    try:
        from importlib.resources import files

        return str(files("gtom").joinpath("_bundle", "gtom.cli.js"))
    except Exception:
        # Fallback for very old environments / edge cases.
        return os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "_bundle",
            "gtom.cli.js",
        )


def _check_node_version(node: str) -> None:
    """Warn (do not hard-fail) if Node is older than the supported major."""
    try:
        out = subprocess.run(
            [node, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        raw = (out.stdout or out.stderr).strip().lstrip("v")
        major = int(raw.split(".")[0])
        if major < NODE_MIN_MAJOR:
            print(
                "gtom: warning: detected Node.js v{found}; gtom needs >= {min}. "
                "The CLI may not work correctly.".format(
                    found=raw, min=NODE_MIN_MAJOR
                ),
                file=sys.stderr,
            )
    except Exception:
        # Version probing is best-effort; never block execution on it.
        pass


def main() -> int:
    node = shutil.which("node")
    if not node:
        print(_NODE_HELP, file=sys.stderr)
        return 1

    _check_node_version(node)

    bundle = _bundle_path()
    if not os.path.isfile(bundle):
        print(
            "gtom: internal error: bundled CLI not found at {p}".format(p=bundle),
            file=sys.stderr,
        )
        return 1

    args = [node, bundle, *sys.argv[1:]]

    # On POSIX, exec replaces this process so signals/exit codes pass through
    # cleanly. On Windows, execvp does not behave the same way (it spawns and
    # the parent exits immediately), so use subprocess and propagate the code.
    if os.name == "posix":
        os.execvp(node, args)
        # Unreachable unless exec fails.
        return 1

    try:
        proc = subprocess.run(args)
        return proc.returncode
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
