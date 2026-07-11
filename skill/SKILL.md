---
name: premiere-pro-mcp-editing
description: Quality-first automatic Premiere editing for weak and strong models (PPMCP)
---

# PPMCP agent skill — automatic systems over tool count

## Quality bar (beat competitors)

Competitors often ship 200–278 atomic tools with weak text, thrash retries, and no delivery pass. **We optimize for cut quality + automatic packs:**

| Capability | PPMCP | Typical CEP MCP |
|------------|-------|-----------------|
| Automatic edit | `edit_auto` + playbooks | Manual 15–40 tool chains |
| Editable titles | CEP + AE Basic Text | Often missing |
| Delivery polish | `quality_pass` / `edit_delivery` | Manual multi-tool |
| QA gate | `edit_verify` | None |
| Failures | `recovery` + continue plan | Model retry loops |
| Token cost | playbooks + compact | Full catalog dump |
| Architecture | UXP-native + optional text bridge | CEP-only (deprecating) |

**Never sacrifice quality for “one more atomic tool.”** Prefer automatic playbooks that already include grade + transitions + fades (+ normalize).

## Session flow

```
edit_bootstrap
  → edit_auto (intent)  OR  edit_playbook_run (named pack)
  → edit_verify
  → (strong model) atomic polish
  → export / save
```

## Prompt templates (copy-paste)

**Full system + user prompts:** [`docs/PROMPTS.md`](../docs/PROMPTS.md)

| Track | Tools | Use when |
|-------|-------|----------|
| **Weak** | only `edit_bootstrap` + `edit_auto` + `edit_help` | small models, low token |
| **Strong / premium** | playbooks first → atomics + vision QA | client review, trim, captions |

### Weak model (cheap, still good)

Only:

1. `edit_bootstrap`
2. `edit_auto` with intent + media args  
3. `edit_help` if stuck

```json
{
  "intent": "youtube episode",
  "args": {
    "paths": ["C:\\\\media\\\\clip.mp4"],
    "title": "Episode 1",
    "lowerThird": "Alex Host",
    "musicPath": "C:\\\\music\\\\bed.mp3",
    "look": "warm"
  }
}
```

```json
{
  "intent": "tiktok",
  "args": {
    "paths": ["C:\\\\media\\\\clip.mp4"],
    "title": "WAIT FOR IT",
    "sfxHits": [{ "path": "C:\\\\sfx\\\\whoosh.wav", "atSeconds": 1.2 }],
    "look": "warm"
  }
}
```

### Strong model (premium)

1. Same automatic pack for structure + polish (`edit_auto` / `edit_playbook_run`)  
2. Then atomics: `clip_trim`, `workflow_ken_burns`, `color_set_param`, `audio_set_gain`, silence/captions  
3. Vision: `sequence_screenshot` / `edit_verify`  
4. Export with explicit path/preset when user asks  

Phases: **structure → premium polish → verify** (see PROMPTS.md §B).

## Playbooks (automatic systems)

| id | Quality | What it does |
|----|---------|----------------|
| `full_cut` | **high** | import → sequence → title → sfx → quality_pass → save |
| `youtube` | **high** | title + lower-third + music + chapters + polish + end card |
| `social` | **high** | punchy title + SFX + Ken Burns + warm grade |
| `trailer` | **high** | film look + title + end card + delivery polish |
| `music_video` | **high** | music bed + SFX + quality |
| `podcast` | **high** | lower-thirds + chapters + normalize + grade |
| `animation_pack` | **high** | video + title + sfxHits + quality_pass |
| `delivery` | **high** | polish active sequence (no import) |
| `polish_export` | **high** | quality_pass + optional export |
| `assemble` | solid | import → sequence |
| `title_card` | high | editable text (PNG if no bridge) |
| `sfx_hits` | solid | place SFX at seconds/ticks |
| `qa_pass` | solid | verify only |
| `chapters` | solid | markers at every V cut |

## Custom `edit_run` ops

Core: `bootstrap`, `import`, `sequence_from_media`, `set_active`, `summarize`, `text`, `sfx`, `marker`, `transition_all`, `fade_video`, `grade`, `grade_all`, `quality_pass`, `export`, `save`

