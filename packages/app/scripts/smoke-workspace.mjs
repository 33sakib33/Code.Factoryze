import { posix, win32 } from 'node:path';

export function workbenchWorkspacePath(url, platform = process.platform) {
  let path = decodeURIComponent(new URL(url).hash.slice(1));
  // Theia URI paths retain a leading slash before Windows drive letters.
  if (platform === 'win32') path = path.replace(/^\/(?=[a-z]:[\\/])/i, '');
  const native = platform === 'win32' ? win32 : posix;
  if (!native.isAbsolute(path)) throw new Error('No absolute workspace in the workbench URL');
  return native.normalize(path);
}
