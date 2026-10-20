"""Opt-in native compatibility probe; uses a disposable tmux session and helper.

Run: python tests/remote/native_probe.py --host exp
No local Claude executable, HTTP client, login flow or existing conversation is used.
"""
import argparse
import json
import pathlib
import shlex
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True)
    args = parser.parse_args()
    def ssh(command, timeout=25):
        return subprocess.check_output(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', args.host, command], text=True, encoding='utf-8', timeout=timeout).strip()
    def call(*parts):
        return ssh(shlex.join(parts))
    root = ssh('mktemp -d /tmp/clb-native-probe-XXXXXXXX')
    if not root.startswith('/tmp/clb-native-probe-') or '/' in root[len('/tmp/'):]:
        raise RuntimeError('Unexpected probe directory')
    name = 'bridge-native-' + uuid.uuid4().hex[:12]
    sid = str(uuid.uuid4())
    def screen():
        return call('tmux', 'capture-pane', '-p', '-t', '=' + name + ':0.0')
    def send(text):
        call('tmux', 'send-keys', '-t', '=' + name + ':0.0', '-l', '--', '\x1b[200~' + text + '\x1b[201~')
        call('tmux', 'send-keys', '-t', '=' + name + ':0.0', 'Enter')
    def wait_for(predicate, timeout=25):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            result = screen()
            if predicate(result):
                return result
            time.sleep(.5)
        raise RuntimeError('Native state timed out: ' + screen()[-1600:])
    try:
        source = (pathlib.Path(__file__).resolve().parents[2] / 'remote/bridge_agent.py').read_text(encoding='utf-8')
        source = source.replace('BRIDGE_DIRECTORY = Path.home() / ".local" / "share" / "claude-local-bridge"', 'BRIDGE_DIRECTORY = Path(__file__).resolve().parent')
        with tempfile.TemporaryDirectory() as local:
            helper = pathlib.Path(local) / 'bridge_agent.py'
            helper.write_text(source, encoding='utf-8')
            subprocess.run(['scp', '-q', str(helper), args.host + ':' + root + '/bridge_agent.py'], check=True, timeout=25)
        call('python3', root + '/bridge_agent.py', 'create-session', '--name', name, '--cwd', root, '--session-id', sid, '--claude-path', 'cc')
        state = wait_for(lambda s: 'trust' in s.lower() or any(x in s for x in ['for shortcuts', 'manual mode on', 'bypass permissions on']))
        if 'trust' in state.lower():
            call('tmux', 'send-keys', '-t', '=' + name + ':0.0', 'Up')
            call('tmux', 'send-keys', '-t', '=' + name + ':0.0', 'Enter')
        state = wait_for(lambda s: any(x in s for x in ['for shortcuts', 'manual mode on', 'bypass permissions on']))
        binding = json.loads(call('python3', root + '/bridge_agent.py', 'discover-transcript', '--session-name', name, '--cwd', root))
        assert binding.get('liveBinding') and binding['boundSessionId'] == sid, binding
        print('PASS: native SessionStart hook identifies the initial conversation', flush=True)
        send('/model')
        wait_for(lambda s: 'model' in s.lower() and ('Enter to' in s or 'Select' in s))
        print('PASS: /model opens the native selector', flush=True)
        call('tmux', 'send-keys', '-t', '=' + name + ':0.0', 'Escape')
        wait_for(lambda s: any(x in s for x in ['for shortcuts', 'manual mode on', 'bypass permissions on']))
        send('/clear')
        time.sleep(2)
        wait_for(lambda s: any(x in s for x in ['for shortcuts', 'manual mode on', 'bypass permissions on']))
        binding = json.loads(call('python3', root + '/bridge_agent.py', 'discover-transcript', '--session-name', name, '--cwd', root))
        assert binding.get('liveBinding') and binding['boundSessionId'] != sid, binding
        print('PASS: /clear updates the live conversation identity', flush=True)
        send('/resume')
        wait_for(lambda s: any(x in s.lower() for x in ['resume', 'conversation', 'session']))
        print('PASS: /resume reaches the native history picker', flush=True)
        call('tmux', 'send-keys', '-t', '=' + name + ':0.0', 'Escape')
        wait_for(lambda s: any(x in s for x in ['for shortcuts', 'manual mode on', 'bypass permissions on']))
        send('/rewind')
        wait_for(lambda s: any(x in s.lower() for x in ['rewind', 'checkpoint', 'nothing to', 'no messages', 'no previous', 'no conversation']))
        print('PASS: /rewind reaches native handling', flush=True)
    finally:
        try:
            call('tmux', 'kill-session', '-t', '=' + name)
        except subprocess.CalledProcessError:
            pass
        finally:
            # The path is the verified mktemp output, never a user-provided directory.
            call('python3', '-c', 'import shutil,sys; shutil.rmtree(sys.argv[1])', root)


if __name__ == '__main__':
    main()
