#!/usr/bin/env python3
"""Local WiZ panel. Python standard library only; binds to loopback."""
import random
import subprocess
import concurrent.futures, ipaddress, json, os, secrets, socket, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from collections import defaultdict
from urllib.parse import parse_qs, urlsplit
import health_bridge
import astronaut_bridge
from music_bridge import MusicBridge
from pattern_frames import ANIMATIONS, animation_frames, validate_options

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('WIZ_PANEL_PORT', '8765'))
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
COMMAND_LOCK = threading.Lock()
DEVICE_LOCKS = defaultdict(threading.RLock)
DATA = ROOT / 'settings.json'
try:
    settings = json.loads(DATA.read_text())
except FileNotFoundError:
    settings = {'lights': {}, 'scenes': []}
lights = settings['lights']
last_discovery = 0.0

def save():
    with LOCK:
        temporary = DATA.with_suffix('.tmp')
        temporary.write_text(json.dumps(settings, indent=2))
        temporary.replace(DATA)

def udp(ip, method, params=None):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(0.9)
        s.connect((ip, 38899))
        payload = json.dumps({'method': method, 'params': params or {}}).encode()
        for _ in range(2):
            s.send(payload)
            until = time.monotonic() + 0.9
            while time.monotonic() < until:
                try:
                    response = json.loads(s.recv(8192))
                    if response.get('method') != method:
                        continue
                    result = response.get('result', {})
                    if 'error' in response or result.get('success') is False:
                        raise ValueError('WiZ rejected this command; the light is still connected' if response.get('error', {}).get('code') == -32602 else 'Light rejected command')
                    if method == 'setPilot' and result.get('success') is not True:
                        raise ValueError('Light did not confirm command')
                    return result
                except socket.timeout:
                    break
        raise TimeoutError('No response from light')

def remember(ip, state):
    mac = state.get('mac')
    if not isinstance(mac, str) or len(mac) != 12:
        return
    if settings.get('lock_to_saved_lights') and mac not in lights:
        return
    with LOCK:
        entry = lights.setdefault(mac, {'id': mac, 'name': f'Light {len(lights)+1}'})
        entry.update(ip=ip, online=True, state=state, seen=time.time(), misses=0, stale=False)

def discover():
    global last_discovery
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.bind(('', 0))
        s.settimeout(0.3)
        for _ in range(2):
            s.sendto(b'{"method":"getPilot","params":{}}', ('255.255.255.255',38899))
            until = time.monotonic()+1.3
            while time.monotonic()<until:
                try:
                    data, addr = s.recvfrom(8192)
                    reply=json.loads(data)
                    if reply.get('method') == 'getPilot' and ipaddress.ip_address(addr[0]).is_private:
                        remember(addr[0], reply.get('result', {}))
                except (socket.timeout, ValueError):
                    pass
    refresh()
    # Some routers suppress WiZ broadcast replies after a DHCP address change.
    # When a saved bulb is stale, probe its local /24 once to recover its MAC.
    with LOCK:
        stale_ips = [item.get('ip') for item in lights.values() if item.get('stale') and item.get('ip')]
    for ip in stale_ips:
        try:
            network = ipaddress.ip_network(f'{ip}/24', strict=False)
        except ValueError:
            continue
        def probe(candidate):
            try:
                result = udp(str(candidate), 'getPilot')
                remember(str(candidate), result)
            except (OSError, ValueError, TimeoutError):
                pass
        with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
            list(pool.map(probe, network.hosts()))
        refresh()
    save()
    last_discovery = time.monotonic()

def refresh_one(item):
    key, item = item
    # Background reads skip busy bulbs rather than delaying controls.
    if not DEVICE_LOCKS[key].acquire(blocking=False):
        return
    try:
        result = udp(item['ip'], 'getPilot')
        if result.get('mac') != key:
            with LOCK:
                lights[key].update(online=False, stale=True, seen=0)
            return
        remember(item['ip'], result)
    except (OSError, ValueError, TimeoutError):
        with LOCK:
            entry = lights[key]
            entry['misses'] = entry.get('misses', 0) + 1
            entry['stale'] = True
            if entry['misses'] >= 3 or time.time()-entry.get('seen',0) > 30:
                entry['online'] = False
    finally:
        DEVICE_LOCKS[key].release()

def refresh():
    with LOCK:
        items = [(key, dict(value)) for key, value in lights.items()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(refresh_one, items))

