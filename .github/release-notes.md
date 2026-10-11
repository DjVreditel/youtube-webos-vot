Ad-free YouTube for LG webOS TVs, with SponsorBlock, Return YouTube Dislike, programmable remote buttons and
a settings panel in a new Fox look. Built on [NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos)
0.8.4, plus the best fixes and features from the rest of the youtube-webos fork network.

## Download

| File | TVs |
|---|---|
| `youtube.leanback.v4_@VERSION@_all_webOS22+.ipk` | webOS 22 and newer (2022+ TVs). Lighter and faster; use this one when your TV supports it. |
| `youtube.leanback.v4_@VERSION@_all.ipk` | webOS 3-6 (2016-2021 TVs). Also runs on newer TVs. |

## Install

The official YouTube app has to be uninstalled first.

- **[Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)**: add one repository, so updates
  come from this fork: `https://raw.githubusercontent.com/foxi69/youtube-webos/main/repo-webos22.json` on webOS 22
  and newer, `https://raw.githubusercontent.com/foxi69/youtube-webos/main/repo.json` on webOS 3-6. If the default webosbrew repository offers YouTube AdFree 0.5.3 as an "update", ignore it: that
  is the older webosbrew build under the same app id.
- **[Device Manager](https://github.com/webosbrew/dev-manager-desktop)**: install the downloaded `.ipk`.
- **[webOS TV CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation)**:
  `ares-install youtube.leanback.v4_@VERSION@_all_webOS22+.ipk`

Once YouTube is up, press the **green** button to open the settings. Every setting and its default is listed in
the [README](https://github.com/foxi69/youtube-webos#settings).

## What's new in @VERSION@

@CHANGELOG@

## Credits

[FriedChickenButt](https://github.com/FriedChickenButt/youtube-webos) (the original project),
[webosbrew](https://github.com/webosbrew/youtube-webos) (the community continuation),
[NicholasBly](https://github.com/NicholasBly/youtube-webos) (the rewrite this fork builds on), and the authors of
the forks whose work is ported here, credited per change above.

**Full changelog:** [CHANGELOG.md](https://github.com/foxi69/youtube-webos/blob/main/CHANGELOG.md)
