#!/usr/bin/env python3
"""Kill the script process group if its Node owner dies or closes stdin."""
import os
import signal
import subprocess
import sys
import threading

child = subprocess.Popen(['bash', *sys.argv[1:]], start_new_session=True)

def watch_owner():
    while os.read(0, 1024):
        pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

threading.Thread(target=watch_owner, daemon=True).start()
code = child.wait()
os._exit(code if code >= 0 else 128 - code)
