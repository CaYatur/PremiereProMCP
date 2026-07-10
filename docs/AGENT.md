# Agent orchestration — quality-first + automatic systems

> **Full usage rules for all models:** [`docs/AGENT_USAGE.md`](./AGENT_USAGE.md)  
> Read that **before** calling tools (text/shape/SFX/quality_pass).

## Goal

Higher **delivery quality** than tool-count competitors, with **low token cost** and **no retry thrash**.

We do **not** win by shipping more atomic mirrors of Premiere menus. We win with:

1. **Automatic packs** (one call → complete professional cut)
2. **Intent router** (`edit_auto`)
3. **Delivery polish** (`quality_pass` / `polish` / `edit_delivery`) — **capped** (crash-safe)
4. **QA gate** (`edit_verify`)
5. **Editable text** + **generic shapes** (color/size/opacity keyframes) + structured recovery

## Quality stack

1. **Editable titles** via multi-path text engine (UXP → hybrid → CEP → PNG). See `docs/TEXT_SYSTEM.md`.
2. **`quality_pass`** / **`polish`**: grade + transitions + fades (+ audio normalize).
3. **Path validation** before import (fail fast).
4. **`atSeconds`** support (models think in seconds).
5. **TIMEOUT single retry** only — then recovery, no loops.
6. **Playbooks** encode professional defaults so weak models still ship polish.

## Entry tools (prefer these)

| Tool | Role |
|------|------|
| `edit_bootstrap` | Session start |
| `edit_auto` | **Intent → best playbook** (weak-model default) |
| `edit_help` | Cheatsheet |
| `edit_playbook_list` / `edit_playbook_run` | Named recipes |
| `edit_pipeline` | Chain multiple playbooks |
| `edit_run` / `edit_once` | Custom op plans |
| `edit_quality_pass` | Delivery grade+transitions+fades |
| `edit_delivery` | Max polish (normalize + optional film/KB) |
| `edit_verify` | QA gate before export |

## Automatic playbooks

| id | Use when |
|----|----------|
| `full_cut` | Default end-to-end quality |
| `youtube` | Episode: title, lower-third, music, chapters, end card, polish |
| `social` | Shorts/Reels: punchy title, SFX, Ken Burns, warm grade |
| `trailer` | Film look, title, end card, cinematic polish |
| `music_video` | Music bed + SFX + quality |
| `podcast` | Lower-thirds, chapters, normalize audio |
| `animation_pack` | Silent/anim + title + SFX hits |
| `delivery` | Polish active sequence only |
| `qa_pass` | Verify without editing |
| `chapters` | Markers at every cut |
| `assemble` | Rough import → sequence |
| `title_card` / `sfx_hits` / `polish_export` | Focused recipes |

## Ops (edit_run)

`bootstrap`, `import`, `sequence_from_media`, `set_active`, `summarize`, `text`, `lower_third`, `end_card`, `titles`, `sfx`, `music_bed`, `duck`, `marker`, `chapter_markers`, `transition_all`, `fade_video`, `grade`, `grade_all`, `quality_pass`, `polish`, `ken_burns`, `film_look`, `normalize_audio`, `audio_fade_all`, `verify`, `pip`, `export`, `save`

## Preferred flow

```
edit_bootstrap
  → edit_auto({ intent: "youtube", args: { paths, title, musicPath } })
  → edit_verify
  → export (if not in playbook)
```

## Vs competitors

| | Typical CEP MCP | PPMCP |
|--|-----------------|-------|
| Philosophy | Mirror every API | Outcome + automatic packs |
| Weak models | Lost in 200+ tools | `edit_auto` / playbooks |
| Text | Often unsupported | Editable MOGRT + recovery |
| Delivery | Manual multi-tool | `polish` / `delivery` |
| Failure | Model thrash | recovery + continue |
| Platform | CEP (sunset) | UXP + optional CEP text |

## Prompt templates

Copy-paste **weak (`edit_auto` only)** vs **strong (premium)** system/user prompts:

→ **`docs/PROMPTS.md`**

See also `skill/SKILL.md` and `server/src/agent/ops.ts`.
