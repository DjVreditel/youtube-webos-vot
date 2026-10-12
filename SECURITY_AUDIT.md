# Biztonsági auditjelentés – YouTube AdFree (youtube.leanback.v4) 0.8.7, LG webOS

| | |
|---|---|
| Vizsgált termék | `foxi69/youtube-webos`, kiadás **v0.8.7** („YouTube AdFree 0.8.7”) |
| Vizsgált artefaktumok | `youtube.leanback.v4_0.8.7_all.ipk` (legacy, webOS 3–6) és `youtube.leanback.v4_0.8.7_all_webOS22+.ipk` (modern, webOS 22+) |
| Forráskód-referencia | tag `v0.8.7` = commit `0c9ca90f51178e7555314a7c99aefedb5a05a383` |
| A vizsgálat dátuma | 2026-10-12 |
| Módszer | statikus elemzés (bináris és forrás), reprodukálható build-összevetés, ellátásilánc-vizsgálat, dinamikus tesztek elszigetelt Chromium-környezetben (valós LG TV nélkül) |

Jelölések: **[S]** = statikus elemzés eredménye, **[T]** = ténylegesen lefuttatott teszt eredménye, **[F]** = feltételezés vagy következtetés, amelyet a vizsgálat nem bizonyított.

---

## 1. Vezetői összefoglaló

**Röviden:** a v0.8.7 kiadás vizsgált tartalmában **nem találtam bizonyítékot** jelszó, token, cookie vagy más hitelesítési adat kiszivárgására, és rejtett vagy kártékony működésre sem. A csomag **bájtra azonos** azzal, amit a `v0.8.7` tag forráskódjából a rögzített (`package-lock.json`) függőségekkel újra lehet építeni. A teljes futtatható kód tehát átvizsgálható forrásból származik.

**A biztonság ennek ellenére nem tekinthető teljes körűen igazoltnak**, mert:

1. **Nem volt valós LG webOS-készülék**, és a vizsgálati környezet hálózati szabályai miatt a valódi YouTube-szerverek sem voltak elérhetők. Az éles bejelentkezés, a valódi YouTube-tokenek tárolási helye és a TV-szintű forgalom nem volt megfigyelhető (lásd 11. fejezet).
2. A kód tervezetten **a `https://www.youtube.com` originben fut**, a bejelentkezett YouTube-munkamenet mellett. Ezért **minden jövőbeli frissítés** teljes hozzáférést kaphat a munkamenethez. A frissítési csatornát egyetlen GitHub-fiók irányítja, aláírás nélkül (F-01, KÖZEPES).
3. Alapértelmezetten **két harmadik fél kap kérést** minden megnézett videónál:
   - a Return YouTube Dislike szolgáltatás a **teljes videóazonosítót**,
   - egy **nem hivatalos SponsorBlock-tükör** (`sponsorblock.inf.re`) a videóazonosító SHA-256 hash-ének első 4 hex karakterét.

   Mindkettő megkapja a TV IP-címét is (F-02, F-03). Hitelesítési adat egyik kérésben sincs (ezt teszt igazolta).

**Telepíthetőség a jelenlegi bizonyítékok alapján:** a v0.8.7 kiadás **feltételesen telepíthető**. Javasolt előbb tesztfiókkal kipróbálni, az adatvédelmi szempontból érzékeny alapbeállításokat felülvizsgálni, és a frissítéseket csak hash-ellenőrzés és változásátnézés után telepíteni (12. fejezet).

Súlyossági összesítés:

| Minősítés | Darab | Azonosítók |
|---|---|---|
| KRITIKUS | 0 | – |
| MAGAS | 0 | – |
| KÖZEPES | 2 | F-01, F-02 |
| ALACSONY | 6 | F-03 … F-08 |
| NEM BIZONYÍTOTT / TOVÁBBI VIZSGÁLAT SZÜKSÉGES | 3 | F-09, F-10, F-11 |
| Tájékoztató (nem sérülékenység) | 5 | I-01 … I-05 |

---

## 2. A vizsgált artefaktum azonosítása

### 2.1 Eredet és ellenőrzőösszegek [T]

A csomagokat a kiadó GitHub-kiadásából töltöttem le (`https://github.com/foxi69/youtube-webos/releases/download/v0.8.7/...`).

| Fájl | Méret (bájt) | SHA-256 (letöltött) | `repo.json` / `repo-webos22.json` | GitHub asset `digest` |
|---|---|---|---|---|
| `youtube.leanback.v4_0.8.7_all.ipk` | 127 698 | `16797b438be68e0b7fa08178839f1227bee79d0d2b4a846d5959209f94ae4329` | egyezik | egyezik |
| `youtube.leanback.v4_0.8.7_all_webOS22+.ipk` | 103 588 | `a962e61c512b046536a2459c8f311742170806fb1ac594306598ef07cc5a6105` | egyezik | egyezik |

**Fontos korlát:** a „hiteles” referencia (`repo.json`, a GitHub asset-digest) **ugyanattól a kiadói fióktól származik**, mint maga a csomag. Független, aláírt referencia (GPG-, Sigstore- vagy LG-aláírás) **nincs**. Az egyezés azt bizonyítja, hogy a letöltés közben nem sérült és nem cserélődött a fájl. Azt nem bizonyítja, hogy a kiadó fiókja nem volt kompromittálva.

### 2.2 Build-proveniencia [T]

- A kiadás leírása szerint (`<!-- built from 0c9ca90 -->`) és a GitHub Actions „Draft release” futás szerint (run `38221936471`, job `114720026512`, head SHA `0c9ca90…`) a csomagokat a CI építette és töltötte fel (`github-actions[bot]`, 2026-10-12 08:10:47Z).
- **Reprodukálható build:** külön worktree-ben a `v0.8.7` tagből `npm ci --ignore-scripts`, majd `npm run build:modern` és `npm run build` paranccsal újraépítettem mindkét változatot. A kapott `dist/` tartalma **`diff -r` szerint bájtra azonos** az IPK-kból kibontott alkalmazásfájlokkal (mind a 9 fájl, mindkét változatban).
- Ebből következik: **a bináris csomag nem tartalmaz olyan kódot, amely ne lenne a tag forráskódjában vagy a lockfile-ban rögzített npm-függőségekben.**

### 2.3 A repóba commitolt `dist/` csomagok [T]

| Fájl | SHA-256 |
|---|---|
| `dist/youtube.leanback.v4_0.8.7_all.ipk` | `2fb10ce38c9cb2dfac878b1b4439065796334f01f1793bf67e5a636220e4c370` |
| `dist/youtube.leanback.v4_0.8.7_all_webOS22+.ipk` | `2fa8ae6183722eeebaea919c1dbb441e249cdbe3227f13a3ab15e83e0821e003` |

Ezek hash-e **eltér** a kiadott csomagokétól. Kibontás után viszont minden fájljuk tartalma azonos a kiadott csomagokéval. Az eltérés csak a tar-metaadatokból adódik: tulajdonos `0/0` a `runner/1001` helyett, illetve eltérő időbélyegek. Lásd I-03.

### 2.4 A vizsgálat hatóköre

- **Benne van:** mindkét IPK minden fájlja; a `v0.8.7` tag teljes `src/` könyvtára (58 modul); a bundle-be ténylegesen bekerülő npm-csomagok listája (webpack-statisztika alapján); a build- és CI-konfiguráció; a Homebrew-tárolófájlok.
- **Nincs benne:** a YouTube saját (szerverről betöltött) JavaScript-kódja; az LG webOS firmware; a Homebrew Channel; a harmadik féltől származó szerverek (RYD, SponsorBlock) működése; valós TV-n végzett futtatás.
- **Megjegyzés:** a `main` ág jelenlegi feje (`0faaff4`) a taghez képest csak kozmetikai változást tartalmaz (`src/ui.js`, `src/ui.css`: a mutatógomb témaszínei). Ez **nem része** a v0.8.7 kiadásnak.

