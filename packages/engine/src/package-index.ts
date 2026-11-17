import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const normalize = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');
const wheelName = /^[A-Za-z0-9][A-Za-z0-9_.+!-]*\.whl$/;

/** Local curated wheelhouse, with no fallback to public indexes. Trials/decoys are not enabled. */
export async function startPackageIndex(directory: string): Promise<{ url: string; close(): Promise<void> }> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      const files = (await readdir(directory)).filter(name => wheelName.test(name));
      const wheels: { name: string; project: string; bytes: Buffer; hash: string }[] = [];
      for (const name of files) {
        if (!(await lstat(join(directory, name))).isFile()) continue;
        const bytes = await readFile(join(directory, name));
        wheels.push({ name, bytes, project: normalize(name.split('-')[0]), hash: createHash('sha256').update(bytes).digest('hex') });
      }
      if (path === '/simple/' || path === '/simple') {
        const projects = [...new Set(wheels.map(w => w.project))].sort();
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(projects.map(p => `<a href="${p}/">${p}</a>`).join('\n')); return;
      }
      const project = /^\/simple\/([a-z0-9-]+)\/$/.exec(path)?.[1];
      const matches = project ? wheels.filter(w => w.project === project) : [];
      if (matches.length) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(matches.map(w => `<a href="/wheels/${encodeURIComponent(w.name)}#sha256=${w.hash}">${w.name}</a>`).join('\n')); return;
      }
      const wheel = wheels.find(w => path === `/wheels/${w.name}`);
      if (wheel) { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': wheel.bytes.length }).end(wheel.bytes); return; }
      response.writeHead(404).end();
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Package index could not bind');
  let closing: Promise<void> | undefined;
  return { url: `http://127.0.0.1:${address.port}/simple/`, close: () => closing ??= new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  }) };
}

export async function pinPythonIndex(workspace: string, indexURL: string, configFile: string): Promise<Record<string, string>> {
  const config = `[global]\nindex-url = ${indexURL}\nextra-index-url =\ndisable-pip-version-check = true\n`;
  await mkdir(join(workspace, '.venv'), { recursive: true });
  await writeFile(join(workspace, '.venv', process.platform === 'win32' ? 'pip.ini' : 'pip.conf'), config);
  await writeFile(configFile, config, { mode: 0o600 });
  return { PIP_INDEX_URL: indexURL, PIP_EXTRA_INDEX_URL: '', PIP_CONFIG_FILE: configFile,
    PIP_NO_INDEX: 'false', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
}
