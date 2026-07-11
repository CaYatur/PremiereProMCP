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

## MCP istemcini bagla

PPMCP **lokal (yerel) bir stdio MCP sunucusu** — kendi PC'nde calisan bir Node islemi, AI istemcinle dogrudan konusur. **Uzak (remote) bir MCP baglayici degildir** — yani Claude'un Connectors ekranindaki *"Add custom connector" → Remote MCP server URL* akisi burada gecerli degil. Setup sonrasi tam yollarin zaten `HOW-TO-CONNECT.txt` / `mcp-config-snippet.json` icinde hazir.

**Claude Desktop** — Setup bunu `claude_desktop_config.json`'a otomatik ekler. Elle yapmak icin `"mcpServers"` objesine ekle:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "C:\\Users\\SEN\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\SEN\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Claude Code** (CLI):

```bash
claude mcp add premiere-pro -- "C:\Users\SEN\AppData\Local\PPMCP\node\node.exe" "C:\Users\SEN\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Settings → MCP → Add server (bu bir *lokal komut*, URL degil):
- Command: yukaridaki Node yolu
- Args: yukaridaki server yolu

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

## Arac durumu: gercekte test edilen neler

**~225 MCP arac**, 17 kategoride (project, sequence, track, clip, transition, effect, color/Lumetri, audio, text/title/shape, marker/metadata, multicam, proxy/media, export, analysis, batch, selection/system, arti ~15 ust-seviye workflow arac). Bu araclarin cogu Adobe'nin kendi `@adobe/premierepro` UXP API'sindeki gercek, dokumante edilmis bir metoda karsilik geliyor ve calismasi beklenir, ama hepsi tek tek canli bir Premiere oturumunda test edilmedi henuz — detayli arac-bazli dogrulama seviyesi icin [docs/FEATURES.md](./docs/FEATURES.md)'e bak.

**Gercek testte iyi calisan:** cekirdek kurgu yolu (`clip_overwrite`, trim, roll/slip/slide, split, ripple delete), sequence/track yonetimi, sekil ekleme + konum + dolgu rengi, `text_write`'in PNG fallback yolu, effect/transition/marker listeleme, medya import. Coklu adimli duzenlemeler (roll/slip/slide ve birlesik workflow araclari) Premiere'in `Project.executeTransaction()` mekanizmasi uzerinden tek atomik islem olarak commit ediliyor — yani islem yarida kesilirse timeline yarim-duzenlenmis halde kalmiyor. Bu transaction tasarimi eklentinin en guvenilir parcasi oldu.

**Su anda bilinen sorunlar, her biri icin gercek bir alternatifle** (dorde de bu Premiere surumunun scripting API'sindeki spesifik bosluklar, belirsiz "calismayabilir" degil):

| Arac | Sorun | Bunun yerine |
|------|-------|--------------|
| `clip_insert` | Bu Premiere surumunde basarisiz oluyor (`SequenceEditor` insert action reddediliyor); senin sequence'ina eklemek yerine medyadan **yeni bir sequence** olusturuyor | Var olan sequence'a eklemek icin `clip_overwrite` |
| `marker_add` | Native marker olusturma basarisiz oluyor; Sequence Properties'e yazilan bir "virtual marker"a duruyor — `marker_list`/`marker_go_to` okuyabiliyor ama Premiere'in kendi marker track'inde **gorunmuyor** | Su an icin bilinen bir sinirlama — gorsel bir Premiere marker'i gerekiyorsa kendi takibini yap |
| `text_set_content` (var olan yaziyi duzenleme) | Sadece istege bagli CEP Text Bridge baglıyken, After Effects ile hazirlanmis bir MOGRT uzerinde guvenilir. CEP yoksa, pure-UXP yolu Premiere tarafindan reddediliyor (MOGRT `Text` property'sinde `Illegal Parameter type`) | Yeni yazi koymak icin `text_write` / `text_add` — CEP olmasa bile PNG fallback ile her zaman basariyla sonuclanir |
| `shape_set_size` | Hazir sekil sablonunda gercek bir piksel-boyut ozelligi hic disari acilmadi; her zaman tek yonlu Motion Scale % ile yaklasik boyut veriyor, bagimsiz genislik/yukseklik degil | "Buyut/kucult" icin sorun degil; tam piksel boyutu icin guvenme |

Dort dursuz bosluk oldugu gibi listelenir, sessizce calisiyormus gibi gosterilmez. Bu tablo, altta yatan Premiere/UXP API degistikce guncellenir.

---

## Lisans

MIT · **CaYaDev** · [cayadev.com](https://cayadev.com)