---

## 3. A csomag teljes tartalma [S][T]

Mindkét IPK szabványos `ar` archívum: `debian-binary` (`2.0`), `control.tar.gz` és `data.tar.gz`. **Telepítési szkript (preinst/postinst/prerm) nincs**; a `control.tar.gz` csak a `control` fájlt tartalmazza.

| Útvonal (`usr/palm/...`) | Szerep | Megállapítás |
|---|---|---|
| `packages/youtube.leanback.v4/packageinfo.json` | csomagazonosító (`id`, `version`, `app`) | ártalmatlan |
| `applications/youtube.leanback.v4/appinfo.json` | alkalmazás-manifest (lásd 8. fejezet) | jogosultsági mezők: `trustLevel: netcast`, `privilegedJail: true`, `allowCrossDomain: true` |
| `.../index.html` (93 B) | indítóoldal, csak az `index.js`-t tölti be | ártalmatlan |
| `.../index.js` (legacy 9 739 B / modern 1 249 B) | `src/index.js` + `src/launch.js` (+ polyfillek): az indítási paraméterekből `https://www.youtube.com/tv` URL-t állít össze és oda navigál | csak `www.youtube.com`-ra navigál (`launch.js:44-90`) |
| `.../webOSUserScripts/userScript.js` (legacy 307 332 B / modern 223 845 B) | a fő funkcionalitás: a webOS ezt injektálja a betöltött YouTube TV oldalba | lásd 4–7. fejezet |
| `.../icon.png`, `largeIcon.png`, `*_preview.png`, `*_splash.png`, `icon.svg` | grafikák | azonosak a repó `assets/` fájljaival; a PNG-kben nincs adat az `IEND` után; az SVG-ben nincs `<script>` vagy eseménykezelő |

**A bundle-be ténylegesen bekerülő harmadik féltől származó kód** (webpack `--json` statisztika) [T]:

| Csomag | Verzió | Legacy | Modern | Szerep |
|---|---|---|---|---|
| `tiny-sha256` | 1.0.2 | igen | igen | SHA-256 a SponsorBlock k-anonim lekérdezéséhez |
| `@twemoji/api` | 16.0.1 | igen | nem | emoji → kép (csak webOS 3/4 esetén aktív) |
| `whatwg-fetch` | 3.6.20 | igen | nem | `fetch` polyfill régi motorokhoz |
| `@babel/runtime` | 7.28.4 | igen (helperek, regenerator) | nem | transzpilációs segédkód |

A fejlesztői diagnosztikai modul (`src/perf_mon.js`) egyik kiadott bundle-ben sincs benne: a `__PERF` karakterlánc előfordulása 0.

---

## 4. Funkcióleltár és működési tesztek

A „Teszt” oszlop értékei:

- **[T-dyn]**: a dinamikus Chromium-harness (`tools/audit-dyn-test.cjs`) ellenőrizte.
- **[T-bench]**: a repó saját `bench/` tesztje futott a kiadott bundle-en.
- **csak TV**: kizárólag valós készüléken ellenőrizhető.

| Funkció (beállítás, alapérték) | Fájl(ok) | Olvas / ír | Hálózat / rendszer | Teszt / állapot |
|---|---|---|---|---|
| Indítás, deep link, hangvezérlés, relaunch | `launch.js`, `userScript.js:49-60` | `window.launchParams` | navigálás csak `https://www.youtube.com/tv…` címre | [T-bench] `launch-test`: 7/7 sikeres; [T-dyn] a relaunch `www.youtube.com/tv?...&v=…` címre navigált |
| Reklámszűrés (`enableAdBlock`, be) | `adblock.js` (`JSON.parse` hook) | YouTube API-válaszok a memóriában | nincs saját forgalom | [T-bench] `adblock-test`: 27/27 sikeres |
| Lejátszási kérés módosítása (`isInlinePlaybackNoAd`) | `hooks/json-stringify.ts:247-303` | kimenő player-kérés törzse | csak a YouTube felé | [T-dyn] a player-kérés törzsében megjelent az `"isInlinePlaybackNoAd":true` |
| Telemetria csökkentése (`enableTrackingBlock`, **ki**) | `adblock.js:23-29, 481-545` | URL-útvonal | blokkolja: `log_event`, `ptracking`, `stats/atr`, `stats/qoe`, `pagead`, `eligibility_check` | [T-dyn] kikapcsolva átengedi, bekapcsolva blokkolja a `log_event` és a `qoe` kéréseket |
| SponsorBlock (`enableSponsorBlock`, be) | `sponsorblock.js`, `sponsorblock-labels.js`, `Sponsorblock-UI.js` | videóazonosító (URL-hash) | `GET https://sponsorblock.inf.re/api/skipSegments/<4 hex>`, tartalék: `sponsor.ajay.app` | [T-dyn] kérés látható, cookie és Authorization nélkül; [T-bench] `sponsorblock-labels-test`: 71/71 sikeres; a tényleges átugrás: csak TV |
| Return YouTube Dislike (`enableReturnYouTubeDislike`, be) | `return-dislike.js` | videóazonosító | `GET https://returnyoutubedislikeapi.com/votes?videoId=<ID>` | [T-dyn] kérés látható, cookie nélkül; [T-bench] `dislike-timing-test`: 9 sikeres, 2 sikertelen (a „slow API” esetek; okukat nem tártam fel, lásd I-05) |
| „Bypass Nag Screens” / automatikus bejelentkezés (`enableAutoLogin`, `autoSelectAccount`, mindkettő be) | `auto-login.js` | YouTube saját `localStorage`-rekordjai (`recurring_actions`, `promo-coupon-*`, `last-identity-used`) | nincs | [T-dyn] az időbélyegek módosultak; a fiókválasztó átlépése: csak TV |
| Képernyővédő-tiltás lejátszás közben | `screensaver-fix.js:123-177` | – | Luna: `com.webos.service.tvpower/power/registerScreenSaverRequest`, `responseScreenSaverRequest` | [T-dyn] a stub-bridge pontosan ezt az egy hívást rögzítette; a valós hatás: csak TV |
| webOS Cast-szolgáltatás blokkolása (`blockWebosCast`, be, csak webOS 25+) | `block-webos-cast.ts` | indítási paraméterek | blokkolja a `/wake_cast_core` kérést | [T-dyn] webOS 25 UA mellett 0, webOS 23 UA mellett 1 `wake_cast_core` kérés ment ki |
| Bélyegkép-minőség javítása (`upgradeThumbnails`, ki) | `thumbnail-quality.js` | `localStorage`: `ytaf-thumb-quality` (videó-ID:minőség lista), `ytaf-thumb-quality-cap` | `HEAD`/`<img>` kérés: `i.ytimg.com` | [T-dyn] bekapcsolás után létrejött a `ytaf-thumb-quality-cap` kulcs; [T-bench] `module-behaviour-test`: 10 sikeres, 3 sikertelen |
| Felirat-fordítás | `subtitle-translate.js` | YouTube-válaszok | `tlang` paraméter a YouTube felirat-URL-jéhez | nem tesztelt (csak TV) |
| Emoji- és karakterjavítás (`enableLegacyEmojiFix`, be; csak webOS 3/4) | `emoji-font.js` | DOM szöveg | képek: `cdnjs.cloudflare.com/.../twemoji/16.0.1/72x72/*.png`; CSS: `fonts.googleapis.com` | statikusan ellenőrizve; DOM-írás csak `textContent`-tel és `createElement`-tel |
| Nyelvi beállítás javítása | `lang-settings-fix.ts:11, 54` | `PREF` cookie (`hl` mező), `.youtube.com` domain | nincs | statikusan ellenőrizve |
| Kodekkényszerítés, videóminőség | `force-codec.js`, `video-quality.js` | `localStorage` (YouTube saját minőség-kulcsa) | nincs | [T-bench] `force-codec-test`: 48/48 sikeres |
| Lejátszási sebesség | `playback-speed.js` | – | – | **nincs a csomagban**: a modult semmi nem importálja (`ui.js:9` kikommentezve, `config.js:183` a beállítás is), a webpack-statisztikában sem szerepel; a `settings-speed-test` ezért nem tud lefutni |
| Billentyűzetes keresés | `keyboard-search.js` | billentyűesemények csak a keresőoldalon | nincs; nem tárol és nem küld semmit | statikusan ellenőrizve |
| Beállítópanel (zöld gomb, Magic Remote gomb) | `ui.js`, `config.js` | `localStorage`: `ytaf-configuration` | nincs | [T-bench] `panel-test`: sikertelen (elavult teszt, I-05); csak TV |
| Óra, hátralévő idő, némított előnézet, kommentjavítás, logóstílus | `watch.js`, `time-remaining.js`, `mute-previews.js`, `comments-fix.js`, `logo-style.js` | DOM | logó: `www.gstatic.com` (YouTube-logó PNG) | nem tesztelt (csak TV) |
| Pufferlimit (webOS ≤ 4) | `hooks/buffer-limit.js` | MSE | nincs | nem tesztelt (csak TV) |

