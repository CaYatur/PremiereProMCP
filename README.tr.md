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

**Gercek, ucdan uca bir testte iyi calisan** (sifirdan kurulan ~48s'lik cok-track'li sequence: video + 4 audio track, transition, gain, keyframe'li fade, marker, title, screenshot, save): sequence/project olusturma, `clip_overwrite`, trim, roll/slip/slide, split, ripple delete, sekil ekleme + konum + dolgu rengi, `text_write`'in PNG fallback yolu, effect/transition listeleme, gain/dB kontrolu, project save/screenshot. Coklu adimli duzenlemeler (roll/slip/slide ve birlesik workflow araclari) Premiere'in `Project.executeTransaction()` mekanizmasi uzerinden tek atomik islem olarak commit ediliyor — yani islem yarida kesilirse timeline yarim-duzenlenmis halde kalmiyor. Bu transaction tasarimi eklentinin en guvenilir parcasi oldu.

**`clip_insert` ve `marker_add`, onceki testlerin isaret ettiginden daha guvenilir cikti.** Ikisi de artik pes etmeden once eklenti icinde ~10-15 farkli varyasyon deniyor (farkli track-index/limit-shift/marker-type kombinasyonlari) — son gercek oturumda `clip_insert`, ~19 video/audio klibin hepsinde basarili oldu (bu varyasyonlardan biri uzerinden), `marker_add` da hicbir hata bildirmeden 7 marker ekledi. Bu retry dongusu, tekil cagrilarin neden yavas hissettirebildiginin de bir parcasi. `marker_add` cagrisinin native yoldan mi yoksa virtual-marker fallback'inden mi gectigini kesin bilmiyoruz (ikisi de ayni basari mesajini donduruyor) — "muhtemelen calisiyor, hangi yoldan gectigi belirsiz" olarak ele al, "bilinen bozuk" degil.

**O oturumdan sonra duzeltildi (henuz canli yeniden test edilmedi):**

| Arac | Ne bozuktu | Ne degisti |
|------|------------|------------|
| `clip_append` | Surekli basarisiz oluyordu (`"Script action failed to execute"`) — `clip_insert`'in zaten sahip oldugu retry mantigi yerine tek sabit bir deneme kullaniyordu | Artik `clip_insert`'in ~10 varyasyonlu retry'ini (cast/raw item × limit-shift/audio-index kombinasyonlari) ayni yardimci fonksiyon uzerinden paylasiyor — `clip_insert`'i calistiran her sey `clip_append`'i de calistirmali |
| `sequence_set_in_out` | `"sequence.setInPoint is not a function"` — hicbir fallback yoktu | Artik bu kod tabanindaki her mutasyonun kullandigi `SequenceEditor` Action-factory desenini de (`createSetInPointAction`/`createSetOutPointAction`) deniyor, `typeof` korumali — o metod da yoksa hicbir sey degismiyor |
| `media_get_info` / `media_analyze_file_info` | Sure, cozunurluk veya fps hicbir zaman donmuyordu | Artik birkac ek alani (`getDuration`, `getFrameSize`, `width`/`height`, `getFrameRate`) `typeof` korumali sekilde deniyor — bu Premiere surumu bunlardan birini acarsa donduruyor, acmazsa `undefined` (oncekinden kotu degil) |

**Hala bozuk, cozum bulunamadi:**

| Arac | Sorun | Bunun yerine |
|------|-------|--------------|
| `track_add_video` / `track_add_audio` | Bu Premiere surumunde basarisiz (`"No UXP method to add audio track"`) — sequence preset'inin basladigi track sayisiyla sinirlisin | Track sayisini onceden, `sequence_create`/yeterli track'li bir preset ile planla; sonradan ekleyemezsin |

**Dusuk guvenirlikli iddialar (onceki statik kod analizinden, bu oturumda yeniden dogrulanmadi):** `text_set_content` (var olan MOGRT yazisini duzenleme) ve `shape_set_size` (tam piksel boyutu) daha once kod-seviyesi problarla bozuk bulunmustu — detay icin [docs/FEATURES.md](./docs/FEATURES.md)'e bak — ama `clip_insert` ayni tarz analizin isaret ettiginden daha duzgun ciktigina gore, bunlari da "canli yeniden kontrol edilmeli" olarak ele al, kesin dogru degil.

**Ayrica bulundu ve duzeltildi: bir bug degil, bir fade/keyframe sira sorunu.** `workflow_audio_fade`/`workflow_fade_clip`, cagrildigi andaki klibin *guncel* baslangic/bitis noktalarina gore fade keyframe hesapliyor — tek basina dogru, ama fade'leri ekledikten *sonra* klibi kisaltirsan (trim), eski fade-out keyframe'i yeni bitis noktasinin otesinde kalabilir ve sessizce uygulanmayi durdurur (fade-in calismaya devam eder, fade-out calismaz). Her iki aracin aciklamasi artik modeli once trim yapmasi icin acikca uyariyor.

Bu bolum, gercek Premiere oturumlari daha fazla somut veri surdukce guncellenir — statik kod analizi tek basina burada zaten bir kez yanilmisti (`clip_insert`).

---

## Lisans

MIT · **CaYaDev** · [cayadev.com](https://cayadev.com)
