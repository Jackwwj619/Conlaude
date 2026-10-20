#!/usr/bin/env python3
"""Constrained remote helper for Claude Local Bridge.

The helper never evaluates shell input and does not listen on a network port.
It emits one JSON object per line on stdout; diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import shlex
import stat
import subprocess
import sys
import time
import tempfile
from pathlib import Path
from typing import Any, Iterable

VERSION = "1.4.1"
SESSION_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,128}$")
CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
BRIDGE_DIRECTORY = Path.home() / ".local" / "share" / "claude-local-bridge"
MAPPING_FILE = BRIDGE_DIRECTORY / "session-map.json"


def emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def fail(message: str, exit_code: int = 2) -> None:
    print(message, file=sys.stderr, flush=True)
    raise SystemExit(exit_code)


def validate_session_name(value: str) -> str:
    if not SESSION_RE.fullmatch(value):
        fail("Invalid tmux session name")
    return value


def validate_session_id(value: str) -> str:
    if not SESSION_ID_RE.fullmatch(value):
        fail("Invalid Claude session id")
    return value


def resolve_existing_directory(value: str) -> Path:
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_dir():
        fail("Working directory is not a directory")
    if "\x00" in str(path):
        fail("Invalid working directory")
    return path


def run_checked(args: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        fail(f"Command failed: {type(error).__name__}")


def read_session_map() -> dict[str, dict[str, Any]]:
    try:
        value = json.loads(MAPPING_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_session_map(value: dict[str, dict[str, Any]]) -> None:
    BRIDGE_DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = MAPPING_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(MAPPING_FILE)


def tmux_lines(format_string: str) -> Iterable[str]:
    result = run_checked(["tmux", "list-panes", "-a", "-F", format_string])
    if result.returncode != 0:
        if "no server running" in result.stderr.lower():
            return []
        fail(result.stderr.strip() or "Unable to query tmux")
    return result.stdout.splitlines()


def is_claude_pane(
    session_name: str,
    command: str,
    pane_pid: int,
    session_map: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """Identify Claude even when it changes argv[0] to its version number."""
    mappings = session_map if session_map is not None else read_session_map()
    mapped_id = mappings.get(session_name, {}).get("sessionId")
    if isinstance(mapped_id, str) and SESSION_ID_RE.fullmatch(mapped_id):
        return True
    if "claude" in command.casefold():
        return True
    try:
        command_line = (Path("/proc") / str(pane_pid) / "cmdline").read_bytes()
    except OSError:
        return False
    return "claude" in command_line.replace(b"\x00", b" ").decode(
        "utf-8", errors="replace"
    ).casefold()


def command_health(args: argparse.Namespace) -> None:
    claude_path = Path(args.claude_path).expanduser()
    emit(
        {
            "ok": True,
            "bridgeVersion": VERSION,
            "pythonVersion": sys.version.split()[0],
            "tmuxPath": shutil.which("tmux"),
            "claudePath": str(claude_path) if claude_path.is_file() else shutil.which("claude"),
            "projectsPath": str(CLAUDE_PROJECTS),
            "projectsReadable": CLAUDE_PROJECTS.is_dir() and os.access(CLAUDE_PROJECTS, os.R_OK),
        }
    )


def command_list_sessions(_: argparse.Namespace) -> None:
    seen: dict[str, dict[str, Any]] = {}
    session_map = read_session_map()
    fmt = "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_tty}"
    for line in tmux_lines(fmt):
        fields = line.split("\t")
        if len(fields) < 8:
            continue
        name, windows, attached, created, pane_pid, command, cwd, tty = fields[:8]
        if name in seen:
            continue
        seen[name] = {
            "name": name,
            "windows": int(windows or 0),
            "attachedClients": int(attached or 0),
            "createdAt": int(created or 0),
            "currentCommand": command,
            "currentPath": cwd,
            "paneTty": tty,
            "isClaude": is_claude_pane(name, command, int(pane_pid or 0), session_map),
        }
    clients = run_checked(["tmux", "list-clients", "-F", "#{session_name}"])
    if clients.returncode == 0:
        counts: dict[str, int] = {}
        for session_name in clients.stdout.splitlines():
            counts[session_name] = counts.get(session_name, 0) + 1
        for session_name, session in seen.items():
            session["attachedClients"] = counts.get(session_name, 0)
    emit({"sessions": list(seen.values()), "bridgeVersion": VERSION})


def inspect_session(name: str) -> dict[str, Any]:
    validate_session_name(name)
    fmt = "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_tty}"
    result = run_checked(["tmux", "display-message", "-p", "-t", f"={name}:0.0", fmt])
    if result.returncode != 0:
        fail(result.stderr.strip() or "tmux session not found", 4)
    fields = result.stdout.rstrip("\n").split("\t")
    if len(fields) < 8:
        fail("Unexpected tmux response")
    clients = run_checked(["tmux", "list-clients", "-t", f"={name}", "-F", "#{client_tty}"])
    return {
        "name": fields[0],
        "windows": int(fields[1] or 0),
        "attachedClients": int(fields[2] or 0),
        "createdAt": int(fields[3] or 0),
        "panePid": int(fields[4] or 0),
        "currentCommand": fields[5],
        "currentPath": fields[6],
        "paneTty": fields[7],
        "isClaude": is_claude_pane(fields[0], fields[5], int(fields[4] or 0)),
        "clientTtys": clients.stdout.splitlines() if clients.returncode == 0 else [],
    }


def command_inspect_session(args: argparse.Namespace) -> None:
    emit({"session": inspect_session(args.name), "bridgeVersion": VERSION})


def jsonl_candidates(cwd: str | None = None) -> list[dict[str, Any]]:
    if not CLAUDE_PROJECTS.is_dir():
        return []
    wanted_cwd = str(Path(cwd).expanduser().resolve()) if cwd else None
    candidates: list[dict[str, Any]] = []
    for path in CLAUDE_PROJECTS.glob("**/*.jsonl"):
        if "subagents" in path.parts:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        cwd_match = wanted_cwd is None
        if wanted_cwd:
            try:
                with path.open("r", encoding="utf-8", errors="replace") as handle:
                    for _ in range(30):
                        line = handle.readline()
                        if not line:
                            break
                        if wanted_cwd in line:
                            cwd_match = True
                            break
            except OSError:
                pass
        if cwd_match:
            candidates.append(
                {
                    "sessionId": path.stem,
                    "path": str(path),
                    "modifiedAt": stat.st_mtime,
                    "bytes": stat.st_size,
                }
            )
    candidates.sort(key=lambda item: item["modifiedAt"], reverse=True)
    return candidates


def transcript_candidate(session_id: str) -> dict[str, Any] | None:
    validate_session_id(session_id)
    matches = [
        path
        for path in CLAUDE_PROJECTS.glob(f"**/{session_id}.jsonl")
        if "subagents" not in path.parts
    ]
    if not matches:
        return None
    matches.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    path = matches[0]
    stat = path.stat()
    return {
        "sessionId": path.stem,
        "path": str(path),
        "modifiedAt": stat.st_mtime,
        "bytes": stat.st_size,
    }


def process_session_id(session_name: str) -> str | None:
    result = run_checked(
        ["tmux", "display-message", "-p", "-t", f"={session_name}:0.0", "#{pane_pid}"]
    )
    if result.returncode != 0:
        return None
    try:
        pane_pid = int(result.stdout.strip())
        arguments = (Path("/proc") / str(pane_pid) / "cmdline").read_bytes().split(b"\x00")
    except (OSError, ValueError):
        return None
    decoded = [argument.decode("utf-8", errors="replace") for argument in arguments if argument]
    for flag in ("--session-id", "--resume"):
        try:
            value = decoded[decoded.index(flag) + 1]
        except (ValueError, IndexError):
            continue
        if SESSION_ID_RE.fullmatch(value) and (
            flag == "--session-id" or transcript_candidate(value) is not None
        ):
            return value
    return None


def command_discover_transcript(args: argparse.Namespace) -> None:
    session_name = validate_session_name(args.session_name)
    session_map = read_session_map()
    mapped_id = session_map.get(session_name, {}).get("sessionId")
    mapping = session_map.get(session_name, {})
    binding_id = mapping.get("bindingId")
    live_id = read_live_binding(binding_id) if isinstance(binding_id, str) else None
    if live_id:
        candidate = transcript_candidate(live_id)
        emit({"candidates": [candidate] if candidate else [], "boundSessionId": live_id,
              "binding": "mapping", "liveBinding": True, "bridgeVersion": VERSION})
        return
    if mapping.get("requireLive") or binding_id:
        emit({"candidates": [], "binding": "mapping", "liveBinding": False, "bridgeVersion": VERSION})
        return
    bound_id = mapped_id if isinstance(mapped_id, str) else process_session_id(session_name)
    if isinstance(bound_id, str) and SESSION_ID_RE.fullmatch(bound_id):
        candidate = transcript_candidate(bound_id)
        emit(
            {
                "candidates": [candidate] if candidate else [],
                "boundSessionId": bound_id,
                "binding": "mapping" if bound_id == mapped_id else "process-argument",
                "waitingForTranscript": candidate is None,
                "bridgeVersion": VERSION,
            }
        )
        return

    claimed_ids = {
        item.get("sessionId")
        for name, item in session_map.items()
        if name != session_name and isinstance(item, dict)
    }
    candidates = [
        candidate
        for candidate in jsonl_candidates(args.cwd)
        if candidate["sessionId"] not in claimed_ids
    ][:20]
    emit({"candidates": candidates, "binding": "heuristic", "bridgeVersion": VERSION})


def find_session_file(session_id: str, wait_for_file: bool = False) -> Path:
    validate_session_id(session_id)
    while True:
        matches = [
            path
            for path in CLAUDE_PROJECTS.glob(f"**/{session_id}.jsonl")
            if "subagents" not in path.parts
        ]
        if matches:
            matches.sort(key=lambda path: path.stat().st_mtime, reverse=True)
            return matches[0]
        if not wait_for_file:
            fail("Claude transcript not found", 4)
        time.sleep(0.25)


def command_watch_transcript(args: argparse.Namespace) -> None:
    path = find_session_file(args.session_id, args.wait_for_file)
    offset = max(0, args.offset)
    with path.open("rb") as handle:
        size = path.stat().st_size
        if offset > size:
            offset = 0
            emit({"sessionId": args.session_id, "offset": 0, "reset": True})
        handle.seek(offset)
        while True:
            start = handle.tell()
            line = handle.readline()
            if line:
                if not line.endswith(b"\n"):
                    handle.seek(start)
                    time.sleep(0.15)
                    continue
                end = handle.tell()
                try:
                    event = json.loads(line.decode("utf-8"))
                    emit(
                        {
                            "bridgeVersion": VERSION,
                            "sessionId": args.session_id,
                            "offset": end,
                            "event": event,
                        }
                    )
                except (UnicodeDecodeError, json.JSONDecodeError):
                    emit(
                        {
                            "bridgeVersion": VERSION,
                            "sessionId": args.session_id,
                            "offset": end,
                            "parseError": True,
                        }
                    )
                continue

            if args.once:
                break
            time.sleep(0.25)
            try:
                if path.stat().st_size < handle.tell():
                    handle.seek(0)
                    emit({"sessionId": args.session_id, "offset": 0, "reset": True})
            except OSError:
                fail("Claude transcript became unavailable", 4)


def read_live_binding(binding_id: str) -> str | None:
    validate_session_id(binding_id)
    try:
        value = json.loads((BRIDGE_DIRECTORY / "bindings" / f"{binding_id}.json").read_text(encoding="utf-8"))
        session_id = value.get("sessionId")
        return session_id if isinstance(session_id, str) and SESSION_ID_RE.fullmatch(session_id) else None
    except (OSError, ValueError, AttributeError):
        return None


def command_session_hook(args: argparse.Namespace) -> None:
    # Consume only the identifier. Never persist prompt, cwd, environment or hook output.
    binding_id = validate_session_id(args.binding_id)
    payload = json.loads(sys.stdin.read(1048576))
    if payload.get("hook_event_name") != "SessionStart":
        return
    session_id = validate_session_id(payload["session_id"])
    directory = BRIDGE_DIRECTORY / "bindings"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as handle:
        json.dump({"sessionId": session_id}, handle)
        temporary = Path(handle.name)
    temporary.chmod(0o600)
    temporary.replace(directory / f"{binding_id}.json")


def command_prepare_native(args: argparse.Namespace) -> None:
    name = validate_session_name(args.name)
    mappings = read_session_map()
    mapping = mappings.setdefault(name, {})
    mapping["requireLive"] = True
    write_session_map(mappings)
    emit({"prepared": True})


def session_hook_settings(session_id: str) -> str:
    hook = " ".join(shlex.quote(part) for part in [
        "python3", str(Path(__file__).resolve()), "session-hook", "--binding-id", session_id
    ])
    return json.dumps({"hooks": {"SessionStart": [{"hooks": [
        {"type": "command", "command": hook, "timeout": 5}
    ]}]}})


def claude_launch_args(command: str, session_id: str, name: str, track_session: bool = False) -> list[str]:
    executable = os.path.expanduser(command.strip())
    if "\x00" in executable or not executable:
        fail("Invalid Claude executable path")
    arguments = ["--session-id", session_id, "--name", name]
    if track_session:
        arguments += ["--settings", session_hook_settings(session_id)]
    if "/" in executable:
        return [executable, *arguments]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", executable):
        fail("Use an executable path or a single shell command name")
    # Users often configure cc as a Bash alias. Only a validated command name
    # enters the fixed shell expression; all arguments remain positional values.
    return ["bash", "-lic", f'{executable} "$@"', "claude-local-bridge", *arguments]


def command_create_session(args: argparse.Namespace) -> None:
    name = validate_session_name(args.name)
    cwd = resolve_existing_directory(args.cwd)
    session_id = validate_session_id(args.session_id)
    if run_checked(["tmux", "has-session", "-t", f"={name}"]).returncode == 0:
        fail("tmux session already exists", 5)

    command = [
        "tmux",
        "new-session",
        "-d",
        "-s",
        name,
        "-c",
        str(cwd),
        *claude_launch_args(args.claude_path, session_id, name, track_session=True),
    ]
    result = run_checked(command, timeout=20.0)
    if result.returncode != 0:
        fail(result.stderr.strip() or "Unable to create tmux session")
    session_map = read_session_map()
    session_map[name] = {
        "sessionId": session_id,
        "bindingId": session_id,
        "cwd": str(cwd),
        "createdAt": time.time(),
    }
    write_session_map(session_map)
    time.sleep(0.35)
    emit({"session": inspect_session(name), "sessionId": session_id, "bridgeVersion": VERSION})


def command_terminate_session(args: argparse.Namespace) -> None:
    name = validate_session_name(args.name)
    result = run_checked(["tmux", "kill-session", "-t", f"={name}"])
    if result.returncode != 0:
        fail(result.stderr.strip() or "Unable to terminate tmux session")
    session_map = read_session_map()
    if name in session_map:
        session_map.pop(name)
        write_session_map(session_map)
    emit({"terminated": True, "name": name, "bridgeVersion": VERSION})


def command_rename_session(args: argparse.Namespace) -> None:
    name = validate_session_name(args.name)
    new_name = validate_session_name(args.new_name)
    if run_checked(["tmux", "has-session", "-t", f"={new_name}"]).returncode == 0:
        fail("Target tmux session name already exists", 5)
    result = run_checked(["tmux", "rename-session", "-t", f"={name}", new_name])
    if result.returncode != 0:
        fail(result.stderr.strip() or "Unable to rename tmux session")
    session_map = read_session_map()
    if name in session_map:
        session_map[new_name] = session_map.pop(name)
        write_session_map(session_map)
    emit({"session": inspect_session(new_name), "bridgeVersion": VERSION})


MAX_TEXT_BYTES = 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_DIRECTORY_ENTRIES = 2000


def image_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def file_snapshot(path: Path, allow_images: bool = False) -> tuple[bytes, os.stat_result, str]:
    # Reject special files before opening (a FIFO must never block the helper).
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("NOT_TEXT")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("NOT_TEXT")
        prefix = stream.read(16)
        is_image = allow_images and image_mime(prefix) is not None
        limit = MAX_IMAGE_BYTES if is_image else MAX_TEXT_BYTES
        if info.st_size > limit:
            raise ValueError("IMAGE_TOO_LARGE" if is_image else "TOO_LARGE")
        data = prefix + stream.read(limit + 1 - len(prefix))
        after = os.fstat(stream.fileno())
    if len(data) > limit:
        raise ValueError("IMAGE_TOO_LARGE" if is_image else "TOO_LARGE")
    if (info.st_mtime_ns, info.st_ctime_ns, info.st_size) != (after.st_mtime_ns, after.st_ctime_ns, after.st_size):
        raise ValueError("CONFLICT")
    identity = f"{info.st_dev}:{info.st_ino}:{info.st_mtime_ns}:{info.st_ctime_ns}:{info.st_mode}:{info.st_uid}:{info.st_gid}"
    version = hashlib.sha256(identity.encode() + b"\0" + data).hexdigest()
    return data, info, version


def text_file_result(path: Path, snapshot=None) -> dict[str, Any]:
    data, info, version = snapshot or file_snapshot(path)
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("NOT_TEXT")
    if any(ord(char) < 32 and char not in "\t\r\n" for char in content):
        raise ValueError("NOT_TEXT")
    crlf = content.count("\r\n")
    mixed = "\r" in content.replace("\r\n", "") or (crlf > 0 and content.count("\n") != crlf)
    ending = "mixed" if mixed else "CRLF" if crlf else "LF"
    return {"path": str(path), "content": content.replace("\r\n", "\n"),
            "version": version, "writable": os.access(path, os.W_OK) and info.st_nlink == 1 and not mixed,
            "lineEnding": ending}


def remote_file_operation(operation: str, request: dict[str, Any]) -> dict[str, Any]:
    raw_path = request.get("path")
    if not isinstance(raw_path, str) or not raw_path or len(raw_path) > 4096 or "\0" in raw_path:
        raise ValueError("INVALID_PATH")
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        raise ValueError("INVALID_PATH")
    if operation == "list":
        path = path.resolve(strict=True)
        entries = []
        truncated = False
        with os.scandir(path) as directory:
            for item in directory:
                if len(entries) >= MAX_DIRECTORY_ENTRIES:
                    truncated = True
                    break
                try:
                    info = item.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                kind = "symlink" if item.is_symlink() else "directory" if stat.S_ISDIR(info.st_mode) else "file" if stat.S_ISREG(info.st_mode) else "other"
                entries.append({"name": item.name, "path": str(path / item.name), "kind": kind,
                                "size": info.st_size, "modified": info.st_mtime * 1000})
        entries.sort(key=lambda item: (item["kind"] != "directory", item["name"].casefold()))
        return {"path": str(path), "parent": str(path.parent), "entries": entries, "truncated": truncated}
    # Symlink files are deliberately not edited; callers can navigate their actual directory.
    if path.is_symlink():
        raise ValueError("SYMLINK")
    path = path.resolve(strict=True)
    snapshot = file_snapshot(path, allow_images=True) if operation == "read" else file_snapshot(path)
    mime = image_mime(snapshot[0])
    if mime and operation == "save":
        raise ValueError("READ_ONLY")
    if operation == "read" and mime:
        data, _, version = snapshot
        return {"kind": "image", "path": str(path), "version": version, "writable": False,
                "mime": mime, "bytes": len(data),
                "dataUrl": "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")}
    original = text_file_result(path, snapshot)
    if operation == "read":
        return original
    if operation != "save":
        raise ValueError("INVALID_REQUEST")
    if request.get("version") != original["version"]:
        raise ValueError("CONFLICT")
    if not original["writable"]:
        raise ValueError("READ_ONLY")
    content = request.get("content")
    if not isinstance(content, str) or any(ord(c) < 32 and c not in "\t\r\n" for c in content):
        raise ValueError("NOT_TEXT")
    content = content.replace("\r\n", "\n")
    if original["lineEnding"] == "CRLF":
        content = content.replace("\n", "\r\n")
    data = content.encode("utf-8")
    if len(data) > MAX_TEXT_BYTES:
        raise ValueError("TOO_LARGE")
    _, info, _ = snapshot
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".conlaude-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            if hasattr(os, "fchown"):
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.chmod(temporary, stat.S_IMODE(info.st_mode))
        if file_snapshot(path)[2] != original["version"]:
            raise ValueError("CONFLICT")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return text_file_result(path)


def command_files(args: argparse.Namespace) -> None:
    try:
        raw = sys.stdin.buffer.read(MAX_TEXT_BYTES * 6 + 16385)
        if len(raw) > MAX_TEXT_BYTES * 6 + 16384:
            raise ValueError("TOO_LARGE")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("INVALID_REQUEST")
        emit({"ok": True, "value": remote_file_operation(args.operation, request)})
    except PermissionError:
        emit({"ok": False, "error": "PERMISSION"})
    except FileNotFoundError:
        emit({"ok": False, "error": "NOT_FOUND"})
    except NotADirectoryError:
        emit({"ok": False, "error": "NOT_DIRECTORY"})
    except (ValueError, OSError) as error:
        emit({"ok": False, "error": str(error) if isinstance(error, ValueError) else "IO_ERROR"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bridge_agent.py")
    subparsers = parser.add_subparsers(dest="command", required=True)
    files = subparsers.add_parser("files")
    files.add_argument("operation", choices=["list", "read", "save"])
    files.set_defaults(handler=command_files)

    health = subparsers.add_parser("health")
    health.add_argument("--claude-path", required=True)
    health.set_defaults(handler=command_health)

    sessions = subparsers.add_parser("list-sessions")
    sessions.set_defaults(handler=command_list_sessions)

    inspect = subparsers.add_parser("inspect-session")
    inspect.add_argument("--name", required=True)
    inspect.set_defaults(handler=command_inspect_session)

    discover = subparsers.add_parser("discover-transcript")
    hook = subparsers.add_parser("session-hook")
    hook.add_argument("--binding-id", required=True)
    hook.set_defaults(handler=command_session_hook)
    prepare = subparsers.add_parser("prepare-native")
    prepare.add_argument("--name", required=True)
    prepare.set_defaults(handler=command_prepare_native)
    discover.add_argument("--session-name", required=True)
    discover.add_argument("--cwd", required=True)
    discover.set_defaults(handler=command_discover_transcript)

    watch = subparsers.add_parser("watch-transcript")
    watch.add_argument("--session-id", required=True)
    watch.add_argument("--offset", type=int, default=0)
    watch.add_argument("--once", action="store_true")
    watch.add_argument("--wait-for-file", action="store_true")
    watch.set_defaults(handler=command_watch_transcript)

    create = subparsers.add_parser("create-session")
    create.add_argument("--name", required=True)
    create.add_argument("--cwd", required=True)
    create.add_argument("--claude-path", default="claude")
    create.add_argument("--session-id", required=True)
    create.set_defaults(handler=command_create_session)

    terminate = subparsers.add_parser("terminate-session")
    terminate.add_argument("--name", required=True)
    terminate.set_defaults(handler=command_terminate_session)

    rename = subparsers.add_parser("rename-session")
    rename.add_argument("--name", required=True)
    rename.add_argument("--new-name", required=True)
    rename.set_defaults(handler=command_rename_session)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
