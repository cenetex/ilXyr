"""Run one process group under a deadline and retain output and resource usage."""

import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(part)
    return value.hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n')
    temporary.replace(path)


def signal_group(pid, number):
    try:
        os.killpg(pid, number)
        return True
    except ProcessLookupError:
        return False


def run_process(command, cwd, output, deadline, grace_seconds, cancelled=lambda: None, max_log_bytes=16 * 1024 * 1024):
    if not math.isfinite(deadline) or not math.isfinite(grace_seconds) or grace_seconds < 0:
        raise ValueError('process limits must be finite and grace must be nonnegative')
    if isinstance(max_log_bytes, bool) or not isinstance(max_log_bytes, int) or max_log_bytes <= 0:
        raise ValueError('log size limit must be a positive integer')
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic_ns()
    result = {'schema': 'ilxyr.feral_process.v1', 'command': list(command), 'status': 'failed',
              'pid': None, 'exit_code': None, 'stop_reason': None, 'signals': [],
              'resource_usage': None, 'descendant_cleanup': False}
    process, waited = None, False
    termination_started = None
    try:
        if cancelled() is not None or time.monotonic() >= deadline:
            result.update(status='skipped', stop_reason='cancelled' if cancelled() is not None else 'deadline')
            return result
        with (output / 'stdout.log').open('xb') as stdout, (output / 'stderr.log').open('xb') as stderr:
            process = subprocess.Popen(command, cwd=cwd, stdout=stdout, stderr=stderr, start_new_session=True)
            result['pid'] = process.pid
            while True:
                log_bytes = (output / 'stdout.log').stat().st_size + (output / 'stderr.log').stat().st_size
                if result['stop_reason'] is None and log_bytes > max_log_bytes:
                    result['stop_reason'] = 'log_size_limit'
                    termination_started = time.monotonic()
                    signal_group(process.pid, signal.SIGKILL)
                    result['signals'].append('KILL')
                pid, status, usage = os.wait4(process.pid, os.WNOHANG)
                if pid:
                    waited = True
                    process.returncode = os.waitstatus_to_exitcode(status)
                    result['exit_code'] = process.returncode
                    if result['stop_reason'] is None and time.monotonic() >= deadline:
                        result['stop_reason'] = 'deadline'
                    result['resource_usage'] = {
                        'user_cpu_seconds': usage.ru_utime, 'system_cpu_seconds': usage.ru_stime,
                        'max_rss_bytes': int(usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024)),
                        'scope': 'wait4_direct_child_and_waited_descendants'}
                    # A successful leader can still leave a live process in its group.
                    result['descendant_cleanup'] = signal_group(process.pid, signal.SIGKILL)
                    result['status'] = 'complete' if process.returncode == 0 and result['stop_reason'] is None and not result['descendant_cleanup'] else 'failed'
                    if result['descendant_cleanup'] and result['stop_reason'] is None:
                        result['stop_reason'] = 'descendants_after_leader_exit'
                    return result
                now = time.monotonic()
                if termination_started is None and (cancelled() is not None or now >= deadline):
                    result['stop_reason'] = 'cancelled' if cancelled() is not None else 'deadline'
                    termination_started = now
                    signal_group(process.pid, signal.SIGTERM)
                    result['signals'].append('TERM')
                if termination_started is not None and now >= termination_started + grace_seconds and 'KILL' not in result['signals']:
                    signal_group(process.pid, signal.SIGKILL)
                    result['signals'].append('KILL')
                time.sleep(0.01)
    except BaseException as error:
        result['error'] = str(error)
        raise
    finally:
        if process is not None and not waited:
            signal_group(process.pid, signal.SIGKILL)
            try:
                _, status, usage = os.wait4(process.pid, 0)
                process.returncode = os.waitstatus_to_exitcode(status)
                result.update(exit_code=process.returncode, resource_usage={
                    'user_cpu_seconds': usage.ru_utime, 'system_cpu_seconds': usage.ru_stime,
                    'max_rss_bytes': int(usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024)),
                    'scope': 'wait4_direct_child_and_waited_descendants'})
            except ChildProcessError:
                result['resource_usage'] = None
        result['total_wall_ns'] = time.monotonic_ns() - started
        result['max_log_bytes'] = max_log_bytes
        result['outputs'] = {name: {'bytes': (output / name).stat().st_size, 'sha256': digest(output / name)}
                             for name in ['stdout.log', 'stderr.log'] if (output / name).exists()}
        save(output / 'process.json', result)
