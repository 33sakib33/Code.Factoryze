/** Small DOM helpers for Factoryze views. Text is always set with textContent, never parsed as HTML. */
type Child = Node | string | null | undefined | false;
type Props = { class?: string; text?: string; title?: string; type?: string; role?: string; hidden?: boolean; id?: string;
  aria?: Record<string, string>; data?: Record<string, string>; on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>> };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.id) node.id = props.id;
  if (props.type && 'type' in node) (node as HTMLButtonElement).type = props.type as HTMLButtonElement['type'];
  if (props.role) node.setAttribute('role', props.role);
  if (props.hidden) node.hidden = true;
  for (const [key, value] of Object.entries(props.aria ?? {})) node.setAttribute(`aria-${key}`, value);
  for (const [key, value] of Object.entries(props.data ?? {})) node.dataset[key] = value;
  for (const [event, handler] of Object.entries(props.on ?? {})) node.addEventListener(event, handler as EventListener);
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/** A codicon glyph from Theia's bundled icon font. */
export const icon = (name: string, extra = ''): HTMLSpanElement => el('span', { class: `codicon codicon-${name} fz-icon ${extra}`.trim(), aria: { hidden: 'true' } });

export function button(label: string, onClick: () => void, options: { kind?: 'primary' | 'quiet' | 'link'; icon?: string; small?: boolean; title?: string; aria?: string } = {}): HTMLButtonElement {
  const node = el('button', { type: 'button', class: ['fz-btn', options.kind ? `fz-${options.kind}` : '', options.small ? 'fz-sm' : ''].filter(Boolean).join(' '),
    title: options.title, on: { click: () => onClick() } }, options.icon ? icon(options.icon) : null, label);
  if (options.aria) node.setAttribute('aria-label', options.aria);
  return node;
}

/** Budget meter: one segment per prompt, scaled to the limit, then the unused track. */
export function meter(segments: readonly { tokens: number; label: string; active?: boolean; warn?: boolean }[], limit: number, small = false): HTMLDivElement {
  const bar = el('div', { class: `fz-meter${small ? ' fz-meter-small' : ''}`, role: 'img' });
  const used = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  bar.setAttribute('aria-label', `${Math.round(used).toLocaleString('en-US')} of ${Math.round(limit).toLocaleString('en-US')} tokens used`);
  for (const segment of segments) {
    if (segment.tokens <= 0 && !segment.active) continue;
    const block = el('span', { class: `fz-seg${segment.active ? ' fz-now' : ''}${segment.warn ? ' fz-unknown' : ''}` });
    block.style.width = `${limit > 0 ? Math.min(100, segment.tokens / limit * 100) : 0}%`;
    block.dataset.tip = `${segment.label}${segment.active ? ' so far:' : ' used'} ${Math.round(segment.tokens).toLocaleString('en-US')} tokens`;
    if (!small) block.tabIndex = 0;
    bar.append(block);
  }
  bar.append(el('span', { class: 'fz-seg fz-rest' }));
  return bar;
}

export type ModalHandle = { dialog: HTMLDialogElement; body: HTMLDivElement; foot: HTMLDivElement; close(): void; closed: Promise<void> };

/** Native modal dialog: focus is trapped, Escape closes, and it removes itself when closed. */
export function modal(title: string, options: { closable?: boolean; wide?: boolean } = {}): ModalHandle {
  const heading = el('h2', { text: title, id: `fz-dialog-${Math.random().toString(36).slice(2)}` });
  const body = el('div', { class: 'fz-dialog-body' });
  const foot = el('div', { class: 'fz-dialog-foot' });
  const dialog = el('dialog', { class: `fz-dialog${options.wide ? ' fz-wide' : ''}` });
  dialog.setAttribute('aria-labelledby', heading.id);
  const head = el('div', { class: 'fz-dialog-head' }, heading);
  if (options.closable !== false) head.append(el('button', { type: 'button', class: 'fz-icon-btn', aria: { label: 'Close' }, on: { click: () => dialog.close() } }, icon('close')));
  dialog.append(head, body, foot);
  dialog.tabIndex = -1;
  document.body.append(dialog);
  const closed = new Promise<void>(resolve => dialog.addEventListener('close', () => { dialog.remove(); resolve(); }, { once: true }));
  dialog.showModal();
  dialog.focus();
  return { dialog, body, foot, close: () => dialog.close(), closed };
}

export const errorText = (error: unknown): string => error instanceof Error ? error.message.replace(/^Request '[^']+' failed\s*/, '') : String(error);
