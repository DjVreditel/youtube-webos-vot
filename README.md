# youtube-webos (foxi69 fork)

Ad-free YouTube for LG webOS TVs, with extra features and fixes on top of
[NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos).

## Where this fork comes from

```
FriedChickenButt/youtube-webos       the original project (inactive since 2024)
  └─ webosbrew/youtube-webos           the community-maintained continuation
       └─ NicholasBly/youtube-webos      rewritten, many features      ← this fork's upstream
            └─ foxi69/youtube-webos        this fork: upstream + the changes below
```

"Upstream" is the repository a fork was copied from and keeps taking updates
from. This fork's direct upstream is **NicholasBly/youtube-webos**; above it are
**webosbrew/youtube-webos** and the original **FriedChickenButt/youtube-webos**
(whose history webosbrew fully contains). NicholasBly's changes are merged in
regularly (see [Staying up to date with upstream](#staying-up-to-date-with-upstream)),
and everything this fork adds stays on top of them. Work further up the chain
and on every other fork is reported by the fork watch, because NicholasBly's
rewrite means it has to be ported rather than merged.

## What this fork adds

On top of upstream 0.8.4, collected from webosbrew, NicholasBly's open pull
requests and the other forks of the project (credits in
[CHANGELOG.md](CHANGELOG.md)):

- **Auto-Translate Subtitles** - pick a language (Hungarian, English, German and
  ~30 more); it is offered as a ready-made "auto-translated" subtitle track
- **Auto Login: always ask who is watching** - account picker on every launch,
  other nag-screen bypasses stay on
- **Bindable yellow button**, **Sleep Timer** and **Audio-Only Mode** shortcut
  actions
- **Magic Remote scroll wheel** seeks on the progress bar
- **Block webOS Cast Service** toggle; casting to the TV works again
- Ad blocking holds up against YouTube's "property locker" (no more playback
  stall a few seconds in)
- SponsorBlock: Non-Music segments are actually fetched, muted segments mute,
  failed requests are retried, and segments submitted while you watch are
  picked up during playback
- Back closes the settings panel, plus a dozen smaller fixes

## Features from upstream (NicholasBly)
- Full support for webOS 3, 4, 5, 6, 22, 23, 24, and 25 (2016 and newer LG TVs) (webOS 1 and 2 currently not supported)
- Enhanced AdBlock Engine: New schema-based filtering system (cleaner Home, Search, and Shorts)
- Filter out QR code + Shop button overlays during video playback
- Enhanced Menu UI + Themes
- Auto Login - bypasses account selection screen
- Force Max Quality
- Hide Endcards
- Shortcuts - Programmable 0-9 key shortcuts during video playback
- Guest Mode: Hides annoying "Sign in" prompts

- SponsorBlock: Highlight feature added
-- All segment types added (Hook, Tangents, muted segments)
-- Color selector for all segments
-- Segment UI list replicating desktop segment list
-- Jump to highlight segment with blue button on LG remote
-- Per-segment options including auto skip, manual skip, show in progress bar, and disabled
-- Skip Segments Once option

- Toggle display on/off with red button on LG remote for OLED TVs + persistent keepalive
- Return YouTube Dislike - added to description tab in video
- Display Time in UI: Smart clock that hides during fullscreen and when description panel is open
- YouTube app fixes - Full video description panel hack to restore visual elements and enable full navigation
- Customizable YouTube UI fixes such as multiline titles and video shelf opacity for better visibility
- Bug fixes, UI fixes

## Improvements
- Rewritten codebase optimized for performance and efficiency to support LG TV hardware

Review changes made since 0.3.8 [here](https://github.com/NicholasBly/youtube-webos/blob/main/CHANGELOG.md)

<img width="642" height="752" alt="webOS_TV_26_Simulator_1 5 0_x16zOsWFaw" src="https://github.com/user-attachments/assets/046b0361-0648-4750-ab97-0b64b553ec17" />

<img width="642" height="631" alt="webOS_TV_25_Simulator_1 4 3_UaFvPZ67yL" src="https://github.com/user-attachments/assets/61963e1b-8211-439a-9f66-50b669940233" />

<img width="642" height="576" alt="webOS_TV_25_Simulator_1 4 3_uW1aZQeVle" src="https://github.com/user-attachments/assets/877a22b6-6814-457b-926c-cac50ed36077" />

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/84c8b6b3-4c82-4a63-9100-b236f2dd3225" />

<!--![Configuration Screen](https://github.com/NicholasBly/youtube-webos/blob/main/screenshots/webOS_TV_24_Simulator_mKe8Gv7zXq.png?raw=true)-->
![Segment Skipped](https://github.com/NicholasBly/youtube-webos/blob/main/screenshots/2_sm_new.png?raw=true)

## Features

- Advertisements blocking
- [SponsorBlock](https://sponsor.ajay.app/) integration
- [Autostart](#autostart)

**Note:** Configuration screen can be opened by pressing 🟩 GREEN button on the remote.

## Pre-requisites

- Official YouTube app needs to be uninstalled before installation.

## Installation

- **This fork:** install the `.ipk` (webOS 22 and newer) from the
  [Releases](https://github.com/foxi69/youtube-webos/releases) page, or the newest one in
  [`dist/`](dist), with the [Device Manager app](https://github.com/webosbrew/dev-manager-desktop)
  or `ares-install`. With [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel),
  add this fork's repo link instead, so updates come from here:
  `https://raw.githubusercontent.com/foxi69/youtube-webos/main/repo.json`
  (it follows this fork's published releases). The NicholasBly link below would replace this build with
  NicholasBly's.

Upstream (NicholasBly) builds:

- Use [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) - app is available via repo link: https://raw.githubusercontent.com/NicholasBly/youtube-webos/main/repo.json
- Use [Device Manager app](https://github.com/webosbrew/dev-manager-desktop) - see [Releases](https://github.com/NicholasBly/youtube-webos/releases) for a
  prebuilt `.ipk` binary file. A webOS22+ .ipk is available for users on 2022+ TVs, supporting webOS22-25. These are lighter, more optimized builds for newer hardware, without translation layers needed for older TVs.
- Use [webOS TV CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation) -
  `ares-install youtube...ipk` (For more information on configuring the webOS CLI tools, see [below](#development-tv-setup))

## Configuration

Configuration screen can be opened by pressing 🟩 GREEN button on the remote.
Black screen / OLED mode can be toggled by pressing 🟥 RED button on the remote.

### Autostart

In order to autostart an application the following command needs to be executed
via SSH or Telnet:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

This will make "YouTube AdFree" display as an eligible input application (next
to HDMI/Live TV, etc...), and, if it was the last selected input, it will be
automatically launched when turning on the TV.

This will also greatly increase startup performance, since it will be runnning
constantly in the background, at the cost of increased idle memory usage.
(so far, relatively unnoticable in normal usage)

In order to disable autostart run this:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

## Building

- Clone the repository

```sh
git clone https://github.com/foxi69/youtube-webos.git
```

- Enter the folder and build the App, this will generate a `*.ipk` file.

```sh
cd youtube-webos

# Install dependencies (need to do this only when updating local repository / package.json is changed)
npm install

npm run build && npm run package

# webOS 22+ only build (lighter, what this fork ships)
npm run build:modern && npm run package
```

## Releases

Releases are drafted automatically and published only after a test on the TV:

1. Every push to `main` runs [Draft release](.github/workflows/release.yml). It builds the webOS 22+
   `.ipk` and puts it in a **draft** release `v<version>` (version from `package.json`), with that
   version's CHANGELOG section as notes. Drafts are visible only to the repository's owner and
   collaborators.
2. Download the `.ipk` from the draft on the [Releases](https://github.com/foxi69/youtube-webos/releases)
   page and install it on the TV.
3. If it works, open the draft and press **Publish release**. That creates the tag and runs
   [Update Homebrew Repository](.github/workflows/build_repo.yml), which points `repo.json` at the new
   release, so Homebrew Channel offers the update.

More pushes with the same version refresh the same draft. After a version is published, a new draft
starts when the version in `package.json` changes.

## Staying up to date with upstream

### Automatically

The [Sync upstream](.github/workflows/sync-upstream.yml) workflow runs every day
(or on demand: **Actions → Sync upstream → Run workflow**). When NicholasBly has
new commits, it merges them into the `upstream-sync` branch and opens a pull
request into `main`. Your own changes are never overwritten: you review the
pull request, test, and merge it. If the merge has conflicts, the run fails and
lists the conflicting files - then sync by hand as below.

One-time setup on GitHub:

1. **Actions** tab → enable workflows (they are off by default on forks).
   This turns on both *Sync upstream* and *Fork watch* below.
2. **Settings → Actions → General → Workflow permissions** → tick
   *Allow GitHub Actions to create and approve pull requests*.

### New work on other forks

The [Fork watch](.github/workflows/fork-watch.yml) workflow runs every day as
well. It walks the whole fork tree of FriedChickenButt/youtube-webos,
webosbrew/youtube-webos and NicholasBly/youtube-webos (forks of forks
included), looks at every fork that was pushed to since its last run, and at
the pull requests on those three repositories. It remembers what it already
reported, so a commit made days before it was pushed (up to 30 days) is still
caught, and nothing is reported twice. When it finds new commits or pull
requests, it opens an issue labelled `fork-watch` with links to them, so you
get a GitHub notification. These are only suggestions: nothing is merged, you
pick what is worth porting. Commits NicholasBly already has are left out
(the sync pull request brings them in), and so are bot commits. It cannot
see private forks, or copies that were uploaded as new repositories instead
of being forked.

### By hand

```sh
git remote add upstream https://github.com/NicholasBly/youtube-webos.git   # once
git fetch upstream
git checkout main
git merge upstream/main        # resolve any conflicts, then commit
npm ci && npm run build:modern && npm run package   # rebuild and test
git push origin main
```

GitHub's **Sync fork** button on the repository page does the same merge, but
only when there are no conflicts and it cannot rebuild the `.ipk`.

The original webosbrew project can be followed the same way
(`git remote add webosbrew https://github.com/webosbrew/youtube-webos.git`),
but NicholasBly's codebase is a rewrite, so its changes have to be ported by
hand rather than merged.

## Development TV setup

These instructions use the [webOS CLI tools](https://github.com/webos-tools/cli).
See <https://webostv.developer.lge.com/develop/tools/cli-introduction> for more information.

### Configuring webOS CLI tools with Developer Mode App

This is partially based on <https://webostv.developer.lge.com/develop/getting-started/developer-mode-app>.

- Install Developer Mode app from Content Store
- Enable Developer Mode
- Enable key server and download TV's private key: `http://TV_IP:9991/webos_rsa`  
  The key must be saved under `~/.ssh` (or `%USERPROFILE%\.ssh` on Windows)
- Configure the device using `ares-setup-device` (`-a` may need to be replaced with `-m` if device named `webos` is already configured)
  - `PASSPHRASE` is the 6-character passphrase printed on screen in developer mode app
  - `privatekey` path is relative to `${HOME}/.ssh` (Windows: `%USERPROFILE%\.ssh`)

```sh
ares-setup-device -a webos -i "username=prisoner" -i "privatekey=webos_rsa" -i "passphrase=PASSPHRASE" -i "host=TV_IP" -i "port=9922"
```

### Configuring webOS CLI tools with Homebrew Channel / root

- Enable SSH in Homebrew Channel app
- Generate SSH key on developer machine (`ssh-keygen -t rsa`)
- Copy the private key (`id_rsa`) to the `~/.ssh` directory (or `%USERPROFILE%\.ssh` on Windows) on the local computer
- Append the public key (`id_rsa.pub`) to the `/home/root/.ssh/authorized_keys` file on the TV
- Configure the device using `ares-setup-device` (`-a` may need to be replaced with `-m` if device named `webos` is already configured)
  - `privatekey` path is relative to `${HOME}/.ssh` (Windows: `%USERPROFILE%\.ssh`)

```sh
ares-setup-device -a webos -i "username=root" -i "privatekey=id_rsa" -i "passphrase=SSH_KEY_PASSPHRASE" -i "host=TV_IP" -i "port=22"
```

## Installation

```sh
npm run deploy
```

## Launching

- The app will be available in the TV's app list. You can also launch it using the webOS CLI tools.

```sh
npm run launch
```

To jump immediately into some specific video use:

```sh
npm run launch -- -p '{"contentTarget":"v=F8PGWLvn1mQ"}'
```