A repó saját tesztkészletének összesítése [T], a kiadott bundle-ön futtatva (a `jsdom` külön telepítve, mert nem szerepel a `package.json`-ban):

- Sikeres: `polyfill-conformance` 264/264, `launch-test` 7/7, `adblock-test` 27/27, `sponsorblock-labels-test` 71/71, `force-codec-test` 48/48, `smoke` 9/10.
- Sikertelen: `modern-smoke` 7/14, `new-features-test` 18/21, `dependency-test`, `panel-test`, `spatnav-correctness`, `perfmon-test`.
- A `smoke`, a `modern-smoke` és a `spatnav-correctness` sikertelen esetei a 0.8.6-ban eltávolított térbeli navigációs modulra (`src/spatial-navigation*.js`) hivatkoznak. Ezek a tesztek elavultak, nem a kód hibáját mutatják.
- A `perfmon-test` a kiadásból szándékosan kihagyott `perf_mon` modult várja, ezért ott a hiba elvárt.
- A többi sikertelen eset okát (`new-features-test`, `dependency-test`, `panel-test`, `module-behaviour-test`, `dislike-timing-test`) a jelentés első változata idején nem tártam fel. Utólag kiderült, hogy mind elavult teszt volt, nem az app hibája (13. fejezet). A `settings-speed-test` a csomagban nem szereplő sebességfunkciót teszteli.

---

## 5. Hálózati kommunikáció

### 5.1 Statikusan azonosított végpontok [S]

A forrás és mindkét bundle teljes URL-kivonata alapján (a legacy bundle URL-készlete a modernét is lefedi):

| Domain / URL | Cél | Hívó fájl és függvény | Továbbított adat | Titkosítás | Indokoltság | Kockázat |
|---|---|---|---|---|---|---|
| `https://www.youtube.com/tv…` | a YouTube TV alkalmazás betöltése | `launch.js` `handleLaunch()` (90. sor) | indítási paraméterek (videó-ID, keresés, DIAL/Cast paraméterek) | HTTPS | szükséges | elvárt |
| `https://www.youtube.com/*` (`youtubei/v1/*`, `api/stats/*` stb.) | a YouTube saját forgalma; az app csak blokkol vagy módosít | `hooks/fetch.ts`, `adblock.js` XHR hook, `json-stringify.ts` | YouTube cookie-k és tokenek (a böngésző és a YouTube kódja küldi) | HTTPS | szükséges | elvárt; az app nem olvassa ki a fejléceket |
| `https://sponsorblock.inf.re/api/skipSegments/<4 hex>?categories=…&actionTypes=…` | SponsorBlock szegmensek (**elsődleges, nem hivatalos tükör**) | `sponsorblock.js` `fetchSegments()` (1763–1800), `SPONSORBLOCK_CONFIG.primaryAPI` (12. sor) | a videó-ID SHA-256 hash-ének első 4 hex karaktere, IP-cím, `Origin`/`Referer: https://www.youtube.com/` | HTTPS | funkcióhoz szükséges | ALACSONY (F-03) |
| `https://sponsor.ajay.app/api/...` | SponsorBlock (hivatalos, tartalék) | ugyanott (13. sor), csak hiba esetén | mint fent | HTTPS | funkcióhoz szükséges | ALACSONY |
| `https://returnyoutubedislikeapi.com/votes?videoId=<ID>` | dislike-szám | `return-dislike.js` `fetchVideoData()` (186. sor) | **teljes videó-ID**, IP-cím, `Origin`/`Referer: https://www.youtube.com/` | HTTPS | funkcióhoz szükséges, alapértelmezetten be | KÖZEPES adatvédelmi kockázat (F-02) |
| `https://i.ytimg.com/vi/…`, `/vi_webp/…` | bélyegkép-ellenőrzés (`HEAD`, `<img>`) | `thumbnail-quality.js` `headExists()` / `imageExists()` (781–851) | videó-ID az URL-ben | HTTPS | YouTube-infrastruktúra; alapértelmezetten ki | elvárt |
| `https://www.gstatic.com/youtube/img/branding/...png` | YouTube-logó | `logo-style.js` (26, 31) | – | HTTPS | YouTube-infrastruktúra | elvárt |
| `https://cdnjs.cloudflare.com/ajax/libs/twemoji/16.0.1/72x72/<kód>.png` | emoji-képek (csak webOS 3/4) | `emoji-font.js` (29) | emoji-kód, IP, Referer-origin | HTTPS | funkcióhoz szükséges | ALACSONY (F-07) |
| `https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic&family=Noto+Sans+Math` | betűtípus-CSS (csak webOS 3/4, UTF-8) | `emoji-font.js` (260) | IP, Referer-origin | HTTPS | funkcióhoz szükséges | ALACSONY (F-07) |
| `luna://com.webos.service.tvpower/power/` | képernyővédő-kérés kezelése | `screensaver-fix.js` (123–177) | `{subscribe, clientName:"youtube-webos"}`, illetve `{ack, timestamp}` | helyi IPC | funkcióhoz szükséges | elvárt |
| `https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/` | a `@twemoji/api` könyvtár alapértelmezett bázis-URL-je | `node_modules/@twemoji/api` | – | – | **nem hívódik meg**: a `twemojiOptions.callback` felülírja | nincs |
| `https://a.example/` | polyfill-funkcióteszt (URL-konstruktor próbája) | `polyfills.js:361` | – | – | nincs hálózati kérés | nincs |

**Nem található** [S] (forrásban és mindkét bundle-ben):

- `WebSocket`, `EventSource`, `navigator.sendBeacon`, `importScripts`, Service Worker;
- dinamikus `<script>` létrehozása;
- `eval`;
- a nem konstans `Function(...)`. Két konstans előfordulás van: a Babel regenerator-runtime és a webpack globalThis-feloldása; ezek szabványos könyvtári kódok.
- analitikai vagy hirdetési SDK;
- IP-címre irányuló kérés;
- titkosítatlan `http://` végpont. Az egyetlen `http://` karakterlánc az SVG névtér (`http://www.w3.org/2000/svg`).

A TLS-ellenőrzés a webOS böngészőmotorjára van bízva. Az app semmilyen tanúsítvány-beállítást nem módosít.

### 5.2 Megfigyelt forgalom (dinamikus teszt) [T]

**Környezet:**

- Playwright és Chromium (Chrome 141).
- Szintetikus `https://www.youtube.com/tv` oldal, a kiadott `userScript.js` injektálva.
- Minden kérés el van fogva és naplózva; valódi hálózatra semmi nem jutott ki.

**Szintetikus hitelesítési adatok:**

