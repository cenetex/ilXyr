"""Keep nested Linux build processes inside the controller's cleanup boundary."""
import ctypes
import os
from pathlib import Path
import signal
import time
from feral_process import run_process, save


def adopt_children():
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'set child subreaper')


def direct_children():
    children = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[1]) == os.getpid(): children.append(int(path.parent.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return children


def stop_adopted_children():
    observed = set(); stop = time.monotonic() + 2
    while True:
        children = direct_children()
        if not children: return {'adopted_pids': sorted(observed), 'remaining_pids': []}
        observed.update(children)
        for pid in children:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
        for pid in children:
            try: os.waitpid(pid, os.WNOHANG)
            except ChildProcessError: pass
        if time.monotonic() >= stop:
            return {'adopted_pids': sorted(observed), 'remaining_pids': direct_children()}
        time.sleep(0.01)


def run_tree(command, cwd, output, deadline, grace_seconds, max_log_bytes):
    adopt_children()
    receipt = None
    try:
        receipt = run_process(command, cwd, output, deadline, grace_seconds, max_log_bytes=max_log_bytes)
        return receipt
    finally:
        cleanup = stop_adopted_children()
        save(output / 'adopted-cleanup.json', cleanup)
        if receipt is not None:
            receipt['adopted_cleanup'] = cleanup
            if cleanup['adopted_pids']:
                receipt.update(status='failed', descendant_cleanup=True,
                    stop_reason=receipt['stop_reason'] or 'adopted_descendants_after_leader_exit')
            save(output / 'process.json', receipt)
