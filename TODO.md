# WiZ Studio roadmap

## Next: party games (requested 2026-10-27)
- [ ] Reaction race: each light represents a player; phones or buttons submit responses.
- [ ] Simon Says: room lights play a colour sequence; players repeat it.
- [ ] Quiz mode: bulbs represent answer choices, with a scoreboard.
- [ ] Include Start/Stop, player setup, and a steady-light option.
- [ ] Keep games in a separate tab. User requested planning only for now.

## Projector + WiZ
- [ ] Identify the user's projector model and connection options.
- [ ] First route: Mac HDMI/USB-C second display, with existing Screen Sync matching projected visuals.
- [ ] Consider an ambient projection window and coordinated scene palettes.
- [ ] Add power/input control only if the projector supports a documented network API or a working IR emitter.

## Spare ESP32 ideas to choose from
- [ ] Physical scene remote / rotary dimmer using buttons or an encoder.
- [ ] Small status display: active scene, music tempo, connection status.
- [ ] Presence/daylight node with appropriate sensors; do not promise CSI presence accuracy.
- [ ] Party game buzzer / reaction button.
- [ ] Addressable LED strip controller (requires strip and suitable power supply).

## Music sync follow-up
- [ ] Test buffered browser-audio playback for live lookahead without song files.
- [ ] Measure acoustic timing on the Bose and optical WiZ response.
- [ ] Spotify DJ integration in India requires Premium Platinum; current account is Premium Standard. Do not start upgrades/trials.
