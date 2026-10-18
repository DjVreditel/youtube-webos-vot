<p align="center">
  <img src="https://raw.githubusercontent.com/foxi69/youtube-webos/main/screenshots/banner.svg" alt="YouTube AdFree for LG webOS TVs" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-@VERSION@-ff7a1a?style=for-the-badge" alt="Version @VERSION@">
  <img src="https://img.shields.io/github/downloads/foxi69/youtube-webos/v@VERSION@/total?style=for-the-badge&color=2ea44f&label=downloads" alt="Downloads of @VERSION@">
  <img src="https://img.shields.io/badge/webOS-3%20%E2%86%92%2025%2B-a50034?style=for-the-badge" alt="webOS 3 to 25+">
</p>

<p align="center">
  <b>Ad-free YouTube for LG TVs</b>, with SponsorBlock, Return YouTube Dislike, DeArrow and a programmable remote.<br>
  Built on <a href="https://github.com/NicholasBly/youtube-webos">NicholasBly/youtube-webos</a>, plus the best of every other fork of the project.
</p>

## ⬇️ Download

| | Package | For |
|:-:|---|---|
| 🚀 | **[youtube.leanback.v4_@VERSION@_all_webOS22+.ipk](https://github.com/foxi69/youtube-webos/releases/download/v@VERSION@/youtube.leanback.v4_@VERSION@_all_webOS22%2B.ipk)** | **webOS 22 and newer** (2022+ TVs). Lighter and faster: pick this one when your TV supports it. |
| 📺 | [youtube.leanback.v4_@VERSION@_all.ipk](https://github.com/foxi69/youtube-webos/releases/download/v@VERSION@/youtube.leanback.v4_@VERSION@_all.ipk) | **webOS 3-6** (2016-2021 TVs). Also runs on newer TVs. |

> [!TIP]
> Installed through Homebrew Channel with this fork's repository? The update comes to you by itself.

## ✨ What's new in @VERSION@

@CHANGELOG@

## 📦 Install

> [!IMPORTANT]
> Uninstall the official YouTube app first.

- 🍺 **[Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)** (updates come by themselves): add one repository.

  | TVs | Repository |
  |---|---|
  | webOS 22 and newer | `https://raw.githubusercontent.com/foxi69/youtube-webos/main/repo-webos22.json` |
  | webOS 3-6 (or any TV) | `https://raw.githubusercontent.com/foxi69/youtube-webos/main/repo.json` |

- 💻 **[Device Manager](https://github.com/webosbrew/dev-manager-desktop)**: install the downloaded `.ipk`.
- ⌨️ **[webOS TV CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation)**:
  `ares-install youtube.leanback.v4_@VERSION@_all_webOS22+.ipk`

Once it is up, press 🟩 **Green** (or the 🦊 button the Magic Remote pointer shows) to open the settings. Every
setting and its default is in the [README](https://github.com/foxi69/youtube-webos#%EF%B8%8F-settings).

<details>
<summary>Homebrew Channel offers "YouTube AdFree 0.5.3" as an update?</summary>
<br>
Ignore it: that is the older webosbrew build under the same app id, from the default webosbrew repository.
</details>

## 🙏 Credits

[FriedChickenButt](https://github.com/FriedChickenButt/youtube-webos) (the original project),
[webosbrew](https://github.com/webosbrew/youtube-webos) (the community continuation),
[NicholasBly](https://github.com/NicholasBly/youtube-webos) (the rewrite this fork builds on), and the authors of
the forks whose work is ported here, credited per change above.

**📜 Full changelog:** [CHANGELOG.md](https://github.com/foxi69/youtube-webos/blob/main/CHANGELOG.md)
