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
const MOD_VERSION = require('./package.json').version;
const GITHUB_REPO = 'DjVreditel/youtube-webos-vot';

const GENERATED_PATHS = 'src/ assets/ package.json tools/deploy.js';

const APP_ICONS = {
  icon: 'icon.png',
  largeIcon: 'largeIcon.png',
  mediumLargeIcon: 'mediumLargeIcon.png',
  extraLargeIcon: 'extraLargeIcon.png',
  playIcon: 'playIcon.png',
  splashBackground: 'splashBackground-v1.png',
  imageForRecents: 'imageForRecents.png',
  bgImage: 'bgImage.png'
};

const VOT_USERSCRIPT_PATCH = `
${PATCH_MARKER}
import './abort-controller-polyfill';
import { initVot } from './vot';

initVot();
`;

const VOT_CONFIG_ENTRIES = `  ${PATCH_MARKER}
  ['enableVot', { default: true, desc: 'Enable Voice Over Translation' }],
  ['votFromLang', { default: 'auto', desc: 'VOT source language' }],
  ['votToLang', { default: 'ru', desc: 'VOT target language' }],
  ['votTranslationVolume', { default: 0.9, desc: 'VOT translation audio volume (0-1)' }],
  ['votOriginalVolume', { default: 0.15, desc: 'Original video volume while VOT is active (0 = muted, 1 = full)' }],
  ['votLivelyVoice', { default: false, desc: 'VOT lively voice (experimental, en->ru only)' }],
  ['votAccountToken', { default: '', desc: 'Yandex account token for lively voice' }],
`;

function step(msg) {
  process.stdout.write(`\n→ ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`  WARNING: ${msg}\n`);
}

function run(cmd) {
  process.stdout.write(`  $ ${cmd}\n`);
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(content, anchor, replacement, what) {
  if (!content.includes(anchor)) {
    warn(`${what}: anchor not found`);
    return content;
  }
  return content.replace(anchor, replacement);
}

// Generated tracked files the patcher rewrites. Marked skip-worktree so git
// (and the IDE commit view) ignores their patched state — they must never be
// committed. setSkipWorktree() re-marks after a fresh checkout; clear before
// git checkout, which cannot touch skip-worktree paths otherwise.
function trackedGeneratedFiles() {
  return runQuiet(`git ls-files ${GENERATED_PATHS}`)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function untrackedGeneratedPaths() {
  const assets = fs.existsSync(MOD_ASSETS) ? fs.readdirSync(MOD_ASSETS) : [];
  return [
    'src/vot/',
    'src/abort-controller-polyfill.ts',
    ...assets
      .map((name) => `assets/${name}`)
      .filter((rel) => !runQuiet(`git ls-files "${rel}"`).trim())
  ];
}

function setSkipWorktree(on) {
  const flag = on ? '--skip-worktree' : '--no-skip-worktree';
  for (const f of trackedGeneratedFiles()) {
    runQuiet(`git update-index ${flag} "${f}"`);
  }
}

function validate() {
  for (const rel of ['userScript.js', 'config.js', 'ui.js']) {
    const filePath = path.join(PROJECT_SRC, rel);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `${rel} not found at: ${filePath}\nvot-mod expects the foxi69/youtube-webos source layout.`
      );
    }
  }
}

function patchUserScript() {
  const filePath = path.join(PROJECT_SRC, 'userScript.js');
  const content = readSource(filePath);

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  userScript.js already patched — skip\n');
    return;
  }

  fs.writeFileSync(filePath, content + VOT_USERSCRIPT_PATCH, 'utf8');
  process.stdout.write('  userScript.js patched\n');
}

function patchConfig() {
  const filePath = path.join(PROJECT_SRC, 'config.js');
  const content = readSource(filePath);

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  config.js already patched — skip\n');
    return;
  }

  const mapStart = content.indexOf('const configOptions = new Map([');
  const mapEnd = mapStart === -1 ? -1 : content.indexOf('\n]);', mapStart);
  if (mapEnd === -1) {
    throw new Error('config.js: cannot locate the configOptions Map');
  }
  let patched =
    content.slice(0, mapEnd).replace(/,?\s*$/, ',\n') +
    VOT_CONFIG_ENTRIES.replace(/,\n$/, '') +
    content.slice(mapEnd);

  patched = replaceOnce(
    patched,
    "  none: 'None',\n",
    "  none: 'None',\n  vot_panel: 'Open/Close VOT Panel',\n",
    'config.js shortcutActions'
  );
  patched = replaceOnce(
    patched,
    "if (color === 'red') def = 'oled_toggle';",
    "if (color === 'red') def = 'vot_panel';",
    'config.js red button default'
  );

  fs.writeFileSync(filePath, patched, 'utf8');
  process.stdout.write('  config.js patched\n');
}

function patchAuthServerUrl() {
  // Optional override: vot-mod/auth-server-url.txt replaces the committed
  // default AUTH_SERVER. Without the file the default in auth.ts is kept.
  const urlPath = path.join(__dirname, 'auth-server-url.txt');
  if (!fs.existsSync(urlPath)) {
    process.stdout.write('  auth-server-url.txt not found — keep default\n');
    return;
  }
  const filePath = path.join(PROJECT_SRC, 'vot', 'auth.ts');
  if (!fs.existsSync(filePath)) {
    process.stdout.write('  vot/auth.ts not found — skip QR login URL\n');
    return;
  }
  const url = fs.readFileSync(urlPath, 'utf8').trim().replace(/\/+$/, '');
  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content.replace(
    /const AUTH_SERVER = '[^']*';/,
    `const AUTH_SERVER = '${url.replace(/'/g, '')}';`
  );
  if (updated === content) {
    if (!content.includes(`'${url}'`)) {
      warn('AUTH_SERVER constant not found in auth.ts');
    }
    return;
  }
  fs.writeFileSync(filePath, updated, 'utf8');
  process.stdout.write(
    url
      ? '  auth server URL injected into vot/auth.ts\n'
      : '  auth server URL empty — QR login disabled\n'
  );
}

