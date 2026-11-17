export type AgentConfigurationStatus = 'checking' | 'ready' | 'missing' | 'unavailable';

/** Only readiness reaches the pane; keys stay in the backend credential store. */
export class AgentConfiguration {
  state: AgentConfigurationStatus = 'checking';
  private generation = 0;
  private latest?: Promise<boolean>;
  private readonly load: () => Promise<boolean>;
  private readonly changed: () => void;

  constructor(load: () => Promise<boolean>, changed: () => void = () => {}) {
    this.load = load; this.changed = changed;
  }

  refresh(): Promise<boolean> {
    const generation = ++this.generation;
    this.state = 'checking'; this.changed();
    const request = (async () => {
      let state: AgentConfigurationStatus;
      try { state = await this.load() ? 'ready' : 'missing'; }
      catch { state = 'unavailable'; }
      if (generation !== this.generation) return this.latest!;
      this.state = state; this.changed();
      return state === 'ready';
    })();
    this.latest = request;
    return request;
  }
}
