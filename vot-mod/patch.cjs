'use strict';

/* global __dirname */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MOD_SRC = path.join(__dirname, 'src');
const MOD_ASSETS = path.join(__dirname, 'assets');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROJECT_SRC = path.join(PROJECT_ROOT, 'src');
const PROJECT_ASSETS = path.join(PROJECT_ROOT, 'assets');

const PATCH_ONLY = process.argv.includes('--patch-only');

const PATCH_MARKER = '// @vot-mod';

const OLD_APP_ID = 'youtube.leanback.v4';
const NEW_APP_ID = 'youtube.djvreditel.v4';
const NEW_APP_TITLE = 'YouTube VOT';

const VOT_USERSCRIPT_PATCH = `
${PATCH_MARKER}
import './abort-controller-polyfill';
import { initVot } from './vot';

initVot();
`;

const VOT_CONFIG_ENTRIES = `${PATCH_MARKER}
  [
    'enableVot',
    { default: true, desc: 'Enable Voice Over Translation' }
  ],
  [
    'votFromLang',
    { default: 'auto', desc: 'VOT source language' }
  ],
  [
    'votToLang',
    { default: 'ru', desc: 'VOT target language' }
  ],
  [
    'votTranslationVolume',
    { default: 0.9, desc: 'VOT translation audio volume (0-1)' }
  ],
  [
    'votOriginalVolume',
    { default: 0.15, desc: 'Original video volume while VOT is active (0 = muted, 1 = full)' }
  ]`;

function step(msg) {
  process.stdout.write(`\n→ ${msg}\n`);
}

function run(cmd) {
  process.stdout.write(`  $ ${cmd}\n`);
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
}

function validate() {
  if (!fs.existsSync(PROJECT_SRC)) {
    throw new Error(
      `src/ not found at: ${PROJECT_SRC}\nMake sure VOT_MOD is placed in the youtube-webos project root.`
    );
  }

  const userScriptPath = path.join(PROJECT_SRC, 'userScript.ts');
  if (!fs.existsSync(userScriptPath)) {
    throw new Error(`userScript.ts not found at: ${userScriptPath}`);
  }

  const configPath = path.join(PROJECT_SRC, 'config.js');
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.js not found at: ${configPath}`);
  }
}

function patchUserScript() {
  const filePath = path.join(PROJECT_SRC, 'userScript.ts');
  const content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  userScript.ts already patched — skip\n');
    return;
  }

  fs.writeFileSync(filePath, content + VOT_USERSCRIPT_PATCH, 'utf8');
  process.stdout.write('  userScript.ts patched\n');
}

function patchConfig() {
  const filePath = path.join(PROJECT_SRC, 'config.js');
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(PATCH_MARKER)) {
    const updated = content.replace(
      /('enableVot',\s*\{\s*default:\s*)false(\s*,)/,
      '$1true$2'
    );
    if (updated !== content) {
      fs.writeFileSync(filePath, updated, 'utf8');
      process.stdout.write('  config.js: updated enableVot default to true\n');
    } else {
      process.stdout.write('  config.js already patched — skip\n');
    }
    return;
  }

  const insertAt = content.lastIndexOf('\n]);');
  if (insertAt === -1) {
    throw new Error('config.js: cannot locate configOptions Map end (]);)');
  }

  const patched =
    content.slice(0, insertAt) +
    ',\n' +
    VOT_CONFIG_ENTRIES +
    content.slice(insertAt);

  fs.writeFileSync(filePath, patched, 'utf8');
  process.stdout.write('  config.js patched\n');
}

function patchManagerTs() {
  const filePath = path.join(PROJECT_SRC, 'player_api', 'manager.ts');
  if (!fs.existsSync(filePath)) {
    process.stdout.write('  player_api/manager.ts not found — skip\n');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  player_api/manager.ts already patched — skip\n');
    return;
  }

  let patched = content;

  // Patch 1: insert noVideo into EventMap before playbackStart
  patched = patched.replace(
    /( +newVideo: CustomEvent<VideoID>;\n)( +)(playbackStart: CustomEvent<undefined>;)/,
    (_, newVideoLine, indent, playbackLine) =>
      `${newVideoLine}${indent}${PATCH_MARKER}\n${indent}noVideo: CustomEvent<undefined>;\n${indent}${playbackLine}`
  );
  if (patched === content) {
    process.stderr.write(
      '  WARNING: player_api/manager.ts: EventMap pattern not found — file not patched\n'
    );
    return;
  }

  // Patch 2: add #handleNoVideo method before #handleNewVideo
  const handleNewVideoTarget = '  #handleNewVideo(videoID: VideoID) {';
  if (!patched.includes(handleNewVideoTarget)) {
    process.stderr.write(
      '  WARNING: player_api/manager.ts: #handleNewVideo not found — file not patched\n'
    );
    return;
  }
  patched = patched.replace(
    handleNewVideoTarget,
    '  #handleNoVideo() {\n' +
      "    console.debug('[PlayerManager] no video');\n" +
      "    this.dispatchEvent(new TypedCustomEvent('noVideo', { detail: undefined }));\n" +
      '  }\n\n' +
      handleNewVideoTarget
  );

  // Patch 3: replace throw with null-safe noVideo dispatch
  // Flexible regex: matches any error message and any consistent indentation
  const beforeThrowPatch = patched;
  patched = patched.replace(
    /( +)if \(!currentVideoID\) throw[^\n]+\n\1this\.#handleNewVideo\(currentVideoID\);\n\1this\.#lastVideoID = currentVideoID;/,
    (_, indent) =>
      `${indent}if (!currentVideoID) {\n` +
      `${indent}  this.#lastVideoID = null;\n` +
      `${indent}  this.#handleNoVideo();\n` +
      `${indent}} else {\n` +
      `${indent}  this.#handleNewVideo(currentVideoID);\n` +
      `${indent}  this.#lastVideoID = currentVideoID;\n` +
      `${indent}}`
  );
  if (patched === beforeThrowPatch) {
    process.stderr.write(
      '  WARNING: player_api/manager.ts: null videoID throw pattern not found — noVideo dispatch may be missing\n'
    );
  }

  // Patch 4: remove debug leak listener (best-effort, no error if absent)
  patched = patched.replace(
    /\n\n {2}instance\.addEventListener\('playbackStart', function \(event\) \{[^}]*\}\);\n/,
    '\n'
  );

  fs.writeFileSync(filePath, patched, 'utf8');
  process.stdout.write('  player_api/manager.ts patched\n');
}

