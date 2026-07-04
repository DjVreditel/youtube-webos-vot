'use strict';

/* global __dirname */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MOD_SRC = path.join(__dirname, 'src');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROJECT_SRC = path.join(PROJECT_ROOT, 'src');

const PATCH_ONLY = process.argv.includes('--patch-only');

const PATCH_MARKER = '// @vot-mod';

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

process.stdout.write(`VOT_MOD patcher\nProject: ${PROJECT_ROOT}\n`);

if (process.argv.includes('--restore')) {
  step('Restoring original sources...');
  run('git checkout -- src/');
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

process.stdout.write('\n✓ Patch complete\n');

if (!PATCH_ONLY) {
  step('Installing dependencies...');
  run('pnpm install');

  step('Building...');
  run('pnpm run build');

  step('Packaging...');
  run('pnpm run package');

  process.stdout.write('\n✓ Done! IPK package is ready\n');
}