function patchAccountToken() {
  // Optional: vot-mod/account-token.txt holds the user's Yandex token
  // (copied from the desktop VOT extension) enabling lively voice.
  // The file is gitignored — the token is baked only into local builds.
  const tokenPath = path.join(__dirname, 'account-token.txt');
  if (!fs.existsSync(tokenPath)) {
    process.stdout.write(
      '  account-token.txt not found — lively voice stays anonymous\n'
    );
    return;
  }
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!token) {
    process.stdout.write('  account-token.txt is empty — skip\n');
    return;
  }

  const filePath = path.join(PROJECT_SRC, 'config.js');
  const content = fs.readFileSync(filePath, 'utf8');
  const safeToken = token.replace(/'/g, '');
  const re = /('votAccountToken',\s*\{\s*default:\s*)'[^']*'/;
  if (!re.test(content)) {
    warn('votAccountToken entry not found in config.js — token not injected');
    return;
  }
  fs.writeFileSync(filePath, content.replace(re, `$1'${safeToken}'`), 'utf8');
  process.stdout.write('  account token injected into config.js\n');
}

function patchUiJs() {
  const filePath = path.join(PROJECT_SRC, 'ui.js');
  const content = readSource(filePath);

  if (content.includes(PATCH_MARKER)) {
    process.stdout.write('  ui.js already patched — skip\n');
    return;
  }

  let patched = `${PATCH_MARKER}\nimport { showVotPanel } from './vot/ui';\n${content}`;
  patched = replaceOnce(
    patched,
    'function nearestInDirection(from, dir, candidates) {',
    'export function nearestInDirection(from, dir, candidates) {',
    'ui.js nearestInDirection'
  );
  patched = replaceOnce(
    patched,
    "    config_menu: 'GLOBAL',\n",
    "    config_menu: 'GLOBAL',\n    vot_panel: 'GLOBAL',\n",
    'ui.js ACTION_SCOPES'
  );
  patched = replaceOnce(
    patched,
    "  if (action === 'config_menu') {\n",
    "  if (action === 'vot_panel') {\n      showVotPanel();\n      return;\n  }\n  if (action === 'config_menu') {\n",
    'ui.js shortcut dispatch'
  );

  fs.writeFileSync(filePath, patched, 'utf8');
  process.stdout.write('  ui.js patched\n');
}

function patchSourceFile(rel, edits) {
  const filePath = path.join(PROJECT_SRC, rel);
  if (!fs.existsSync(filePath)) {
    warn(`${rel} not found`);
    return;
  }
  const content = readSource(filePath);
  if (content.includes(PATCH_MARKER)) {
    process.stdout.write(`  ${rel} already patched — skip\n`);
    return;
  }
  let patched = content;
  for (const [anchor, replacement] of edits) {
    patched = replaceOnce(patched, anchor, replacement, rel);
  }
  if (patched === content) return;
  fs.writeFileSync(filePath, `${PATCH_MARKER}\n${patched}`, 'utf8');
  process.stdout.write(`  ${rel} patched\n`);
}