**Automatic systems:** `lower_third`, `end_card`, `titles`, `music_bed`, `duck`, `chapter_markers`, `polish`, `ken_burns`, `film_look`, `normalize_audio`, `audio_fade_all`, `verify`, `pip`

- Times: `atTicks` **or** `atSeconds`  
- Paths: absolute; missing files fail fast with recovery (no thrash)

## Failure rules (mandatory)

1. Read `recovery` — act once  
2. Same error twice → skip that op  
3. Never loop `text_*` / `PLUGIN_NOT_CONNECTED`  
4. Prefer continuing plan (`stopOnError: false`) so one miss does not kill the cut  
5. **`RATE_LIMITED` / `invalid: true`** → wait `retryAfterMs`, do **not** spam; use `edit_run` batches (Premiere crashes if flooded)  

## Rate limits (Premiere-safe)

| Limit | Default |
|-------|---------|
| Min gap between MCP tools | ~220 ms (main crash guard; hard reject if faster) |
| Soft gap between plugin calls | ~100 ms (auto-wait) |
| Max tools / min | ~400 (very high; gap is real limit) |
| Max heavy edits / min | ~300 |
| `edit_run` plan max | 30 ops, default `throttleMs: 120` |

Too fast → **INVALID** response (`code: RATE_LIMITED`). Slow down.

## Read first

**`docs/AGENT_USAGE.md`** — mandatory for every model (text, shape, SFX, crash safety).

## Text design system (corners first)

Deep design: `docs/TEXT_SYSTEM.md` + `server/src/textEngine.ts`.

| style | Default anchor | Use when |
|-------|----------------|----------|
| `title` | **top_left** | Episode/show name on B-roll — NOT dead center |
| `lower_third` | **bottom_left** | Names / guests |
| `caption` | **bottom_center** | Subtitles |
| `title_center` / `end_card` | **center** | Only intentional cards / “COMING SOON” |

**Always (defaults):** large scale, **fitted dark rounded PNG plate** (same px center as text), soft ~0.5s fade-in.  
`trackIndex` ≥ 2 (plate = track−1). Never invent 960,480.

```
// Good — one call text+plate
text_write { style: "title", trackIndex: 2, colorHex: "FFFFFF" }

// Good — REC blink as GENERIC objects (not magic tool)
text_write { text: "BACKROOMS REC", style: "title", trackIndex: 2 }
shape_add { trackIndex: 2, fillColor: {r:220,g:20,b:20}, width: 36, height: 36, x: 0.5, y: 0.16 }
effect_set_opacity { trackIndex: 2, clipIndex: <shape>, opacity: 100, atTicks: "..." }
effect_set_opacity { ... opacity: 10, atTicks: "..." }  // blink

// Bad
center every title; hand-align shape under text as plate; invent 960,480
```

### Shapes / colors / opacity

| Need | Tool |
|------|------|
| Fill color | `shape_set_fill_color` or `shape_add.fillColor` |
| Size | `shape_set_size` (square ≈ dot) — no real Size property; always approximates via uniform Scale %, not independent W×H |
| Position | `shape_set_position` / `effect_set_transform` 0–1 |
| Opacity over time | `effect_set_opacity` + **`atTicks`** keyframes |
| Text color | `text_write.colorHex` |

Match colors to picture (cool backrooms → white titles; danger → red REC).

## Audio (frame-controlled)

- Default gain **0 dB** if model omits `gainDb`  
- UXP Level linear 0..1 maps rubber-band (−∞ … **+15 dB**): **0 dB ≈ linear 0.178**, not 1.0  
- Model may boost: `gainDb: 6` … max **+15**  
- Intentional quiet: `gainDb: -6` or `soft: true`  
- Do not force Channel Volume L/R  



## Checkpoint / undo (project snapshot)

Premiere undo stack is unreliable for agents. Use **file checkpoints**:

```
checkpoint_create { label: "before-risky" }
// … cuts / deletes / sfx …
// if ruined:
checkpoint_restore { id: "<from create/list>" }
checkpoint_list
```

Stored under `~/.ppmcp/checkpoints/`. Call **before** mass edits.


## Token hygiene

- `compact: true` default on orchestration tools  
- One `edit_auto` > ten atomics  
- Avoid dumping full effect catalogs unless needed  
