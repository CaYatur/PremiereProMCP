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

PPMCP **lokal bir stdio MCP sunucusu** — kendi PC'nde calisan bir Node islemi. AI istemcin onu bir alt-islem olarak baslatir ve stdin/stdout uzerinden konusur. Girilecek bir URL ya da port yok.

> [!WARNING]
> Claude'un **Settings → Connectors → Add custom connector** ekrani *Remote MCP server URL* ister. O ekran barindirilan (hosted) sunuculara aittir ve PPMCP icin **calismaz**. Istemcinin kendi lokal config dosyasini (veya `claude mcp add`) kullan.

Her istemci ayni iki degeri ister. Setup bunlari gercek yollarinla birlikte `%APPDATA%\PPMCP\HOW-TO-CONNECT.txt` ve `mcp-config-snippet.json` icine zaten yazdi:

| Deger | Varsayilan |
|-------|-----------|
| `command` | `%LOCALAPPDATA%\PPMCP\node\node.exe` |
| `args[0]` | `%LOCALAPPDATA%\PPMCP\server\dist\index.js` |

> **Kacis karakteri:** `.json` dosyasinin icinde her ters bolu **cift** yazilmali (`C:\\Users\\SEN\\...`); komut satirinda ise tek. Baglanti hatalarinin en yaygin sebebi budur.

**Claude Desktop** — Setup bunu senin icin yazar. Elle yapmak icin `%APPDATA%\Claude\claude_desktop_config.json` dosyasini ac (yoksa olustur), mevcut `"mcpServers"` objesine **ekle** (dosyanin tamamini degistirme), sonra uygulamayi **tamamen kapatip yeniden ac** — pencereyi kapatmak yetmez.

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

**Claude Code** (CLI) — `--scope user` her projede kullanilabilir yapar; `claude mcp list` ile dogrula.

```bash
claude mcp add premiere-pro --scope user -- "C:\Users\SEN\AppData\Local\PPMCP\node\node.exe" "C:\Users\SEN\AppData\Local\PPMCP\server\dist\index.js"
```

**Cursor** — Claude Desktop ile ayni JSON; `%USERPROFILE%\.cursor\mcp.json` (tum projeler) veya `.cursor\mcp.json` (sadece bu proje).

**VS Code / GitHub Copilot agent modu** — farkli sekle sahip tek istemci: anahtar `mcpServers` degil **`servers`**, ve acikca `"type": "stdio"` ister. `.vscode/mcp.json` icine koy, ya da **MCP: Open User Configuration** komutunu calistir.

```json
{
  "servers": {
    "premiere-pro": {
      "type": "stdio",
      "command": "C:\\Users\\SEN\\AppData\\Local\\PPMCP\\node\\node.exe",
      "args": ["C:\\Users\\SEN\\AppData\\Local\\PPMCP\\server\\dist\\index.js"]
    }
  }
}
```

