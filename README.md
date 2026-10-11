# YouTube AdFree for webOS (foxi69 fork)

Ad-free YouTube for LG webOS TVs with SponsorBlock, Return YouTube Dislike, programmable remote buttons and
many fixes. It is built on [NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos), plus
the best of the other forks of the project (see [What this fork adds](#what-this-fork-adds)).

- [Installation](#installation)
- [Remote control](#remote-control)
- [Settings](#settings)
- [What this fork adds](#what-this-fork-adds)
- [All features](#all-features)
- [Where this fork comes from](#where-this-fork-comes-from)
- [Releases](#releases)
- [Staying up to date with upstream](#staying-up-to-date-with-upstream)
- [Autostart](#autostart)
- [Building](#building) and [Development TV setup](#development-tv-setup)

## Installation

The official YouTube app has to be uninstalled first.

**Pick the package for your TV.** Both are on the [Releases](https://github.com/foxi69/youtube-webos/releases)
page, and the newest ones are also in [`dist/`](dist):

| File | TVs |
|---|---|
| `youtube.leanback.v4_<version>_all_webOS22+.ipk` | webOS 22 and newer (2022+ TVs). Lighter and faster; use this when your TV supports it. |
| `youtube.leanback.v4_<version>_all.ipk` | webOS 3-6 (2016-2021 TVs). Also runs on newer TVs. |

Install it in one of three ways:

- **[webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)**: add this fork's repo link,
  `https://raw.githubusercontent.com/foxi69/youtube-webos/main/repo.json`, so updates come from here. It
  follows this fork's published releases. NicholasBly's repo link would replace this build with NicholasBly's.
- **[Device Manager app](https://github.com/webosbrew/dev-manager-desktop)**: install the downloaded `.ipk`.
- **[webOS TV CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation)**:
  `ares-install youtube...ipk` (see [Development TV setup](#development-tv-setup)).

## Remote control

| Button | Default | Notes |
|---|---|---|
| 🟩 Green | Open/close the settings | If no button is set to *Open/Close Settings*, Green is forced back to it. |
| 🟥 Red | OLED black overlay | Blacks out the screen while audio plays. Notifications stay visible and the clock is hidden. |
| 🟨 Yellow | *None* (YouTube's own search) | Can be set to any action, see below. While it is *None*, YouTube's search binding keeps working. |
| 🟦 Blue | SponsorBlock manual skip / jump to highlight | |
| 5 | Skip to next chapter | |
| 0-4, 6-9 | *None* | Can be set to any action during playback. |
| Back | Closes the settings panel | Otherwise YouTube's normal Back. |
| Magic Remote wheel | Scrolls | With *Scroll Wheel Seeks* on, each notch on the focused progress bar seeks 10 s. |

Every coloured button and number key can be set to any of these actions on the **Shortcuts** tab:

- **Playback:** Play/Pause, Fast Forward (Burst), Rewind (Burst), Skip to Next / Previous Chapter
- **SponsorBlock:** Manual Skip / Jump to Highlight, Skip to Last SponsorBlock Segment
- **Panels:** Toggle Subtitles, Toggle Comments, Toggle Description, Save / Watch Later
- **Screen:**
  - Toggle OLED Black Overlay
  - **Toggle Audio-Only Mode**: hides the picture and keeps the sound; ends when you leave the video
  - **Sleep Timer**: each press steps 15/30/60/90/120 min, then off; pauses the video when it runs out
- **App:** Open/Close Settings, Refresh Page

## Settings

The settings panel opens with 🟩 Green and has four tabs.

**Main**
- *Cosmetic Filtering:*
  - Ad Blocking
  - Reduce Telemetry & Tracking
  - Remove Shorts (Global)
  - Remove Live Videos (Global)
  - Remove Top Live Games
  - Remove "Most Relevant" Shelf
  - Guest Mode: Hide Sign-in Buttons (only when not signed in)
- *Video Player:*
  - Force Max Quality
  - Force Video Codec (Auto, AV1, VP9, AVC, HEVC, Avoid AV1)
  - **Auto-Translate Subtitles**: pick a language
  - Hide Endcards
  - **Magic Remote: Scroll Wheel Seeks on Progress Bar**
  - Return YouTube Dislike
- *Interface:*
  - Bypass Nag Screens
  - **Auto Login (off: always ask who is watching)**
  - Max Thumbnail Quality and Thumbnail Strategy
  - YouTube Logo (default, Premium, hidden)
  - Display Time in UI
  - OLED-Care Mode (True Black UI)
  - Disable Notifications
  - **Block webOS Cast Service** (webOS 25 only)

**SponsorBlock**
- SponsorBlock on/off.
- A mode for each category: Auto Skip, Manual Skip, Show in Seek Bar, or Disable. Each category also has its own colour.
  - Categories: Sponsor, Intro, Outro, Interaction, Self Promotion, Non-Music, Filler, Hook, Preview.
  - Highlight has its own modes: auto skip to start, ask, show in seek bar, disable.
- Allow segments that mute audio.
- **Periodically Check for New Segments.**
- Skip Segments Once.
- Show an icon when a video is entirely an advertisement.
- Show time with skips removed.

**Shortcuts**: the action of keys 0-9 and of the Red, Green, Yellow and Blue buttons.

**UI Tweaks**
- Video shelf opacity
- Force Previews
- Fix Multiline Titles
- New Liquid Glass UI
- Emoji + Characters Fix (webOS 3-4)

**Auto-Translate Subtitles** offers about 30 languages: Hungarian, English, German, Spanish, French, Italian,
Portuguese, Dutch, Polish, Czech, Slovak, Romanian, Croatian, Serbian, Slovenian, Bulgarian, Greek, Turkish,
Ukrainian, Russian, Swedish, Danish, Finnish, Norwegian, Arabic, Hindi, Indonesian, Vietnamese, Thai,
Japanese, Korean and Chinese.

The TV app gets only about 16 translation languages from YouTube; the web gets about 125. The chosen
language is pinned to the top of the subtitle menu. If the video has no subtitle in that language, a
ready-made "*Language* (auto-translated)" track is added, translated by YouTube's own servers.

## What this fork adds

Compared to upstream NicholasBly 0.8.4. Taken from webosbrew, NicholasBly's open pull requests and the
other forks of the project; credits are in [CHANGELOG.md](CHANGELOG.md).

**New**
- Auto-Translate Subtitles to a language of your choice.
- Auto Login: always ask who is watching.
- Bindable yellow button, Sleep Timer and Audio-Only Mode.
- Magic Remote scroll-wheel seeking.
- SponsorBlock picks up segments submitted while you watch: re-checked during playback.
- Block webOS Cast Service toggle.

**Fixed**
- Ad blocking holds up against YouTube's "property locker"; previously playback could stall a few seconds in.
- Casting from a phone to the TV works again.
- SponsorBlock:
  - Non-Music segments are actually fetched;
  - muted segments now mute;
  - failed requests are retried.
- Back closes the settings panel, and colour-button seeks no longer fire twice.
- The OLED overlay no longer hides the notifications.
- Return YouTube Dislike no longer shows "1000k".
- Force Max Quality no longer expires after a year, and resets when switched off.
- 2026+ TVs are no longer detected as a simulator.
- Fixes for the legacy build (webOS 3-6).

## All features

- Support for webOS 3, 4, 5, 6, 22, 23, 24, 25 and newer (2016 and newer LG TVs; webOS 1 and 2 are not supported).
- Ad blocking with a schema-based filter engine: cleaner Home, Search and Shorts. It also hides QR-code and
  shop overlays during playback.
- Optional filters: Shorts, live videos, "Most Relevant" shelf, Top Live Games, guest sign-in prompts.
- [SponsorBlock](https://sponsor.ajay.app/):
  - every segment type, including Hook, Filler and muted segments, plus Highlight;
  - colour for every segment, and a desktop-style segment list;
  - auto, manual and seek-bar-only modes per category, and Skip Segments Once;
  - full-video label and time with skips removed;
  - new segments picked up during playback.
- Return YouTube Dislike in the description panel.
- Force Max Quality, Force Video Codec and Max Thumbnail Quality.
- Auto-Translate Subtitles.
- Bypass Nag Screens: account picker, Premium and other upsell screens. Optionally, always ask who is watching.
- Programmable remote: 0-9 and all four colour buttons, Magic Remote wheel seeking.
- OLED care:
  - OLED black overlay on Red, with keep-alive;
  - OLED-Care Mode (true-black UI);
  - Audio-Only Mode;
  - Sleep Timer.
- Smart clock that hides in fullscreen and when the description panel is open.
- UI fixes:
  - full description panel navigation;
  - multiline titles and video shelf opacity;
  - themes, YouTube logo style, emoji fix for webOS 3-4.

<img width="642" height="752" alt="Settings panel" src="https://github.com/user-attachments/assets/046b0361-0648-4750-ab97-0b64b553ec17" />

<img width="642" height="631" alt="Settings panel, SponsorBlock" src="https://github.com/user-attachments/assets/61963e1b-8211-439a-9f66-50b669940233" />

<img width="642" height="576" alt="Settings panel, Shortcuts" src="https://github.com/user-attachments/assets/877a22b6-6814-457b-926c-cac50ed36077" />

<img width="1280" height="720" alt="Video with SponsorBlock segments" src="https://github.com/user-attachments/assets/84c8b6b3-4c82-4a63-9100-b236f2dd3225" />

![Segment Skipped](https://github.com/NicholasBly/youtube-webos/blob/main/screenshots/2_sm_new.png?raw=true)

## Where this fork comes from

```
FriedChickenButt/youtube-webos       the original project (inactive since 2024)
  └─ webosbrew/youtube-webos           the community-maintained continuation
       └─ NicholasBly/youtube-webos      rewritten, many features      ← this fork's upstream
            └─ foxi69/youtube-webos        this fork: upstream + the changes above
```

"Upstream" is the repository a fork was copied from and keeps taking updates from. This fork's direct
upstream is **NicholasBly/youtube-webos**. Above it are **webosbrew/youtube-webos** and the original
**FriedChickenButt/youtube-webos**, whose history webosbrew fully contains.

NicholasBly's changes are merged in regularly (see [Staying up to date with upstream](#staying-up-to-date-with-upstream)),
and everything this fork adds stays on top of them. Work further up the chain and on every other fork is
reported by the [fork watch](#new-work-on-other-forks). NicholasBly rewrote the codebase, so that work has to
be ported rather than merged.

## Releases

Releases are drafted automatically and published only after a test on the TV:

1. Every push to `main` runs [Draft release](.github/workflows/release.yml).
   - It builds both `.ipk` files (webOS 22+ and legacy webOS 3-6).
   - It puts them in a **draft** release `v<version>`, with the version taken from `package.json`.
   - The release notes are that version's CHANGELOG section.
   - Drafts are visible only to the repository's owner and collaborators.
2. Download the `.ipk` from the draft on the [Releases](https://github.com/foxi69/youtube-webos/releases)
   page and install it on the TV.
3. If it works, open the draft and press **Publish release**. That creates the tag and runs
   [Update Homebrew Repository](.github/workflows/build_repo.yml), which points `repo.json` at the new
   release, so Homebrew Channel offers the update.

More pushes with the same version refresh the same draft. After a version is published, a new draft starts
when the version in `package.json` changes.

## Staying up to date with upstream

### Automatically

The [Sync upstream](.github/workflows/sync-upstream.yml) workflow runs every day, or on demand from
**Actions → Sync upstream → Run workflow**.

When NicholasBly has new commits, it merges them into the `upstream-sync` branch and opens a pull request
into `main`. Your own changes are never overwritten: you review the pull request, test it, and merge it.
If the merge has conflicts, the run fails and lists the conflicting files. Then sync by hand, as below.

One-time setup on GitHub:

1. **Actions** tab → enable workflows. They are off by default on forks. This turns on *Sync upstream*,
   *Fork watch* and *Draft release*.
2. **Settings → Actions → General → Workflow permissions** → tick *Allow GitHub Actions to create and approve
   pull requests*.

### New work on other forks

The [Fork watch](.github/workflows/fork-watch.yml) workflow also runs every day.

**What it looks at**
- The whole fork tree of FriedChickenButt/youtube-webos, webosbrew/youtube-webos and NicholasBly/youtube-webos,
  forks of forks included. It checks every fork pushed to since its last run.
- The pull requests on those three repositories.
- It remembers what it already reported. A commit made days before it was pushed (up to 30 days) is still
  caught, and nothing is reported twice.

**What it does**
- When it finds new commits or pull requests, it opens an issue labelled `fork-watch` with links to them, so
  you get a GitHub notification.
- These are only suggestions: nothing is merged, and you pick what is worth porting.

**What it leaves out**
- Commits NicholasBly already has; the sync pull request brings those in.
- Bot commits.
- Private forks, and copies that were uploaded as new repositories instead of being forked. It cannot see these.

### By hand

```sh
git remote add upstream https://github.com/NicholasBly/youtube-webos.git   # once
git fetch upstream
git checkout main
git merge upstream/main        # resolve any conflicts, then commit
npm ci && npm run build:modern && npm run package   # rebuild and test
git push origin main
```

GitHub's **Sync fork** button on the repository page does the same merge, but only when there are no
conflicts, and it cannot rebuild the `.ipk`.

## Autostart

To start the app automatically, run this via SSH or Telnet:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

"YouTube AdFree" then appears as an input next to HDMI and Live TV. If it was the last selected input, it
starts when the TV is turned on. It also starts much faster, because it keeps running in the background;
the cost is somewhat higher idle memory use, which is barely noticeable in practice.

To turn autostart off:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

## Building

```sh
git clone https://github.com/foxi69/youtube-webos.git
cd youtube-webos

# Install dependencies (again only when package.json changes)
npm install

# Legacy build (webOS 3 and newer)
npm run build && npm run package

# webOS 22+ build (lighter)
npm run build:modern && npm run package
```

Both commands create `dist/youtube.leanback.v4_<version>_all.ipk`. Rename the webOS 22+ one to
`..._all_webOS22+.ipk` if you keep both.

## Development TV setup

These instructions use the [webOS CLI tools](https://github.com/webos-tools/cli). See
<https://webostv.developer.lge.com/develop/tools/cli-introduction> for more information.

### Configuring webOS CLI tools with Developer Mode App

This is partially based on <https://webostv.developer.lge.com/develop/getting-started/developer-mode-app>.

- Install the Developer Mode app from the Content Store.
- Enable Developer Mode.
- Enable the key server and download the TV's private key: `http://TV_IP:9991/webos_rsa`.
  Save the key under `~/.ssh` (or `%USERPROFILE%\.ssh` on Windows).
- Configure the device using `ares-setup-device`. Replace `-a` with `-m` if a device named `webos` is
  already configured.
  - `PASSPHRASE` is the 6-character passphrase shown in the Developer Mode app.
  - The `privatekey` path is relative to `${HOME}/.ssh` (Windows: `%USERPROFILE%\.ssh`).

```sh
ares-setup-device -a webos -i "username=prisoner" -i "privatekey=webos_rsa" -i "passphrase=PASSPHRASE" -i "host=TV_IP" -i "port=9922"
```

### Configuring webOS CLI tools with Homebrew Channel / root

- Enable SSH in the Homebrew Channel app.
- Generate an SSH key on the development machine (`ssh-keygen -t rsa`).
- Copy the private key (`id_rsa`) to `~/.ssh` (or `%USERPROFILE%\.ssh` on Windows) on the local computer.
- Append the public key (`id_rsa.pub`) to `/home/root/.ssh/authorized_keys` on the TV.
- Configure the device using `ares-setup-device`. Replace `-a` with `-m` if a device named `webos` is
  already configured. The `privatekey` path is relative to `${HOME}/.ssh` (Windows: `%USERPROFILE%\.ssh`).

```sh
ares-setup-device -a webos -i "username=root" -i "privatekey=id_rsa" -i "passphrase=SSH_KEY_PASSPHRASE" -i "host=TV_IP" -i "port=22"
```

### Deploying and launching

```sh
npm run deploy    # install the built package on the configured TV
npm run launch    # start it
npm run launch -- -p '{"contentTarget":"v=F8PGWLvn1mQ"}'   # start straight into a video
```

## Credits

- [FriedChickenButt](https://github.com/FriedChickenButt/youtube-webos), the original project.
- [webosbrew](https://github.com/webosbrew/youtube-webos), the community continuation.
- [NicholasBly](https://github.com/NicholasBly/youtube-webos), the rewrite this fork builds on.
- The authors of the forks whose fixes and features are ported here, credited per change in
  [CHANGELOG.md](CHANGELOG.md).
