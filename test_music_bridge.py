import threading
import time
import unittest
from unittest.mock import patch
from music_bridge import MusicBridge

class MusicBridgeTests(unittest.TestCase):
    def setUp(self):
        self.lights={'one':{'ip':'192.0.2.1','online':True,'seen':time.time()}}
        self.bridge=MusicBridge(self.lights,threading.RLock(),lambda p:p)
        self.session=self.bridge.start()['session']
    def frame(self):
        return dict(session=self.session,sequence=1,expiresAt=time.time()*1000+100,frames=[{'id':'one','params':{'state':True,'r':255,'g':0,'b':0,'dimming':80}}])
    @patch('music_bridge.socket.socket')
    def test_dispatch_without_ack_and_reject_reordered(self,socket):
        sock=socket.return_value.__enter__.return_value
        self.assertEqual(self.bridge.frame(self.frame())['sent'],1)
        sock.sendto.assert_called_once();sock.recv.assert_not_called()
        self.assertTrue(self.bridge.frame(self.frame())['dropped'])
    @patch('music_bridge.socket.socket')
    def test_expired_frame_never_sends(self,socket):
        frame=self.frame();frame['expiresAt']=time.time()*1000-1
        self.assertTrue(self.bridge.frame(frame)['expired']);socket.assert_not_called()
    @patch('music_bridge.socket.socket')
    def test_stop_invalidates_pending_requests(self,socket):
        self.bridge.stop(self.session)
        self.assertTrue(self.bridge.frame(self.frame())['dropped']);socket.assert_not_called()
    @patch('music_bridge.socket.socket')
    def test_old_stop_cannot_cancel_new_session(self,socket):
        new=self.bridge.start()['session'];self.bridge.stop(self.session)
        frame=self.frame();frame['session']=new
        self.assertEqual(self.bridge.frame(frame)['sent'],1)
    @patch('music_bridge.socket.socket')
    def test_offline_and_stale_addresses_not_used(self,socket):
        self.lights['one']['seen']=time.time()-30
        self.assertEqual(self.bridge.frame(self.frame())['sent'],0)
        socket.return_value.__enter__.return_value.sendto.assert_not_called()
    def test_unknown_or_excluded_rejected(self):
        self.lights['one']['excluded']=True
        with self.assertRaises(ValueError):self.bridge.frame(self.frame())
    def test_max_four_lights(self):
        frame=self.frame();frame['frames']*=5
        with self.assertRaises(ValueError):self.bridge.frame(frame)

if __name__=='__main__':unittest.main()
