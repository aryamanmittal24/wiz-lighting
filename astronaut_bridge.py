"""Read decoded NEC button presses from the ESP32 IR learner over USB."""
import glob
import os
import re
import select
import termios
import threading
import time
import tty

BUTTONS = {
    '45': 'Power', '47': 'Timer', '09': 'Nebula B+', '40': 'Nebula S−',
    '44': 'Nebula', '43': 'Nebula S+', '15': 'Nebula B−',
    '46': 'Star S−', '19': 'Star S+', 'FF': 'Star', '07': 'Star B−', '0D': 'Star B+',
}
DEFAULT_MAP = {
    '45': 'toggle', '47': 'none', '09': 'brighter', '40': 'previous_color',
    '44': 'next_color', '43': 'next_color', '15': 'dimmer',
    '46': 'previous_color', '19': 'next_color', 'FF': 'warm',
    '07': 'dimmer', '0D': 'brighter',
}
ACTIONS = {'none', 'toggle', 'brighter', 'dimmer', 'next_color', 'previous_color', 'warm', 'cool', 'all_off'}
NEC = re.compile(r'Protocol=NEC\s+Address=0x0+\s+Command=0x([0-9A-Fa-f]+)')

class Bridge:
    def __init__(self, on_button):
        self.on_button = on_button
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.port = None
        self.connected = False
        self.last_button = None
        self.last_error = None

    def status(self):
        with self.lock:
            return {'running': bool(self.thread and self.thread.is_alive()),
                    'connected': self.connected, 'port': self.port,
                    'last_button': self.last_button, 'error': self.last_error}

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive(): return self.status()
            self.stop_event.clear()
            self.last_error = None
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()
        return self.status()

    def stop(self):
        self.stop_event.set()
        with self.lock:
            self.connected = False
        return self.status()

    def _run(self):
        while not self.stop_event.is_set():
            ports = sorted(glob.glob('/dev/cu.usbmodem*'))
            if not ports:
                with self.lock: self.last_error = 'Connect the ESP32 by USB.'
                self.stop_event.wait(2)
                continue
            fd = None
            try:
                fd = os.open(ports[0], os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
                tty.setraw(fd)
                attrs = termios.tcgetattr(fd)
                attrs[4] = attrs[5] = termios.B115200
                termios.tcsetattr(fd, termios.TCSANOW, attrs)
                with self.lock:
                    self.port, self.connected, self.last_error = ports[0], True, None
                pending = b''
                while not self.stop_event.is_set():
                    if not select.select([fd], [], [], 0.3)[0]: continue
                    chunk = os.read(fd, 4096)
                    if not chunk: raise OSError('ESP32 disconnected')
                    pending = (pending + chunk)[-8192:]
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        match = NEC.search(line.decode('utf-8', 'replace'))
                        if not match: continue
                        command = match.group(1).upper().zfill(2)
                        if command not in BUTTONS: continue
                        with self.lock: self.last_button = {'name': BUTTONS[command], 'command': command, 'at': time.time()}
                        try:
                            self.on_button(command)
                            with self.lock: self.last_error = None
                        except Exception as error:
                            with self.lock: self.last_error = str(error)
            except OSError as error:
                with self.lock: self.last_error = str(error)
                self.stop_event.wait(2)
            finally:
                if fd is not None: os.close(fd)
                with self.lock: self.connected = False