def validate(params):
    if not isinstance(params, dict) or not params:
        raise ValueError('Choose a setting')
    ranges = {'r': (0,255), 'g': (0,255), 'b': (0,255), 'dimming': (1,100), 'temp': (2200,6500), 'sceneId': (0,35), 'speed': (10,200), 'w': (0,255), 'c': (0,255), 'fadeIn': (0,5000), 'fadeOut': (0,5000)}
    for key, value in params.items():
        if key == 'state':
            if type(value) is not bool: raise ValueError('Invalid power value')
        elif key not in ranges or type(value) is not int or not ranges[key][0] <= value <= ranges[key][1]:
            raise ValueError('Invalid light setting: '+key)
    return params

def control(ids, params):
    # Current WiZ firmware rejects an explicit sceneId of 0. Omitting it
    # selects direct RGB/temperature control and works across firmware versions.
    if isinstance(params, dict) and params.get('sceneId') == 0:
        params = dict(params)
        params.pop('sceneId', None)
    validate(params)
    if not isinstance(ids, list) or not ids or any(key not in lights for key in ids):
        raise ValueError('Select known lights first')
    def apply(key):
        with DEVICE_LOCKS[key]:
            try:
                with LOCK:
                    ip = lights[key]['ip']
                    current = dict(lights[key].get('state') or {})
                    recent = time.time()-lights[key].get('seen',0) < 15
                # Fresh polling already verified identity; recheck stale addresses.
                if not recent:
                    state = udp(ip, 'getPilot')
                    if state.get('mac') != key:
                        raise ValueError('Address changed; rescan lights')
                    remember(ip, state)
                # Older WiZ firmware rejects raw dimming values below 10%.
                # Approximate the requested 1–9% range by sending the accepted
                # 10% floor while scaling the active LED channels. This keeps
                # night scenes visibly dim instead of leaving the old level on.
                device_params = dict(params)
                requested_dimming = device_params.get('dimming')
                if isinstance(requested_dimming, int) and 1 <= requested_dimming < 10:
                    factor = requested_dimming / 10
                    device_params['dimming'] = 10
                    channel_keys = ('r', 'g', 'b', 'w', 'c')
                    if not any(k in device_params for k in channel_keys):
                        device_params.update({k: current[k] for k in channel_keys if k in current})
                    for channel in channel_keys:
                        if channel in device_params:
                            device_params[channel] = max(0, min(255, round(device_params[channel] * factor)))
                udp(ip, 'setPilot', device_params)
                with LOCK:
                    entry = lights[key]
                    entry.pop('control_error', None)
                    entry.update(online=True, stale=False, misses=0)
                    entry.setdefault('state', {}).update(params)
                    if 'temp' in params:
                        for k in ('r','g','b'): entry['state'].pop(k,None)
                    elif 'r' in params: entry['state'].pop('temp',None)
                return {'id': key, 'ok': True}
            except (OSError, ValueError, TimeoutError) as error:
                with LOCK: lights[key]['control_error'] = str(error)
                return {'id': key, 'ok': False, 'error': str(error)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        return list(pool.map(apply, dict.fromkeys(ids)))

def snapshot():
    with LOCK:
        return json.loads(json.dumps({'lights': list(lights.values()), 'screen_order': settings.get('screen_order', list(lights)), 'scenes': settings['scenes'], 'pattern': dict(pattern_status), 'identify': dict(identify_status)}))

def scene_params(state):
    p = {'state': bool(state.get('state', False)), 'dimming': max(1,state.get('dimming',100))}
    if state.get('sceneId',0):
        p['sceneId'] = state['sceneId']
        if 'speed' in state: p['speed']=state['speed']
    elif state.get('temp',0): p.update(temp=state['temp'])
    elif all(k in state for k in ('r','g','b')):
        p.update({k:state[k] for k in ('r','g','b')}); p.update(w=0,c=0)
    return p

ASTRONAUT_COLORS = [(103, 68, 215), (36, 145, 220), (51, 189, 148), (245, 111, 83), (222, 91, 154)]
astronaut_color_index = 0

def astronaut_mapping():
    return {**astronaut_bridge.DEFAULT_MAP, **settings.get('astronaut_mapping', {})}

def astronaut_status():
    return {**astronaut.status(), 'buttons': astronaut_bridge.BUTTONS,
            'mapping': astronaut_mapping(), 'actions': sorted(astronaut_bridge.ACTIONS)}

def astronaut_press(command):
    global astronaut_color_index
    action = astronaut_mapping().get(command, 'none')
    if action == 'none': return
    with COMMAND_LOCK:
        with LOCK:
            ids = [key for key in settings.get('screen_order', list(lights))
                   if key in lights and not lights[key].get('excluded') and lights[key].get('online')]
            states = [lights[key].get('state', {}) for key in ids]
        if not ids: raise ValueError('No WiZ lights are online')
        stop_pattern()
        if action == 'toggle': params = {'state': not any(s.get('state') for s in states)}
        elif action == 'all_off': params = {'state': False}
        elif action in ('brighter', 'dimmer'):
            level = round(sum(s.get('dimming', 50) for s in states) / len(states))
            params = {'state': True, 'dimming': max(1, min(100, level + (12 if action == 'brighter' else -12)))}
        elif action in ('next_color', 'previous_color'):
            astronaut_color_index = (astronaut_color_index + (1 if action == 'next_color' else -1)) % len(ASTRONAUT_COLORS)
            r, g, b = ASTRONAUT_COLORS[astronaut_color_index]
            params = {'state': True, 'r': r, 'g': g, 'b': b, 'w': 0, 'c': 0, 'dimming': 45}
        elif action == 'warm': params = {'state': True, 'temp': 2700, 'dimming': 35}
        elif action == 'cool': params = {'state': True, 'temp': 6000, 'dimming': 65}
        else: return
        failures = [result for result in control(ids, params) if not result['ok']]
        if failures: raise ValueError(f"{len(failures)} WiZ light(s) did not respond")

astronaut = astronaut_bridge.Bridge(astronaut_press)

pattern_stop = threading.Event()
pattern_thread = None
pattern_status = {'running': False, 'name': 'Thunder Classic', 'mode': 'classic', 'error': None}
identify_status = {'running': False, 'current': None, 'remaining': [], 'results': {}, 'error': None}
identify_original = {}

def stop_pattern():
    if pattern_thread and pattern_thread.is_alive():
        pattern_stop.set()
        pattern_thread.join(timeout=12)
        if pattern_thread.is_alive():
            raise ValueError('Pattern is still stopping; retry shortly')

def identify_start(ids=None):
    global identify_original
    stop_pattern()
    refresh()
    with LOCK:
        if ids is None: ids=[key for key, light in lights.items() if not light.get('excluded')]
        ids=list(dict.fromkeys(ids))
        if not ids or any(key not in lights or not lights[key].get('online') for key in ids):
            raise ValueError('Select lights that are online')
        identify_original={key:scene_params(lights[key]['state']) for key in ids}
        identify_status.update(running=True,current=None,remaining=ids[:],results={},error=None)
    return identify_next()

def identify_next():
    with LOCK:
        if not identify_status['remaining']:
            identify_status.update(running=False,current=None)
            save()
            return snapshot()
        key=identify_status['remaining'][0]
    result=control([key],{'state':True,'r':0,'g':0,'b':0,'w':255,'c':255,'dimming':100,'fadeIn':0})
    if not result[0]['ok']:
        with LOCK: identify_status['error']=result[0]['error']; identify_status['running']=False
        raise ValueError(result[0]['error'])
    with LOCK: identify_status['current']=key
    return snapshot()

def identify_answer(is_mine):
    with LOCK:
        if not identify_status['running'] or not identify_status['current']:
            raise ValueError('No light is waiting for an answer')
        key=identify_status['current']
        original=identify_original[key]
    result=control([key],original)
    if not result[0]['ok']: raise ValueError(result[0]['error'])
    with LOCK:
        lights[key]['excluded']=not is_mine
        identify_status['results'][key]=bool(is_mine)
        identify_status['remaining']=[item for item in identify_status['remaining'] if item != key]
        identify_status['current']=None
        save()
    return identify_next()

def send_pattern_frame(sock, ids, frames):
    """Send one current frame without ACK retries or queued obsolete frames."""
    with LOCK:
        if any(lights[key].get('excluded') or not lights[key].get('online') or lights[key].get('stale')
               or time.time()-lights[key].get('seen',0)>20 for key in ids):
            raise ValueError('Light connection changed. Animation stopped; rescan lights.')
        addresses=[lights[key]['ip'] for key in ids]
    for ip,params in zip(addresses,frames):
        sock.sendto(json.dumps({'method':'setPilot','params':params}).encode(),(ip,38899))

def start_pattern(ids, mode='classic', options=None):
    global pattern_thread
    if not isinstance(ids,list) or len(set(ids)) < 2 or any(i not in lights for i in ids):
        raise ValueError('Select at least two known lights')
    if mode not in ('classic','storm',*ANIMATIONS):
        raise ValueError('Choose a known animation')
    options=validate_options(options)
    ids=list(dict.fromkeys(ids))
    if len(ids)>16 or any(lights[key].get('excluded') for key in ids):
        raise ValueError('Choose 2–16 room lights')
    stop_pattern()
    refresh()
    with LOCK:
        if any(not lights[i].get('online') or lights[i].get('stale') for i in ids):
            raise ValueError('All selected lights must respond before starting')
        original={i:scene_params(lights[i]['state']) for i in dict.fromkeys(ids)}
        pattern_status.update(running=True,mode=mode,name=ANIMATIONS.get(mode,'Thunderstorm' if mode == 'storm' else 'Thunder Classic'),error=None,**options)
    pattern_stop.clear()
    def run():
        try:
            if mode in ANIMATIONS:
                began=time.monotonic()
                with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:
                    while not pattern_stop.is_set():
                        tick=time.monotonic()
                        frames=animation_frames(mode,tick-began,len(ids),**options)
                        send_pattern_frame(sock,ids,frames)
                        # Sample the current time each tick. A stalled loop skips
                        # missed frames rather than replaying them in a burst.
                        if pattern_stop.wait(max(.01,.1-(time.monotonic()-tick))):break
                return
            results=control(list(original),{'state':False,'fadeOut':0})
            if any(not r['ok'] for r in results): raise ValueError('A light rejected control. Thunder stopped.')
            previous=None
            consecutive_failures=0
            while not pattern_stop.is_set():
                if mode == 'storm':
                    pair=random.sample(list(original),2)
                    if len(original)>2 and previous and set(pair)==set(previous):
                        pair=random.sample(list(original),2)
                    strikes=[
                        {'state':True,'r':0,'g':0,'b':0,'w':255,'c':255,'dimming':100,'fadeIn':0},
                        {'state':True,'r':0,'g':0,'b':0,'w':210,'c':255,'dimming':random.randint(38,62),'fadeIn':0}
                    ]
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                        batches=list(pool.map(lambda item:control([item[0]],item[1]),zip(pair,strikes)))
                    failed=sum(not result['ok'] for batch in batches for result in batch)
                    if failed:
                        consecutive_failures += 1
                        if consecutive_failures >= 3:
                            raise ValueError('Three strikes failed in a row. Thunderstorm stopped; check Wi-Fi and local control.')
                    else: consecutive_failures=0
                    if pattern_stop.wait(random.uniform(.08,.13)): break
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                        list(pool.map(lambda key:control([key],{'state':False,'fadeOut':45}),pair))
                    previous=pair
                else:
                    key=random.choice([i for i in original if i != previous])
                    # Drive the dedicated white LEDs directly. Sending sceneId/temp
                    # after an RGB look can leave older firmware in RGB mode (red).
                    result=control([key],{
                        'state':True,'r':0,'g':0,'b':0,
                        'w':random.choice([180,220,255]),'c':255,
                        'dimming':100,'fadeIn':20
                    })
                    if not result[0]['ok']:
                        consecutive_failures += 1
                        if consecutive_failures >= 3:
                            raise ValueError('Three strikes failed in a row. Thunder stopped; check Wi-Fi and local control.')
                        previous=key
                        continue
                    consecutive_failures=0
                    # The bulb performs this fade itself; sending multiple dimming
                    # packets made the visual timing depend on Wi-Fi latency.
                    if pattern_stop.wait(0.18): break
                    control([key],{'state':False,'fadeOut':80})
                    # A missed off acknowledgement should not kill the pattern. The
                    # next strike targets another bulb, and Stop restores all state.
                    previous=key
        except Exception as error:
            with LOCK: pattern_status['error']=str(error)
        finally:
            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                restored=list(pool.map(lambda item:control([item[0]],{**item[1],'fadeIn':0,'fadeOut':0}), original.items()))
            failed=sum(not r['ok'] for batch in restored for r in batch)
            with LOCK:
                pattern_status['running']=False
                if failed: pattern_status['error']=f'{failed} lights could not restore. Check connection.'
    pattern_thread=threading.Thread(target=run,daemon=True)
    pattern_thread.start()

music = MusicBridge(lights, LOCK, validate)
ANALYSIS_LOCK = threading.Lock()
MAX_TRACK_BYTES = 22050 * 900 * 4

def analyze_track(raw):
    runtime = ROOT / '.venv-analysis' / 'bin' / 'python'
    if not runtime.exists():
        raise ValueError('Track analysis needs setup. Run Setup Music Analysis.command once.')
    if not ANALYSIS_LOCK.acquire(blocking=False):
        raise ValueError('Another song is being analysed. Wait for it to finish.')
    try:
        result = subprocess.run([str(runtime), str(ROOT / 'track_analysis.py')],
                                input=raw, capture_output=True, timeout=180)
        if result.returncode:
            raise ValueError('Audio analysis failed. Try another song or run Setup Music Analysis.command.')
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        raise ValueError('Analysis took too long. Try a shorter song.')
    finally:
        ANALYSIS_LOCK.release()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self, status, body, mime='application/json'):
        if not isinstance(body, bytes): body=json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers(); self.wfile.write(body)
    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{PORT}', f'localhost:{PORT}')
    def do_GET(self):
        if not self.valid_host(): return self.send(403,{'error':'Invalid host'})
        if self.path.startswith('/google-health/callback?'):
            query = parse_qs(urlsplit(self.path).query)
            try:
                health_bridge.callback(query.get('state', [''])[0], query.get('code', [''])[0])
                self.send_response(303)
                self.send_header('Location', '/health?connected=1')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
            except ValueError as error:
                self.send(400, {'error': str(error)})
            return
        if self.path == '/api/state': return self.send(200,snapshot())
        if self.path == '/api/session': return self.send(200,{'token':TOKEN})
        if self.path == '/api/astronaut/status': return self.send(200,astronaut_status())
        if self.path == '/api/health/status': return self.send(200,health_bridge.status())
        if self.path == '/api/health/readings':
            try: return self.send(200,health_bridge.readings())
            except ValueError as error: return self.send(503,{'error':str(error)})
        files={'/':'index.html','/app.js':'app.js','/style.css':'style.css',
               '/music-dsp.js':'music-dsp.js','/music-worklet.js':'music-worklet.js',
               '/track-timeline.js':'track-timeline.js','/track-player.js':'track-player.js',
               '/studio-scenes.js':'studio-scenes.js','/studio-tabs.js':'studio-tabs.js',
               '/pattern-ui.js':'pattern-ui.js',
               '/health':'health.html','/health/':'health.html',
               '/health.js':'health.js','/health.css':'health.css',
               '/room':'room.html','/room/':'room.html','/room.html':'room.html',
               '/room.js':'room.js','/room.css':'room.css',
               '/astronaut':'astronaut.html','/astronaut/':'astronaut.html',
               '/astronaut.js':'astronaut.js','/astronaut.css':'astronaut.css',
               '/vendor/three.module.js':'vendor/three.module.js',
               '/vendor/OrbitControls.js':'vendor/OrbitControls.js'}
        if self.path not in files: return self.send(404,{'error':'Not found'})
        name=files[self.path]
        mime={'html':'text/html; charset=utf-8','js':'text/javascript','css':'text/css'}[name.split('.')[-1]]
        self.send(200,(ROOT/'web'/name).read_bytes(),mime)
    def do_POST(self):
        if not self.valid_host() or self.headers.get('X-Wiz-Token') != TOKEN:
            return self.send(403,{'error':'Reload the panel and try again'})
        try:
            length=int(self.headers.get('Content-Length',0))
            if self.path == '/api/music/analyze':
                if self.headers.get('Content-Type') != 'application/octet-stream' or not 0 < length <= MAX_TRACK_BYTES or length % 4:
                    raise ValueError('Choose a song up to 15 minutes long.')
                raw = self.rfile.read(length)
                if len(raw) != length: raise ValueError('Audio upload was incomplete.')
                return self.send(200,analyze_track(raw))
            if not 0 < length <= 65536: raise ValueError('Invalid request size')
            body=json.loads(self.rfile.read(length))
            if self.path == '/api/health/connect':
                return self.send(200,{'url':health_bridge.start()})
            if self.path == '/api/health/disconnect':
                health_bridge.disconnect()
                return self.send(200,{'ok':True})
            if self.path == '/api/astronaut/start': return self.send(200,astronaut.start())
            if self.path == '/api/astronaut/stop': return self.send(200,astronaut.stop())
            if self.path == '/api/astronaut/mapping':
                mapping = body.get('mapping')
                if not isinstance(mapping, dict) or any(k not in astronaut_bridge.BUTTONS or v not in astronaut_bridge.ACTIONS for k,v in mapping.items()):
                    raise ValueError('Invalid remote mapping')
                with LOCK:
                    settings['astronaut_mapping'] = mapping
                    save()
                return self.send(200,astronaut_status())
            if self.path == '/api/music/start':
                with COMMAND_LOCK:
                    stop_pattern()
                    return self.send(200,music.start())
            if self.path == '/api/music/frame': return self.send(200,music.frame(body))
            if self.path == '/api/music/stop': return self.send(200,music.stop(body.get('session')))
            with COMMAND_LOCK:
                if self.path in ('/api/control','/api/pattern/start','/api/scenes/run','/api/identify/start'):
                    music.stop()
                if self.path == '/api/discover': discover(); result=snapshot()
                elif self.path == '/api/control':
                    stop_pattern()
                    result={'results':control(body.get('ids'),body.get('params'))}
                elif self.path == '/api/pattern/start':
                    start_pattern(body.get('ids'),body.get('mode','classic'),body.get('options')); result=snapshot()
                elif self.path == '/api/pattern/stop':
                    stop_pattern(); result=snapshot()
                elif self.path == '/api/identify/start':
                    result=identify_start(body.get('ids'))
                elif self.path == '/api/identify/answer':
                    if type(body.get('isMine')) is not bool: raise ValueError('Answer yes or no')
                    result=identify_answer(body['isMine'])
                elif self.path == '/api/rename':
                    name=str(body.get('name','')).strip()[:40]
                    if not name or body.get('id') not in lights: raise ValueError('Enter a light name')
                    with LOCK: lights[body['id']]['name']=name; save()
                    result=snapshot()
                elif self.path == '/api/light/exclude':
                    key=body.get('id')
                    if key not in lights or type(body.get('excluded')) is not bool: raise ValueError('Choose a known light')
                    with LOCK:
                        lights[key]['excluded']=body['excluded']
                        if body['excluded']:
                            for scene in settings['scenes']:
                                scene['lights'].pop(key,None)
                            settings['scenes'][:]=[scene for scene in settings['scenes'] if scene['lights']]
                        save()
                    result=snapshot()
                elif self.path == '/api/scenes/save':
                    name=str(body.get('name','')).strip()[:40]
                    if not name: raise ValueError('Enter a scene name')
                    refresh()
                    with LOCK:
                        ids=body.get('ids',[])
                        if not ids or any(i not in lights or not lights[i]['online'] for i in ids):
                            raise ValueError('All selected lights must be online to save a look')
                        settings['scenes'].append({'id':secrets.token_hex(6),'name':name,'lights':{i:scene_params(lights[i]['state']) for i in ids}})
                        save()
                    result=snapshot()
                elif self.path == '/api/scenes/run':
                    stop_pattern()
                    scene=next((s for s in settings['scenes'] if s['id']==body.get('id')),None)
                    if not scene: raise ValueError('Scene not found')
                    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                        batches=pool.map(lambda item: control([item[0]],item[1]),scene['lights'].items())
                        result={'results':[r for batch in batches for r in batch]}
                elif self.path == '/api/scenes/delete':
                    with LOCK:
                        settings['scenes'][:]=[s for s in settings['scenes'] if s['id']!=body.get('id')]; save()
                    result=snapshot()
                else: return self.send(404,{'error':'Not found'})
            self.send(200,result)
        except (ValueError, KeyError, TypeError) as error: self.send(400,{'error':str(error)})
        except OSError as error: self.send(503,{'error':str(error)})

def poll():
    while True:
        time.sleep(6)
        refresh()
        with LOCK:
            any_online = any(item.get('online') for item in lights.values())
        if not any_online or time.monotonic() - last_discovery > 120:
            discover()

def discover_and_poll():
    # Discovery can take a minute on an unreliable network; never block HTTP.
    try:
        discover()
    except OSError as error:
        print(f'Initial WiZ discovery unavailable: {error}', flush=True)
    poll()

if __name__=='__main__':
    httpd = ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    for entry in lights.values():
        entry.update(online=False, stale=True)
    threading.Thread(target=discover_and_poll,daemon=True).start()
    print(f'WiZ Control ready: http://127.0.0.1:{PORT}',flush=True)
    httpd.serve_forever()
