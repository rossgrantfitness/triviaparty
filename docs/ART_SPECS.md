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
- Game files: OGG in `art/export/audio/`, normalized to consistent loudness
- Voice lines named by ID: `host.final_question.01` → `host_final_question_01.ogg`
- Every third-party sound or music file is listed with its license in `licenses.md`

## Palette

Asagi-shu (colorcombinations.org/palettes/asagi-shu), from the Edo period:

| Name | Hex | Used for |
|---|---|---|
| Asagi (pale blue-green) | `#6B9BB0` | TV backdrop, answer D |
| Shu (shrine vermilion) | `#D8453A` | Titles, primary buttons, answer A, collars |
| Gofun (chalk white) | `#F4EEE0` | Phone background, text on dark tiles |
| Sumi (ink black) | `#2B2B2B` | Text, outlines, answer C |

Helpers derived from it: deep asagi `#3F6E82` (answer B, timer), paper `#FFFAF0` (cards).
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
