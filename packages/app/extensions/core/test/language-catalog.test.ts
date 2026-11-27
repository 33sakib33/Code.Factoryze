import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { editorLanguages, editorSurface, languageFor, syntaxRoles, syntaxTokenColors, type SyntaxMode } from '../src/browser/language-catalog.ts';

// The same grammar engine, grammars and stock themes the editor uses, so these tests see the colours a person would see.
// Tests run from the repository root.
const here = createRequire(resolve('packages/app/extensions/core/package.json')), monaco = createRequire(here.resolve('@theia/monaco/package.json'));
const vsctm = monaco('vscode-textmate'), oniguruma = monaco('vscode-oniguruma');
const engine = oniguruma.loadWASM(readFileSync(monaco.resolve('vscode-oniguruma/release/onig.wasm')).buffer);
const grammarFile = (name: string) => here(`tm-grammars/grammars/${name}.json`);
const stock = (name: string) => monaco(`@theia/monaco/data/monaco-themes/vscode/${name}.json`).tokenColors ?? [];
const stockThemes: Record<SyntaxMode, string[]> = { light: ['light_vs', 'light_plus', 'light_theia'], dark: ['dark_vs', 'dark_plus', 'dark_theia'] };

async function painter(mode: SyntaxMode) {
  await engine;
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources), createOnigString: (text: string) => new oniguruma.OnigString(text) }),
    loadGrammar: async (scope: string) => { const language = editorLanguages.find(l => l.scope === scope); return language ? grammarFile(language.grammar) : null; },
  });
  registry.setTheme({ settings: [{ settings: { foreground: editorSurface[mode].text, background: editorSurface[mode].background } }, ...stockThemes[mode].flatMap(stock), ...syntaxTokenColors(mode)] });
  /** Colour and style of the first occurrence of `word` in `line`. */
  return async (languageId: string, line: string, word: string) => {
    const grammar = await registry.loadGrammar(editorLanguages.find(l => l.id === languageId)!.scope);
    const tokens: Uint32Array = grammar.tokenizeLine2(line, vsctm.INITIAL).tokens, at = line.indexOf(word);
    assert.ok(at >= 0, `"${word}" is not in the line`);
    let metadata = 0;
    for (let i = 0; i < tokens.length; i += 2) if (tokens[i] <= at) metadata = tokens[i + 1];
    const style = (metadata >>> 11) & 0xf;
    return { colour: String(registry.getColorMap()[(metadata >>> 15) & 0x1ff]).toUpperCase(), italic: (style & 1) === 1, bold: (style & 2) === 2 };
  };
}
const role = (name: string) => syntaxRoles.find(r => r.name === name)!;

