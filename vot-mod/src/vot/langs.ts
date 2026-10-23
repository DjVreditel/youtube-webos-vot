export const SOURCE_LANGS: [string, string][] = [
  ['auto', 'Auto'],
  ['ru', 'Russian'],
  ['en', 'English'],
  ['zh', 'Chinese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['fr', 'French'],
  ['it', 'Italian'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['ja', 'Japanese']
];

export const TARGET_LANGS: [string, string][] = [
  ['ru', 'Russian'],
  ['en', 'English'],
  ['kk', 'Kazakh']
];

export function isSourceLang(code: string): boolean {
  return SOURCE_LANGS.some(([c]) => c === code);
}

export function isTargetLang(code: string): boolean {
  return TARGET_LANGS.some(([c]) => c === code);
}
