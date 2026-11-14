# Track-aware music sync

- Add bounded, authenticated local PCM analysis with librosa in an isolated runtime.
- Extract beat timestamps, percussive attacks, normalized frequency bands and waveform.
- Add local song player and timeline, using the audio output clock and lookahead lighting scheduling.
- Preserve tab audio capture for streaming sources. Explain live vs advance analysis in UI.
- Keep Stop, seeking, source switches and other lighting controls cancellation-safe.
- Verify synthetic rhythmic audio, silence/tone rejection, scheduler seek/stall behavior, and browser UI without bulb writes.

Timing: output clock estimate minus 45 ms assumed bulb reaction and measured HTTP dispatch. Neither UDP completion nor audio timing measures optical bulb latency. Use existing microphone correlation for residual speaker timing.
