import unittest
from unittest.mock import patch
import server

class ControllerTests(unittest.TestCase):
    def test_astronaut_color_press_uses_online_room_lights(self):
        import astronaut_bridge
        with patch.dict(server.lights, {'a':{'online':True,'state':{}},'b':{'online':False,'state':{}}}, clear=True), patch.dict(server.settings, {'screen_order':['a','b']}, clear=False), patch.object(server,'stop_pattern'), patch.object(server,'control',return_value=[{'id':'a','ok':True}]) as control:
            server.astronaut_press('44')
        self.assertEqual(control.call_args.args[0], ['a'])
        self.assertEqual(control.call_args.args[1]['state'], True)
        self.assertEqual(control.call_args.args[1]['w'], 0)

    def test_astronaut_no_action_sends_nothing(self):
        with patch.object(server,'control') as control:
            server.astronaut_press('47')
        control.assert_not_called()

    def test_nec_capture_matches_remote_map(self):
        import astronaut_bridge
        match=astronaut_bridge.NEC.search('Protocol=NEC Address=0x0 Command=0x46 Raw-Data=0xB946FF00')
        self.assertEqual(match.group(1), '46')

    def test_rejects_invalid_values(self):
        for p in ({'dimming':0},{'dimming':101},{'r':256},{'state':'true'},{'temp':True},{'unknown':1}):
            with self.subTest(p=p), self.assertRaises(ValueError): server.validate(p)

    def test_rejects_unknown_target_without_sending(self):
        with patch.object(server,'udp') as udp, self.assertRaises(ValueError):
            server.control(['not-known'],{'state':True})
        udp.assert_not_called()

    def test_address_reassignment_never_sends_write(self):
        with patch.dict(server.lights,{'test':{'ip':'192.168.0.2'}},clear=True), patch.object(server,'udp',return_value={'mac':'different'}) as udp:
            result=server.control(['test'],{'state':True})
            self.assertFalse(result[0]['ok'])
            self.assertEqual(udp.call_count,1)
            self.assertEqual(udp.call_args.args[1],'getPilot')

    def test_partial_failure_is_reported(self):
        def fake(ip,method,params=None):
            if method=='getPilot': return {'mac':ip,'state':True,'dimming':20}
            if ip=='bad': raise TimeoutError('No response')
            return {'success':True}
        with patch.dict(server.lights,{i:{'ip':i} for i in ['good','bad']},clear=True), patch.object(server,'udp',side_effect=fake):
            result=server.control(['good','bad'],{'state':True})
            self.assertEqual([r['ok'] for r in result],[True,False])

    def test_scene_preserves_dynamic_settings_and_off(self):
        self.assertEqual(server.scene_params({'state':False,'sceneId':26,'speed':200,'dimming':1}),{'state':False,'sceneId':26,'speed':200,'dimming':1})

    def test_color_scene_clears_white_channels(self):
        p=server.scene_params({'state':True,'sceneId':0,'r':10,'g':20,'b':30,'dimming':50})
        self.assertEqual((p['w'],p['c'],p['r']),(0,0,10))

class ConnectionTests(unittest.TestCase):
    def test_one_missed_poll_keeps_last_state_then_three_marks_offline(self):
        import time
        item={'ip':'192.168.0.2','online':True,'seen':time.time(),'state':{'state':True}}
        with patch.dict(server.lights,{'test':item},clear=True), patch.object(server,'udp',side_effect=TimeoutError()):
            server.refresh_one(('test',item))
            self.assertTrue(item['online'])
            self.assertTrue(item['stale'])
            self.assertTrue(item['state']['state'])
            server.refresh_one(('test',item));server.refresh_one(('test',item))
            self.assertFalse(item['online'])

    def test_successful_poll_recovers_connection(self):
        key='123456789abc'
        item={'ip':'192.168.0.2','online':False,'misses':3}
        with patch.dict(server.lights,{key:item},clear=True), patch.object(server,'udp',return_value={'mac':key,'state':True}):
            server.refresh_one((key,item))
            self.assertTrue(item['online']);self.assertFalse(item['stale'])
            self.assertEqual(item['misses'],0)

    def test_fresh_identity_sends_only_one_command(self):
        import time
        item={'ip':'192.168.0.2','seen':time.time(),'state':{}}
        with patch.dict(server.lights,{'test':item},clear=True), patch.object(server,'udp',return_value={'success':True}) as udp:
            result=server.control(['test'],{'state':True})
            self.assertTrue(result[0]['ok'])
            udp.assert_called_once_with('192.168.0.2','setPilot',{'state':True})

    def test_sub_ten_brightness_uses_dimmed_channels_at_accepted_floor(self):
        import time
        item={'ip':'192.168.0.2','seen':time.time(),'state':{'r':255,'g':128,'b':0,'dimming':30}}
        with patch.dict(server.lights,{'test':item},clear=True), patch.object(server,'udp',return_value={'success':True}) as udp:
            result=server.control(['test'],{'state':True,'dimming':1})
            self.assertTrue(result[0]['ok'])
            udp.assert_called_once_with('192.168.0.2','setPilot',{
                'state':True,'dimming':10,'r':26,'g':13,'b':0
            })

