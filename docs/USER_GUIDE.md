# WiZ Studio

Double-click **Start.command**, then use the panel at http://127.0.0.1:8765.
Keep its Terminal window open while using the panel; Control-C stops it.
Open **3D Room** in the navigation, or http://127.0.0.1:8765/room, for the photo-based bedroom controls. Drag to orbit, scroll to zoom, and select one of the four numbered fixtures to change its real bulb. The room uses an approximate 11 × 10 ft footprint and 6 × 6.5 ft king mattress. Lighting is illustrative rather than a calibrated brightness simulation. Bulbs initially map by the existing Floor Lamp, Left Bulb, Right Bulb and Table lamp names; **Fixture connection** can override the mapping in this browser. Opening or rotating the page does not send light commands. Release the brightness slider to apply it. Existing effects stop when a manual command is sent, as on the main dashboard. Three.js r170 is bundled locally under `web/vendor` with its MIT license, so the 3D page needs no CDN connection.
Requires Python 3, already available on this Mac. No packages or cloud account required.

- Select individual lights or select all, then change power, brightness, color, or white temperature.
- Rename lights to match their physical locations. Names follow device identity if its network address changes; click Rescan after network changes.
- Quick looks apply a static color and brightness to selected lights.
- Save current look captures each selected light separately, including its power state. Applying a saved look restores those specific lights.
- Thunder flashes one selected bulb at a time in random order. It drives the dedicated warm/cool white LEDs, holds the strike for 0.18 seconds, then uses the bulb's own 80 ms fade-out. Wi-Fi response time adds some timing jitter between strikes. Start requires at least two responsive lights. Stop restores each light’s previous look. Manual light controls also stop Thunder. Keep the server running until Stop has completed. Flashing lights may trigger photosensitive seizures.
- Brightness updates while dragging; pending values coalesce so only the newest is sent. Light changes request zero fade time.

Lights must share the Mac’s network and have **Allow local communication** enabled in the WiZ app. Allow local network access for Python/Terminal if macOS asks. Status refreshes approximately every six seconds. Rescan finds new or moved lights.

Settings and scenes stay in `settings.json` beside the server. The server accepts connections only from this Mac. Closing the panel does not turn lights off.

## Astronaut remote

Open **Astronaut** from the sidebar. With the ESP32-S3 connected by USB and the KY-022 receiver wired to `GND`, `3V3`, and `GPIO16`, click **Start listening**. The existing IR learner firmware prints NEC button codes; the Mac reads them and applies the saved button map to online WiZ lights. Click **Stop** to disable the bridge. Listening stays off after a server restart, so remote presses never start controlling bulbs without an explicit Start. You can set any button to **No WiZ action** and save the map.

The remote still controls the projector directly. The WiZ colors are coordinated palettes; the projector remote offers relative controls and mode cycling, not exact RGB selection. Sending commands *to* the projector from the panel requires a wired and tested IR emitter, which is not part of this bridge yet.

## YouTube Sync

Open **YouTube Sync**, paste a YouTube link and press **Load**, or leave it blank if the video is already open. Press **Start color sync**, then share the YouTube or panel tab when macOS asks. The sampler boosts color saturation, ignores black UI regions, and continuously maps left, center, and right screen regions to the three selected lights over local UDP.

For audio-reactive effects, use **Music Sync**; no video upload or embedded player is required. Open any YouTube video in a tab, share that tab with audio enabled, choose a visualizer (default **Beat flash**), then start. Sensitivity and brightness are automatic. The audio-clock detector follows attacks independently of its tempo estimate and coalesces late light updates. See the Bose music-sync setup below.

If capture is unavailable in the embedded panel browser, open `http://127.0.0.1:8765/#patterns` in Chrome. Both sync modes require the browser's tab-sharing permission; Music Sync also requires **Share audio**.

### 3D Room Studio
Open `/room` (also linked from the main light deck). The page starts in **Preview**: adjust fixtures, select a group, or try Golden hour, Aurora, Deep focus, Cinema, Rose lounge, and Goodnight without sending bulb commands. **Apply preview to room** sends the four-fixture look and switches to Live control. **Live control** alone switches to the current physical states; subsequent changes control bulbs. All targeted fixtures must be online and assigned.