function patchPerformance() {
  patchSourceFile('launch.js', [
    [
      "import './polyfills.js';",
      "import './polyfills.js';\nimport { getWebOSVersion } from './webos-utils.js';"
    ],
    [
      "  ytURL.searchParams.set('env_forceFullAnimation', '1');",
      "  if (getWebOSVersion() > 5) ytURL.searchParams.set('env_forceFullAnimation', '1');"
    ]
  ]);
  patchSourceFile('math-letters.js', [
    [
      'function onMutations(records) {\n  if (mathFontActive()) return;',
      'function onMutations(records, observer) {\n  if (mathFontActive()) {\n    observer.disconnect();\n    return;\n  }'
    ]
  ]);
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
  const appInfoPath = path.join(PROJECT_ASSETS, 'appinfo.json');
  if (fs.existsSync(appInfoPath)) {
    const info = JSON.parse(fs.readFileSync(appInfoPath, 'utf8'));
    info.id = NEW_APP_ID;
    info.title = NEW_APP_TITLE;
    info.version = MOD_VERSION;
    info.iconColor = '#f4afc3';
    info.vendorExtension = { ...info.vendorExtension, allowCrossDomain: true };
    for (const [field, file] of Object.entries(APP_ICONS)) {
      if (fs.existsSync(path.join(PROJECT_ASSETS, file))) info[field] = file;
    }
    fs.writeFileSync(appInfoPath, JSON.stringify(info, null, 2) + '\n', 'utf8');
    process.stdout.write('  assets/appinfo.json patched\n');
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

  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = fs.readFileSync(pkgPath, 'utf8');
  fs.writeFileSync(
    pkgPath,
    pkg.replace(/"version": "[^"]*"/, `"version": "${MOD_VERSION}"`),
    'utf8'
  );
  process.stdout.write(`  package.json version set to ${MOD_VERSION}\n`);
}

function writeRepoJson() {
  const ipkName = `${NEW_APP_ID}_${MOD_VERSION}_all.ipk`;
  const ipk = fs.readFileSync(path.join(PROJECT_ROOT, 'dist', ipkName));
  const sha256 = require('crypto').createHash('sha256').update(ipk).digest('hex');
  const iconUri = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/vot-mod/assets/icon.png`;
  const description = 'YouTube без рекламы с закадровым переводом (VOT)';
  const repo = {
    paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1 },
    packages: [
      {
        id: NEW_APP_ID,
        title: NEW_APP_TITLE,
        description,
        iconUri,
        manifest: {
          id: NEW_APP_ID,
          version: MOD_VERSION,
          type: 'web',
          title: NEW_APP_TITLE,
          appDescription: description,
          iconUri,
          sourceUrl: `https://github.com/${GITHUB_REPO}`,
          rootRequired: false,
          ipkUrl: `https://github.com/${GITHUB_REPO}/releases/download/v${MOD_VERSION}/${ipkName}`,
          ipkHash: { sha256 }
        }
      }
    ]
  };
  fs.writeFileSync(
    path.join(__dirname, 'repo.json'),
    JSON.stringify(repo, null, 2) + '\n',
    'utf8'
  );
  process.stdout.write(`  vot-mod/repo.json written (${ipkName}, sha256 ${sha256})\n`);
}

process.stdout.write(`VOT_MOD patcher\nProject: ${PROJECT_ROOT}\n`);

if (process.argv.includes('--restore')) {
  step('Restoring original sources...');
  // Clear skip-worktree first — git checkout cannot touch those paths
  setSkipWorktree(false);
  // Unstage first: `git checkout --` restores from the index, which may
  // hold patched content (e.g. after a failed lint-staged commit)
  run(`git reset -q -- ${GENERATED_PATHS}`);
  run(`git checkout -- ${GENERATED_PATHS}`);
  run(`git clean -fdqx -- ${untrackedGeneratedPaths().join(' ')}`);
  process.stdout.write('\n✓ Restore complete\n');
  process.exit(0);
}

validate();

// Clear skip-worktree so this run writes onto normally-tracked files
setSkipWorktree(false);

step('Injecting VOT mod files...');
fs.cpSync(MOD_SRC, PROJECT_SRC, {
  recursive: true,
  force: true,
  filter: (src) => !src.endsWith('.d.ts')
});
process.stdout.write('  done\n');

step('Patching userScript.js...');
patchUserScript();

step('Patching config.js...');
patchConfig();
patchAccountToken();
patchAuthServerUrl();

step('Patching ui.js (VOT panel shortcut)...');
patchUiJs();

step('Patching old-TV performance...');
patchPerformance();

step('Replacing assets (icons, splash, background)...');
patchAssets();

step('Patching app ID and title...');
patchAppId();

step('Hiding generated files from git (skip-worktree + exclude)...');
// Tracked files: skip-worktree so the IDE commit view ignores them
setSkipWorktree(true);
// Untracked generated files: local exclude so they don't show as new
{
  const excludePath = path.join(PROJECT_ROOT, '.git', 'info', 'exclude');
  if (fs.existsSync(excludePath)) {
    let exclude = fs.readFileSync(excludePath, 'utf8');
    for (const line of untrackedGeneratedPaths()) {
      if (!exclude.split('\n').includes(line)) {
        exclude = exclude.replace(/\n?$/, '\n') + line + '\n';
      }
    }
    fs.writeFileSync(excludePath, exclude, 'utf8');
  }
  process.stdout.write('  generated files hidden\n');
}

process.stdout.write('\n✓ Patch complete\n');

if (!PATCH_ONLY) {
  step('Installing dependencies...');
  run('npm ci');

  step('Building...');
  run('npm run build');

  step('Packaging...');
  run('npm run package');

  step('Writing Homebrew Channel repo manifest...');
  writeRepoJson();

  process.stdout.write('\n✓ Done! IPK package is ready in dist/\n');
}
