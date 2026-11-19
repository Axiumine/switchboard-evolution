import { File, Paths } from 'expo-file-system';

// Choices the phone keeps from one run to the next: the width of the sidebar
// beside the workspace, the Sessions tab's combos. A small JSON file of the
// app's own, read once at start; the secure store is for the keys.

const NAME = 'prefs.json';

export type Prefs = Record<string, unknown>;

let cache: Prefs | null = null;
let writing: Promise<void> = Promise.resolve();

/** The prefs in a file's text; none when it is not a JSON object. */
export function parsePrefs(text: string): Prefs {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The prefs saved so far (read from the file the first time). */
export function loadPrefs(): Prefs {
  if (cache) return cache;
  try {
    const file = new File(Paths.document, NAME);
    cache = file.exists ? parsePrefs(file.textSync()) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Keeps `patch` over what is saved; the writes go one after the other. */
export function savePrefs(patch: Prefs): void {
  cache = { ...loadPrefs(), ...patch };
  const text = JSON.stringify(cache);
  writing = writing
    .then(() => {
      const file = new File(Paths.document, NAME);
      if (!file.exists) file.create();
      return file.write(text);
    })
    .catch(() => {});
}
