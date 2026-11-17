import type { GatewayErrorCode } from '@factoryze/protocol';

export interface ModelRequest {
  method: string;
  path: string;
  body: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ModelResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<string>;
  failureCode?: GatewayErrorCode;
}

export interface ReplayFixture {
  request: Pick<ModelRequest, 'method' | 'path' | 'body'>;
  response: { status: number; headers: Record<string, string>; chunks: string[] };
}

function stream(chunks: string[]): AsyncIterable<string> {
  return (async function* () { yield* chunks; })();
}

function safeHeaders(headers: Record<string, string>): Record<string, string> {
  const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
  return contentType ? { 'content-type': contentType[1] } : {};
}

/** Capture a curated request/response in memory. Callers review fixture content before saving it. */
export async function recordExchange(
  request: ModelRequest,
  send: (request: ModelRequest) => Promise<ModelResponse>
): Promise<{ fixture: ReplayFixture; response: ModelResponse }> {
  const response = await send(request);
  const chunks: string[] = [];
  for await (const chunk of response.body) chunks.push(chunk);
  const headers = safeHeaders(response.headers);
  return {
    fixture: {
      request: { method: request.method, path: request.path, body: request.body },
      response: { status: response.status, headers, chunks }
    },
    response: { status: response.status, headers, body: stream(chunks) }
  };
}

/** A local provider whose calls must match recorded traffic in order. */
export class ReplayProvider {
  private cursor = 0;
  private readonly fixtures: ReplayFixture[];

  constructor(fixtures: ReplayFixture[]) { this.fixtures = fixtures; }

  get remaining(): number { return this.fixtures.length - this.cursor; }

  async send(request: ModelRequest): Promise<ModelResponse> {
    const fixture = this.fixtures[this.cursor];
    if (!fixture) throw new Error('Replay fixtures exhausted');
    const expected = fixture.request;
    if (request.method !== expected.method || request.path !== expected.path || request.body !== expected.body) {
      throw new Error(`Replay request does not match fixture ${this.cursor + 1}`);
    }
    this.cursor += 1;
    return {
      status: fixture.response.status,
      headers: { ...fixture.response.headers },
      body: stream(fixture.response.chunks)
    };
  }
}
