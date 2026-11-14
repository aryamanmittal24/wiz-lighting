"""Small local-only Google Health OAuth and read client for WiZ Studio."""
import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CLIENT_ID = os.environ.get('WIZ_GOOGLE_HEALTH_CLIENT_ID', '')
REDIRECT = 'http://127.0.0.1:8765/google-health/callback'
SCOPES = ('https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
          'https://www.googleapis.com/auth/googlehealth.sleep.readonly')
CREDS = Path(os.environ.get('WIZ_GOOGLE_HEALTH_CREDENTIALS',
    str(Path.home() / 'Downloads' / ('client_secret_' + CLIENT_ID + '.json'))))
STORE = Path.home() / 'Library' / 'Application Support' / 'WiZ Studio' / 'google-health-token.json'
LOCK = threading.RLock()
STATE = {}
TOKEN = {}
CACHE = {'at': 0, 'data': None}

def credentials():
    try:
        web = json.loads(CREDS.read_text())['web']
        if web['client_id'] != CLIENT_ID or not web.get('client_secret'):
            raise ValueError('The selected Google OAuth client does not match this app')
        return web
    except FileNotFoundError:
        raise ValueError('Google client file not found in Downloads')

def _request(url, data=None, bearer=None):
    headers = {'Accept': 'application/json'}
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        data = urlencode(data).encode()
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        # Do not expose tokens, detailed health payloads or Google response bodies.
        raise ValueError('Google Health returned HTTP ' + str(error.code)) from None
    except URLError:
        raise ValueError('Cannot reach Google Health right now') from None

def _load():
    global TOKEN
    if not TOKEN and STORE.exists():
        TOKEN = json.loads(STORE.read_text())

def _save():
    STORE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STORE.parent, 0o700)
    tmp = STORE.with_suffix('.tmp')
    fd = os.open(tmp, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file:
        json.dump(TOKEN, file)
    os.replace(tmp, STORE)
    os.chmod(STORE, 0o600)

def status():
    with LOCK:
        _load()
        try:
            credentials()
            ready = True
        except ValueError:
            ready = False
        return {'configured': ready, 'connected': bool(TOKEN.get('refresh_token')),
                'scopes': ['Heart rate and health metrics', 'Sleep']}

def start():
    credentials()
    with LOCK:
        state = secrets.token_urlsafe(32)
        STATE.clear()
        STATE[state] = time.time() + 600
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
        'client_id': CLIENT_ID, 'redirect_uri': REDIRECT, 'response_type': 'code',
        'access_type': 'offline', 'prompt': 'consent', 'scope': ' '.join(SCOPES),
        'state': state})

def callback(state, code):
    global TOKEN
    with LOCK:
        expiry = STATE.pop(state, 0)
        if not state or expiry < time.time() or not code:
            raise ValueError('Google connection expired; start again')
        client = credentials()
        response = _request('https://oauth2.googleapis.com/token', {
            'code': code, 'client_id': CLIENT_ID, 'client_secret': client['client_secret'],
            'redirect_uri': REDIRECT, 'grant_type': 'authorization_code'})
        if not response.get('refresh_token'):
            raise ValueError('Google did not grant ongoing access; reconnect and approve both scopes')
        TOKEN = {'refresh_token': response['refresh_token'], 'access_token': response['access_token'],
                 'expires_at': time.time() + int(response.get('expires_in', 3600))}
        _save()
        CACHE.update(at=0, data=None)

def _access():
    _load()
    if not TOKEN.get('refresh_token'):
        raise ValueError('Connect Google Health first')
    if TOKEN.get('expires_at', 0) > time.time() + 60:
        return TOKEN['access_token']
    client = credentials()
    response = _request('https://oauth2.googleapis.com/token', {
        'refresh_token': TOKEN['refresh_token'], 'client_id': CLIENT_ID,
        'client_secret': client['client_secret'], 'grant_type': 'refresh_token'})
    TOKEN['access_token'] = response['access_token']
    TOKEN['expires_at'] = time.time() + int(response.get('expires_in', 3600))
    _save()
    return TOKEN['access_token']

def _points(kind, filter_expr, access):
    url = 'https://health.googleapis.com/v4/users/me/dataTypes/' + kind + '/dataPoints?'
    url += urlencode({'filter': filter_expr, 'pageSize': 10000 if kind == 'heart-rate' else 25})
    return _request(url, bearer=access).get('dataPoints', [])

def readings(force=False):
    with LOCK:
        if CACHE['data'] is not None and time.time() - CACHE['at'] < (15 if force else 60):
            return CACHE['data']
        access = _access()
        now = datetime.now(timezone.utc)
        since_hr = (now - timedelta(hours=2)).isoformat().replace('+00:00', 'Z')
        since_sleep = (now - timedelta(days=3)).isoformat().replace('+00:00', 'Z')
        hr = _points('heart-rate', f'heart_rate.sample_time.physical_time >= "{since_hr}"', access)
        sleep = _points('sleep', f'sleep.interval.end_time >= "{since_sleep}"', access)
        samples = []
        for point in hr:
            value = point.get('heartRate', {})
            stamp = value.get('sampleTime', {}).get('physicalTime')
            bpm = value.get('beatsPerMinute')
            if stamp and bpm:
                samples.append({'bpm': int(bpm), 'time': stamp})
        latest = max(samples, key=lambda item: item['time']) if samples else None
        sessions = []
        for point in sleep:
            value = point.get('sleep', {})
            interval = value.get('interval', {})
            if interval.get('startTime') and interval.get('endTime'):
                sessions.append({'start': interval['startTime'], 'end': interval['endTime'],
                                 'summary': value.get('summary', {})})
        sessions.sort(key=lambda item: item['end'], reverse=True)
        result = {'heartRate': latest, 'heartRateSamples': len(samples),
                  'sleep': sessions[:3], 'checkedAt': now.isoformat()}
        CACHE.update(at=time.time(), data=result)
        return result

def disconnect():
    global TOKEN
    with LOCK:
        TOKEN = {}
        CACHE.update(at=0, data=None)
        STORE.unlink(missing_ok=True)
