import base64
import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("files_agent", pathlib.Path(__file__).resolve().parents[2] / "remote/bridge_agent.py")
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)


class RemoteFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.path = self.root / "中文 ' $文件.txt"
        self.path.write_bytes(b"\xef\xbb\xbfhello\r\nworld\r\n")

    def read(self):
        return agent.remote_file_operation("read", {"path": str(self.path)})

    def save(self, version, content):
        return agent.remote_file_operation("save", {"path": str(self.path), "version": version, "content": content})

    def test_image_signatures_roundtrip_without_relying_on_extension(self):
        samples = [(b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"),
                   (b"GIF89a", "image/gif"), (b"RIFF1234WEBP", "image/webp")]
        for header, mime in samples:
            with self.subTest(mime=mime):
                data = header + b"payload"
                self.path.write_bytes(data)
                result = self.read()
                self.assertEqual(result["kind"], "image")
                self.assertEqual(result["mime"], mime)
                self.assertFalse(result["writable"])
                self.assertEqual(base64.b64decode(result["dataUrl"].split(",", 1)[1]), data)
                self.assertEqual(result["bytes"], len(data))
                with self.assertRaises(ValueError):
                    self.save(result["version"], "do not overwrite image")
                self.assertEqual(self.path.read_bytes(), data)

    def test_images_have_a_separate_bounded_size_limit(self):
        data = b"\x89PNG\r\n\x1a\n" + b"x" * agent.MAX_TEXT_BYTES
        self.path.write_bytes(data)
        self.assertEqual(self.read()["bytes"], len(data))
        with mock.patch.object(agent, "MAX_IMAGE_BYTES", 64):
            with self.assertRaisesRegex(ValueError, "IMAGE_TOO_LARGE"):
                self.read()
        self.path.write_bytes(b"RIFF1234WAVE" + b"\x00")
        with self.assertRaisesRegex(ValueError, "NOT_TEXT"):
            self.read()

    def test_list_is_shallow_sorted_and_bounded(self):
        (self.root / "z-folder").mkdir()
        (self.root / "z-folder" / "nested.txt").write_text("nested")
        (self.root / ".hidden").write_text("hidden")
        result = agent.remote_file_operation("list", {"path": str(self.root)})
        self.assertEqual(result["entries"][0]["name"], "z-folder")
        self.assertEqual(len(result["entries"]), 3)
        with mock.patch.object(agent, "MAX_DIRECTORY_ENTRIES", 2):
            result = agent.remote_file_operation("list", {"path": str(self.root)})
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["entries"]), 2)

    def test_save_roundtrips_unicode_bom_crlf_and_returns_new_version(self):
        original = self.read()
        self.assertEqual(original["lineEnding"], "CRLF")
        saved = self.save(original["version"], "\ufeff你好\nworld\n")
        self.assertEqual(self.path.read_bytes(), "\ufeff你好\r\nworld\r\n".encode())
        self.assertNotEqual(saved["version"], original["version"])
        self.assertEqual(list(self.root.glob(".conlaude-*")), [])

    def test_stale_save_leaves_external_change_intact(self):
        original = self.read()
        self.path.write_text("changed by Claude", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "CONFLICT"):
            self.save(original["version"], "my change")
        self.assertEqual(self.path.read_text(), "changed by Claude")

    def test_change_during_staging_is_detected_and_temp_is_removed(self):
        original = self.read()
        actual = agent.file_snapshot
        count = 0
        def snapshot(path):
            nonlocal count
            count += 1
            if count == 2:
                self.path.write_text("concurrent edit")
            return actual(path)
        with mock.patch.object(agent, "file_snapshot", side_effect=snapshot):
            with self.assertRaisesRegex(ValueError, "CONFLICT"):
                self.save(original["version"], "my edit")
        self.assertEqual(self.path.read_text(), "concurrent edit")
        self.assertEqual(list(self.root.glob(".conlaude-*")), [])

    def test_failed_replace_preserves_original(self):
        original = self.read()
        before = self.path.read_bytes()
        with mock.patch.object(agent.os, "replace", side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                self.save(original["version"], "changed")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.root.glob(".conlaude-*")), [])

    def test_binary_large_files_and_oversize_unicode_save_are_rejected(self):
        original = self.read()
        with self.assertRaisesRegex(ValueError, "TOO_LARGE"):
            self.save(original["version"], "界" * 400000)
        for data, error in [(b"a\x00b", "NOT_TEXT"), (b"\xff", "NOT_TEXT"), (b"a" * (agent.MAX_TEXT_BYTES + 1), "TOO_LARGE")]:
            self.path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, error):
                self.read()

    def test_mixed_newlines_are_read_only(self):
        self.path.write_bytes(b"a\r\nb\nc")
        result = self.read()
        self.assertFalse(result["writable"])
        with self.assertRaisesRegex(ValueError, "READ_ONLY"):
            self.save(result["version"], "a")

    @unittest.skipIf(os.name == "nt", "POSIX file semantics")
    def test_permissions_symlinks_and_special_files(self):
        self.path.chmod(0o640)
        original = self.read()
        self.save(original["version"], "next")
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o640)
        link = self.root / "link"
        link.symlink_to(self.path)
        with self.assertRaisesRegex(ValueError, "SYMLINK"):
            agent.remote_file_operation("read", {"path": str(link)})
        fifo = self.root / "pipe"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, "NOT_TEXT"):
            agent.remote_file_operation("read", {"path": str(fifo)})
