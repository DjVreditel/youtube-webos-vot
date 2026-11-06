# LG G5 controls, translation and native volume fixes

Validated on an LG G5 running webOS 11.2.0, using the separate Cobalt app
(`youtube.vot.cobalt`, 101.5.2). The Magic Remote has no red shortcut button.
The user confirmed the controls/audio flow on the TV, including the final redraw fix.

## Controls and focus

- Translation and VOT options are icon buttons beside the native player settings.
  Translation toggles the upper panel; its close button hides the panel without
  stopping the voice track. Status updates do not reopen it.
- Pointer selection, D-pad navigation and OK work in the upper menu. Leaving the
  menu releases its focus, and closing either menu restores a native YouTube
  control so Up/Down can open or navigate the transport controls again.
- The icons use native settings geometry. Zero-height width slots keep the
  inline toolbar background at its original height. Embedded PNG glyphs also
  render in Cobalt, where the initial CSS-drawn sliders did not.
- YouTube removes unknown children on focus redraws. MutationObserver repair
  reattaches the same buttons and images before paint, instead of waiting for
  the one-second fallback timer. Repair does not steal native focus.

## Original track and cache

OriginalVolume coordinates the media element and YouTube player level, rebinds
on audio-track replacement, explicitly mutes zero, and restores the previous
state when translation stops. The Yandex voice uses its separate audio path.

The native shared Starfish pipeline needs an explicit volume transition:

```json
{"volume":50,"ease":{"duration":50,"type":"Linear"}}
```

On this G5, the volume-only command returned success without changing the
hardware level. The omitted easing type reached the LG sink as an empty string;
`Linear` made 0–100% changes take effect. Patch `0002` adds that payload to the
pinned RF1705 source used by `cobalt-port/build.sh`, after the existing `0001`.
It leaves the shared hardware audio/video path intact.

The equivalent payload correction was tested on the TV with an app-local
adapter, and the user confirmed audible changes at 0%, 50% and 100%. The native
adapter tests ran on macOS with ASan/UBSan and on ARM on the TV. This proposal
contains the source patch, not that adapter or a modified binary. The full
Docker Cobalt source build has **not** been rerun here; patch application was
checked against pinned `99caa9314fca028acc09e93d1c49f91797386e43` after `0001`.

The URL cache now also reuses lively-voice entries, keyed by the voice actually
returned. A stale URL first retries normal server cache. Temporary translation
failures have bounded retries, persistent cache bypass and correctly consume a
successful retry response. Unknown length-delimited protobuf fields no longer
corrupt the following fields. Cancellation during audio upload is propagated.

## OLED theme and inline previews

On the same G5, full-screen playback worked while home-screen autoplay tiles
were black. The user confirmed that disabling OLED-care mode restored preview
video. The media element reported ready frames and advancing playback at the
expected tile rectangle (720×405 in the 1920×1080 UI).

The new guard temporarily suspends page-level OLED overrides while a Cobalt
inline preview has a frame. YouTube can then retain its native transparency.
The saved preference and settings-panel theme are preserved; page styling
returns when inline playback ends or the user opens Watch/Shorts. Paused
previews remain visible. Non-Cobalt clients keep the existing behavior.

The guard passed lifecycle tests and a compiled-bundle CSS check, including
transparent preview backgrounds and restoration on the watch page. The updated
payload was installed on the TV. Re-enabling OLED with this guard has **not yet
been visually confirmed**; the owner's successful observation was with the
OLED setting disabled. Native decoder changes were unnecessary and are not
part of this preview fix.

## Intermittent translation errors

A later report showed the generic server translation error on a video that
previously worked. The error did not recur during the observation: the user
confirmed successful translation. No specific server-side cause was established.

Regression tests exposed two client-side recovery problems:

- Source-audio upload results were ignored. A failed chunk could be followed
  by later chunks, then be reported as a generic translation error. Uploads now
  retry transient failures with the same chunk/file id, stop on permanent or
  exhausted failures, and never send an empty-audio fallback for an upload
  rejection. New server job ids can request audio again; repeated polls of the
  same job do not re-upload it. Work is bounded to three jobs per request.
- On Cobalt, any whole-file download failure was treated as an expired URL.
  Timeouts and temporary server errors now preserve the cached translation;
  only HTTP 401/403/404/410 allow the normal expired-URL refresh path.

The last failure stores at most 24 diagnostic events locally under
`ytaf-vot-last-error-v1` (stage, response codes, retry/chunk numbers and video id).
It excludes raw errors/responses, titles, URLs, credentials and audio content.
Cancellation/success do not overwrite it; records older than seven days are
removed when a new translation starts. Storage failure cannot stop playback.
No collection server, remote-command interface or temporary probe is included.

The new failure tests fail on the preceding source and pass after the changes.
The intermittent TV error itself remains unconfirmed, so these are concrete
recovery fixes plus diagnostics, not a claim that all upstream errors are gone.

## Concurrent MP3 decoding and audio-stutter follow-up

After fix10 the owner reported stuttering and disappearing translation audio.
The exact previous fix9 preload was restored and the app relaunched; the native
player and volume adapter hashes were unchanged. Audible behavior after that
rollback is awaiting the owner's check. This does not establish fix10 as the
cause: its changes did not alter decoding or ongoing playback scheduling.

A separate decoder defect was reproduced with generated sine-wave MP3 files.
`decodeMp3` shared one minimp3 decoder state across jobs while yielding between
frame slices. A prefetch and a seek decode could reset each other's state,
producing shortened audio and different PCM samples. The defect also exists in
fix9. Complete decoder jobs now run serially; a rejected job releases the queue,
and exceptions from later timer slices free the input allocation and reject.
Playback scheduling, gain, native output and volume handling are unchanged.

Three regression tests cover exact concurrent-versus-serial PCM equality,
recovery after invalid input, and allocation/queue cleanup after a later-slice
exception. Two fail on the old source; all pass after the change. Fixtures are
short generated tones with a generation recipe, with no user audio and no FFmpeg
requirement in CI. The connection to the owner's audible symptom and the
candidate's effect on the TV are not yet confirmed.

## Optional blue launcher

Set `COBALT_ICON_VARIANT=blue` when running `cobalt-port/package.sh` to use the
included blue launcher artwork. The default keeps the existing artwork. This
helps distinguish a separate Cobalt installation from the stock YouTube app.
The supplied PNGs are 80×80 and 130×130; their design changes the play button from
red to blue. They were generated with imagegen from the existing launcher icon.

The translation button uses the unchanged Yandex sign from the official
[brand announcement](https://yandex.ru/company/news/31-03-2021)
([192px asset](https://yastatic.net/s3/home-static/_/f0/f0597b6727cc67dceebc4e3a87caf571.png)).
The sliders icon source is included as `src/vot/menu-sliders.svg`.

## Reproduce the checks

```sh
npm ci
node vot-mod/patch.cjs --patch-only
npm run typecheck --prefix vot-mod
node --test vot-mod/tests/*.test.mjs
npm run build
node bench/vot-player-controls-check.cjs
node bench/vot-oled-preview-check.cjs
# Optional real browser layout check; point this at your Chrome/Chromium:
CHROME_BIN=/path/to/chrome node bench/vot-controls-layout-check.cjs
```

The 73 tests cover pointer/remote ownership, repeated native DOM redraws,
button/image identity, disposal, volume replacement/restoration, cancellation,
protobuf decoding, bounded retries, cache separation and OLED preview lifecycle. The compiled bundle
check covers toggle/close and native focus return. The browser check verifies
that both inline and flex toolbars retain their original height and matching
icon size/centres; the previous inline implementation grew from 56 to 79px.
