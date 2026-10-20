import importlib.util
import io
import json
import pathlib
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("bridge_agent", ROOT / "remote" / "bridge_agent.py")
assert SPEC and SPEC.loader
bridge_agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge_agent)


class BridgeAgentTests(unittest.TestCase):
    def test_session_hook_tracks_resume_without_recording_input_or_environment(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(bridge_agent, "BRIDGE_DIRECTORY", pathlib.Path(directory)):
            payload = {"hook_event_name": "SessionStart", "session_id": "new-session", "cwd": "/private", "prompt": "secret"}
            with mock.patch.object(bridge_agent.sys, "stdin", io.StringIO(json.dumps(payload))):
                bridge_agent.command_session_hook(SimpleNamespace(binding_id="original-session"))
            self.assertEqual(bridge_agent.read_live_binding("original-session"), "new-session")
            self.assertEqual(json.loads((pathlib.Path(directory) / "bindings/original-session.json").read_text()), {"sessionId": "new-session"})

    def test_live_session_binding_overrides_original_launch_mapping(self):
        output = io.StringIO()
        with mock.patch.object(bridge_agent, "read_session_map", return_value={"work": {"sessionId": "old", "bindingId": "original"}}), mock.patch.object(bridge_agent, "read_live_binding", return_value="resumed"), mock.patch.object(bridge_agent, "transcript_candidate", return_value=None), redirect_stdout(output):
            bridge_agent.command_discover_transcript(SimpleNamespace(session_name="work", cwd="/tmp"))
        self.assertEqual(json.loads(output.getvalue())["boundSessionId"], "resumed")

    def test_invalidated_legacy_mapping_never_guesses_newest_transcript(self):
        output = io.StringIO()
        with mock.patch.object(bridge_agent, "read_session_map", return_value={"work": {"sessionId": "old", "requireLive": True}}), mock.patch.object(bridge_agent, "jsonl_candidates") as candidates, redirect_stdout(output):
            bridge_agent.command_discover_transcript(SimpleNamespace(session_name="work", cwd="/tmp"))
        self.assertEqual(json.loads(output.getvalue())["candidates"], [])
        candidates.assert_not_called()

    def test_launch_scopes_hook_to_one_claude_process(self):
        arguments = bridge_agent.claude_launch_args("cc", "uuid", "session", track_session=True)
        settings = json.loads(arguments[arguments.index("--settings") + 1])
        command = settings["hooks"]["SessionStart"][0]["hooks"][0]["command"]
        self.assertIn("session-hook --binding-id uuid", command)
        self.assertNotIn("http", command)

    def test_create_allows_prefix_of_existing_session(self):
        def run(command, **kwargs):
            if command[1] == "has-session":
                return SimpleNamespace(returncode=0 if command[3] == "work" else 1)
            return SimpleNamespace(returncode=0)
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.object(bridge_agent, "run_checked", side_effect=run),
            mock.patch.object(bridge_agent, "read_session_map", return_value={}),
            mock.patch.object(bridge_agent, "write_session_map"),
            mock.patch.object(bridge_agent, "inspect_session", return_value={}),
            mock.patch.object(bridge_agent.time, "sleep"),
            redirect_stdout(io.StringIO()),
        ):
            bridge_agent.command_create_session(SimpleNamespace(
                name="work", cwd=directory, claude_path="cc",
                session_id="0199d8f0-aabb-7ccd-8123-abcdef012345"))

    def test_terminate_never_resolves_a_missing_name_to_a_prefix_match(self):
        def run(command, **kwargs):
            return SimpleNamespace(returncode=1 if command[3] == "=work" else 0,
                                   stderr="session not found")
        with (
            mock.patch.object(bridge_agent, "run_checked", side_effect=run),
            self.assertRaises(SystemExit),
        ):
            bridge_agent.command_terminate_session(SimpleNamespace(name="work"))

    def test_claude_alias_uses_login_shell_and_positional_arguments(self):
        self.assertEqual(bridge_agent.claude_launch_args("cc", "uuid", "session"),
                         ["bash", "-lic", 'cc "$@"', "claude-local-bridge",
                          "--session-id", "uuid", "--name", "session"])

    def test_claude_path_with_spaces_stays_a_single_executable(self):
        args = bridge_agent.claude_launch_args("/opt/Claude Code/claude", "uuid", "session")
        self.assertEqual(args, ["/opt/Claude Code/claude", "--session-id", "uuid", "--name", "session"])

    def test_claude_command_rejects_shell_expressions(self):
        for command in ["", "cc; echo injected", "$(echo cc)", "cc --flag", "cc\x00"]:
            with self.subTest(command=command), self.assertRaises(SystemExit):
                bridge_agent.claude_launch_args(command, "uuid", "session")

    def test_session_name_validation(self):
        self.assertEqual(bridge_agent.validate_session_name("claude-mas_01"), "claude-mas_01")
        with self.assertRaises(SystemExit):
            bridge_agent.validate_session_name("bad;command")

    def test_existing_directory_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(bridge_agent.resolve_existing_directory(directory), pathlib.Path(directory).resolve())

    def test_emit_is_jsonl_and_preserves_unicode(self):
        output = io.StringIO()
        with redirect_stdout(output):
            bridge_agent.emit({"message": "你好"})
        self.assertEqual(json.loads(output.getvalue()), {"message": "你好"})

    def test_session_id_validation(self):
        self.assertEqual(bridge_agent.validate_session_id("0199d8f0-aabb-7ccd-8123-abcdef012345"), "0199d8f0-aabb-7ccd-8123-abcdef012345")
        with self.assertRaises(SystemExit):
            bridge_agent.validate_session_id("../escape")

    def test_mapped_session_is_claude_when_process_title_is_a_version(self):
        mapping = {"claude-0906": {"sessionId": "19304813-c09d-409b-9050-054222785253"}}
        self.assertTrue(
            bridge_agent.is_claude_pane("claude-0906", "2.1.263", 999999999, mapping)
        )

    def test_claude_install_path_is_detected_from_proc_command_line(self):
        command_line = b"/home/user/.local/share/claude/versions/2.1.263\x00--name\x00test"
        with mock.patch.object(bridge_agent.Path, "read_bytes", return_value=command_line):
            self.assertTrue(bridge_agent.is_claude_pane("existing", "2.1.263", 42, {}))

    def test_mapped_discovery_waits_for_its_file_instead_of_falling_back(self):
        session_id = "99421998-21de-45b7-9d35-e4ff9452c0e1"
        args = SimpleNamespace(session_name="claude-test", cwd="/tmp")
        output = io.StringIO()
        with (
            mock.patch.object(
                bridge_agent,
                "read_session_map",
                return_value={"claude-test": {"sessionId": session_id}},
            ),
            mock.patch.object(bridge_agent, "transcript_candidate", return_value=None),
            mock.patch.object(
                bridge_agent,
                "jsonl_candidates",
                side_effect=AssertionError("must not fall back"),
            ),
            redirect_stdout(output),
        ):
            bridge_agent.command_discover_transcript(args)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["boundSessionId"], session_id)
        self.assertEqual(payload["candidates"], [])
        self.assertTrue(payload["waitingForTranscript"])

    def test_candidate_scan_excludes_subagent_transcripts(self):
        original_projects = bridge_agent.CLAUDE_PROJECTS
        with tempfile.TemporaryDirectory() as directory:
            projects = pathlib.Path(directory)
            main = projects / "session.jsonl"
            nested = projects / "session" / "subagents" / "agent-test.jsonl"
            nested.parent.mkdir(parents=True)
            event = json.dumps({"cwd": directory, "type": "user"}) + "\n"
            main.write_text(event, encoding="utf-8")
            nested.write_text(event, encoding="utf-8")
            bridge_agent.CLAUDE_PROJECTS = projects
            try:
                candidates = bridge_agent.jsonl_candidates()
            finally:
                bridge_agent.CLAUDE_PROJECTS = original_projects
        self.assertEqual([candidate["sessionId"] for candidate in candidates], ["session"])

    def test_watcher_waits_until_the_bound_transcript_exists(self):
        original_projects = bridge_agent.CLAUDE_PROJECTS
        session_id = "11111111-2222-4333-8444-555555555555"
        with tempfile.TemporaryDirectory() as directory:
            projects = pathlib.Path(directory)
            expected = projects / "project" / f"{session_id}.jsonl"
            bridge_agent.CLAUDE_PROJECTS = projects

            def create_transcript():
                expected.parent.mkdir(parents=True)
                expected.write_text("{}\n", encoding="utf-8")

            timer = threading.Timer(0.05, create_transcript)
            timer.start()
            try:
                actual = bridge_agent.find_session_file(session_id, wait_for_file=True)
            finally:
                timer.join()
                bridge_agent.CLAUDE_PROJECTS = original_projects
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
