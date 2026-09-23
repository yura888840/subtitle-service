#!/usr/bin/env python3
"""Kill the script process group if its Node owner dies or closes stdin."""
import os
import signal
import subprocess
import sys
import threading

child = subprocess.Popen(['bash', *sys.argv[1:]], start_new_session=True)

def watch_owner():
    sys.stdin.buffer.read()
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

threading.Thread(target=watch_owner, daemon=True).start()
sys.exit(child.wait())
