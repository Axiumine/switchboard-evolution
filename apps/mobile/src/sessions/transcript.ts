// A session's conversation as chat items, from the transcript entries the
// desktop returns (read-session-entries: Claude's format, Codex mapped onto it
// by the desktop). Built up as new entries arrive, the way the desktop's
// message viewer (public/jsonl-viewer.js) pairs each tool call with its result.

/** An image Claude received or produced, as a data URI an Image can show. */
export type ChatImage = { uri: string; mediaType: string };

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images?: ChatImage[]; time?: string }
  | { kind: 'assistant'; id: string; text: string; images?: ChatImage[]; time?: string }
  | { kind: 'command'; id: string; text: string; output?: string; time?: string }
  /** Claude's thinking (only with `new Transcript({ thinking: true })`). */
  | { kind: 'thinking'; id: string; text: string; time?: string }
  | {
    kind: 'tool'; id: string; name: string; summary: string;
    /** What the tool was called with (an Edit's strings, a command), for the details. */
    input?: unknown;
    result?: string; error?: boolean;
    /** How many lines the whole result has (it is cut short), for "Read 120 lines". */
    lines?: number;
    /** Screenshots and other images in the result. */
    images?: ChatImage[];
    time?: string;
  };

const MAX_RESULT = 2000;

/** Terminal colour and cursor codes, which a CLI leaves in command output. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

/** Text without the wrappers Claude Code adds for itself. */
export function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>/g, '')
    .trim();
}

function blocksOf(content: any): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

/** An image block's picture, when it carries its bytes (base64); other sources have nothing to show. */
function imageOf(block: any): ChatImage | null {
  const source = block?.source;
  if (block?.type !== 'image' || source?.type !== 'base64' || typeof source.data !== 'string' || !source.data) return null;
  const mediaType = typeof source.media_type === 'string' && /^image\/[\w.+-]+$/.test(source.media_type) ? source.media_type : 'image/jpeg';
  return { uri: `data:${mediaType};base64,${source.data}`, mediaType };
}

function imagesOf(content: any): ChatImage[] {
  return blocksOf(content).flatMap((block) => imageOf(block) ?? []);
}

function resultText(content: any): { text: string; lines: number } {
  const text = typeof content === 'string'
    ? content
    : blocksOf(content).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  const clean = stripAnsi(text);
  const lines = clean.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd().split('\n').length;
  return { text: clean.length > MAX_RESULT ? `${clean.slice(0, MAX_RESULT)}…` : clean, lines };
}

/** One line saying what a tool call does. */
export function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.prompt;
  const text = typeof pick === 'string'
    ? pick
    : String(Object.values(input).find((v) => typeof v === 'string') ?? '');
  const line = text.split('\n')[0];
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

/** A slash command as Claude Code records it: <command-name>/x</command-name><command-args>…</command-args>. */
function slashCommand(text: string): string | null {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  if (!name) return null;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

export class Transcript {
  items: ChatItem[] = [];
  private toolIndex = new Map<string, number>();

  /** `thinking`: keep Claude's thinking as items of their own (the chat shows them folded). */
  constructor(private options: { thinking?: boolean } = {}) {}

  /** Add the entries read since the last call; returns the items, as a new array if anything changed. */
  add(entries: any[]): ChatItem[] {
    let changed = false;
    for (const entry of entries) {
      if (this.addEntry(entry)) changed = true;
    }
    if (changed) this.items = [...this.items];
    return this.items;
  }

  private push(item: ChatItem) {
    this.items.push(item);
    return true;
  }

  private addEntry(entry: any): boolean {
    if (!entry || (entry.type !== 'user' && entry.type !== 'assistant') || entry.isMeta) return false;
    const time = entry.timestamp;
    const baseId = entry.uuid || `${this.items.length}`;
    const blocks = blocksOf(entry.message?.content);
    // A message's images go with its text, shown above it in the bubble.
    let images: ChatImage[] | null = null;
    const firstImage = blocks.findIndex((block) => imageOf(block));
    if (firstImage >= 0) images = imagesOf(blocks);
    let changed = false;
    blocks.forEach((block, i) => {
      const id = `${baseId}:${i}`;
      if (block?.type === 'text' && typeof block.text === 'string') {
        if (entry.type === 'user') {
          const command = slashCommand(block.text);
          if (command) { changed = this.push({ kind: 'command', id, text: command, time }) || changed; return; }
          const output = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(block.text)?.[1];
          if (output !== undefined) {
            const last = this.items.at(-1);
            // A new item, not a change to the old one, so the list sees it.
            if (last?.kind === 'command' && last.output === undefined) { this.items[this.items.length - 1] = { ...last, output: stripAnsi(output).trim() }; changed = true; }
            return;
          }
        }
        const text = cleanText(block.text);
        if (!text) return;
        changed = this.push({ kind: entry.type, id, text, ...(images ? { images } : {}), time }) || changed;
        images = null;
      } else if (block?.type === 'thinking' && this.options.thinking) {
        const text = typeof block.thinking === 'string' ? block.thinking.trim() : '';
        if (text) changed = this.push({ kind: 'thinking', id, text, time }) || changed;
      } else if (block?.type === 'tool_use') {
        this.toolIndex.set(block.id, this.items.length);
        changed = this.push({ kind: 'tool', id: block.id || id, name: block.name || 'Tool', summary: toolSummary(block.name, block.input), input: block.input, time }) || changed;
      } else if (block?.type === 'tool_result') {
        const index = this.toolIndex.get(block.tool_use_id);
        if (index === undefined) return;
        const tool = this.items[index] as Extract<ChatItem, { kind: 'tool' }>;
        const shots = imagesOf(block.content);
        const { text, lines } = resultText(block.content);
        this.items[index] = { ...tool, result: text, lines, error: !!block.is_error, ...(shots.length ? { images: shots } : {}) };
        changed = true;
      }
    });
    // Images with no text to go with.
    if (images) changed = this.push({ kind: entry.type, id: `${baseId}:${firstImage}`, text: '', images, time }) || changed;
    return changed;
  }
}
