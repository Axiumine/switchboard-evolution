import { create } from 'zustand';

import { loadPrefs, savePrefs } from '@/store/prefs';

// The text size of the file editor (and of Markdown shown formatted), one for
// every editor, kept between runs. In px, as the editor page takes it.

export const FONT_MIN = 9;
export const FONT_MAX = 24;
/** The size the editor had before it could change: 12 px. */
export const FONT_DEFAULT = 12;

/** A size the editor can show: a whole number of px between the smallest and the largest. */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return FONT_DEFAULT;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)));
}

/** `style` with its sizes (text, line height, margins) multiplied by `factor`; what has none is as it was. */
export function scaleTextStyles<T extends Record<string, Record<string, any>>>(styles: T, factor: number): T {
  const scaled: Record<string, Record<string, any>> = {};
  for (const [name, style] of Object.entries(styles)) {
    const next = { ...style };
    for (const key of ['fontSize', 'lineHeight', 'marginTop', 'marginBottom'] as const) {
      if (typeof next[key] === 'number') next[key] = Math.round(next[key] * factor * 10) / 10;
    }
    scaled[name] = next;
  }
  return scaled as T;
}

const saved = loadPrefs().editorFontSize;

export const useEditorFont = create<{ size: number; bigger(): void; smaller(): void }>((set, get) => {
  const change = (by: number) => {
    const size = clampFontSize(get().size + by);
    if (size === get().size) return;
    set({ size });
    savePrefs({ editorFontSize: size });
  };
  return {
    size: typeof saved === 'number' ? clampFontSize(saved) : FONT_DEFAULT,
    bigger: () => change(1),
    smaller: () => change(-1),
  };
});