- cookie-k: `SID`, `SAPISID`, `LOGIN_INFO`, `VISITOR_INFO1_LIVE`;
- `localStorage`: hozzáférési és frissítési token, `last-identity-used`;
- az oldal saját kéréseinek `Authorization: Bearer ya29.SYNTH…` fejléce.

**Futtatott változatok:**

1. legacy bundle, webOS 2021-es (webOS 6) user agent;
2. legacy bundle, webOS 2017-es (webOS 3) user agent;
3. modern bundle, webOS 2025-ös user agent, `enableTrackingBlock` és `upgradeThumbnails` bekapcsolva;
4. modern bundle, webOS 2023-as user agent.

**Eredmények:**

- Harmadik fél felé csak a `returnyoutubedislikeapi.com` (1 kérés) és a `sponsorblock.inf.re` (2 kérés) kapott kérést. Mindegyik kérésnél: `Cookie` fejléc nincs, `Authorization` fejléc nincs, `Referer: https://www.youtube.com/` (csak az origin, a videót tartalmazó hash nem).
- **A szintetikus titkok egyike sem jelent meg harmadik félnek küldött kérésben** (URL, fejléc, törzs). Az automatikus keresés eredménye: `third-party credential occurrences: 0` mind a négy futásban.
- A titkok kizárólag `www.youtube.com` felé mentek, ott is csak az oldal saját (szimulált) kéréseiben.
- Luna-hívás: kizárólag `luna://com.webos.service.tvpower/power/registerScreenSaverRequest` `{"subscribe":true,"clientName":"youtube-webos"}`.
- Bekapcsolt tracking-blokk mellett a `log_event` és a `stats/qoe` kérés nem ment ki. webOS 25-ös user agent mellett a `wake_cast_core` sem.
- Oldalhiba (`pageerror`) nem volt.

**Korlát:** a webOS 3/4 betűtípus-link nem jelent meg, valószínűleg azért, mert a szintetikus oldal karakterkódolása nem UTF-8 volt (`emoji-font.js:249` feltétele). Ezt az ágat csak statikusan vizsgáltam.

**Reprodukálás:**

```sh
CHROMIUM_PATH=/path/to/chrome NODE_PATH=$(npm root -g) \
  node tools/audit-dyn-test.cjs <kibontott>/webOSUserScripts/userScript.js 2021 out.json
```

---

## 6. Jelszavak, tokenek és cookie-k – adatáramlási térkép

### 6.1 Hozzáférési modell [S][F]

A webOS a `webOSUserScripts/userScript.js` fájlt **a YouTube TV oldalába** injektálja. A kód ezért ugyanabban a JavaScript-környezetben és ugyanabban az originben (`https://www.youtube.com`) fut, mint a YouTube saját kódja. Ennek következményei:

- **elérhető számára** minden, ami a YouTube kódja számára is: a nem `HttpOnly` cookie-k (`document.cookie`), a `localStorage` (a leanback kliens itt tárolja a fiókidentitás adatait, pl. `yt.leanback.default::last-identity-used`), a DOM, és a hookolt `fetch`/`XMLHttpRequest`/`JSON.parse`/`JSON.stringify` által látott adatok;
- **ez a hozzáférés a működés természetéből fakad**, nem a kód hibája. Ugyanakkor ez az oka annak, hogy a kiadó és a frissítési csatorna megbízhatósága kritikus (F-01).

[F] A YouTube TV-kliens a Google-fiók OAuth-tokenjeit vélhetően a `localStorage`-ben tartja. Ezt valós bejelentkezéssel **nem tudtam ellenőrizni** (11. fejezet).

### 6.2 Érzékeny adatok egyenként

| Adat | Keletkezés / tárolás | Mely kód fér hozzá | Kikerülhet-e a készülékről, és hova | Megállapítás |
|---|---|---|---|---|
| Google/YouTube OAuth access/refresh tokenek | a YouTube kódja hozza létre; [F] `localStorage` / memória | elvben a teljes userscript; **ténylegesen semmi**: nincs olyan kódsor, amely tokent olvasna, másolna vagy továbbítana [S] | csak a YouTube saját kéréseiben a `youtube.com` felé [T] | NEM ÉSZLELT kiszivárgás |
| `Authorization` fejléc | a YouTube kéréseiben | a `fetch` hook megkapja az `init` objektumot (`hooks/fetch.ts:79-155`), de csak az URL útvonalát vizsgálja; az XHR hook (`adblock.js:499-528`) csak az URL-t | változatlanul a YouTube-hoz [T] | NEM ÉSZLELT kiszivárgás; az „Authorization”, „token”, „SAPISID” karakterlánc egyik bundle-ben sem fordul elő [S] |
| Cookie-k (`SID`, `SAPISID`, `LOGIN_INFO`, `PREF` stb.) | böngésző cookie-tár (`.youtube.com`) | `document.cookie`: **csak** `lang-settings-fix.ts` olvassa és írja, kizárólag a `PREF` cookie `hl` mezőjét (11. és 54. sor) | a böngésző csak a `youtube.com` felé küldi. A harmadik félnek szóló `fetch` hívások `credentials` beállítás nélkül futnak: alapértelmezés `same-origin`, a `whatwg-fetch` polyfillben szintén. Az XHR-ek `withCredentials` nélkül. | NEM ÉSZLELT kiszivárgás [T]: a 3. féltől származó kérésekben nem volt `Cookie` fejléc |
| Fiókidentitás (`last-identity-used`) | YouTube, `localStorage` | `utils.js:152-177` `isGuestMode()`: **csak** az `identityType` mezőt olvassa, hogy vendégmód-e | nem kerül ki | ALACSONY, indokolt |
| Fiókválasztó és promó-rekordok (`recurring_actions`, `promo-coupon-*`) | YouTube, `localStorage` | `auto-login.js:51-166`: csak `lastFired`, `data` és `expiration` időbélyegeket ír | nem kerül ki | adatvédelmi hatása F-04 |
| App-beállítások (`ytaf-configuration`) | `config.js:219-243` | az app modulja | nem kerül ki | nem érzékeny |
| Bélyegkép-gyorsítótár (`ytaf-thumb-quality`) | `thumbnail-quality.js:268-318`: `videóID:fokozat` lista | az app | nem kerül ki | helyben megmaradó böngészési nyom (I-04) |
| Videóazonosító (megtekintési előzmény) | URL-hash | `return-dislike.js`, `sponsorblock.js` | **igen**: RYD-hez teljes ID-vel, SponsorBlock-tükörhöz 4 hex karakteres hash-előtaggal | F-02, F-03 |
| Indítási paraméterek (DIAL `pairingCode`, keresőkifejezés) | webOS `launchParams` | `launch.js`, `block-webos-cast.ts` | a YouTube URL-jébe kerül; a konzolra is naplózódik (`launch.js:55`, `userScript.js:51`) | F-06 |
| Hibakereső mód (`window.__ytaf_debug__`) | csak kézzel, devtoolsból kapcsolható | `hooks/fetch.ts:94-135`, `app_api/index.ts:35` | a teljes kérés- és választörzseket a **konzolra** írja, hálózatra nem | F-06 |

### 6.3 Válasz a 7. kérdésre: bizonyítható-e, hogy az adat nem hagyja el a készüléket?

- **A vizsgált v0.8.7 kódra:** a statikus elemzés (minden hálózati API és minden URL feltérképezve, a teljes futó kód reprodukálható forrásból) és a dinamikus teszt alapján **az app saját kódja nem továbbít hitelesítési adatot** a YouTube-on kívüli címzettnek. Szintetikus adatokkal ez igazolt.
- **Teljes bizonyossággal nem állítható**, mert:
  - a YouTube saját, futás közben letöltött kódját nem vizsgáltam;
  - valós készüléken és valós fiókkal nem tudtam tesztelni;
  - a userscript tervezetten hozzáfér a munkamenethez, ezért egy **jövőbeli** verzió ezt megváltoztathatja (F-01).

---

