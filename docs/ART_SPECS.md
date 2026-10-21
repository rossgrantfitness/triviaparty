# Art specs

Sizes, formats and naming for everything in `art/`. Based on manifest section 9;
fill in details as the style guide is decided.

## Folders

- `art/source/` — working files (Blender `.blend`, Krita `.kra`, Aseprite `.aseprite`, audio masters). Claude Code never deletes these without asking.
- `art/export/` — finished files the game imports. One subfolder per asset, e.g. `art/export/fox/`.

## Naming

Lowercase with underscores: `fox.glb`, `fox_idle.glb`, `icon_science.png`, `host_final_question_01.ogg`.

## Characters

| Spec | Value |
|---|---|
| Format | `.glb` (glTF binary) exported from Blender |
| Triangles | Under 8,000 |
| Texture | One 1024 px texture |
| Rig | Godot-compatible, humanoid-ish |
| Animations (7) | idle, thinking, answer_locked, correct_cheer, wrong_slump, winner_dance, loser_clap |

## UI

| Asset | Spec |
|---|---|
| Host UI (TV) | 1920×1080 base, scales to 4K; type readable from a couch |
| Phone UI | Portrait 390×844 base, thumb-sized buttons, readable in bright rooms |
| Category icons | 512 px PNG, simple silhouettes |
| Steam capsules and logo | Check Steamworks' current capsule size list |

## Audio

- Masters: WAV 48 kHz in `art/source/audio/`
- Game files: `art/export/audio/sfx_<name>.wav` (short sounds stay WAV: instant
  start, tiny files). Music and voice lines will be OGG. `npm run sync-art`
  copies them to `host/assets/sfx/` and `client/public/sfx/`.
- Current sound effects are synthesized by `tools/audio/make_sfx.py`
  (needs Python with numpy; run it, then `npm run sync-art`).

### Sound identity

One iconic, memorable sound that makes the game a pleasure to use (the way great
Japanese products have a sound you'd know anywhere):

- **The signature:** a bright four-note rising jingle, G5 C6 E6 A6 (`sfx_logo`).
  It plays when the game opens and returns at the intro and the winner screen.
- **One family:** every other sound is a fragment of the jingle in the same bell
  tone and key: taps and lock-ins are single notes from it, "right" is its last
  two notes, "wrong" is a soft low bonk (never harsh), the winner fanfare is the
  full jingle bigger.
- **Pleasure over noise:** short (most under 0.3 s), soft attack, no harsh
  buzzers, lock-ins rise in pitch as more players answer.
- Names: `sfx_<what>.wav` (`sfx_correct.wav`, `sfx_steal.wav`).
- Voice lines named by ID: `host.final_question.01` → `host_final_question_01.ogg`
- Every third-party sound or music file is listed with its license in `licenses.md`

## Palette

Orange, grey, black, white, steel, yellow and a warm red (Ross, 2026-10-21; it
replaced the first asagi-shu palette). Same values on the TV (`host/scripts/look.gd`)
and the phones (`client/src/style.css`):

| Name | Hex | Used for |
|---|---|---|
| Orange | `#F47A1F` | Titles, primary buttons, highlights, stamps |
| Deep orange | `#C85A12` | Answer D, pressed buttons |
| Yellow | `#FFC53D` | Accents, stars, confetti, timer warning |
| Red | `#DE4A3B` | Answer A, wrong answers, steals |
| Steel | `#5B7486` | TV backdrop, panels |
| Dark steel | `#34495A` | Answer B, timer |
| Grey | `#A3A8AD` | Disconnected players, dividers |
| Black | `#1E1F22` | Text, outlines, answer C |
| White | `#FFFFFF` | Cards, drawing paper, text on dark tiles |
| Amber | `#D98A00` | Points and right answers (reads on white and steel) |
Answers always pair a color with a shape and letter: ▲ A, ● B, ■ C, ◆ D.

## Current placeholder animals

`dog` (shiba), `cat` (calico, maneki-neko collar and bell), `bunny`, `frog`, built
from rounded shapes by `tools/art/make_chibi_animals.py` (Blender 4.2+ or
`pip install bpy`). They are placeholders until the final characters are made.
To replace one, export a `.glb` to `art/export/<animal>/<animal>.glb` with the
same node names and run `npm run sync-art`.

The host animates characters in code, so a replacement only needs these nodes
(no baked animations required for now):

| Node | What it is | Origin |
|---|---|---|
| `body` | torso, feet, tail | between the feet, on the ground |
| `head` | head with ears, eyes, cheeks as children | at the neck |
| `arm_l`, `arm_r` | arms (children of `body`) | arm center |

Faces the camera along Blender −Y. About 1.2 units tall. Under 8,000 triangles
(current ones: 5,200 to 7,900).

## Open decisions

- 8 character accent colors (one per animal) for phone screens
- Animals 5 to 8
- 3D characters vs 2D-on-3D fallback (decide after the first test character)
