# PPMCP — Agent kullanım kılavuzu (tüm modeller)

Bu belge **Claude / GPT / Gemini / Cursor** gibi her agent için zorunlu.  
Araçları çağırmadan önce oku. Yanlış varsayımlar Premiere’i şişirir veya çökertir.

---

## 1) Oturum disiplini

```
1. edit_bootstrap          → plugin bağlı mı?
2. (isteğe bağlı) edit_help / text_design_guide
3. checkpoint_create       → riskli iş öncesi snapshot (önerilir)
4. YENİ sequence oluştur   → sequence_from_media veya edit_run plan
5. set_active → TAM sequence adı (timestamp dahil)
6. Video / text / shape / SFX  (frame-aware; SFX default 0 dB)
7. edit_verify
8. quality_pass — küçük cut: 1 batch; büyük: clipFrom döngüsü
9. project_save
// Bozulduysa: checkpoint_restore { id } — dirty kaydetmeden geri al
```

### Sakın

| Hata | Sonuç |
|------|--------|
| `sequence_set_active_by_name("Cut")` ilk kısmi eşleşme | Eski/şişmiş sekansta edit → crash |
| `quality_pass` 100+ clip tek seferde | Crash; **batch** kullan (`clipFrom`) |
| `audio_fix_levels` allClips / mass gain | Kullanıcı fader’ları bozulur |
| SFX’i rastgele saniyeye koymak | Ses frame ile uyuşmaz |
| `shape_add` + text’i elle hizalamaya çalışmak | Kayar; text_write composite kullan |
| Tam timeline AME render for still | Yavaş; full Premiere window screenshot kullan |
| **Tool spam / aralıksız 50+ atomic çağrı** | **Premiere crash** → `RATE_LIMITED` |

---

## 1b) Hız limiti (RATE_LIMITED) — zorunlu

Premiere UXP peş peşe hızlı çağrıda çöker. Sunucu iki katman korur:

| Katman | Ne | Varsayılan |
|--------|-----|------------|
| **Soft** (relay) | Plugin çağrıları arası otomatik bekleme | ~100 ms |
| **Hard** (MCP tool) | Çok hızlı tool → **INVALID** | ≥**220 ms** tool arası (asıl koruma) |
| Dakikalık tavan | Aşırı flood için yedek | ≤**400** tool/dk · ≤**300** heavy/dk (çok yüksek; gap asıl koruma) |

### Model ne yapmalı?

1. **`RATE_LIMITED` / `invalid: true` gelirse** → işlem **yapılmadı**.  
2. Cevaptaki **`retryAfterMs` kadar bekle** (spam retry yasak).  
3. Devam et: **`edit_run` plan** (tek tool, birçok op, `throttleMs` default 120).  
4. 40 ayrı `clip_overwrite` yerine **bir `edit_run`**.  
5. Büyük kurgu: batch’ler arasında 1–2 sn nefes.

### Örnek hata

```json
{
  "ok": false,
  "invalid": true,
  "code": "RATE_LIMITED",
  "retryAfterMs": 200,
  "recovery": "Wait retryAfterMs. Prefer edit_run..."
}
```

Env (opsiyonel): `PPMCP_MIN_TOOL_MS`, `PPMCP_MIN_RELAY_MS`, `PPMCP_MAX_TOOLS_PER_MIN`, `PPMCP_RATE_LIMIT=0` (hard kapatır, soft kalır).

---

## 2) Text — ne mümkün?

### Önerilen (tek çağrı)

`text_write` → **composite card**: yazı + koyu bar **tek PNG**.

```json
{
  "name": "text_write",
  "arguments": {
    "trackIndex": 2,
    "atTicks": "127008000000",
    "text": "EPISODE TITLE",
    "style": "title",
    "withBackground": true,
    "soften": true,
    "preferPng": true,
    "colorHex": "FFFFFF",
    "durationTicks": "1270080000000"
  }
}
```

| style | Yerleşim |
|-------|----------|
| `title` | top-left (varsayılan) |
| `lower_third` | bottom-left |
| `caption` | bottom-center |
| `title_center` / `end_card` | center (bilinçli) |

- `trackIndex` ≥ 2 (plate = track−1).  
- 960,480 veya rastgele pixel **yasak**.  
- Renk: `colorHex` (PNG). **Videoya uygun seç** (soğuk grade → beyaz/cyan; sıcak → krem; alarm/rec → kırmızı vurgu).

### Ayrı nesne + yazı?

Evet, ama **yazı arka planı için ayrı plate şart değil** — `withBackground: true` zaten bar ekler.

Ayrı nesne **yalnızca** UI / efekt için:

- Kayıt noktası, badge, highlight  
- Vignette / bar / progress  
- Blink / pulse grafik  

```
text_write  (kart)
shape_add   (renk/size/pos) 
effect_set_opacity { opacity, atTicks }  → zamanla yanıp sönme
```