function patchYtApiTs() {
  const filePath = path.join(PROJECT_SRC, 'player_api', 'yt-api.ts');
  if (!fs.existsSync(filePath)) {
    process.stdout.write('  player_api/yt-api.ts not found — skip\n');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  player_api/yt-api.ts already patched — skip\n');
    return;
  }

  // Flexible regex: matches both `interface VideoData` and `type VideoData`
  const patched = content.replace(
    /(export (?:interface|type) VideoData[^{]*\{[^}]*?video_id: VideoID[^;]*;)(\s*\})/,
    (_, before, closing) =>
      `${before}\n  ${PATCH_MARKER}\n  defaultAudioLanguage?: string;\n  audioTracks?: Array<{ language?: string }>;${closing}`
  );

  if (patched === content) {
    process.stdout.write(
      '  player_api/yt-api.ts: VideoData pattern not found — skip\n'
    );
    return;
  }

  fs.writeFileSync(filePath, patched, 'utf8');
  process.stdout.write('  player_api/yt-api.ts patched\n');
}

function patchUiJs() {
  const filePath = path.join(PROJECT_SRC, 'ui.js');
  if (!fs.existsSync(filePath)) {
    process.stderr.write('  WARNING: ui.js not found — RED button not wired\n');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  ui.js already patched — skip\n');
    return;
  }

  // Patch 1: import showVotPanel
  const importAnchor = "import './ui.css';";
  if (!content.includes(importAnchor)) {
    process.stderr.write(
      '  WARNING: ui.js: import anchor not found — RED button not wired\n'
    );
    return;
  }
  let patched = content.replace(
    importAnchor,
    `${importAnchor}\n${PATCH_MARKER}\nimport { showVotPanel } from './vot/ui';`
  );

  // Patch 2: extend the red entries of colorCodeMap (upstream only has 403).
  // Extra codes cover remotes that report RED as 398/114/166/108.
  const redAnchor = "[403, 'red'],";
  if (!patched.includes(redAnchor)) {
    process.stderr.write(
      '  WARNING: ui.js: colorCodeMap red entry not found — extra codes not added\n'
    );
  } else {
    patched = patched.replace(
      redAnchor,
      "[403, 'red'],\n  [398, 'red'],\n  [114, 'red'],\n  [166, 'red'],\n  [108, 'red'],"
    );
  }

  // Patch 3: insert the red branch into eventHandler before the blue branch.
  // charCode||keyCode fallback: on newer webOS keydown carries keyCode only.
  const blueAnchor = "  } else if (getKeyColor(evt.charCode) === 'blue') {";
  if (!patched.includes(blueAnchor)) {
    process.stderr.write(
      '  WARNING: ui.js: blue branch not found — RED button not wired\n'
    );
    return;
  }
  patched = patched.replace(
    blueAnchor,
    "  } else if (getKeyColor(evt.charCode || evt.keyCode) === 'red') {\n" +
      '    evt.preventDefault();\n' +
      '    evt.stopPropagation();\n\n' +
      "    if (evt.type === 'keydown') {\n" +
      '      showVotPanel();\n' +
      '    }\n' +
      '    return false;\n' +
      blueAnchor
  );

  fs.writeFileSync(filePath, patched, 'utf8');
  process.stdout.write('  ui.js patched\n');
}

