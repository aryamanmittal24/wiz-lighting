import http.client
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server

class TrackAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.original_port = server.PORT
        server.PORT = cls.http.server_port
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        server.PORT = cls.original_port

    def request(self, body=b'1234', token=server.TOKEN, length=None):
        conn = http.client.HTTPConnection('127.0.0.1', server.PORT)
        conn.request('POST', '/api/music/analyze', body, headers={
            'X-Wiz-Token': token, 'Content-Type': 'application/octet-stream',
            'Content-Length': str(len(body) if length is None else length)})
        response = conn.getresponse()
        status, data = response.status, response.read()
        conn.close()
        return status, data

    def test_requires_session_token(self):
        self.assertEqual(self.request(token='wrong')[0], 403)

    def test_pcm_route_does_not_parse_audio_as_json(self):
        with patch.object(server, 'analyze_track', return_value={'bpm': 120}) as analyze:
            status, data = self.request()
        self.assertEqual(status, 200)
        analyze.assert_called_once_with(b'1234')
        self.assertIn(b'120', data)

    def test_rejects_large_upload_before_reading(self):
        self.assertEqual(self.request(body=b'', length=100_000_000)[0], 400)

if __name__ == '__main__': unittest.main()