Night/day changes only the scene's ambient lighting. Custom looks save in this browser's local storage, independently of the main dashboard's server scenes. The renderer approximates lighting, not measured illumination. Scene application sends individual commands; partial failures are reported by fixture name and do not roll back successful bulbs.

## Music sync: Bose SoundLink Revolve+ II

The default **Beat flash** now uses sample-clock AudioWorklet processing (1024-sample Hann FFT, approximately 10 ms hops), positive log-spectral flux with kick/mid-band weighting, a rolling median/MAD adaptive threshold, local peak picking, and a 120 ms retrigger guard. There is no generated metronome. Tempo is a separate 10-second autocorrelation estimate with a broad 60–200 BPM range, metrical prior and change hysteresis. It is approximate; half/double-time ambiguity remains possible in music. It does not drive the attack time. Quiet input clears tempo after 1.2 seconds. Sensitivity, delay sliders and arbitrary ±30 BPM adjustments are removed.

Start sync in Chrome and share the music tab with audio. Keep the Bose as the Mac’s output. The initial 270 ms Bose preset is an **unmeasured fallback inherited from this setup**, not a Bose specification. For better alignment, click **Measure speaker timing** while a varied, percussive section plays through the Bose near the Mac. Allow the Mac’s built-in microphone. Ten seconds of local envelope correlation estimates the difference between shared-tab capture and acoustic playback, subtracting microphone input latency if the browser reports it. Two independent measurement halves must agree; silence, unrelated sound and ambiguous periodic offsets are rejected. The microphone closes on completion, Stop, or error. Audio is never uploaded or saved. Calibration is deliberately session-scoped because capture and Bluetooth buffering can change after reconnecting. A failed remeasurement keeps the existing timing.

Scheduling subtracts analysis age, estimated local HTTP dispatch time and a fixed **unmeasured 45 ms bulb reaction allowance**. AudioContext.outputLatency is not used as a measurement of another tab’s output path. The dedicated token-protected music endpoint dispatches a maximum of four bulbs in one frame without waiting/retrying ACKs; stale frames expire, out-of-order sequences are rejected, old sessions are invalidated, and manual controls cancel music ownership. UDP success means dispatch, not observed light output. Polling still verifies device identity. No Wi-Fi bulb system can guarantee sample-perfect physical alignment without optical feedback; browser background throttling, Wi-Fi jitter and microphone buffering remain limitations.

