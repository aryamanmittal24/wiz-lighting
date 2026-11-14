# WiZ Studio: from controls to a room interface

## Problem and ownership

The goal was to control a real bedroom's WiZ lights from a local dashboard, then make scenes and audio-driven effects usable through the same interface. Aryaman supplied the room references, hardware, feature direction and physical feedback. Implementation and debugging used AI assistance.

## Development milestones

1. **Local controls:** discover bulbs, select targets, change color/brightness and save scenes.
2. **Room interface:** translate reference photos into a 3D layout and map four fixtures to bulb identities.
3. **Scene workflow:** preview a look before applying it to physical lights; expose offline targets and failures.
4. **Music timing:** replace simplistic flashing with audio analysis, separate attack detection from tempo, and explore acoustic calibration for Bluetooth playback.
5. **Advance analysis and screen sync:** schedule lighting from local song analysis and shared-screen content while preserving manual override.
6. **Optional inputs:** extend the local studio with remote-button and health integration points; future game concepts remain in the roadmap.

## Decisions that mattered

| Issue | Implementation choice | Remaining limitation |
| --- | --- | --- |
| IP addresses change | Check bulb identity before writing | Discovery depends on the local network |
| Effects can fight manual controls | Cancel active ownership on manual action | Physical bulb response still varies |
| Commands may arrive late | Expire stale music frames | UDP acknowledgement is not optical verification |
| Users need to explore safely | Separate scene preview from apply | Preview brightness is illustrative |
| Bluetooth audio buffers | Optional acoustic calibration | Timing can change after reconnecting |

## Evidence

The source includes focused Python tests, JavaScript checks and browser test harnesses. The publication run passed 35 Python tests. Screenshots, audio captures and personal device configuration are deliberately excluded from the public repository. Physical timing and generalization to other rooms are not benchmarked.

## How to read the history

The first GitHub commit is a source snapshot uploaded on 15 November 2026. Earlier local changes were not committed individually. The sequence below is reconstructed from the development conversation and retained code; it is not a claim that Git recorded those stages. New commits preserve actual changes from publication onward. No contribution dates have been backfilled.

[Browse commits and diffs](https://github.com/aryamanmittal24/wiz-lighting/commits/main/)