---

## 3) Shape / nesne — renk, boyut, opacity

### shape_add

- Template: **dikdörtgen** MOGRT.  
- “Yuvarlak” için: **width ≈ height** (kare; küçük boyutta nokta gibi okunur).  
- Gerçek vector circle API yok; **eşit w×h kare** küçük boyutta nokta gibi okunur.

```json
{
  "name": "shape_add",
  "arguments": {
    "trackIndex": 1,
    "atTicks": "127008000000",
    "durationTicks": "1270080000000",
    "fillColor": { "r": 220, "g": 20, "b": 20, "a": 255 },
    "width": 28,
    "height": 28,
    "x": 0.45,
    "y": 0.16
  }
}
```

Dönen `trackIndex` + `clipIndex`’i sakla (sonraki opacity/color için).

### Renk

- `shape_set_fill_color` `{ r, g, b, a }` 0–255  
- Yazı: `text_write` `colorHex`  
- **Her zaman sahneye uydur** (soğuk B-roll → beyaz; brand → marka rengi; danger UI → kırmızı).

### Opacity / blink (frame veya ticks)

```json
// Sabit
{ "name": "effect_set_opacity", "arguments": {
  "trackType": "video", "trackIndex": 2, "clipIndex": 0, "opacity": 100
}}

// Keyframe (yanıp sönme) — her ~0.4s bir
{ "name": "effect_set_opacity", "arguments": {
  "trackType": "video", "trackIndex": 2, "clipIndex": 0,
  "opacity": 100, "atTicks": "127008000000"
}}
{ "name": "effect_set_opacity", "arguments": {
  "trackType": "video", "trackIndex": 2, "clipIndex": 0,
  "opacity": 10, "atTicks": "228614400000"
}}
// ... duration boyunca tekrar et
```

Ticks: `seconds * 254016000000`.  
Örnek 0.4s = `101606400000`.

### Position / size

- `shape_set_position` / `effect_set_transform` → Motion **0–1**  
- `shape_set_size` px (yoksa Scale %)

---

## 4) Yanıp sönen UI noktası (ör. kayıt / live) — özel tool yok

**Yapma:** projeye özel sihirli bayraklara güvenme.

**Yap (her türlü proje):**

1. `text_write` → başlık/kart (composite plate)  
2. `shape_add` → renk + küçük kare + title’ın **yanına** konum (ölç / tahmin 0–1)  
3. `effect_set_param` veya `effect_set_opacity` + **`atTicks`**: hızlı **0↔100** (ör. her 0.12s)  
4. Duration = yazı ile aynı  

Blink hızı: yavaş (0.4s+) “nefes”; hızlı (0.1–0.15s half) “recording LED”.

---

## 5) Ses — frame kontrollü (zorunlu)

### Kural

Ses dosyası **adı + sahne içeriği + cut anı** ile eşleşmeli.  
Rastgele `atSeconds: 5` yok.

| Dosya adı ipucu | Ne zaman |
|-----------------|----------|
| `tv_on`, `switch` | TV boot / mavi ekran |
| `whoosh` | Cut, camera pan/turn (scene-detect veya bilinen cut) |
| `walk`, `footstep`, `concrete` | Yürüme görüntüsü |
| `run` | Koşu |
| `jumpscare`, `smiler`, `creature` | Yaratık / entity frame |
| `impact`, `boom`, `explosion` | Hit / scare beat |
| `bulb`, `fluorescent`, `buzz` | Glitch / ambience (bed −6 dB) |
| `shutter`, `camera` | Foto / channel flip |

### Akış

```
1. Timeline saniye haritasını çıkar (clip süreleri ardışık)
2. analyze_detect_onsets / scene cuts (ffmpeg) → whoosh noktaları
3. Her SFX için: { path, atSeconds, trackIndex, role }
4. edit_run plan ile sfx ops (gainDb sadece bilinçli; default 0 dB)
5. sequence_screenshot ile 2–3 key frame kontrol
```

### Audio fader güvenliği

- Default **0 dB** — model `gainDb` vermezse sistem **0** yazar (sessiz / negatif bırakma)  
- Bilinçli kısma: açık `gainDb: -6` veya `soft: true` (music_bed)  
- Sadece **kendi yerleştirdiğin** clip: `trackIndex`+`clipIndex`  
- `audio_fix_levels` → scope zorunlu; `allClips:true` nadir  
- polish/delivery **otomatik fader ezmez**  

### Checkpoint / geri alma

Bozuk kesme, yanlış silme, ses felaketi için Premiere undo stack’ine güvenme — **proje snapshot**:

```
checkpoint_create { label: "before-sfx" }   // önce kaydet + .prproj kopyala
// … riskli edit_run …
checkpoint_restore { id: "<id>" }           // bozuk state’i açmadan geri dön
checkpoint_list                             // id / label listesi
```

