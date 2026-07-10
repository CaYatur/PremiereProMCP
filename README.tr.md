# Premiere Pro MCP (PPMCP)

**Claude, Cursor veya herhangi bir [MCP](https://modelcontextprotocol.io) istemcisinden Adobe Premiere Pro kontrolu — gercek timeline kurgusu.**

**Gelistirici:** [CaYaDev](https://cayadev.com)

> [!IMPORTANT]
> **Kurulum icin:** **[Releases](https://github.com/CaYatur/PremiereProMCP/releases)** sayfasina git, `PPMCP-Setup-x.x.x.zip` dosyasini indir, cikart, sonra **`Setup.bat`** dosyasina cift tikla. Kurulumun tamami bu tek dosyadan calisir.

Ana dil: **[English README](./README.md)** · [ES](./README.es.md) · [DE](./README.de.md) · [FR](./README.fr.md) · [JA](./README.ja.md) · [ZH](./README.zh-CN.md)

---

# Kurulum (buradan basla)

**Tam rehber:** **[INSTALL.md](./INSTALL.md)**  
(yollar, UXP Developer Tool indirme, Claude / Claude Code / Cursor, Premiere paneli)

## Herkes icin (onerilen): Releases ZIP

1. **[GitHub Releases](https://github.com/CaYatur/PremiereProMCP/releases)** ac  
2. **`PPMCP-Setup-x.x.x.zip`** indir, klasoru ac  
3. **`Setup.bat`** cift tikla (Windows PowerShell sihirbazi)  
4. Sihirbazda: **kurulum klasoru**, **surum**, istege bagli **CEP Text Bridge**  
5. **Onceki kurulum varsa:** Guncelle / Kaldir  
6. Bitince acilan dosyalar (bu PC'nin **tam yollari** yazili):
   - `%APPDATA%\PPMCP\HOW-TO-USE.txt`
   - `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt`
   - `%APPDATA%\PPMCP\mcp-config-snippet.json`

ZIP icinde portable **Node** vardir; ayri Node kurman gerekmez.

**Adobe UXP Developer Tool** (ucretsiz) sart — Premiere paneli icin bir kez kur:

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/  
- https://developer.adobe.com/photoshop/uxp/2021/devtool/installation/  
- Arama: **Adobe UXP Developer Tool download**

## Gelistiriciler: repo

```bash
git clone https://github.com/CaYatur/PremiereProMCP.git
cd PremiereProMCP
npm install
npm run build
npm run dev:bridge
```

veya Node kuruluysa: `installer\Setup.bat` / `installer\install.bat`  
Ayrinti: **[INSTALL.md](./INSTALL.md)**

---

## Bu nedir?

PPMCP, AI ajanini **calisan Premiere Pro**'ya baglayan bir MCP sunucusudur: sekans, kesim, yazi, sekil, ses, grade, export.

**Cekirdek: UXP.** Duzenlenebilir yazi icin **istege bagli CEP** (PNG yazi CEP olmadan da calisir).

---

## Ozellikler

- Timeline: import, overwrite, trim, marker, screenshot  
- Yazi / sekil / Motion keyframe  
- SFX + muzik bed, 0 dB unity, kullanici mix'ine mass yazmama  
- quality_pass, rate limit, checkpoint  
- Tek EXE kurulum (Releases)

---

## Lisans

MIT · **CaYaDev** · [cayadev.com](https://cayadev.com)