## 7. Kártékony vagy nem dokumentált viselkedés

| Vizsgált minta | Eredmény | Minősítés |
|---|---|---|
| Rejtett adatgyűjtés / adatküldés | nincs; csak a 5.1 táblázat dokumentált végpontjai léteznek, és mind a README-ben és a CHANGELOG-ban szereplő funkcióhoz tartozik [S][T] | NEM ÉSZLELT A VIZSGÁLT KÖRNYEZETBEN |
| Hátsó kapu, távoli parancsvégrehajtás | nincs: nincs `eval`, nincs nem konstans `Function`, nincs `<script>`-injektálás, nincs `innerHTML`/`insertAdjacentHTML`/`outerHTML` hozzárendelés a forrásban [S]; a távoli válaszokat (RYD, SponsorBlock) csak `JSON.parse` dolgozza fel, és csak `textContent`, illetve escape-elt CSS-karakterlánc formájában jelennek meg (`sponsorblock-labels.js:122-162`) | NEM ÉSZLELT |
| Obfuszkált vagy futás közben letöltött kód | a bundle minifikált (Terser), de **reprodukálhatóan a forrásból készül**; futás közben nem tölt le kódot (csak képet, betűtípus-CSS-t és JSON-t) | NEM ÉSZLELT |
| Jogosultságkiterjesztés, root | a csomag nem kér rootot (`rootRequired: false`), nincs natív bináris, szolgáltatás vagy telepítési szkript | NEM ÉSZLELT |
| Webos-szolgáltatások jogosulatlan elérése | egyetlen Luna-végpont: `tvpower` képernyővédő-kérés (dokumentált funkció) | NEM ÉSZLELT |
| Fájlműveletek, perzisztencia | csak böngésző-`localStorage` és a `PREF` cookie; automatikus indítás csak a README szerinti kézi, SSH/Telnet-es `luna-send-pub` paranccsal | NEM ÉSZLELT |
| Időzített feladatok | `setInterval` 60 mp-enként „mindig kérdezze meg, ki nézi” módban (`auto-login.js:47`); SponsorBlock időszakos frissítés lejátszás közben; mindkettő dokumentált | NEM ÉSZLELT rejtett tevékenység |
| Hibaágakba rejtett viselkedés | a hibaágak csak naplóznak vagy újrapróbálkoznak (RYD: legfeljebb `FETCH_MAX_RETRIES`); adatküldés nincs bennük [S] | NEM ÉSZLELT |
| Dokumentálatlan működés | a `JSON.stringify` globális felülírása és az `isInlinePlaybackNoAd` kényszerítése a reklámszűrés része (CHANGELOG / README); a YouTube szolgáltatási feltételeit érintheti (I-01) | nem biztonsági kérdés |

**Következtetés:** rosszindulatú működésre **nincs bizonyíték**. A talált kockázatok valódi, de alacsony vagy közepes súlyú adatvédelmi és ellátásilánc-kérdések, nem kártékony kód.

---

## 8. WebOS-jogosultságok és rendszerhozzáférés

`assets/appinfo.json` (azonos a csomagban lévővel) [S]:

| Mező | Érték | Jelentés / megállapítás |
|---|---|---|
| `id` | `youtube.leanback.v4` | **az eredeti LG YouTube-alkalmazás azonosítója**. Emiatt kell előbb eltávolítani a gyári appot (README 20. sor). Átveszi a deep linkeket, a hangvezérlést, a DIAL-t (`dialAppName: "YouTube"`) és az `inAppSearch` integrációt. |
| `vendor` | `webosbrew.org` | |
| `trustLevel` | `netcast` | magasabb megbízhatósági szint, mint egy átlagos fejlesztői appé. [F] Hogy ténylegesen milyen többletjogot ad homebrew- vagy fejlesztői telepítéskor, az firmware-függő, és **csak valós TV-n ellenőrizhető** (F-09). |
| `privilegedJail` | `true` | [F] privilegizált sandbox-profil; hatása firmware-függő (F-09) |
| `allowCrossDomain` | `true` | a webOS webes runtime-ban lazítja a cross-origin korlátozást; a SponsorBlock- és RYD-hívások így régi TV-ken is működnek. Ha bármilyen idegen kód futna az oldalon, ez növelné a hatását (F-05). |
| `supportQuickStart` | `true` | a gyors indításhoz háttérben életben tartható [F] |
| `checkUpdateOnLaunch` | `false` | nincs automatikus frissítés-ellenőrzés az appból |

**Ténylegesen megállapított képességek** [S]:

- a YouTube origin minden adata: DOM, `localStorage`, nem `HttpOnly` cookie;
- egy Luna-szolgáltatás (`com.webos.service.tvpower`);
- hálózati kérések a 5.1 táblázat címeire.

**Nincs:** fájlrendszer-hozzáférés, más app adatainak olvasása, `luna-send`/`webOS.service.request` más szolgáltatásokra, SSH/Telnet használat.

**Telepítés:** fejlesztői mód (Developer Mode app, `ares-install`), Device Manager vagy Homebrew Channel. A README szerint **root nem szükséges**. Root/SSH csak az opcionális automatikus indításhoz (`com.webos.service.eim/addDevice`) és a root-alapú fejlesztői beállításhoz kell (README 357–378., 416–426. sor). Az app maga nem állít be automatikus indítást.

**XSS / kódinjektálás:**

- A DOM-írások `textContent`/`createElement` alapúak, `innerHTML` nincs.
- A SponsorBlock-adatból készülő CSS-be csak escape-elt karakterlánc (`cssString`) és szabályos kifejezéssel ellenőrzött szín (`safeColor`) kerül; a szegmensszín forrása a felhasználói beállítás vagy beépített táblázat.
- Az indítási paraméter csak `https://www.youtube.com` originre navigálhat (`launch.js:44-51`): **nincs nyílt átirányítás** más domainre.

---

## 9. Sérülékenységek és kockázatok

### F-01 – Frissítési és ellátásilánc-bizalmi modell — **KÖZEPES**

- **Bizonyíték:**
  - A Homebrew Channel a `main` ágon lévő `repo.json`/`repo-webos22.json` fájlt követi. Ezt a `build_repo.yml` generálja. A benne lévő SHA-256 ugyanabból a kiadásból számolódik.
  - A kiadás `"immutable": false`, aláírás nincs.
  - A kiadó egyetlen fiók (`foxi69`). A commitokat a GitHub web-flow írja alá (`%G?` = `E`, helyben nem ellenőrizhető).
  - A v0.8.5–0.8.7 kiadások egy napon belül jelentek meg, sok MI-asszisztált commit van (`Co-Authored-By: Claude`).
- **Kihasználhatóság:** a `foxi69` fiók vagy a repó írási joga kompromittálódik, és a felhasználó a Homebrew Channelben frissít.
- **Hatás:** a következő verzió a YouTube originben fut, és **teljes hozzáférést kaphat a bejelentkezett munkamenethez**, akár fiókátvétellel is.
- **Reprodukálható:** a modell igen; tényleges kompromittálásra nincs jel.
- **Javítás:**
  - a felhasználónak: verzió rögzítése, frissítés előtt diff és hash ellenőrzése, reprodukálható újraépítés (2.2);
  - a kiadónak: immutable release, Sigstore/GPG aláírás vagy build-attesztáció (`actions/attest-build-provenance`), ágvédelem és kötelező review a `main`-en.

### F-02 – Megtekintési előzmény harmadik félnek (Return YouTube Dislike) — **KÖZEPES (adatvédelem)**

- **Bizonyíték:** `return-dislike.js:186`: `https://returnyoutubedislikeapi.com/votes?videoId=${videoID}`; `config.js:132`: `enableReturnYouTubeDislike` alapértelmezetten `true`. [T] a kérés minden megnyitott videónál kiment.
- **Hatás:** a RYD üzemeltetője a TV IP-címével együtt megkapja a megnézett videók azonosítóját, azaz a megtekintési előzményt. Hitelesítési adatot nem kap [T].
- **Javítás:** alapértelmezés legyen ki, vagy legyen k-anonim lekérdezés, ha a szolgáltatás támogatja. Felhasználóként a funkció kikapcsolható a panelen.