function patchAssets() {
  // Overwrite upstream icons / splash / background with the mod's branding
  if (!fs.existsSync(MOD_ASSETS)) {
    process.stdout.write('  vot-mod/assets not found — skip\n');
    return;
  }
  for (const name of fs.readdirSync(MOD_ASSETS)) {
    const from = path.join(MOD_ASSETS, name);
    const to = path.join(PROJECT_ASSETS, name);
    const src = fs.readFileSync(from);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(src)) {
      process.stdout.write(`  assets/${name} already replaced — skip\n`);
      continue;
    }
    fs.writeFileSync(to, src);
    process.stdout.write(`  assets/${name} replaced\n`);
  }
}

function patchAppId() {
  // appinfo.json — the id here is the real app ID on the TV; title is the visible name
  const appInfoPath = path.join(PROJECT_ROOT, 'assets', 'appinfo.json');
  if (fs.existsSync(appInfoPath)) {
    const info = JSON.parse(fs.readFileSync(appInfoPath, 'utf8'));
    if (info.id !== NEW_APP_ID || info.title !== NEW_APP_TITLE) {
      info.id = NEW_APP_ID;
      info.title = NEW_APP_TITLE;
      fs.writeFileSync(
        appInfoPath,
        JSON.stringify(info, null, 2) + '\n',
        'utf8'
      );
      process.stdout.write('  assets/appinfo.json patched\n');
    } else {
      process.stdout.write('  assets/appinfo.json already patched — skip\n');
    }
  }

  // package.json scripts + tools/deploy.js reference the app ID / ipk name literally
  for (const rel of ['package.json', path.join('tools', 'deploy.js')]) {
    const filePath = path.join(PROJECT_ROOT, rel);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(OLD_APP_ID)) {
      process.stdout.write(`  ${rel} already patched — skip\n`);
      continue;
    }
    fs.writeFileSync(
      filePath,
      content.split(OLD_APP_ID).join(NEW_APP_ID),
      'utf8'
    );
    process.stdout.write(`  ${rel} patched\n`);
  }
}

function patchPackageManager() {
  // Upstream pins pnpm via devEngines.packageManager (onFail: error), which blocks
  // `npm run build`. Switch the project to npm so it builds with either manager.
  const filePath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const alreadyNpm =
    pkg.devEngines?.packageManager?.name === 'npm' &&
    typeof pkg.packageManager === 'string' &&
    pkg.packageManager.startsWith('npm@');
  if (alreadyNpm) {
    process.stdout.write('  package.json (packageManager) already patched — skip\n');
    return;
  }

  if (pkg.devEngines?.packageManager) {
    pkg.devEngines.packageManager.name = 'npm';
  }
  // packageManager must carry a valid corepack hash; drop it and let npm ignore the field
  pkg.packageManager = 'npm@' + (process.env.npm_config_user_agent?.match(/npm\/(\S+)/)?.[1] ?? '11.0.0');

  // lint:all uses `pnpm run` with a regex filter that npm doesn't support
  if (pkg.scripts?.['lint:all']?.includes('pnpm run')) {
    pkg.scripts['lint:all'] =
      'npm run lint:eslint && npm run lint:tsc && npm run lint:prettier';
  }

  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  process.stdout.write('  package.json (packageManager) patched\n');
}

process.stdout.write(`VOT_MOD patcher\nProject: ${PROJECT_ROOT}\n`);

if (process.argv.includes('--restore')) {
  step('Restoring original sources...');
  run('git checkout -- src/ assets/ package.json tools/deploy.js');
  run('git clean -f -q src/vot src/abort-controller-polyfill.ts');
  process.stdout.write('\n✓ Restore complete\n');
  process.exit(0);
}

validate();

step('Injecting VOT mod files...');
fs.cpSync(MOD_SRC, PROJECT_SRC, {
  recursive: true,
  force: true,
  filter: (src) => !src.endsWith('.d.ts')
});
process.stdout.write('  done\n');

step('Patching userScript.ts...');
patchUserScript();

step('Patching config.js...');
patchConfig();

step('Patching player_api/manager.ts...');
patchManagerTs();

step('Patching player_api/yt-api.ts...');
patchYtApiTs();

step('Patching ui.js (RED button)...');
patchUiJs();

step('Replacing assets (icons, splash, background)...');
patchAssets();

step('Patching app ID and title...');
patchAppId();

step('Patching package manager (pnpm → npm)...');
patchPackageManager();

process.stdout.write('\n✓ Patch complete\n');

if (!PATCH_ONLY) {
  step('Installing dependencies...');
  run('npm install');

  step('Building...');
  run('npm run build');

  step('Packaging...');
  run('npm run package');

  process.stdout.write('\n✓ Done! IPK package is ready\n');
}
