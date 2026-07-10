# Text system — research, architecture, fragility

> Last updated: 2026-07-10 (deep research + multi-path engine)

## Goal

**Type Tool quality** when possible (editable graphic, font/size in Properties),  
**CEP** when UXP cannot write strings,  
**PNG** always as safety net — and make the whole stack **as unbreakable as the platform allows**.

There is **no public UXP Type Tool API**. “Type Tool quality” here means:  
an **AE-authored MOGRT** with a text field the editor can still change in Premiere — not a raster still.

---

## Platform facts (live-tested + desk research)

| Finding | Status |
|---------|--------|
| UXP create text layer / Type Tool | **Does not exist** in `@adobe/premierepro` |
| UXP `insertMogrtFromPath` | Works (AE + many Adobe templates) |
| UXP `ComponentParam.createKeyframe(string)` for MOGRT Text | **Fails** — `"Illegal Parameter type"` (types claim `string` is valid; runtime rejects) |
| UXP SimpleText `AE.ADBE PPro SimpleText` Content | **Same string gap** |
| UXP Position / Color on same Graphic Parameters | **Works** (`PointF`, `Color` instances) |
| ExtendScript `param.getValue()` / `setValue(json, true)` on **AE Capsule** | **Works** (textEditValue + fontTextRunLength) |
| Adobe bundled `Basic Title.mogrt` (`AE.ADBE Text`) | **Unreliable** for ES write — do not use |
| PNG import + overwrite | **Always works** (raster, not editable) |
| SVG import | **Not supported** by Premiere |

Sources: live probes in this repo (`plugin/src/handlers/title.js`, `debug.js`, `spike/extendscript-test`), Adobe forum reports on MOGRT text via scripting, Premiere scripting docs (`importMGT`).

---

## Path ladder (quality → reliability)

Implemented in `server/src/textEngine.ts` (`placeText`):

```
A) UXP insert + UXP setText     → editable-uxp   (rare today; kept for when Adobe fixes strings)
B) UXP insert + CEP setText     → editable-cep   (hybrid; less fragile than full ES insert)
C) CEP importMGT + setText      → editable-cep   (PRIMARY for Type Tool–like quality)
D) PNG System.Drawing + import  → raster-png     (SAFETY NET — never removed)
```

Each path:

- has **retries + backoff** (import race, component-not-ready)
- records **pathAttempts** for agents (no silent thrash)
- CEP paths optionally **read-back verify** and re-write once on mismatch

`text_write` uses A→B→C→D.  
`text_write_editable` uses A→B→C with `requireEditable` (no silent PNG).  
`text_write_png` forces D.

---

## What “Type Tool quality” means in practice

| Property | UXP Type Tool | Our best (CEP + AE Basic Text) | PNG |
|----------|---------------|--------------------------------|-----|
| Editable later in Properties | Yes | **Yes** | No |
| Font/size/style in Premiere | Yes | **Yes** (template defaults; user can change) | Baked into pixels |
| Looks clean (no sports chrome) | Yes | **Yes** with plain Basic Text.mogrt | Yes |
| Works offline / no bridge | Yes | Needs CEP panel open | Yes |
| Agent-stable | N/A (no API) | Medium (hardened) | High |

## Design system (model-facing)

**Do not put every title in the dead center.** That looks amateur on B-roll.

| style | Default anchor | Notes |
|-------|----------------|--------|
| `title` | **top_left** | Episode/show name |
| `lower_third` | **bottom_left** | Guest / name tag |
| `caption` | **bottom_center** | Subtitles |
| `title_center` / `end_card` | **center** | Only intentional cards |

Also default: **dark plate at same anchor**, **soft opacity fade-in ~0.5s**, large Motion scale.  
`trackIndex` ≥ 2 so plate sits on track−1. Never pixel Position (960,480).

---

## Fragility map & mitigations

| Fragility | Mitigation |
|-----------|------------|
| CEP panel closed | Auto PNG + clear recovery; `text_system_status` |
| CEP evalScript flaky | Client reloads `host.jsx` + **one retry** |
| `importMGT` race | 3 attempts; file exists check; path normalize |
| setText before components ready | 3 write retries after insert; hybrid path alternative |
| Wrong text silent | verify + re-write; multi-strategy `writeTextParam` |
| Wrong MOGRT type (Adobe Basic Title) | Only AE Capsule / Basic Text.mogrt |
| UXP string forever broken | Keep CEP until Adobe ships real string params; PNG forever |
| Auto scale/position hacks | **Removed** — hid text full-screen; user positions in Premiere |
| Agent thrash on text fail | `pathAttempts` + single recovery; stopOnError false on playbooks |

---

## Operator checklist (max quality)

1. Premiere open + project + active sequence  
2. UXP plugin loaded + bridge `:8265`  
3. **Window → PPMCP Text Bridge** open (status green)  
4. `plugin/templates/Basic Text.mogrt` present (AE-authored)  
5. Call `text_system_status` or `edit_bootstrap`  
6. `text_write` / playbook `title_card` / op `text`  

If bridge is down → PNG still places readable titles; tell the user it’s raster.

---

## Code map

| Piece | Role |
|-------|------|
| `server/src/textEngine.ts` | Multi-path `placeText`, PNG render, health |
| `server/src/tools/title.ts` | MCP tools (`text_write`, `text_system_status`, …) |
| `server/src/agent/ops.ts` | `text` / `lower_third` / `end_card` ops |
| `plugin/src/handlers/title.js` | UXP insert/setText/SimpleText (A) |
| `legacy-bridge/cep/jsx/host.jsx` | ES write + importMGT (B/C) |
| `legacy-bridge/cep/client/client.js` | Relay ↔ evalScript + reload retry |
| `plugin/templates/Basic Text.mogrt` | Type Tool–like plain AE template |

---

## Honest ceiling

Until Adobe exposes either:

1. a real Type Tool / text-layer create API in UXP, or  
2. string-capable `ComponentParam` keyframes for graphic text,

**editable “Type Tool quality” will depend on CEP/ExtendScript + AE MOGRTs**, with PNG as the reliability floor. This project keeps that ladder explicit and hardened rather than faking a pure-UXP Type Tool.

Use `text_bridge_ensure` for install steps; the panel cannot be auto-opened from UXP.

---

## Related: media analysis (silence / beats / STT)

See `server/src/mediaAnalysis.ts` — real ffmpeg DSP + optional whisper STT:

| Tool | Engine |
|------|--------|
| `analyze_detect_silence` | ffmpeg silencedetect |
| `analyze_detect_onsets` | PCM energy peaks (beat/footstep heuristics) |
| `analyze_detect_scene_changes` | ffmpeg scene filter |
| `analyze_suggest_cut_points` | merge of the above |
| `analyze_transcribe` / `caption_generate_auto` | whisper CLI or Windows Speech |
| `caption_import_srt` / `caption_place_from_srt` | SRT without STT |

Requires **ffmpeg** on PATH. Whisper optional: `pip install openai-whisper`.