### F-03 – Nem hivatalos SponsorBlock-tükör az elsődleges végpont — **ALACSONY**

- **Bizonyíték:** `sponsorblock.js:12-13`: elsődleges a `https://sponsorblock.inf.re/api`, tartalék a hivatalos `https://sponsor.ajay.app/api`. Az upstreamből örökölt (`git log -S`: NicholasBly, 0.7.6).
- **Továbbított adat:** a videó-ID SHA-256 hash-ének 4 hex karaktere (k-anonimitás, `sponsorblock.js:674-676`) és az IP-cím.
- **Integritás:** a tükör válasza határozza meg, mely videószakaszokat ugorja át vagy némítja el a lejátszó. A válasz típusellenőrzésen megy át (`isWellFormedSegment`, 79–85. sor), kódfuttatásra nem alkalmas. Egy rosszindulatú tükör legfeljebb zavaró átugrásokat okozhat.
- **Javítás:** a hivatalos API legyen az elsődleges, vagy legyen választható.

### F-04 – Automatikus fiókválasztás alapértelmezetten — **ALACSONY (adatvédelem)**

- **Bizonyíték:** `config.js:163-164` (`enableAutoLogin`, `autoSelectAccount` alapértelmezetten `true`); `auto-login.js:24-30, 210-238`: a „Ki nézi?” képernyőt 7 napra elhalasztja, és ha mégis megjelenik, szimulált ENTER-rel kiválasztja a fókuszban lévő (utoljára használt) fiókot.
- **Hatás:** közös TV-n bárki a legutóbb használt Google-fiókkal fog nézni (előzmények, feliratkozások, ajánlások). A hitelesítést nem kerüli meg: a fiók már be volt jelentkezve a TV-n.
- **Javítás:** közös háztartásban kapcsold ki az „Auto Login” beállítást („always ask who is watching” mód).

### F-05 – `allowCrossDomain: true` és bővített `trustLevel` a manifestben — **ALACSONY**

- **Bizonyíték:** `assets/appinfo.json` 21., 33–34. sor.
- **Hatás:** önmagában nem sérülékenység. Ha azonban idegen kód futna a YouTube-oldalon (pl. egy YouTube-oldali XSS), a lazított cross-origin szabályok [F] lehetővé tehetik helyi hálózati eszközök válaszainak olvasását is.
- **Javítás:** csak a minimálisan szükséges jogosultságok deklarálása. A tényleges hatást valós TV-n kell ellenőrizni (F-09).

### F-06 – Érzékeny adatok a konzolnaplóban — **ALACSONY**

- **Bizonyíték:**
  - `launch.js:55` `console.info('handleLaunch', params)` és `userScript.js:51` `console.info('RELAUNCH:', evt, window.launchParams)`: a DIAL `pairingCode`, a keresési és hangparancs-paraméterek a konzolra kerülnek;
  - `hooks/fetch.ts:94-135`: `__ytaf_debug__` esetén teljes kérés- és választörzsek (tokenekkel együtt) a konzolra kerülnek.
- **Kihasználhatóság:** csak devtools/`ares-inspect` hozzáféréssel, ami fejlesztői módot és helyi hozzáférést feltételez. Hálózatra nem kerülnek ki [S].
- **Javítás:** a paraméterek naplózásának megszüntetése vagy csak `DEBUG` esetén; a debug-dump tiltása a kiadott buildben.

### F-07 – Harmadik féltől betöltött erőforrások webOS 3/4 alatt — **ALACSONY**

- **Bizonyíték:** `emoji-font.js:27-31, 255-261`: twemoji PNG-k a `cdnjs.cloudflare.com`-ról, Noto-betűtípus CSS a `fonts.googleapis.com`-ról.
- **Hatás:** IP-cím és Referer-origin megy ki. Kód nem töltődik be. Egy kompromittált CDN legfeljebb képeket, illetve a CSS-en keresztül megjelenést módosíthatna.
- **Javítás:** az erőforrások becsomagolása az IPK-ba, vagy SRI (`integrity`) használata a CSS-linken.

### F-08 – A build-eszközlánc ismert sérülékenységei — **ALACSONY** (a TV-re nem kerülnek)

- **Bizonyíték:** `npm audit` a `v0.8.7` lockfile-on 10 találatot ad (1 kritikus, 7 magas, 2 közepes). **Mind** a `@webos-tools/cli` devDependency függőségfáján belül van (`proxy-addr`, `shelljs`, `js-yaml`, `braces`, `micromatch` stb.).
- **Hatás:** a webpack-statisztika szerint egyik sem kerül a bundle-be (3. fejezet). A kockázat a build-gépet és a CI-t érinti, a TV-t nem. A futásidejű függőségekre (`tiny-sha256`, `@twemoji/api`, `whatwg-fetch`, `@babel/runtime`) nincs audit-találat.
- **Javítás:** `@webos-tools/cli` frissítése vagy elkülönítése; a Dependabot npm-frissítéseinek legalább biztonsági riasztás szintű bekapcsolása.

### F-09 – A `trustLevel: netcast` / `privilegedJail` tényleges hatása — **NEM BIZONYÍTOTT / TOVÁBBI VIZSGÁLAT SZÜKSÉGES**

Valós TV-n kellene ellenőrizni, hogy fejlesztői vagy homebrew telepítéskor milyen Luna-API-k érhetők el ténylegesen. Ez a kód nem használ ki ilyet, de a deklaráció nagyobb mozgásteret adhat egy jövőbeli verziónak.

### F-10 – A valódi YouTube-tokenek tárolása és kezelése a TV-n — **NEM BIZONYÍTOTT / TOVÁBBI VIZSGÁLAT SZÜKSÉGES**

A vizsgálati környezetből a `youtube.com` nem volt elérhető (proxy: `CONNECT tunnel failed, response 403`). Tesztfiókos bejelentkezésnél meg kell figyelni:

- hol és milyen kulcs alatt tárolódnak a tokenek;
- hogy a hookolt `JSON.parse`/`stringify` útvonalon áthaladó tokenek nem kerülnek-e máshová.

A statikus elemzés alapján nem kerülnek.

### F-11 – A YouTube által futás közben letöltött kód és a hookok kölcsönhatása — **NEM BIZONYÍTOTT / TOVÁBBI VIZSGÁLAT SZÜKSÉGES**

A `JSON.parse`, `JSON.stringify`, `fetch` és `XMLHttpRequest` globális felülírása a YouTube teljes forgalmát érinti. A vizsgálat szerint a hookok csak szűrnek és blokkolnak, adatot nem másolnak ki. Az éles YouTube-kliens és a hookok együttes viselkedését azonban nem lehetett megfigyelni.

### Tájékoztató megállapítások