- Konum: `~/.ppmcp/checkpoints/<id>/`  
- Restore varsayılanı: mevcut dirty kaydetmez, checkpoint’i yeni `*_restored_*.prproj` olarak açar  
- Riskli iş **öncesi** mutlaka checkpoint al  
- `project.save` timeout / Premiere modal → checkpoint fail; File > Save elle, sonra tekrar `checkpoint_create`  
- Checkpoint **proje dosyası** kopyasıdır (sekanstaki her şey); meta’daki `sequenceName` sadece o an aktif sekanstı not eder

---

## 6) Frame / QA

- `sequence_screenshot` → **tam Premiere penceresi** (stabil)  
- Tam AME sequence render still için **kullanma**  
- Screenshot capture **geçici olarak** CTI’yi o frame’e alır, sonra **eski playhead’e geri koyar**  
- Overlay / text yerleştirirken: önce `playhead_get_position` — **set_active yapmadan önce** oku; `set_active` sekan değiştirince o sekanın CTI’si (çoğu zaman 0) gelir  
- Kullanıcının “şu anki frame”i = get ile okunan ticks; uydurma / 0 varsayma  

---

---

## 7) quality_pass — küçük ve **büyük** projeler

### Küçük / orta (≤ ~24 V clip)

```json
{ "name": "edit_quality_pass", "arguments": { "look": "cool", "maxGrade": 24 } }
```

Tek çağrı yeter.

### Büyük proje (50–200+ clip)

Tek seferde yüzlerce Lumetri = **Premiere crash**. Batch:

```
edit_quality_pass { look: "cool", maxGrade: 24, clipFrom: 0 }
// → nextClipFrom: 24, hasMore: true

edit_quality_pass { look: "cool", maxGrade: 24, clipFrom: 24 }
// → nextClipFrom: 48, hasMore: true

// hasMore: false olana kadar tekrarla
```

| Alan | Anlam |
|------|--------|
| `maxGrade` | Bu batch’te kaç clip (default 24, max 60/çağrı) |
| `clipFrom` | Track clip listesinde başlangıç |
| `nextClipFrom` | Cevap — sonraki `clipFrom` |
| `hasMore` | `true` ise döngü devam |

- Fade-in: sadece `clipFrom: 0`  
- Fade-out: sadece son batch  
- SFX her zaman **0 dB** Level  

### Neden “hepsini birden” yok?

Premiere UXP, peş peşe 100+ `applyLumetri` + transition’da çöküyor.  
Büyük proje = **aynı kalite, parçalı uygulama** — reddetmek değil, batch.

---

## 7b) Ses −∞ / +15 dB — KRİTİK ÖLÇEK

Premiere clip rubber-band **tepe ≈ +15 dB**. UXP `Volume > Level` lineer **0..1** bu tepeye map’lenir:

| Level (linear) | UI dB (yaklaşık) |
|----------------|------------------|
| `0.0` | −∞ (sessiz) |
| **`~0.178`** | **0 dB unity** |
| `1.0` | **+15 dB (max)** |

Formül: `linear = 10^((dB - 15) / 20)`

Agent API **dB** konuşur:
- default / `decibels: 0` → **0 dB** (linear ~0.178)  
- model boost: `gainDb: 6` … max **+15**  
- kısma: `gainDb: -6`  

**Channel Volume L/R’ye dokunma** (1.0 yazmak ekstra boost istiflemişti).

---

## 8) Minimal genel plan (kopyala)

```
edit_bootstrap
sequence_from_media { name: "Edit <timestamp>", paths: [...] }
set_active { query: EXACT full name }

text_write title/lower_third (colorHex matches grade)
optional: shape_add + opacity keyframes for UI chrome
sfx by section (filename + cut times)
markers
edit_verify
sequence_screenshot at 2–3 key times
project_save
# large project: loop edit_quality_pass with clipFrom until hasMore=false
```

---

## 9) edit_help özeti (token-ucuz)

Zayıf model: sadece `edit_bootstrap` + `edit_auto` + `edit_help`.  
Güçlü model: playbook → atomics (text/shape/sfx/frame) → verify.  
Detay: `docs/PROMPTS.md`, `skill/SKILL.md`, bu dosya.

---

## 10) API gerçekleri (dürüst)

| İstek | Gerçek |
|-------|--------|
| Type Tool yazı | Yok; MOGRT/CEP/PNG |
| Perfect circle shape | Yok; kare shape veya PNG daire |
| Yazı + plate tek tık | `text_write` composite |
| Shape rengi | `shape_set_fill_color` |
| Opacity zamanla | `effect_set_opacity` + `atTicks` |
| Text rengi | `colorHex` (PNG) / MOGRT param (kırılgan) |
| SFX loudness | Level dB, LUFS değil |

Agentler **mevcut tool ile** yaratıcı olmalı; olmayan API’yi uydurmamalı.
