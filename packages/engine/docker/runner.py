"""Trusted container controller. Never run this runner on the lab host with student files."""
import ast
import contextlib
import inspect
import json
import os
import pathlib
import platform
import runpy
import secrets
import selectors
import shutil
import signal
import subprocess
import sys
import time

RUNNER = "factoryze-hidden-v1"


def child():
    nonce = os.environ.pop("FACTORYZE_CHECK_NONCE")
    # Bind the encoder/writer before importing student modules. Noise and early exits fail closed.
    encode, write = json.dumps, os.write
    passed = False
    try:
        sys.path.insert(0, "/work/student")
        with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            tests = runpy.run_path(str(pathlib.Path("/checks") / sys.argv[2]))
            check = tests[sys.argv[3]]
            if not inspect.isfunction(check):
                raise TypeError("Not a test function")
            check()
            passed = True
    except BaseException:
        pass
    write(1, encode({"nonce": nonce, "passed": passed}).encode())


def check():
    shutil.copytree("/submission", "/work/student")
    for root, dirs, files in os.walk("/work/student"):
        os.chmod(root, 0o700)
        for file in files:
            os.chmod(os.path.join(root, file), 0o600)
    nonce = secrets.token_hex(32)
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1", "FACTORYZE_CHECK_NONCE": nonce}
    process = subprocess.Popen([sys.executable, "-I", __file__, "_child", sys.argv[2], sys.argv[3]],
                               cwd="/work/student", env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    selector.register(process.stderr, selectors.EVENT_READ)
    output = bytearray()
    size, deadline, failed = 0, time.monotonic() + int(sys.argv[4]) / 1000, False
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                failed = True
                break
            for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                data = os.read(key.fileobj.fileno(), 8192)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                size += len(data)
                if size > 65536:
                    failed = True
                    break
                if key.fileobj is process.stdout:
                    output.extend(data)
            if failed:
                break
        remaining = max(0.01, deadline - time.monotonic())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            failed = True
    finally:
        selector.close()
        # A fresh container is removed after every check, including detached descendants.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        process.stdout.close()
        process.stderr.close()
    try:
        result = json.loads(output)
        passed = not failed and process.returncode == 0 and result.get("nonce") == nonce and result.get("passed") is True
    except (ValueError, AttributeError):
        passed = False
    print(json.dumps({"passed": passed}))


def discover():
    checks = []
    for file in sorted(pathlib.Path("/checks").rglob("test_*.py")):
        tree = ast.parse(file.read_text(encoding="utf-8"))
        for node in sorted((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name.startswith("test_")), key=lambda node: node.name):
            checks.append({"file": file.relative_to("/checks").as_posix(), "name": node.name})
    print(json.dumps({"checks": checks}))


def health():
    status = dict(line.split(":", 1) for line in pathlib.Path("/proc/self/status").read_text().splitlines() if ":" in line)
    cgroup = pathlib.Path("/sys/fs/cgroup")
    quota, period = (cgroup / "cpu.max").read_text().split()
    print(json.dumps({"runner": RUNNER, "python": platform.python_version(), "uid": os.getuid(),
                      "capEff": status["CapEff"].strip(), "noNewPrivs": status["NoNewPrivs"].strip(), "seccomp": status["Seccomp"].strip(),
                      "limits": {"memory": int((cgroup / "memory.max").read_text()), "swap": int((cgroup / "memory.swap.max").read_text()),
                                 "pids": int((cgroup / "pids.max").read_text()), "cpuQuota": int(quota), "cpuPeriod": int(period)}}))


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "health":
        health()
    elif mode == "discover":
        discover()
    elif mode == "check":
        check()
    elif mode == "_child":
        child()
    else:
        raise SystemExit("Unknown grading operation")
