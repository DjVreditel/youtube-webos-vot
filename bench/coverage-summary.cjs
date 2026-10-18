// Prints coverage/coverage-summary.json (from `npm run coverage`) as Markdown:
// the totals over src/, then every src/ file, least covered first. CI appends
// it to the job summary. The report also lists the bundled node_modules
// helpers; they are left out here, totals included.
const summary = require('../coverage/coverage-summary.json');

const rows = Object.keys(summary)
  // Keys look like "youtube-webos/src/ui.js" (the package name, from webpack).
  .map((file) => ({ name: file.replace(/\\/g, '/').replace(/^[^/]+\/(?=src\/)/, ''), ...summary[file] }))
  .filter((r) => /^src\//.test(r.name) && !r.name.endsWith('.css'))
  .sort((a, b) => a.lines.pct - b.lines.pct);

const total = (metric) => {
  let covered = 0, all = 0;
  for (const r of rows) { covered += r[metric].covered; all += r[metric].total; }
  return all ? `${Math.round((covered / all) * 1000) / 10}%` : '-';
};

console.log('## Test coverage (legacy build)\n');
console.log(`Lines **${total('lines')}** · functions **${total('functions')}** · branches **${total('branches')}** (${rows.length} files in src/)\n`);
console.log('| File | Lines | Functions | Branches |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.lines.pct}% (${r.lines.covered}/${r.lines.total}) | ${r.functions.pct}% | ${r.branches.pct}% |`);
}
