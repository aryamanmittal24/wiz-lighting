"""Low-latency music frames: bounded, ordered, no ACK retries/backlog.
A successful frame means UDP dispatched, not measured optical output.
"""
import json
import secrets
import socket
import threading
import time

class MusicBridge:
    def __init__(self, lights, lock, validate):
        self.lights, self.state_lock, self.validate = lights, lock, validate
        self.lock = threading.Lock()
        self.session = None
        self.sequence = -1

    def start(self):
        with self.lock:
            self.session = secrets.token_urlsafe(24)
            self.sequence = -1
            return {'session': self.session}

    def stop(self, session=None):
        with self.lock:
            if session is None or session == self.session:
                self.session = None
            return {'ok': True}

    def frame(self, body):
        frames = body.get('frames')
        seq = body.get('sequence')
        if not isinstance(frames, list) or not 1 <= len(frames) <= 4 or type(seq) is not int:
            raise ValueError('Invalid music frame')
        expires = body.get('expiresAt')
        if type(expires) not in (int, float) or not time.time()*1000 < expires <= time.time()*1000+2000:
            return {'expired': True, 'sent': 0}
        prepared = []
        with self.state_lock:
            for frame in frames:
                if not isinstance(frame, dict): raise ValueError('Invalid music light')
                key, params = frame.get('id'), frame.get('params')
                if key not in self.lights or self.lights[key].get('excluded'):
                    raise ValueError('Choose known room lights')
                self.validate(params)
                if any(k not in ('state','r','g','b','w','c','dimming','fadeIn','fadeOut') for k in params):
                    raise ValueError('Invalid music setting')
                entry = self.lights[key]
                # Never recheck stale addresses in the beat path. Poller refreshes them.
                if not entry.get('online') or time.time()-entry.get('seen',0)>20:
                    continue
                prepared.append((key,entry['ip'],dict(params,fadeIn=0,fadeOut=0)))
        with self.lock:
            if not self.session or body.get('session') != self.session or seq <= self.sequence:
                return {'dropped': True, 'sent': 0}
            if expires <= time.time()*1000:
                return {'expired': True, 'sent': 0}
            self.sequence = seq
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                for key, ip, params in prepared:
                    # All music brightness is >=10, accepted by older WiZ firmware.
                    if 'dimming' in params: params['dimming']=max(10,params['dimming'])
                    sock.sendto(json.dumps({'method':'setPilot','params':params}).encode(), (ip,38899))
            return {'sent':len(prepared), 'dropped':False}
