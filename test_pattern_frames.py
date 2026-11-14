import unittest
from unittest.mock import patch
import server
try:
    from pattern_frames import animation_frames, validate_options, ANIMATIONS
except ImportError:
    animation_frames = None

class AnimationTests(unittest.TestCase):
    def test_frame_engine_exists(self):
        self.assertIsNotNone(animation_frames, 'Moving animation engine must exist')

    @unittest.skipIf(animation_frames is None, 'Engine not built yet')
    def test_all_frames_are_valid_wiz_commands(self):
        for mode in ANIMATIONS:
            for count in (2,4,8):
                for time in (0,.12,.5,1,2.5,8):
                    frames=animation_frames(mode,time,count)
                    self.assertEqual(len(frames),count)
                    for frame in frames:
                        server.validate(frame)
                        self.assertGreaterEqual(frame['dimming'],10)
                        self.assertEqual((frame['w'],frame['c']),(0,0))

    @unittest.skipIf(animation_frames is None, 'Engine not built yet')
    def test_chase_moves_and_reverse_mirrors_order(self):
        for mode in ('chase','bounce','comet'):
            a=animation_frames(mode,0,4)
            b=animation_frames(mode,1.5,4)
            self.assertNotEqual(a,b)
            self.assertEqual(animation_frames(mode,1.5,4,reverse=True),list(reversed(b)))
        first=animation_frames('chase',0,4)
        self.assertEqual(sum(f['dimming']==max(x['dimming'] for x in first) for f in first),1)

    @unittest.skipIf(animation_frames is None, 'Engine not built yet')
    def test_gradient_changes_spatially_and_over_time(self):
        a=animation_frames('gradient',0,4)
        self.assertEqual(len({(f['r'],f['g'],f['b']) for f in a}),4)
        self.assertNotEqual(a,animation_frames('gradient',1,4))

    @unittest.skipIf(animation_frames is None, 'Engine not built yet')
    def test_strobe_has_distinct_on_and_off_frames(self):
        frames=[animation_frames('strobe',i*.02,4,speed=100) for i in range(100)]
        self.assertTrue(any(all(f['state'] for f in frame) for frame in frames))
        self.assertTrue(any(not any(f['state'] for f in frame) for frame in frames))
        transitions=sum(frames[i][0]['state'] and not frames[i-1][0]['state'] for i in range(1,len(frames)))
        self.assertLessEqual(transitions,6,'Maximum strobe rate bounded to 3 Hz')

    @unittest.skipIf(animation_frames is None, 'Engine not built yet')
    def test_options_reject_unbounded_values(self):
        for options in ({'speed':0},{'brightness':101},{'reverse':'yes'},{'palette':'bad'},{'unknown':1},{'speed':True}):
            with self.assertRaises(ValueError):validate_options(options)
        self.assertEqual(validate_options({})['brightness'],65)

class AnimationLifecycleTests(unittest.TestCase):
    @unittest.skipIf(animation_frames is None, 'Engine not built yet')
    def test_stop_restores_originals_and_preserves_order(self):
        original={key:{'ip':'127.0.0.1','online':True,'state':{'state':False,'dimming':25,'temp':4000}} for key in ('a','b','c','d')}
        sent=[];restored=[]
        def send(sock,ids,frames):sent.append((ids,frames))
        def wait(seconds):server.pattern_stop.set();return True
        def control(ids,params):restored.extend(ids);return [{'id':i,'ok':True} for i in ids]
        with patch.dict(server.lights,original,clear=True),patch.object(server,'refresh'),patch.object(server,'control',side_effect=control),patch.object(server,'send_pattern_frame',side_effect=send),patch.object(server.pattern_stop,'wait',side_effect=wait):
            server.start_pattern(['d','c','b','a'],'gradient',{'speed':40,'brightness':55,'reverse':True,'palette':'ocean'})
            server.pattern_thread.join(3)
        self.assertEqual(sent[0][0],['d','c','b','a'])
        self.assertCountEqual(restored,original)
        self.assertFalse(server.pattern_status['running'])
        self.assertEqual(server.pattern_status['brightness'],55)

if __name__=='__main__':unittest.main()
