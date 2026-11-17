import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { parse } from 'yaml';
import { labFileSchema, taskPackSchema, type LabFile, type LabTaskBundle } from '@factoryze/protocol';

export const labFilesHash = (files: LabFile[]) => createHash('sha256').update(JSON.stringify(files)).digest('hex');
export function validateLabFiles(input: LabFile[]): LabFile[] {
  if (input.length > 512) throw Error('Lab snapshot exceeds the file limit');
  const names = new Set<string>(); let bytes = 0;
  const files = input.map(file => {
    const valid = labFileSchema.parse(file), data = Buffer.from(valid.data, 'base64');
    if (data.toString('base64') !== valid.data || data.length > 1048576 || names.has(valid.path.toLowerCase())) throw Error('Invalid or duplicate lab file');
    names.add(valid.path.toLowerCase()); bytes += data.length;
    if (bytes > 4194304) throw Error('Lab snapshot exceeds 4 MiB');
    return valid;
  }).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const file of files) if (file.path.split('/').slice(0,-1).some((_,i,array) => names.has(array.slice(0,i+1).join('/').toLowerCase()))) throw Error('A lab file conflicts with a directory');
  return files;
}
export function captureLabFiles(directory: string): LabFile[] {
  const root = realpathSync.native(directory), files: LabFile[] = [];
  const ignored = new Set(['.git','.venv','node_modules','__pycache__','.pytest_cache']);
  function walk(current: string): void {
    for (const name of readdirSync(current).sort()) {
      if (ignored.has(name.toLowerCase()) || /^\.env(?:\.|$)/i.test(name) || name.toLowerCase().startsWith('.factoryze') || /\.pyc$/i.test(name)) continue;
      const path = join(current,name), before = lstatSync(path), canonical = realpathSync.native(path);
      const rel = relative(root,canonical);
      if (before.isSymbolicLink() || rel.startsWith('..'+sep) || rel === '..' || resolve(root,rel) !== canonical) throw Error('Lab sync refuses linked files');
      if (before.isDirectory()) { walk(path); continue; }
      if (!before.isFile() || before.nlink !== 1 || before.size > 1048576) throw Error('Lab sync accepts bounded regular files only');
      const fd = openSync(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fstatSync(fd); if (opened.ino !== before.ino || opened.dev !== before.dev) throw Error('File changed during lab sync');
        const data = readFileSync(fd), after = lstatSync(path);
        if (after.isSymbolicLink() || after.ino !== opened.ino || after.size !== data.length || realpathSync.native(path) !== canonical) throw Error('File changed during lab sync');
        files.push({ path: relative(root,path).split(sep).join('/'), data: data.toString('base64') });
        validateLabFiles(files);
      } finally { closeSync(fd); }
    }
  }
  walk(root); return validateLabFiles(files);
}
export function materializeLabFiles(directory: string, input: LabFile[]): void {
  const files = validateLabFiles(input), root = realpathSync.native(directory);
  for (const file of files) {
    const path = resolve(root,file.path), rel = relative(root,path);
    if (rel.startsWith('..') || path === root) throw Error('Unsafe lab destination');
    const parts = file.path.split('/');
    for (let i=1;i<parts.length;i++) {
      const folder = join(root,...parts.slice(0,i)); mkdirSync(folder,{recursive:true});
      if (lstatSync(folder).isSymbolicLink() || realpathSync.native(folder) !== folder) throw Error('Linked lab destination');
    }
    writeFileSync(path,Buffer.from(file.data,'base64'),{flag:'wx',mode:0o600});
  }
}
export function captureLabTask(taskRoot: string, id: string): { public: LabTaskBundle; hidden: LabFile[] } {
  const taskId = taskPackSchema.shape.id.parse(id), directory = join(taskRoot,taskId);
  const task = taskPackSchema.parse(parse(readFileSync(join(directory,'task.yaml'),'utf8')));
  if (task.id !== id) throw Error('Task ID does not match the lab');
  const files = captureLabFiles(join(directory,'workspace')), hidden = captureLabFiles(join(directory,'tests','hidden'));
  return { public: { task, files, hash: createHash('sha256').update(JSON.stringify({task,files})).digest('hex') }, hidden };
}
