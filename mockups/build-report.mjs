import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const appRequire = createRequire(resolve(here, '../packages/app/package.json'));
const coreRequire = createRequire(resolve(here, '../packages/app/extensions/core/package.json'));
const { build } = appRequire('esbuild');
const result = await build({ entryPoints: [resolve(here, 'report-preview.ts')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2022' });
const css = await readFile(resolve(here, '../packages/app/extensions/core/src/browser/style/factoryze.css'), 'utf8');
const fonts = await Promise.all([400, 600, 700].map(async weight => {
  const file = coreRequire.resolve(`@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-${weight}-normal.woff2`);
  return `@font-face{font-family:'Atkinson Hyperlegible Next';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${(await readFile(file)).toString('base64')}) format('woff2')}`;
}));
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Factoryze — improved report preview</title>
<style>${fonts.join('\n')}\n${css}
*{box-sizing:border-box}body{margin:0;background:var(--fz-page);color:var(--fz-text);font:14px/1.5 var(--fz-ui)}
.preview-top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 28px;background:var(--fz-chrome);border-bottom:1px solid var(--fz-line)}
.preview-brand{font-size:19px;font-weight:700;letter-spacing:-.5px}.preview-brand span{display:inline-grid;place-items:center;margin-right:9px;width:27px;height:27px;background:var(--fz-accent);color:var(--fz-on-accent);border-radius:6px;font-size:20px}
.preview-caption{color:var(--fz-muted);font-size:12px;margin-left:12px;font-weight:400;letter-spacing:0}
.preview-controls{display:flex;gap:12px;align-items:center}.preview-controls label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fz-muted)}
select{font:13px var(--fz-ui);padding:7px 28px 7px 10px;border:1px solid var(--fz-line-strong);border-radius:5px;color:var(--fz-text);background:var(--fz-editor)}
button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--fz-accent);outline-offset:3px}
#report{overflow:visible}.preview-breadcrumb,.preview-submission{font-size:12px;color:var(--fz-muted)}
.preview-footnote{border-top:1px solid var(--fz-line);padding-top:16px;color:var(--fz-muted);font-size:12px}
@media(max-width:760px){.preview-top{padding:12px 16px;align-items:flex-start;flex-wrap:wrap}.preview-caption{display:none}.preview-controls{width:100%;justify-content:space-between;flex-wrap:wrap}}
</style></head><body>
<header class="preview-top"><div class="preview-brand"><span aria-hidden="true">f</span>factoryze <span class="preview-caption" style="display:inline;background:none;width:auto;height:auto;color:var(--fz-muted);font-size:12px">Report preview</span></div>
<div class="preview-controls"><label>Example <select id="report-state"><option value="complete">Complete submission</option><option value="partial">Some checks failed</option><option value="older">Earlier report</option><option value="manual">Without the agent</option></select></label><button id="theme" class="fz-btn fz-quiet fz-sm" type="button" aria-pressed="false">Dark appearance</button></div></header>
<main id="report" class="fz-page fz-report-view" aria-label="Practice report"><div id="report-content" class="fz-page-inner fz-report-content"></div></main>
<script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>\n`;
await writeFile(resolve(here, 'report.html'), html);
process.stdout.write('Built mockups/report.html (self-contained report mockup).\n');