Research used:
- [Müller/FMP spectral novelty](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S1_NoveltySpectral.html)
- [Müller/FMP autocorrelation tempograms](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S2_TempogramAutocorrelation.html)
- [Web Audio timing specification](https://webaudio.github.io/web-audio-api/)
- [Bose Bluetooth audio/video timing guidance](https://support.bose.co.uk/article/slrvii-speakerwireless-sound-and-video-out-of-sync---ka08c000001buheaaq)

Validation: `node test_music_sync.cjs`, `python3 -m unittest test_music_bridge test_server`, and `node test_screen_sync.cjs`. `test_music_browser.html` can be served on a separate localhost development server to test the real worklet with a silent synthetic drum track; it does not send bulb commands or capture a microphone.

## Track-aware music sync

Open Music Sync and choose **Song file · advance analysis**. Select an audio file
supported by your browser (MP3/WAV/M4A/FLAC/OGG support varies), up to 15 minutes
and 128 MB. The browser decodes it and the local Python analyser uses librosa
0.11 to extract beat timestamps, low-weighted spectral-flux drum attacks, and
bass/mid/treble envelopes. Click **Play with lights**. Pause/resume and seeking
cancel old commands and rebuild the timeline. Hiding the page pauses track
playback because background browser timers cannot provide reliable light timing.
Analysis and decoded audio remain in memory; songs are not saved or sent to an
external service. The first analysis can take longer while numerical code warms up.

Run `Setup Music Analysis.command` once on a new installation (Python 3.13
recommended). It installs `requirements-analysis.txt` into `.venv-analysis`; the
main panel still uses only Python's standard library. Analysis runs in a bounded,
180-second subprocess and accepts authenticated PCM uploads only. One song is
analysed at a time.

The player schedules using `AudioContext.getOutputTimestamp()` where available,
then `outputLatency`, with a 270 ms Bose fallback estimate. A 45 ms WiZ optical
reaction estimate and measured HTTP dispatch lead are subtracted. **Measure
speaker timing** uses the built-in microphone to estimate acoustic delay;
unreported microphone buffering remains uncertain. This does not measure bulb
optical response. Beat/BPM results are estimates and may choose half/double tempo
on ambiguous music. Only detected attacks trigger flashes, not a free metronome.

**Live browser audio · YouTube / Spotify** preserves existing tab capture. In
Chrome choose the playing tab and enable Share audio. This is reactive analysis,
not whole-track prediction; protected playback may not expose audio. Direct
YouTube/Spotify account/player integration is not implemented. YouTube's iframe
API controls playback but does not expose the full audio samples for analysis.

Verification:

- `.venv-analysis/bin/python -m unittest test_track_analysis.py`
- `python3 -m unittest test_track_api.py test_music_bridge.py test_server.py`
- `node test_track_timeline.cjs` and `node test_music_sync.cjs`
- `node test_track_browser.cjs` with Playwright installed and Chrome available
  (uses a synthetic WAV, intercepts all light commands, and mutes browser output).

## Separate Studio views and scenes

The sidebar now switches between Lights, Scenes, Music, Screen Sync, Hand
Control, and Patterns, showing only the selected feature. Existing 3D Room,
Astronaut, and Health pages remain linked. Direct links such as `/#music-sync`
and older `/#looks` links still work. Switching Studio views retains active
capture/playback; changing an actual light or scene stops live modes as before.
Mobile navigation scrolls horizontally.

Scenes includes 18 curated static looks with Relax, Focus, Cinema, and Party
filters. Palette dots preview per-light colours, applied in the saved room
order. Colour scenes clear white channels; reading/focus scenes use white
colour temperature. Custom saved looks are available below the scene library.

Future ideas and the requested party-games backlog are saved in `TODO.md`.
Run `node test_studio_tabs.cjs` with Playwright and Chrome to verify navigation,
scene filtering and four-light commands without controlling physical bulbs.

## Motion animations

Open **Patterns** for Travelling Gradient, Light Chase, Bounce Scanner, Comet
Trail, Aurora Flow, Room Breathing, Room Strobe, and Alternating Strobe. Original
Thunder Classic/Thunderstorm effects are still available. Choose speed,
brightness, palette and direction, then Start. While running, **Apply changes**
restarts the effect with the new settings; **Stop & restore** restores each
bulb's original state. Motion follows the saved `screen_order`. Two to sixteen
online, non-excluded lights are supported.

Previews are illustrative and do not send light commands. Preview flashes cap
at 1 Hz and honour reduced-motion preferences. Physical strobe ranges from
0.75 to 3 Hz, while the network frame cadence is capped at 10 updates/second
per light. This is not a measured optical timing guarantee. Brightness trails
scale RGB values below the firmware's 10% dimming floor. Smooth modes send a
100 ms fade request; firmware response varies.

The server sends current frames without ACK waits or retries, skips missed
frames instead of building a backlog, and stops/restores if a target's verified
connection becomes stale. A pattern runs until stopped or replaced by another
light control, even when the browser switches tabs or closes. A running panel
on the same Mac can stop it again.

Tests: `python3 -m unittest test_pattern_frames.py test_server.py` and
`node test_pattern_browser.cjs` (Playwright + Chrome; all bulb APIs intercepted).

## Repository setup

This private source snapshot excludes personal device settings, OAuth tokens, screenshots and backups. Run `python3 server.py`, open http://127.0.0.1:8765, and use Rescan to discover your own bulbs. Settings are created locally. Optional Google Health requires your own OAuth client: set `WIZ_GOOGLE_HEALTH_CLIENT_ID` and `WIZ_GOOGLE_HEALTH_CREDENTIALS` (path to the downloaded client JSON). No credentials are included.