- **I-01:** A reklámszűrés és a lejátszási kérés módosítása (`json-stringify.ts`) a YouTube szolgáltatási feltételeibe ütközhet. Fiókszankcióra nincs bizonyíték. Nem biztonsági, hanem jogi és fiókkockázati kérdés.
- **I-02:** `return-dislike.js:186`: a videóazonosító URL-kódolás nélkül kerül a query stringbe. Egy `&` jelet tartalmazó `v` paraméter extra paramétert juttathat a RYD-kérésbe. Csak a RYD-szerver felé hat, hatása elhanyagolható. Javítás: `encodeURIComponent(videoID)`.
- **I-03:** A README a `dist/` mappát is letöltési forrásként ajánlja. Az ottani IPK-k hash-e eltér a `repo.json` hash-étől (tartalmuk azonos, 2.3), ezért a felhasználó nem tudja őket hash alapján ellenőrizni. Javaslat: csak a Releases oldalt ajánlani, vagy determinisztikus csomagolást használni.
- **I-04:** Helyi nyomok: a `ytaf-thumb-quality` kulcs a böngészett videók azonosítóit tárolja `localStorage`-ben (csak bekapcsolt bélyegkép-javításnál), a `PREF` cookie-t 10 évre írja. Mindkettő a készüléken marad.
- **I-05:**
  - A repó `bench/` tesztjei részben elavultak (a 0.8.6-ban törölt térbeli navigációra hivatkoznak), több teszt felderítetlen okból sikertelen (4. fejezet), és a `jsdom` nem szerepel a függőségek között. Ezért a beállítópanel és a bélyegkép-javítás működése nem tekinthető igazoltnak. (Javítva, lásd 13. fejezet.)
  - A GitHub Actions lépései főverzió-taggel vannak hivatkozva (`@v7`), nem commit-SHA-val. A workflow-k `contents: write` jogot kapnak, `pull_request_target` nincs.
  - A `sync-upstream.yml` csak PR-t nyit, nem merge-el automatikusan.

---

## 10. Függőségek és ellátásilánc-biztonság

| Elem | Állapot |
|---|---|
| Futásidejű npm-csomagok | 4 db (3. fejezet); a lockfile `sha512` integritás-hash-ekkel rögzíti őket; az `npm ci` ellenőrizte őket; `npm audit`: 0 találat rájuk |
| Fejlesztői csomagok | 736 dev-függőség; 10 audit-találat, mind a `@webos-tools/cli` fán (F-08); az `npm ci --ignore-scripts` mellett a build sikeres és reprodukálható; a `package.json` `allowScripts` blokkja tiltja a `@webos-tools/cli`, `ssh2` és `cpu-features` install-szkriptjeit |
| Build-reprodukálhatóság | **igazolt**: a v0.8.7 két változata bájtra azonos újraépítéssel (2.2) |
| CI | GitHub-hosted runner, a tag commitjából építve; a kiadás-feltöltő `github-actions[bot]`; az assetek nem immutable-ök |
| Aláírás | nincs (IPK, kiadás, tag); a tag lightweight, a commitok GitHub web-flow aláírásúak |
| Upstream | `NicholasBly/youtube-webos` → `webosbrew/youtube-webos` → `FriedChickenButt/youtube-webos`; a SponsorBlock-tükör és a manifest jogosultsági mezői az upstreamből öröklődtek (`git log -S`) |
| Beágyazott titkok | nincs: az `AIza`, `api_key`, `apiKey`, `secret`, `password`, `token`, `Authorization`, `SAPISID` keresésnek nincs releváns találata a bundle-ökben [S] |

---

## 11. Nem tesztelt területek és fennmaradó bizonytalanságok

| Nem elvégzett vizsgálat | Ok | Ami emiatt **nem** állítható |
|---|---|---|
| Futtatás valós LG webOS TV-n (3–6, 22–25) | nem volt készülék | a webOS runtime tényleges jogosultságai (`trustLevel`, `privilegedJail`, `allowCrossDomain`); a Luna-hívás valós hatása; a képernyővédő, a cast-blokk, a gyorsindítás és az automatikus indítás tényleges működése |
| Forgalomrögzítés éles YouTube-bal (indulás, bejelentkezés, lejátszás, beállítás, kilépés) | a környezet hálózati szabálya tiltotta a `youtube.com`, a RYD és a SponsorBlock elérését (HTTP 403 a proxyn) | hogy éles működés közben valóban csak a 5.1 végpontok forgalmaznak; DNS-szintű viselkedés; a TLS-láncok |
| Bejelentkezett mód és vendégmód összehasonlítása valódi tesztfiókkal | mint fent | a valódi tokenek helye és útja (F-10) |
| Újraindítás, háttérforgalom, hosszabb futás | mint fent | hosszú távú háttérforgalom (statikusan csak a SponsorBlock időszakos frissítése, a 60 mp-es helyi időzítő és a képernyővédő-feliratkozás azonosítható) |
| A YouTube futás közben letöltött JS-kódja | a hatókörön kívül esik | a YouTube és a hookok kölcsönhatása (F-11) |
| Harmadik fél szerverei (RYD, `sponsorblock.inf.re`) | külső fél | az ottani adatkezelés és naplózás |

A dinamikus vizsgálat Chromium 141-ben futott webOS user agenttel. A webOS 3 (Chromium 38) és webOS 4 (Chromium 53) motor viselkedését csak a repó saját, `jsdom`-alapú „Chrome 38 downgrade” környezete közelíti.

---

## 12. Javítási javaslatok és biztonságos telepítési ajánlás

**Felhasználóknak:**

1. **Ne a mindennap használt fiókkal kezdd.** Először tesztfiókkal vagy vendégmódban próbáld ki. Ha lehet, olyan TV-n, amelyen nincs bejelentkezve a személyes Google-fiókod.
2. Letöltés után **ellenőrizd a SHA-256-ot** (2.1). Csak a Releases oldalról telepíts, ne a repó `dist/` mappájából.
3. Ha nem akarod, hogy a megtekintési előzményed külső szolgáltatóhoz kerüljön, **kapcsold ki a Return YouTube Dislike funkciót**. Ha csak a hivatalos SponsorBlockot fogadod el, a SponsorBlockot is (amíg az elsődleges végpont nem módosítható).
4. Közös TV-n **kapcsold ki az „Auto Login”-t** (F-04).
5. Ha kevesebb YouTube-telemetriát szeretnél, a „Reduce Telemetry & Tracking” alapértelmezetten **ki** van kapcsolva; be kell kapcsolni.
6. **Frissítéseket ne telepíts automatikusan.** Minden új verziónál nézd át a változásokat, és lehetőleg reprodukáld a buildet (2.2), mert a kód hozzáfér a YouTube-munkamenethez (F-01).
7. Ha gyanú merül fel: a Google-fiókban (Biztonság → Eszközeid) vond vissza a TV hozzáférését, és távolítsd el az alkalmazást.

**A kiadónak:**

- immutable kiadások, aláírás vagy build-attesztáció (F-01);
- a hivatalos SponsorBlock API legyen az elsődleges (F-03);
- RYD alapértelmezetten ki, vagy egyértelmű adatvédelmi tájékoztatás (F-02);
- `encodeURIComponent` a RYD-URL-ben (I-02);
- az indítási paraméterek naplózásának megszüntetése (F-06);
- a webOS 3/4 külső erőforrások becsomagolása (F-07);
- a `@webos-tools/cli` frissítése (F-08);
- a `bench/` tesztek karbantartása és a `jsdom` felvétele a devDependency-k közé (I-05);
- a manifest jogosultságainak minimalizálása (F-05).

---

## Végső biztonsági döntés

**Található-e bizonyíték jelszó, token, cookie vagy más hitelesítési adat jogosulatlan kiszivárgására?**
**Nem.** A v0.8.7 kód statikus elemzésében nincs olyan útvonal, amely hitelesítési adatot olvasna és továbbítana. A dinamikus tesztben a szintetikus cookie-k és tokenek egyetlen YouTube-on kívüli kérésben sem jelentek meg (0 előfordulás négy futásban). Ez a „NEM ÉSZLELT A VIZSGÁLT KÖRNYEZETBEN” minősítésnek felel meg, nem a lehetetlenség bizonyításának.

**Van-e olyan kódrészlet, amely lehetővé teszi a hitelesítési adatokhoz való szükségtelen hozzáférést?**
A userscript **tervezetten** a YouTube originben fut, így *képes volna* hozzáférni a munkamenethez. Ez a működés velejárója, és ez a legnagyobb fennmaradó kockázat (F-01). Ténylegesen a kód csak a `PREF` cookie `hl` mezőjét és a `last-identity-used` rekord `identityType` mezőjét olvassa. Tokent, `Authorization` fejlécet vagy munkamenet-cookie-t nem olvas. A `__ytaf_debug__` mód a tokeneket tartalmazó törzseket a konzolra írná, de csak kézi bekapcsolással (F-06).

