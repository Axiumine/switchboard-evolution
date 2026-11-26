import { describe, expect, it } from '@jest/globals';

import { envNeedsIgnore, envRows, type EnvFileEntry } from '../model';
import { ENV_FILE_NAME, ENV_FILE_TEMPLATE, ENV_RULES, loadOrderText } from '@/shared/vendor/env-files-model';

const project = {
  root: '/home/dev/Switchboard/demo',
  folders: [
    { path: '/home/dev/code/app', mode: 'in-place' as const },
    { path: '/home/dev/Switchboard/demo/repos/api', mode: 'worktree' as const, branch: 'demo' },
  ],
};

const entries: EnvFileEntry[] = [
  { path: '/home/dev/Switchboard/demo/repos/api', kind: 'worktree', filePath: '/home/dev/Switchboard/demo/repos/api/local.env.sh', exists: true, gitIgnored: false },
  { path: '/home/dev/Switchboard/demo', kind: 'project', filePath: '/home/dev/Switchboard/demo/local.env.sh', exists: true, gitIgnored: null },
  { path: '/home/dev/code/app', kind: 'folder', filePath: '/home/dev/code/app/local.env.sh', exists: false, gitIgnored: false },
];

describe('envRows', () => {
  it('lists the project folder, then the folders in the project\'s order, with the Files tab\'s labels', () => {
    expect(envRows(project, entries).map((r) => [r.label, r.kind, r.exists])).toEqual([
      ['Project', 'project', true],
      ['app', 'folder', false],
      ['api · demo', 'worktree', true],
    ]);
  });

  it('shows only what the computer listed, and nothing before it answers', () => {
    expect(envRows(project, entries.slice(1, 2)).map((r) => r.label)).toEqual(['Project']);
    expect(envRows(project, undefined)).toEqual([]);
  });
});

describe('envNeedsIgnore', () => {
  it('warns only for a file that exists and that Git does not ignore', () => {
    expect(envNeedsIgnore({ exists: true, gitIgnored: false })).toBe(true);
    expect(envNeedsIgnore({ exists: true, gitIgnored: true })).toBe(false);
    expect(envNeedsIgnore({ exists: true, gitIgnored: null })).toBe(false);
    expect(envNeedsIgnore({ exists: false, gitIgnored: false })).toBe(false);
  });
});

describe('the shared words', () => {
  it('names the file, starts it with the shebang, and says what a session loads', () => {
    expect(ENV_FILE_NAME).toBe('local.env.sh');
    expect(ENV_FILE_TEMPLATE.split('\n')[0]).toBe('#!/bin/bash');
    expect(ENV_RULES.length).toBeGreaterThan(2);
    expect(loadOrderText('project')).toBe('Sessions started here load only this file.');
    expect(loadOrderText('folder')).toMatch(/project's local\.env\.sh first, then this one/);
  });
});
