# LG G5 controls, translation and native volume fixes

Validated on an LG G5 running webOS 11.2.0, using the separate Cobalt app
(`youtube.vot.cobalt`, 101.5.2). The Magic Remote has no red shortcut button.
The user confirmed the complete flow on the TV, including the final redraw fix.

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
# Optional real browser layout check; point this at your Chrome/Chromium:
CHROME_BIN=/path/to/chrome node bench/vot-controls-layout-check.cjs
```

The 53 tests cover pointer/remote ownership, repeated native DOM redraws,
button/image identity, disposal, volume replacement/restoration, cancellation,
protobuf decoding, bounded retries and cache separation. The compiled bundle
check covers toggle/close and native focus return. The browser check verifies
that both inline and flex toolbars retain their original height and matching
icon size/centres; the previous inline implementation grew from 56 to 79px.
