import * as monaco from '@theia/monaco-editor-core';
import type { LanguageGrammarDefinitionContribution, TextmateRegistry } from '@theia/monaco/lib/browser/textmate';
import type { MonacoThemeRegistry } from '@theia/monaco/lib/browser/textmate/monaco-theme-registry';
import { editorLanguages, editorSurface, syntaxTokenColors, type SyntaxMode } from './language-catalog';

// Bundled with the app rather than loaded on demand: the installed app has no extension host to fetch grammars from.
const grammars: Record<string, object> = {
  python: require('tm-grammars/grammars/python.json'), javascript: require('tm-grammars/grammars/javascript.json'), typescript: require('tm-grammars/grammars/typescript.json'),
  go: require('tm-grammars/grammars/go.json'), json: require('tm-grammars/grammars/json.json'), markdown: require('tm-grammars/grammars/markdown.json'),
};
// The editor's stock themes, which Factoryze's palette is laid over. Each one builds on the files it includes.
const stockThemes: Record<SyntaxMode, { name: string; base: 'vs' | 'vs-dark'; top: string; files: Record<string, object> }> = {
  light: { name: 'light-theia', base: 'vs', top: './light_theia.json', files: {
    './light_vs.json': require('@theia/monaco/data/monaco-themes/vscode/light_vs.json'), './light_plus.json': require('@theia/monaco/data/monaco-themes/vscode/light_plus.json'),
    './light_theia.json': require('@theia/monaco/data/monaco-themes/vscode/light_theia.json') } },
  dark: { name: 'dark-theia', base: 'vs-dark', top: './dark_theia.json', files: {
    './dark_vs.json': require('@theia/monaco/data/monaco-themes/vscode/dark_vs.json'), './dark_plus.json': require('@theia/monaco/data/monaco-themes/vscode/dark_plus.json'),
    './dark_theia.json': require('@theia/monaco/data/monaco-themes/vscode/dark_theia.json') } },
};
const pairs: [string, string][] = [['{', '}'], ['[', ']'], ['(', ')']];
const quotes = ['"', "'", '`'];

/**
 * Gives the editor its languages. Without this every file opens as plain text: no colours, no comment shortcut,
 * no matching brackets. The editor asks for these before it builds its tokenizer, so the palette is in place first.
 */
export class FactoryzeLanguages implements LanguageGrammarDefinitionContribution {
  constructor(private readonly themes: MonacoThemeRegistry) {}

  registerTextmateLanguage(registry: TextmateRegistry): void {
    for (const mode of ['light', 'dark'] as const) {
      const stock = stockThemes[mode];
      // Re-registering under the stock name keeps Theia's light and dark themes, and everything that follows them, as they are.
      // The text colour is set too, so a word no rule names is drawn like the rest of the app's text, not in the stock black or grey.
      this.themes.register({ include: stock.top, colors: { 'editor.foreground': editorSurface[mode].text }, tokenColors: syntaxTokenColors(mode) }, stock.files, stock.name, stock.base);
    }
    for (const language of editorLanguages) {
      monaco.languages.register({ id: language.id, aliases: [language.label], extensions: language.extensions });
      monaco.languages.setLanguageConfiguration(language.id, {
        comments: { ...(language.lineComment ? { lineComment: language.lineComment } : {}), ...(language.blockComment ? { blockComment: language.blockComment } : {}) },
        brackets: pairs,
        autoClosingPairs: [...pairs.map(([open, close]) => ({ open, close })), ...quotes.map(quote => ({ open: quote, close: quote, notIn: ['string', 'comment'] }))],
        surroundingPairs: [...pairs, ...quotes.map(quote => [quote, quote] as [string, string])].map(([open, close]) => ({ open, close })),
        ...(language.indent ? { indentationRules: { increaseIndentPattern: language.indent, decreaseIndentPattern: language.dedent ?? /^\s*$^/ } } : {}),
        ...(language.offSide ? { folding: { offSide: true } } : {}),
      });
      const content = grammars[language.grammar];
      registry.registerTextmateGrammarScope(language.scope, { getGrammarDefinition: async () => ({ format: 'json', content }) });
      registry.mapLanguageIdToTextmateGrammar(language.id, language.scope);
    }
  }
}
