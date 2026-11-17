import {browserCheckJobSchema, type BrowserCheckJob} from '@factoryze/protocol';

/** One private job per process. No line splitting, silent truncation, or replacement UTF-8. */
export async function readBrowserCheckJob(source: AsyncIterable<Uint8Array>): Promise<BrowserCheckJob> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > 3 * 1024 * 1024) throw Error('Browser check transport limit exceeded');
    chunks.push(Buffer.from(chunk));
  }
  const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  return browserCheckJobSchema.parse(JSON.parse(text));
}
