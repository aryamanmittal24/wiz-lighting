"""Offline track descriptors. Input: mono 22050 Hz little-endian float32 PCM.
Audio lives only in process memory. No uploads to third-party services.
"""
import json
import sys

RATE = 22050
MAX_SECONDS = 15 * 60
MAX_BYTES = RATE * MAX_SECONDS * 4


def analyze_pcm(raw):
    import numpy as np
    import librosa
    if not raw or len(raw) % 4 or len(raw) > MAX_BYTES:
        raise ValueError('Choose a song up to 15 minutes long.')
    y = np.frombuffer(raw, dtype='<f4').copy()
    if len(y) < RATE or not np.isfinite(y).all() or np.max(np.abs(y)) > 8:
        raise ValueError('Invalid audio samples. Choose another audio file.')
    hop = 256
    spectrum = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    frequencies = librosa.fft_frequencies(sr=RATE, n_fft=2048)
    energy = np.sqrt(np.mean(spectrum**2, axis=0))
    bands = np.stack([np.sqrt(np.sum(spectrum[(frequencies >= lo) & (frequencies < hi)]**2, axis=0))
                      for lo, hi in ((30, 220), (220, 2200), (2200, 10000))])
    # Low-band spectral flux favours drum attacks over vocal/hi-hat subdivisions.
    np.multiply(spectrum, 10, out=spectrum)
    np.log1p(spectrum, out=spectrum)
    envelope = np.zeros(spectrum.shape[1], dtype=np.float32)
    for lo, hi, weight in ((30, 220, .65), (220, 2200, .30), (2200, 10000, .05)):
        band = spectrum[(frequencies >= lo) & (frequencies < hi)]
        novelty = np.diff(band, axis=1, prepend=band[:, :1])
        np.maximum(novelty, 0, out=novelty)
        envelope += weight*np.mean(novelty, axis=0)
    del spectrum, band, novelty
    peaks = librosa.onset.onset_detect(onset_envelope=envelope, sr=RATE, hop_length=hop,
                                      units='frames', backtrack=False, delta=.12,
                                      wait=round(.12*RATE/hop))
    floor = max(float(np.max(energy)) * .015, .0001)
    peaks = peaks[energy[peaks] > floor]
    # A steady tone has an initial attack, not a meaningful beat grid.
    bpm, beats = 0., np.array([])
    if len(peaks) >= 4:
        tempo, frames = librosa.beat.beat_track(onset_envelope=envelope, sr=RATE,
                                               hop_length=hop, start_bpm=110, trim=True)
        bpm = float(np.asarray(tempo).reshape(-1)[0])
        beats = librosa.frames_to_time(frames, sr=RATE, hop_length=hop)
    hits = librosa.frames_to_time(peaks, sr=RATE, hop_length=hop)
    # Compact ~25 Hz display/lighting envelope; normalize over the whole song.
    stride = 4
    descriptors = np.vstack([bands, energy])
    scale = np.maximum(np.percentile(descriptors, 95, axis=1, keepdims=True), 1e-6)
    descriptors = np.clip(descriptors/scale, 0, 1)
    descriptors[:, energy < floor] = 0
    waveform = np.max(np.abs(librosa.util.frame(np.pad(y, (0, (-len(y)) % 512)),
                                              frame_length=512, hop_length=512)), axis=0)
    return {'version': 1, 'duration': len(y)/RATE, 'bpm': round(bpm, 2),
            'beats': np.round(beats, 4).tolist(), 'hits': np.round(hits, 4).tolist(),
            'step': stride*hop/RATE, 'bands': np.round(descriptors[:, ::stride].T, 4).tolist(),
            'waveform': np.round(waveform, 4).tolist(),
            'engine': 'librosa 0.11 · offline spectral-flux analysis'}


if __name__ == '__main__':
    try:
        print(json.dumps(analyze_pcm(sys.stdin.buffer.read(MAX_BYTES+1)), allow_nan=False))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