for (const mode of ['light', 'dark'] as const) {
  test(`${mode}: Python is coloured by what each word is`, async () => {
    const paint = await painter(mode), colour = async (line: string, word: string) => (await paint('python', line, word)).colour;
    const define = 'def fine_for(loan, days=25):  # late returns';
    assert.equal(await colour(define, 'def'), role('keyword')[mode]);
    assert.equal(await colour(define, 'fine_for'), role('function')[mode]);
    assert.equal(await colour(define, '25'), role('number')[mode]);
    assert.deepEqual(await paint('python', define, 'late returns'), { colour: role('comment')[mode], italic: true, bold: false });
    const body = '    return min(days * RATE["book"], cap)';
    assert.equal(await colour(body, 'return'), role('keyword')[mode]);
    assert.equal(await colour(body, 'min'), role('function')[mode]);
    assert.equal(await colour(body, 'book'), role('string')[mode]);
    // Names a person chose, and operators, stay in the text colour.
    for (const word of ['days', '*', 'cap']) assert.equal(await colour(body, word), editorSurface[mode].text.toUpperCase(), word);
    assert.equal(await colour('    if late and not waived:', 'and'), role('keyword')[mode]);
    assert.equal(await colour('class Loan(Record):', 'Loan'), role('type')[mode]);
    assert.equal(await colour('class Loan(Record):', 'Record'), role('type')[mode]);
    assert.equal(await colour('def total(cents: int) -> str:', 'int'), role('type')[mode]);
    assert.equal(await colour('@dataclass', 'dataclass'), role('decorator')[mode]);
    assert.equal(await colour('    done = True', 'True'), role('number')[mode]);
    assert.equal(await colour('    """Fine in cents."""', 'Fine in cents'), role('string')[mode]);
  });

  test(`${mode}: the other languages use the same colour for the same kind of thing`, async () => {
    const paint = await painter(mode), colour = async (id: string, line: string, word: string) => (await paint(id, line, word)).colour;
    const json = '{"book": 25, "open": true, "branch": "Riverside"}';
    assert.equal(await colour('json', json, 'book'), role('function')[mode]);
    assert.equal(await colour('json', json, '25'), role('number')[mode]);
    assert.equal(await colour('json', json, 'true'), role('number')[mode]);
    assert.equal(await colour('json', json, 'Riverside'), role('string')[mode]);
    for (const id of ['typescript', 'javascript']) {
      const line = 'const total = items.length + 2; // sum';
      assert.equal(await colour(id, line, 'const'), role('keyword')[mode], id);
      assert.equal(await colour(id, line, '2'), role('number')[mode], id);
      assert.equal(await colour(id, line, 'sum'), role('comment')[mode], id);
      assert.equal(await colour(id, 'function fee(km) { return "flat"; }', 'fee'), role('function')[mode], id);
      assert.equal(await colour(id, 'function fee(km) { return "flat"; }', 'flat'), role('string')[mode], id);
    }
    assert.equal(await colour('typescript', 'let fee: number = 0;', 'number'), role('type')[mode]);
    const go = 'func Fee(km int) int { return 40 }';
    assert.equal(await colour('go', go, 'func'), role('keyword')[mode]);
    assert.equal(await colour('go', go, 'Fee'), role('function')[mode]);
    assert.equal(await colour('go', go, 'int'), role('type')[mode]);
    assert.equal(await colour('go', go, '40'), role('number')[mode]);
    assert.deepEqual(await paint('markdown', '# Library fines', 'Library'), { colour: role('heading')[mode], italic: false, bold: true });
    assert.equal(await colour('markdown', 'Run `python -m unittest` first.', 'python'), role('string')[mode]);
  });
}

test('every colour is readable on the editor surface', () => {
  const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
  const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const mode of ['light', 'dark'] as const) for (const r of syntaxRoles) {
    assert.match(r[mode], /^#[0-9A-F]{6}$/, `${r.name} ${mode}`);
    assert.ok(contrast(r[mode], editorSurface[mode].background) >= 4.5, `${r.name} on ${mode}: ${contrast(r[mode], editorSurface[mode].background).toFixed(2)}`);
  }
});

test('files are matched to a language by extension, and each grammar is the one its language names', () => {
  assert.equal(languageFor('library/fines.py')?.id, 'python');
  assert.equal(languageFor('Stubs.PYI')?.id, 'python');
  assert.equal(languageFor('src/fee.ts')?.id, 'typescript');
  assert.equal(languageFor('fee.mjs')?.id, 'javascript');
  assert.equal(languageFor('main.go')?.id, 'go');
  assert.equal(languageFor('data/rates.json')?.id, 'json');
  assert.equal(languageFor('README.md')?.id, 'markdown');
  for (const plain of ['notes.txt', 'server.log', 'Makefile', 'archive.py.zip']) assert.equal(languageFor(plain), undefined, plain);
  const extensions = editorLanguages.flatMap(l => l.extensions);
  assert.equal(new Set(extensions).size, extensions.length, 'no extension belongs to two languages');
  assert.equal(new Set(editorLanguages.map(l => l.id)).size, editorLanguages.length);
  for (const language of editorLanguages) assert.equal(grammarFile(language.grammar).scopeName, language.scope, language.id);
  // Python blocks open after a colon and close on else/except; brace languages open after a bracket.
  const python = editorLanguages.find(l => l.id === 'python')!;
  assert.match('    if days_late <= 0:', python.indent!); assert.match('async def run():  # go', python.indent!); assert.doesNotMatch('    return 0', python.indent!);
  assert.match('    else:', python.dedent!); assert.doesNotMatch('    elsewhere = 1', python.dedent!);
  const go = editorLanguages.find(l => l.id === 'go')!;
  assert.match('func Fee(km int) int {', go.indent!); assert.match('}', go.dedent!); assert.doesNotMatch('x := Fee(2)', go.indent!);
});