class PatternTests(unittest.TestCase):
    def test_rejects_unknown_pattern_mode(self):
        with patch.dict(server.lights,{'a':{},'b':{}},clear=True):
            with self.assertRaises(ValueError): server.start_pattern(['a','b'],'unknown')

    def test_random_single_light_flashes_and_restore(self):
        calls=[]; waits=[]
        originals={key:{'ip':key,'online':True,'state':{'state':False,'dimming':25,'temp':4000}} for key in ('a','b','c')}
        def fake_control(ids,params):
            calls.append((ids,dict(params)))
            return [{'id':i,'ok':True} for i in ids]
        def wait(seconds):
            waits.append(seconds)
            if len(waits)==1: server.pattern_stop.set()
            return False
        with patch.dict(server.lights,originals,clear=True), patch.object(server,'refresh'), patch.object(server,'control',side_effect=fake_control), patch.object(server.pattern_stop,'wait',side_effect=wait):
            server.start_pattern(['a','b','c'])
            server.pattern_thread.join(3)
            self.assertFalse(server.pattern_thread.is_alive())
        flashes=[(ids,p) for ids,p in calls if p.get('state') is True]
        self.assertEqual(len(flashes),1)
        self.assertTrue(all(len(ids)==1 for ids,p in flashes))
        self.assertEqual(waits,[0.18])
        strike=flashes[0][1]
        self.assertEqual(strike['r'],0)
        self.assertEqual(strike['g'],0)
        self.assertEqual(strike['b'],0)
        self.assertEqual(strike['c'],255)
        self.assertEqual(strike['fadeIn'],20)
        offs=[p for _,p in calls if p.get('state') is False and p.get('fadeOut')==80]
        self.assertEqual(len(offs),1)
        restores=[(ids,p) for ids,p in calls if p.get('temp')==4000]
        self.assertEqual(len(restores),3)
        self.assertFalse(server.pattern_status['running'])

    def test_pattern_refuses_stale_light(self):
        with patch.dict(server.lights,{'a':{'online':True,'stale':True},'b':{'online':True}},clear=True), patch.object(server,'refresh'):
            with self.assertRaises(ValueError):server.start_pattern(['a','b'])

    def test_storm_flashes_two_lights_with_one_dimmer(self):
        calls=[]
        originals={key:{'ip':key,'online':True,'state':{'state':False,'dimming':25,'temp':4000}} for key in ('a','b','c','d')}
        def fake_control(ids,params):
            calls.append((ids,dict(params)))
            return [{'id':i,'ok':True} for i in ids]
        def wait(seconds):
            server.pattern_stop.set()
            return False
        with patch.dict(server.lights,originals,clear=True), patch.object(server,'refresh'), patch.object(server,'control',side_effect=fake_control), patch.object(server.pattern_stop,'wait',side_effect=wait), patch.object(server.random,'sample',return_value=['a','b']), patch.object(server.random,'randint',return_value=50), patch.object(server.random,'uniform',return_value=.1):
            server.start_pattern(['a','b','c','d'],'storm')
            server.pattern_thread.join(3)
        flashes=[p for _,p in calls if p.get('state') is True and p.get('r')==0]
        self.assertEqual(len(flashes),2)
        self.assertEqual(sorted(p['dimming'] for p in flashes),[50,100])
        self.assertTrue(all(p['fadeIn']==0 for p in flashes))
        offs=[p for _,p in calls if p.get('state') is False and p.get('fadeOut')==45]
        self.assertEqual(len(offs),2)

    def test_pattern_tolerates_two_failed_strikes_then_stops_on_third(self):
        originals={key:{'ip':key,'online':True,'state':{'state':False,'dimming':25,'temp':4000}} for key in ('a','b')}
        single_attempts=[]
        def fake_control(ids,params):
            if len(ids)==1 and params.get('r')==0:
                single_attempts.append(ids[0])
                return [{'id':ids[0],'ok':False,'error':'missed'}]
            return [{'id':i,'ok':True} for i in ids]
        with patch.dict(server.lights,originals,clear=True), patch.object(server,'refresh'), patch.object(server,'control',side_effect=fake_control):
            server.start_pattern(['a','b'])
            server.pattern_thread.join(3)
        self.assertEqual(len(single_attempts),3)
        self.assertFalse(server.pattern_status['running'])
        self.assertIn('Three strikes failed',server.pattern_status['error'])

if __name__=='__main__': unittest.main()