**Történik-e adatküldés a szükséges szolgáltatásokon kívülre?**
**Igen, dokumentált funkciók részeként.** Hitelesítési adatot egyik sem tartalmaz:

- `returnyoutubedislikeapi.com` (teljes videó-ID, alapértelmezetten be);
- `sponsorblock.inf.re`, illetve `sponsor.ajay.app` (4 karakteres hash-előtag, alapértelmezetten be);
- webOS 3/4 alatt `cdnjs.cloudflare.com` és `fonts.googleapis.com`.

Mindegyik megkapja a TV IP-címét. Analitikai, hirdetési vagy ismeretlen végpont nincs.

**Van-e bizonyíték rejtett, kártékony vagy dokumentálatlan működésre?**
**Nincs.** A bináris bájtra reprodukálható a nyilvános forrásból. Nincs dinamikus kódbetöltés, `eval`, `innerHTML`-injektálás vagy rejtett végpont. Az egyetlen rendszerszolgáltatás-hívás a dokumentált képernyővédő-kezelés.

**Biztonságosan használható-e az alkalmazás személyes Google-fiókkal?**
**A biztonság nem igazolt teljes körűen.** A jelenlegi bizonyítékok alapján a v0.8.7 nem szivárogtat hitelesítési adatot. A kockázat elfogadható lehet, ha:

- a felhasználó elfogadja a 3. félnek küldött videóazonosítókat, vagy kikapcsolja ezeket a funkciókat;
- és nem telepít ellenőrizetlenül frissítést.

A végső döntéshez szükséges a valós TV-n, tesztfiókkal végzett forgalomvizsgálat (11. fejezet). Addig a személyes fiók használata **tudatosan vállalt maradék kockázattal** jár.

**Milyen további vizsgálatok szükségesek a maradék kockázat csökkentéséhez?**

1. Valós LG TV-n, elszigetelt hálózaton, **tesztfiókkal**: teljes forgalomrögzítés (DNS és TLS-SNI szinten is, pl. mitmproxy/pi-hole) indulás, bejelentkezés, lejátszás, beállítás és kilépés közben, bejelentkezett és vendégmódban, újraindítás és gyorsindítás után.
2. A valódi YouTube-tokenek tárolási helyének és útjának azonosítása `ares-inspect`-tel (F-10).
3. A `trustLevel: netcast` / `privilegedJail` tényleges Luna-hozzáférésének felmérése (F-09).
4. Minden új verziónál: diff a vizsgált `0c9ca90`-hoz képest, reprodukálható build és hash-ellenőrzés.
5. A harmadik fél szolgáltatók (RYD, `sponsorblock.inf.re`) adatkezelési gyakorlatának felülvizsgálata.

---

## 13. Javítások állapota (a v0.8.7 audit után)

Ezek a változások a `claude/hopeful-darwin-4p3s81` ágon vannak, és **a v0.8.7 kiadásban még nincsenek benne**. A következő kiadással kerülnek a TV-re. A fenti 1–12. fejezet a v0.8.7 csomagra vonatkozik, és változatlanul érvényes rá.

| Megállapítás | Állapot | Változás |
|---|---|---|
| F-01 Frissítési / ellátásilánc-bizalom | **nyitott – a kiadó beállításain múlik** | kódból nem javítható: az immutable release és az ágvédelem repóbeállítás, a build-attesztációt a kiadónak kell bevezetnie |
| F-02 RYD alapértelmezetten be | **javítva** | `config.js`: `enableReturnYouTubeDislike` alapértéke `false`. Csak új telepítésre hat: meglévő mentett beállítás megtartja a korábbi értékét. A README beállítástáblája jelzi az adatküldést. |
| F-03 Nem hivatalos SponsorBlock-tükör elsődlegesen | **javítva** | `sponsorblock.js`: elsődleges a hivatalos `sponsor.ajay.app`, a tükör (`sponsorblock.inf.re`) csak tartalék |
| F-04 Automatikus fiókválasztás alapértelmezetten | **változatlan, szándékosan** | ez a funkció lényege, és helyi beállítás (nem küld adatot); közös TV-n a felhasználónak kell kikapcsolnia |
| F-05 Manifest jogosultságok | **változatlan** | eltávolításuk valós TV-n tesztelés nélkül eltörheti a deep linket, a DIAL-t vagy a régi TV-ken a cross-origin kéréseket |
| F-06 Indítási paraméterek a konzolnaplóban | **javítva** | `launch.js`, `userScript.js`: csak a paraméterek nevei kerülnek a naplóba. A `__ytaf_debug__` dump megmaradt: kézzel, devtoolsból kapcsolható, és aki devtoolshoz fér, a munkamenet adatait így is látja. |
| F-07 Külső CDN webOS 3/4 alatt | **változatlan** | a twemoji-képkészlet túl nagy az IPK-hoz; a Google Fonts CSS-e user agentenként változik, ezért SRI-vel nem rögzíthető |
| F-08 Build-eszközlánc sérülékenységei | **változatlan, a kiadó döntése szerint** | a `@webos-tools/cli` a legfrissebb (3.2.6), és csak a buildhez kell; a TV-re telepített csomagba nem kerül |
| I-02 RYD URL-kódolás | **javítva** | `return-dislike.js`: `encodeURIComponent(videoID)` |
| I-03 `dist/` csomagok hash-e | **dokumentálva** | a README a Releases oldalt ajánlja, és jelzi, hogy a `dist/` hash-e eltér a `repo.json`-étól |
| I-05 Elavult tesztek | **javítva** | lásd lent |

**A tesztek javítása (I-05):**

- A „sikertelen” panel-, függőség- és új-funkció-tesztek valódi oka az volt, hogy az app szándékosan figyelmen kívül hagyja a nem megbízható (`isTrusted === false`) billentyűeseményeket (`ui.js` `isSyntheticKey`, v0.8.7-ben az 1553. sor). A jsdom `dispatchEvent()` pedig mindig ilyet küld, így ezek a tesztek a beállítópanelt soha meg sem nyitották.
- Új segédfüggvény (`bench/chrome38-env.cjs` `dispatchTrusted`) a távirányítóhoz hasonlóan megbízható eseményt küld.
- A tesztek a jelenlegi kódot követik:
  - hattabos beállítópanel;
  - a bélyegképeket a modul már a JSON-válaszban javítja, nem a DOM-ban;
  - a „4.3k” formátum 0.8.3 óta érvényes;
  - a `JSON.parse` hook kikapcsolva átengedő marad.
- A 0.8.6-ban eltávolított térbeli navigációs polyfill tesztjei törölve.
- A `jsdom` (30.1.1) dev-függőség lett. Ellenőriztem, hogy a lockfile változása után a `v0.8.7` forrásból mindkét csomag továbbra is bájtra azonos a kiadottal.

**Ellenőrzés a javított kódon** [T]:

- A repó tesztjei mind sikeresek: `polyfill-conformance` 264, `launch-test` 7/7, `smoke` 10/10, `modern-smoke` 10/10, `adblock-test` 27, `new-features-test` 21, `dependency-test` 11, `module-behaviour-test` 14, `panel-test` 21, `dislike-timing-test` 11, `sponsorblock-labels-test` 71, `force-codec-test` 48, emoji-tesztek.
- Dinamikus teszt (`tools/audit-dyn-test.cjs`):
  - alapbeállítással nem ment kérés a `returnyoutubedislikeapi.com`-ra;
  - a SponsorBlock a `sponsor.ajay.app`-ot kérdezte;
  - a naplóban csak `handleLaunch [contentTarget]` és `RELAUNCH: [contentTarget]` szerepelt;
  - bekapcsolt RYD mellett is 0 hitelesítési adat ment harmadik félnek.
