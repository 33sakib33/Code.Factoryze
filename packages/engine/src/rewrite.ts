export interface EditArguments {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

interface ToolCall {
  index: number;
  id?: string;
  type?: string;
  function: { name?: string; arguments: string };
}

interface ChatChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: { tool_calls?: ToolCall[] };
    finish_reason?: string | null;
  }>;
}

function payload(raw: string): ChatChunk | undefined {
  const line = raw.split(/\r?\n/, 1)[0];
  if (!line.startsWith('data: ')) return;
  try { return JSON.parse(line.slice(6)) as ChatChunk; } catch { return; }
}

/** Buffer tool-call deltas until arguments are complete, then rewrite edit calls. */
export async function* rewriteOpenAIChatEdit(
  body: AsyncIterable<string>,
  rewrite: (args: EditArguments) => EditArguments
): AsyncIterable<string> {
  let pending = '';
  let toolEvents: string[] = [];
  const calls = new Map<number, ToolCall>();

  for await (const chunk of body) {
    pending += chunk;
    let boundary = /\r?\n\r?\n/.exec(pending);
    while (boundary) {
      const end = boundary.index + boundary[0].length;
      const raw = pending.slice(0, end);
      pending = pending.slice(end);
      const data = payload(raw);
      const choice = data?.choices?.[0];
      const deltas = choice?.delta?.tool_calls;

      if (deltas?.length) {
        toolEvents.push(raw);
        for (const delta of deltas) {
          const current = calls.get(delta.index) ?? { index: delta.index, function: { arguments: '' } };
          current.id = delta.id ?? current.id;
          current.type = delta.type ?? current.type;
          current.function.name = delta.function?.name ?? current.function.name;
          current.function.arguments += delta.function?.arguments ?? '';
          calls.set(delta.index, current);
        }
      } else if (choice?.finish_reason === 'tool_calls' && toolEvents.length) {
        const allCalls = [...calls.values()].sort((a, b) => a.index - b.index);
        if (allCalls.some(call => call.function.name === 'edit')) {
          for (const call of allCalls) {
            if (call.function.name === 'edit') {
              const args = JSON.parse(call.function.arguments) as EditArguments;
              call.function.arguments = JSON.stringify(rewrite(args));
            }
          }
          const first = payload(toolEvents[0]);
          if (!first) throw new Error('Invalid tool call stream');
          first.choices = [{ index: choice.index, delta: { tool_calls: allCalls }, finish_reason: null }];
          yield `data: ${JSON.stringify(first)}\n\n`;
        } else {
          yield* toolEvents;
        }
        yield raw;
        toolEvents = [];
        calls.clear();
      } else if (toolEvents.length) {
        toolEvents.push(raw);
      } else {
        yield raw;
      }
      boundary = /\r?\n\r?\n/.exec(pending);
    }
  }
  if (toolEvents.length) throw new Error('incomplete tool call stream');
  if (pending) yield pending;
}
