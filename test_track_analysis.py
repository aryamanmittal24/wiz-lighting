import unittest
import numpy as np
from track_analysis import analyze_pcm

RATE = 22050

def drums(bpm=120, seconds=14):
    y = np.zeros(RATE * seconds, dtype=np.float32)
    pulse = np.arange(int(.12 * RATE)) / RATE
    kick = .7 * np.sin(2*np.pi*(70*pulse-90*pulse*pulse)) * np.exp(-pulse*45)
    for t in np.arange(.5, seconds-.2, 60/bpm):
        start = round(t*RATE)
        y[start:start+len(kick)] += kick
    return y

class TrackAnalysisTests(unittest.TestCase):
    def test_known_drums_have_correct_tempo_and_attack_times(self):
        for bpm in (90, 120, 140):
            with self.subTest(bpm=bpm):
                result = analyze_pcm(drums(bpm).tobytes())
                self.assertLess(abs(result['bpm']-bpm), 4)
                self.assertGreater(len(result['hits']), 12)
                for t in result['hits']:
                    self.assertLess(abs((t-.5)/(60/bpm)-round((t-.5)/(60/bpm)))*(60/bpm), .07)
                self.assertEqual(result['duration'], 14)
                self.assertTrue(all(0 <= v <= 1 for frame in result['bands'] for v in frame))

    def test_silence_and_sustained_tone_do_not_flash(self):
        t = np.arange(RATE*8)/RATE
        for y in (np.zeros_like(t), .2*np.sin(2*np.pi*440*t)):
            result = analyze_pcm(y.astype('<f4').tobytes())
            self.assertLessEqual(len(result['hits']), 1)
            self.assertEqual(result['bpm'], 0)

    def test_quiet_subdivisions_do_not_double_tempo(self):
        y = drums(120, 18)
        rng = np.random.default_rng(42)
        t = np.arange(int(.025*RATE))/RATE
        hat = .015*rng.uniform(-1, 1, len(t))*np.exp(-t*180)
        for time in np.arange(.5, 17.8, .25):
            start = round(time*RATE)
            y[start:start+len(hat)] += hat
        # A silent break must not receive inferred metronome flashes.
        y[7*RATE:10*RATE] = 0
        result = analyze_pcm(y.tobytes())
        self.assertLess(abs(result['bpm']-120), 4)
        self.assertFalse(any(7.1 < hit < 9.9 for hit in result['hits']))

    def test_reject_invalid_pcm(self):
        for raw in (b'', b'abc', np.array([np.nan]*RATE, dtype='<f4').tobytes()):
            with self.assertRaises(ValueError): analyze_pcm(raw)

if __name__ == '__main__': unittest.main()
