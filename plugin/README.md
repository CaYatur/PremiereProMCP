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
