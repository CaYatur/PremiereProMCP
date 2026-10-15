# Loading the PPMCP UXP plugin (dev mode)

**Developer:** [CaYaDev](https://cayadev.com)

1. Make sure the bridge is running: `npm run dev:bridge` (or use `installer\install.bat` which starts it at login).
2. Open Premiere Pro.
3. Open the **UXP Developer Tool**.
4. **Add Plugin** → select `plugin/manifest.json`.
5. Click **Load**.
6. Open the PPMCP panel:
   - **Active** (green) = connected to the bridge  
   - Bottom-right: **Developer: CaYaDev · [cayadev.com](https://cayadev.com)**  
7. If status stays red: start the bridge, reload the plugin, check UXP Developer Tool logs.
8. Optional smoke test from repo root: `node scripts/smoke-test.mjs`

For full Windows install: [`INSTALL.md`](../INSTALL.md) / `installer\install.bat`.

## Permissions (manifest.json)

- `network.domains: "all"` — kept because UXP host-domain matching for a
  loopback `ws://` URL with a port is not reliably documented; narrowing it
  risks the panel failing to connect. The panel only ever opens
  `ws://127.0.0.1:8265`, and the bridge itself rejects web origins and
  unauthenticated clients.
- `localFileSystem: "fullAccess"` — needed to probe AE MOGRT templates under
  `%APPDATA%` / Program Files (`getEntryWithUrl`) and as a fallback for
  reading the relay token from `%APPDATA%\PPMCP\relay-token`.
- `relay-token.txt` in this folder is written by the bridge and is
  per-install; it is git-ignored and never shipped.
