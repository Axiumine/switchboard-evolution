import { describe, expect, it } from '@jest/globals';

import { appendMention, chatMention, filesRoots, foldersToList, pasteTarget, remapExpanded, treeRows, type FileEntry } from '../model';

const entry = (relativePath: string, type: FileEntry['type'] = 'file'): FileEntry => ({
  name: relativePath.split('/').pop()!, relativePath, type, size: 1, viewable: type === 'file', previewType: type === 'file' ? 'text' : null,
});

describe('files roots', () => {
  it('lists the project folder first, then each attached folder once', () => {
    const roots = filesRoots({
      root: '/work/demo',
      folders: [
        { path: '/code/app', mode: 'in-place', branch: 'main' },
        { path: '/code/app.worktrees/feature', mode: 'worktree', branch: 'feature' },
        { path: '/code/app', mode: 'in-place' },
      ],
    });
    expect(roots).toEqual([
      { path: '/work/demo', label: 'Project', kind: 'project' },
      { path: '/code/app', label: 'app · main', kind: 'folder' },
      { path: '/code/app.worktrees/feature', label: 'feature', kind: 'worktree' },
    ]);
  });
});

describe('tree rows', () => {
  it('shows open folders under their parents and hides .git', () => {
    const listings = {
      '': [entry('.git', 'directory'), entry('src', 'directory'), entry('docs', 'directory'), entry('README.md')],
      src: [entry('src/lib', 'directory'), entry('src/a.ts')],
      'src/lib': [entry('src/lib/b.ts')],
    };
    const rows = treeRows(listings, new Set(['src', 'src/lib', 'docs']));
    expect(rows.map((r) => `${r.depth}:${r.entry.relativePath}`)).toEqual(['0:src', '1:src/lib', '2:src/lib/b.ts', '1:src/a.ts', '0:docs', '0:README.md']);
  });

  it('lists only folders whose parents are open', () => {
    expect(foldersToList(new Set(['src/lib', 'src', 'docs/old']))).toEqual(['', 'src', 'src/lib']);
  });
});

describe('chat mentions', () => {
  it('mentions a file for Claude relative to the session folder, quoted when it has spaces', () => {
    expect(chatMention('claude', '/code/app', '/code/app/src/a.ts')).toBe('@src/a.ts ');
    expect(chatMention('claude', '/work/demo', '/code/app/src/a.ts')).toBe('@/code/app/src/a.ts ');
    expect(chatMention(null, '/code/app', '/code/app/my notes.md')).toBe('@"my notes.md" ');
  });

  it('types the path for Codex, shell-quoted when needed', () => {
    expect(chatMention('codex', '/code/app', '/code/app/src/a.ts')).toBe('src/a.ts ');
    expect(chatMention('codex', '/code/app', "/code/app/it's here.md")).toBe("'it'\\''s here.md' ");
  });

  it('adds a mention after what is already written', () => {
    expect(appendMention('', '@a.ts ')).toBe('@a.ts ');
    expect(appendMention('Look at', '@a.ts ')).toBe('Look at @a.ts ');
    expect(appendMention('Look at ', '@a.ts ')).toBe('Look at @a.ts ');
  });
});

describe('explorer actions', () => {
  it('pastes into a folder, next to a file, or into the root', () => {
    expect(pasteTarget(entry('src', 'directory'))).toBe('src');
    expect(pasteTarget(entry('src/a.ts'))).toBe('src');
    expect(pasteTarget(entry('a.ts'))).toBe('');
    expect(pasteTarget(null)).toBe('');
  });

  it('keeps open folders open under their new name and forgets deleted ones', () => {
    expect(remapExpanded(['src', 'src/lib', 'srcs', 'docs'], 'src', 'source')).toEqual(['source', 'source/lib', 'srcs', 'docs']);
    expect(remapExpanded(['src', 'src/lib', 'docs'], 'src', null)).toEqual(['docs']);
  });
});
