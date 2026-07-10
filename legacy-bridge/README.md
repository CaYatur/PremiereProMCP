# PPMCP optional text bridge (ExtendScript / CEP)

**Not required** for normal editing. The UXP plugin + bridge cover cuts, color, effects, export, screenshots, and **PNG titles**.

This CEP panel is an **optional** add-on that enables **real editable MOGRT text** via classic ExtendScript (`getValue` / `setValue` on AE capsule properties). UXP cannot write string component params (`Illegal Parameter type`).

## What it does

| Role | Detail |
|------|--------|
| Connects as | `legacy-bridge` on `ws://127.0.0.1:8265` (same relay as UXP) |
| Methods | `legacy.mogrt.setText`, `getText`, `listTextProps`, `insertAndSetText`, `legacy.ping` |
| Scope | Text only — no general editing |

Full design: **`docs/TEXT_SYSTEM.md`**. Engine: `server/src/textEngine.ts`.

`text_write` path ladder (anti-fragile):

1. **A** UXP insert + UXP setText (usually blocked by string keyframe gap)  
2. **B** Hybrid: UXP insert + CEP setText  
3. **C** CEP `importMGT` + setText (**primary Type Tool–like** path)  
4. **D** PNG safety net (always kept)

CEP hardening: importMGT retries, multi-strategy writeTextParam, verify+rewrite, client reload host.jsx on EvalScript error.

## Install (Windows, dev)

```powershell
cd path\to\PremiereProMCP
powershell -ExecutionPolicy Bypass -File legacy-bridge\install-dev.ps1
```

Then:

1. Start the PPMCP bridge (relay on port 8265).
2. **Restart Premiere Pro**.
3. **Window → PPMCP Text Bridge** (leave the panel open).
4. Status should read **Connected**.
5. `app_get_connection_status` → `legacyBridgeConnected: true`.

`install-dev.ps1` enables `PlayerDebugMode` for unsigned CEP extensions (CSXS 9–12).

## Requirements for editable text

- AE-authored MOGRT (e.g. Premiere **Essential Graphics → [AE] Sports Package → …Lower Third…**).
- Premiere-native “Basic Title” / non-AE templates often **cannot** be written even with ExtendScript.
- You can pass `mogrtPath` to `text_write` if you have your own AE `.mogrt`.

## Uninstall

Delete:

`%APPDATA%\Adobe\CEP\extensions\com.ppmcp.legacybridge`

## Deprecation note

CEP / ExtendScript are on Adobe’s wind-down path. This helper is intentionally **narrow and optional** so core PPMCP stays UXP-native. When UXP gains string keyframes, remove this panel.

## Files

```
legacy-bridge/
  install-dev.ps1
  README.md
  cep/
    CSXS/manifest.xml
    client/          # panel UI + WebSocket client
    jsx/host.jsx     # ExtendScript text read/write
```
