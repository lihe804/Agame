# -*- coding: utf-8 -*-
"""Wrapper for buddy-cloud.py `3d` that feeds a LOCAL image file as base64
in-process (avoids OS command-line length limits for large base64 strings).

Usage:
    echo -n "<token>" | python gen3d.py <image_path> [prompt] [-- extra buddy-cloud args]

stdin line 1: auth token (piped, never on command line)
argv[1]     : local image path
argv[2]     : optional text prompt to accompany the image
remaining   : forwarded to buddy-cloud.py 3d (e.g. --face-count 100000)
"""
import base64
import io
import runpy
import sys

SCRIPT = r"C:\Users\L2301\AppData\Local\Programs\WorkBuddy\resources\app.asar.unpacked\resources\plugins\workbuddy-builtin\skills\buddy-multimodal-generation\scripts\buddy-cloud.py"


def main():
    token = sys.stdin.readline().strip()
    image_path = sys.argv[1]
    prompt = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("-") else ""
    extra = sys.argv[3:] if prompt else sys.argv[2:]

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")

    argv = ["buddy-cloud.py", "3d"]
    if prompt:
        argv.append(prompt)
    argv += ["--image-base64", b64, "--token-stdin", *extra]

    sys.stdin = io.StringIO(token + "\n")
    sys.argv = argv
    runpy.run_path(SCRIPT, run_name="__main__")


if __name__ == "__main__":
    main()
