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

**277 MCP arac**, ~20 kategoride (project, sequence, track, clip, transition, effect — 52 tek-atislik ozel effect/audio/transition kisayolu dahil — color/Lumetri, audio, text/title/shape, marker/metadata, multicam, proxy/media, export, analysis, batch, selection/system, checkpoint, agent-orchestration/edit-pipeline, arti ~22 ust-seviye workflow arac). Bu araclarin cogu Adobe'nin kendi `@adobe/premierepro` UXP API'sindeki gercek, dokumante edilmis bir metoda karsilik geliyor. Gercek ucdan uca oturumlar artik asagidaki ~48s'lik duman testinden cok daha genis bir kismini calistirdi; su ana kadar cikan sorunlar asagida isaretlenenler ("Hala bozuk" ve "Dusuk guvenirlikli iddialar") — detayli arac-bazli dogrulama seviyesi icin [docs/FEATURES.md](./docs/FEATURES.md)'e bak.

**Gercek, ucdan uca bir testte iyi calisan** (sifirdan kurulan ~48s'lik cok-track'li sequence: video + 4 audio track, transition, gain, keyframe'li fade, marker, title, screenshot, save): sequence/project olusturma, `clip_overwrite`, trim, roll/slip/slide, split, ripple delete, sekil ekleme + konum + dolgu rengi, `text_write`'in PNG fallback yolu, effect/transition listeleme, gain/dB kontrolu, project save/screenshot. **`clip_append` artik gercek bir oturumda calistigi dogrulandi** — klipleri dogru sirayla ekliyor (onceden `"Script action failed to execute"` ile basarisiz oluyordu; asagidaki paylasimli-retry duzeltmesi canli olarak tuttu). Coklu adimli duzenlemeler (roll/slip/slide ve birlesik workflow araclari) Premiere'in `Project.executeTransaction()` mekanizmasi uzerinden tek atomik islem olarak commit ediliyor — yani islem yarida kesilirse timeline yarim-duzenlenmis halde kalmiyor. Bu transaction tasarimi eklentinin en guvenilir parcasi oldu.

**`clip_insert` ve `marker_add`, onceki testlerin isaret ettiginden daha guvenilir cikti.** Ikisi de artik pes etmeden once eklenti icinde ~10-15 farkli varyasyon deniyor (farkli track-index/limit-shift/marker-type kombinasyonlari) — son gercek oturumda `clip_insert`, ~19 video/audio klibin hepsinde basarili oldu (bu varyasyonlardan biri uzerinden), `marker_add` da hicbir hata bildirmeden 7 marker ekledi. Bu retry dongusu, tekil cagrilarin neden yavas hissettirebildiginin de bir parcasi. `marker_add` cagrisinin native yoldan mi yoksa virtual-marker fallback'inden mi gectigini kesin bilmiyoruz (ikisi de ayni basari mesajini donduruyor) — "muhtemelen calisiyor, hangi yoldan gectigi belirsiz" olarak ele al, "bilinen bozuk" degil.

**Duzeltme uygulandi, canli yeniden test bekliyor (henuz dogrulanmadi):**

| Arac | Ne bozuktu | Ne degisti |
|------|------------|------------|
| `sequence_set_in_out` | Gercek test onu iki hata mesajindan gecirdi: once `"sequence.setInPoint is not a function"`, sonra (ilk duzeltme denemesinden sonra) `"no candidate method found… Not exposed via UXP Sequence/SequenceEditor"` — ilk duzeltme Action factory'yi **yanlis nesnede** (`SequenceEditor`) ariyordu | **Kok neden bulundu:** `createSetInPointAction`/`createSetOutPointAction` `SequenceEditor`'da degil, **Sequence nesnesinin kendisinde** (Adobe'nin resmi `ppro_reference`'inda dogrulandi, Premiere 25.6'da geldi). Artik `sequence.createSetInPointAction(t)` / `createSetOutPointAction(t)` cagriliyor ve **ikisi tek bir compound transaction icinde** commit ediliyor (timeline hicbir zaman gecersiz in>out ara durumundan gecmiyor), eski editor/direct yollari fallback olarak kaliyor. `clip_append` (25.6 donemi bir action) bu build'de calistigi icin build ≥25.6, yani bu factory'ler mevcut olmali |
| `media_get_info` / `media_analyze_file_info` | Sure, cozunurluk veya fps hicbir zaman donmuyordu | Artik birkac ek alani (`getDuration`, `getFrameSize`, `width`/`height`, `getFrameRate`) `typeof` korumali sekilde deniyor — bu Premiere surumu bunlardan birini acarsa donduruyor, acmazsa `undefined` (oncekinden kotu degil) |

**Hala bozuk — dogrulanan Adobe platform kisitlamasi, eklenti bug'i degil:**

| Arac | Sorun | Bunun yerine |
|------|-------|--------------|
| `track_add` / `track_add_video` / `track_add_audio` | Premiere UXP API'si bos track eklemek icin **hicbir** metod sunmuyor — 2026-07-11'de Adobe'nin resmi referansina karsi dogrulandi: ne `Sequence` sinifinda ne de `SequenceEditor`'da `addTrack`/`addVideoTrack`/`addAudioTrack`/`createAddTrackAction` var. Bu Premiere'in kendisinde eksik; eklenti tarafi hicbir kod bunu ekleyemez | (1) Sequence'i bastan yeterli track ile olustur (`sequence_create` / bir preset). (2) `clip_overwrite`/`clip_insert` ile klibi daha yuksek bir track index'ine yerlestir (ikisi de artik calisiyor) — Premiere klibi oraya birakinca aradaki track'leri otomatik olusturmasi beklenir |
| `sequence_create` / `sequence_create_from_media` track sayisi | Preset'in sabit track sayisini aliyorsun (≈3 video + 3–4 audio) ve — yukaridaki `track_add` kisitlamasi yuzunden — sonradan bos track ekleyemiyorsun | Ayni cozum: yeterli track'li bir preset sec veya klipleri daha yuksek track index'lerine birakarak track olusturmaya zorla |

**Dusuk guvenirlikli iddialar (onceki statik kod analizinden, bu oturumda yeniden dogrulanmadi):** `text_set_content` (var olan MOGRT yazisini duzenleme) ve `shape_set_size` (tam piksel boyutu) daha once kod-seviyesi problarla bozuk bulunmustu — detay icin [docs/FEATURES.md](./docs/FEATURES.md)'e bak — ama `clip_insert` ayni tarz analizin isaret ettiginden daha duzgun ciktigina gore, bunlari da "canli yeniden kontrol edilmeli" olarak ele al, kesin dogru degil.

**Ayrica bulundu ve duzeltildi: bir bug degil, bir fade/keyframe sira sorunu.** `workflow_audio_fade`/`workflow_fade_clip`, cagrildigi andaki klibin *guncel* baslangic/bitis noktalarina gore fade keyframe hesapliyor — tek basina dogru, ama fade'leri ekledikten *sonra* klibi kisaltirsan (trim), eski fade-out keyframe'i yeni bitis noktasinin otesinde kalabilir ve sessizce uygulanmayi durdurur (fade-in calismaya devam eder, fade-out calismaz). Her iki aracin aciklamasi artik modeli once trim yapmasi icin acikca uyariyor.

Bu bolum, gercek Premiere oturumlari daha fazla somut veri surdukce guncellenir — statik kod analizi tek basina burada zaten bir kez yanilmisti (`clip_insert`).

---

## Lisans

MIT · **CaYaDev** · [cayadev.com](https://cayadev.com)
