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

## Open decisions

- Color palette (1 background family + 8 character accent colors)
- First 8 animals
- 3D characters vs 2D-on-3D fallback (decide after the first test character)