**Windsurf** — `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (veya Cascade paneli → MCP ikonu → Configure), `mcpServers` sekli, sonra Windsurf'u yeniden yukle.

**Diger tum MCP istemcileri** — Cline, Roo Code, Continue, Zed, LM Studio, JetBrains AI, Gemini CLI, Codex CLI veya kendi host'un: transport olarak **`stdio`** ver (bazi istemciler buna "local", "command" veya "process" der), komut olarak Node yolunu, tek argüman olarak da server yolunu. Neredeyse hepsi yukaridaki `mcpServers` seklini kullanir; VS Code'un `servers` + `"type": "stdio"` yapisi tek yaygin istisnadir. Sadece uzak URL alani sunan bir istemci PPMCP'yi calistiramaz.

**Istemcisiz test** — bu komut bir baslangic satiri yazip beklemeli (durdurmak icin Ctrl+C). Yaziyorsa sunucu saglamdir, sorun istemci config'indedir:

```bash
"C:\Users\SEN\AppData\Local\PPMCP\node\node.exe" "C:\Users\SEN\AppData\Local\PPMCP\server\dist\index.js"
```

**Kaynaktan derliyorsan** (Setup ZIP yerine): `npm run build` calistir, komut olarak `node` (sistem Node 18+), argüman olarak da klonundaki `server/dist/index.js` mutlak yolunu ver.

### Modelin kac arac gordugunu sec

PPMCP 277 arac iceriyor. Hepsini kaydetmek her oturumda binlerce token'a mal olur ve arac secimini kotulestirir — bu yuzden sunucu bir **profil** kaydeder, geri kalani `tool_search` → `tool_schema` → `tool_invoke` ile tek cagri uzaginda tutar.

| `PPMCP_PROFILE` | Kayitli arac | Ne zaman |
|-----------------|--------------|----------|
| `core` | ~19 | Kucuk/ucuz modeller; sadece `edit_bootstrap` → `edit_auto` → `edit_verify` |
| `standard` *(varsayilan)* | ~109 | Canli dogrulanmis araclar + gercek bir kurguda kullanilan atomikler |
| `full` | 277 | Tum katalog acik, 1.0.x'teki gibi |

```json
"env": { "PPMCP_PROFILE": "standard" }
```

Istemci bazinda tam anlatim ve sorun giderme tablosu: **[INSTALL.md](./INSTALL.md)**.

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

**277 MCP arac**, ~20 kategoride. 1.1.0'dan itibaren sunucu tum katalogu degil bir **profil** kaydediyor (varsayilan 109); geri kalani `tool_search` → `tool_schema` → `tool_invoke` ile tek cagri uzakta, `PPMCP_PROFILE=full` eski yuzeyi geri getiriyor. Katalog su kategorileri kapsiyor: project, sequence, track, clip, transition, effect — 52 tek-atislik ozel effect/audio/transition kisayolu dahil — color/Lumetri, audio, text/title/shape, marker/metadata, multicam, proxy/media, export, analysis, batch, selection/system, checkpoint, agent-orchestration/edit-pipeline, arti ~22 ust-seviye workflow arac). Bu araclarin cogu Adobe'nin kendi `@adobe/premierepro` UXP API'sindeki gercek, dokumante edilmis bir metoda karsilik geliyor. Gercek ucdan uca oturumlar artik asagidaki ~48s'lik duman testinden cok daha genis bir kismini calistirdi; su ana kadar cikan sorunlar asagida isaretlenenler ("Hala bozuk" ve "Dusuk guvenirlikli iddialar") — detayli arac-bazli dogrulama seviyesi icin [docs/FEATURES.md](./docs/FEATURES.md)'e bak.

**Gercek, ucdan uca bir testte iyi calisan** (sifirdan kurulan ~48s'lik cok-track'li sequence: video + 4 audio track, transition, gain, keyframe'li fade, marker, title, screenshot, save): sequence/project olusturma, `clip_overwrite`, trim, roll/slip/slide, split, ripple delete, sekil ekleme + konum + dolgu rengi, `text_write`'in PNG fallback yolu, effect/transition listeleme, gain/dB kontrolu, project save/screenshot. **`clip_append` artik gercek bir oturumda calistigi dogrulandi** — klipleri dogru sirayla ekliyor (onceden `"Script action failed to execute"` ile basarisiz oluyordu; paylasimli-retry duzeltmesi canli olarak tuttu). **`sequence_set_in_out` de artik dogrulandi** (2026-07-11 yeniden test) — in/out noktalarini `"via": "sequence.createSetInPointAction + sequence.createSetOutPointAction"` ile set etti, 1.0.1'deki kok-neden duzeltmesini teyit etti (factory `SequenceEditor`'da degil, Sequence nesnesinde). Coklu adimli duzenlemeler (roll/slip/slide ve birlesik workflow araclari) Premiere'in `Project.executeTransaction()` mekanizmasi uzerinden tek atomik islem olarak commit ediliyor — yani islem yarida kesilirse timeline yarim-duzenlenmis halde kalmiyor. Bu transaction tasarimi eklentinin en guvenilir parcasi oldu.

**`clip_insert` ve `marker_add`, onceki testlerin isaret ettiginden daha guvenilir cikti.** Ikisi de artik pes etmeden once eklenti icinde ~10-15 farkli varyasyon deniyor (farkli track-index/limit-shift/marker-type kombinasyonlari) — son gercek oturumda `clip_insert`, ~19 video/audio klibin hepsinde basarili oldu (bu varyasyonlardan biri uzerinden), `marker_add` da hicbir hata bildirmeden 7 marker ekledi. Bu retry dongusu, tekil cagrilarin neden yavas hissettirebildiginin de bir parcasi. `marker_add` cagrisinin native yoldan mi yoksa virtual-marker fallback'inden mi gectigini kesin bilmiyoruz (ikisi de ayni basari mesajini donduruyor) — "muhtemelen calisiyor, hangi yoldan gectigi belirsiz" olarak ele al, "bilinen bozuk" degil.

**Duzeltme uygulandi, canli yeniden test bekliyor (henuz dogrulanmadi):**

| Arac | Ne bozuktu | Ne degisti |
|------|------------|------------|
| `app_get_version` | Hep `null` donuyordu — kod `version`'i `Application` **class**'indan okuyordu, ama Adobe'nin `ppro_reference`'ine gore `version` bir *instance* property (`Promise<string>`, 25.6+), o yuzden hic cozulmuyordu | Artik surumu UXP **host** nesnesinden okuyor (`require("uxp").host.version`) — her UXP uygulamasinin sundugu build-bagimsiz yol; `{ version, host, uxpVersion }` donuyor. 1.0.2'de duzeltildi (`ppro.Application.version` sadece ucuz bir yedek olarak kaldi) |
| `media_get_info` / `media_analyze_file_info` | Sure, cozunurluk veya fps hicbir zaman donmuyordu | Artik birkac ek alani (`getDuration`, `getFrameSize`, `width`/`height`, `getFrameRate`) `typeof` korumali sekilde deniyor — bu Premiere surumu bunlardan birini acarsa donduruyor, acmazsa `undefined` (oncekinden kotu degil) |

**Hala bozuk — dogrulanan Adobe platform kisitlamasi, eklenti bug'i degil:**

| Arac | Sorun | Bunun yerine |
|------|-------|--------------|
| `track_add` / `track_add_video` / `track_add_audio` | Premiere UXP API'si bos track eklemek icin **hicbir** metod sunmuyor — 2026-07-11'de Adobe'nin resmi referansina karsi dogrulandi: ne `Sequence` sinifinda ne de `SequenceEditor`'da `addTrack`/`addVideoTrack`/`addAudioTrack`/`createAddTrackAction` var. Bu Premiere'in kendisinde eksik; eklenti tarafi hicbir kod bunu ekleyemez | Track sayisini **sequence'i olustururken** sec (`sequence_create`, veya yeterli track'i olan bir sequence preset'i). **Sonradan track eklemenin hicbir yolu yok** — "klibi daha yuksek bir track index'ine koyup otomatik track actir" fikri de burada **calismiyor**: 2026-07-11'de denendi ve `"[INTERNAL_ERROR] BE: An invalid track index was passed to the sequence"` ile basarisiz oldu |
| `sequence_create` / `sequence_create_from_media` track sayisi | Preset'in sabit track sayisini aliyorsun (≈3 video + 3–4 audio) ve — yukaridaki `track_add` kisitlamasi yuzunden — sonradan hicbir yolla track ekleyemiyorsun | Track sayisini olusturma aninda planla (yeterli track'li bir preset). Mevcut track sayisinin otesine klip eklemek track listesini buyutmez, hata verir |

**Dusuk guvenirlikli iddialar (onceki statik kod analizinden, bu oturumda yeniden dogrulanmadi):** `text_set_content` (var olan MOGRT yazisini duzenleme) ve `shape_set_size` (tam piksel boyutu) daha once kod-seviyesi problarla bozuk bulunmustu — detay icin [docs/FEATURES.md](./docs/FEATURES.md)'e bak — ama `clip_insert` ayni tarz analizin isaret ettiginden daha duzgun ciktigina gore, bunlari da "canli yeniden kontrol edilmeli" olarak ele al, kesin dogru degil.

**Ayrica bulundu ve duzeltildi: bir bug degil, bir fade/keyframe sira sorunu.** `workflow_audio_fade`/`workflow_fade_clip`, cagrildigi andaki klibin *guncel* baslangic/bitis noktalarina gore fade keyframe hesapliyor — tek basina dogru, ama fade'leri ekledikten *sonra* klibi kisaltirsan (trim), eski fade-out keyframe'i yeni bitis noktasinin otesinde kalabilir ve sessizce uygulanmayi durdurur (fade-in calismaya devam eder, fade-out calismaz). Her iki aracin aciklamasi artik modeli once trim yapmasi icin acikca uyariyor.

Bu bolum, gercek Premiere oturumlari daha fazla somut veri surdukce guncellenir — statik kod analizi tek basina burada zaten bir kez yanilmisti (`clip_insert`).

---

## Lisans

MIT · **CaYaDev** · [cayadev.com](https://cayadev.com)
