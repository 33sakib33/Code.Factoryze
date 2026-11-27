/**
 * The languages the editor colours, and the colours it uses. No editor imports here, so the palette is testable on its own.
 * The palette is the one in mockups/ide.html; only the comment grey is darker (light) and lighter (dark) so comments stay readable.
 */
export type EditorLanguage = {
  id: string;
  label: string;
  /** Root scope of the TextMate grammar, and its file name in the tm-grammars package. */
  scope: string;
  grammar: string;
  extensions: string[];
  lineComment?: string;
  blockComment?: [string, string];
  /** A line matching this is followed by a deeper indent; a line matching `dedent` moves back out. */
  indent?: RegExp;
  dedent?: RegExp;
  /** True where blocks are marked by indentation alone. */
  offSide?: boolean;
};

const braceIndent = /^.*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*)$/, braceDedent = /^\s*[}\])]/;

export const editorLanguages: EditorLanguage[] = [
  { id: 'python', label: 'Python', scope: 'source.python', grammar: 'python', extensions: ['.py', '.pyi'], lineComment: '#', blockComment: ['"""', '"""'], offSide: true,
    indent: /^\s*(?:async\s+)?(?:def|class|for|if|elif|else|while|try|with|finally|except|match|case)\b.*:\s*(?:#.*)?$/, dedent: /^\s*(?:elif|else|except|finally)\b.*:/ },
  { id: 'javascript', label: 'JavaScript', scope: 'source.js', grammar: 'javascript', extensions: ['.js', '.mjs', '.cjs'], lineComment: '//', blockComment: ['/*', '*/'], indent: braceIndent, dedent: braceDedent },
  { id: 'typescript', label: 'TypeScript', scope: 'source.ts', grammar: 'typescript', extensions: ['.ts', '.mts', '.cts'], lineComment: '//', blockComment: ['/*', '*/'], indent: braceIndent, dedent: braceDedent },
  { id: 'go', label: 'Go', scope: 'source.go', grammar: 'go', extensions: ['.go'], lineComment: '//', blockComment: ['/*', '*/'], indent: braceIndent, dedent: braceDedent },
  { id: 'json', label: 'JSON', scope: 'source.json', grammar: 'json', extensions: ['.json'], indent: braceIndent, dedent: braceDedent },
  { id: 'markdown', label: 'Markdown', scope: 'text.html.markdown', grammar: 'markdown', extensions: ['.md', '.markdown'], blockComment: ['<!--', '-->'] },
];

/** The language for a file name, by its extension. */
export function languageFor(fileName: string): EditorLanguage | undefined {
  const lower = fileName.toLowerCase();
  return editorLanguages.find(language => language.extensions.some(extension => lower.endsWith(extension)));
}

export type SyntaxMode = 'light' | 'dark';
/** The editor surface each mode is read against (--fz-editor) and its plain text colour (--fz-text). */
export const editorSurface: Record<SyntaxMode, { background: string; text: string }> = {
  light: { background: '#FBFCFB', text: '#1E2A30' },
  dark: { background: '#1D262A', text: '#D8E1E4' },
};

type Role = { name: string; light: string; dark: string; fontStyle?: string; scopes: string[] };

/**
 * One colour per kind of thing, so the eye learns it once. Names a person chose (variables, parameters, attributes)
 * and punctuation stay in the text colour: colouring everything would say nothing.
 */
export const syntaxRoles: Role[] = [
  { name: 'plain', light: editorSurface.light.text, dark: editorSurface.dark.text, scopes: ['variable', 'variable.parameter', 'variable.other.constant', 'variable.other.enummember', 'meta.definition.variable.name',
    'support.variable', 'entity.name.variable', 'meta.object-literal.key', 'support.constant', 'keyword.operator', 'punctuation', 'meta.brace', 'meta.embedded', 'entity.other.attribute'] },
  { name: 'keyword', light: '#7C3A8C', dark: '#D39BE0', scopes: ['keyword', 'keyword.control', 'storage', 'storage.type', 'storage.modifier', 'variable.language', 'keyword.operator.logical.python',
    'keyword.operator.new', 'keyword.operator.expression', 'keyword.operator.cast', 'keyword.operator.sizeof', 'keyword.operator.instanceof', 'keyword.operator.wordlike'] },
  { name: 'function', light: '#1F48B8', dark: '#93B4FF', scopes: ['entity.name.function', 'support.function', 'meta.function-call.generic.python', 'support.type.property-name', 'support.type.property-name.json', 'markup.underline.link'] },
  { name: 'string', light: '#8A5A10', dark: '#E0B872', scopes: ['string', 'string.quoted.docstring', 'string.regexp', 'punctuation.definition.string', 'markup.inline.raw', 'markup.fenced_code.block.markdown'] },
  { name: 'comment', light: '#66767E', dark: '#8C9CA3', fontStyle: 'italic', scopes: ['comment', 'punctuation.definition.comment', 'markup.quote'] },
  { name: 'number', light: '#A33A2A', dark: '#F29B85', scopes: ['constant.numeric', 'constant.language', 'constant.character.escape', 'constant.other.placeholder'] },
  { name: 'type', light: '#0F6B74', dark: '#6CC6CD', scopes: ['entity.name.type', 'entity.name.class', 'entity.name.namespace', 'entity.other.inherited-class', 'support.type', 'support.class',
    'storage.type.numeric.go', 'storage.type.byte.go', 'storage.type.boolean.go', 'storage.type.string.go', 'storage.type.uintptr.go', 'storage.type.error.go', 'storage.type.rune.go'] },
  { name: 'decorator', light: '#7A5C00', dark: '#D8C27A', scopes: ['entity.name.function.decorator', 'meta.function.decorator', 'punctuation.definition.decorator'] },
  { name: 'heading', light: '#0F6B74', dark: '#6CC6CD', fontStyle: 'bold', scopes: ['markup.heading', 'entity.name.section', 'punctuation.definition.heading'] },
  { name: 'strong', light: editorSurface.light.text, dark: editorSurface.dark.text, fontStyle: 'bold', scopes: ['markup.bold'] },
  { name: 'emphasis', light: editorSurface.light.text, dark: editorSurface.dark.text, fontStyle: 'italic', scopes: ['markup.italic'] },
];

export type TokenColor = { scope: string[]; settings: { foreground: string; fontStyle?: string } };

/** The palette as VS Code-style token colours. Laid over the editor's stock theme, these win wherever they name the same thing. */
export function syntaxTokenColors(mode: SyntaxMode): TokenColor[] {
  return syntaxRoles.map(role => ({ scope: role.scopes, settings: { foreground: role[mode], ...(role.fontStyle ? { fontStyle: role.fontStyle } : {}) } }));
}
