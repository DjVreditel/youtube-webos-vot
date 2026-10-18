// Loaded with --require in coverage runs (bench/ci.sh --coverage). The bench
// tests eval the bundle inside jsdom, where V8 sees it as a nameless script;
// a sourceURL names it after its file, so c8 finds the file and its source
// map and reports src/ lines.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, options) {
  const out = readFileSync.apply(this, arguments);
  if (typeof out === 'string' && typeof file === 'string' && /webOSUserScripts[\\/]userScript\.js$/.test(file)) {
    return out + '\n//# sourceURL=' + pathToFileURL(path.resolve(file)).href;
  }
  return out;
};
