import { describe, expect, it, jest } from '@jest/globals';

import { ACCENT_DEFAULT } from '@/shared/vendor/settings-model';
import { TEMPLATES_AFTER, choicesFor, commitField, fieldsFor, harnessesOff, parseFieldInput, savedValue, terminalEngineNow, type SettingsField } from '../model';
import type { GlobalSettingsInfo } from '../types';

const info: GlobalSettingsInfo = {
  values: {
    disabledHarnesses: ['opencode'],
    permissionMode: 'auto',
    worktree: false,
    worktreeName: '',
    chrome: false,
    addDirs: '',
    codexSandbox: 'workspace-write',
    codexApproval: '',
    codexModel: '',
    preLaunchCmd: '',
    terminalTheme: 'switchboard',
    accentColor: '#5b9dff',
    shellProfile: 'auto',
    visibleSessionCount: 5,
    sessionMaxAgeDays: 3,
    terminalEngine: 'hc',
    projectsRoot: '',
    mcpEmulation: false,
    editorPrefs: { minimap: true, stickyScroll: true, whitespace: false, vim: false },
    languageServers: true,
  },
  options: {
    harnesses: [
      { id: 'claude', label: 'Claude Code', enabled: true },
      { id: 'codex', label: 'Codex', enabled: true },
      { id: 'opencode', label: 'OpenCode', enabled: false },
    ],
    shellProfiles: [{ id: 'zsh', name: 'zsh' }],
    terminalEngine: { engine: 'hc', version: '0.6.1', source: 'bundled', path: '/Users/demo/app/herdr-core', session: 'switchboard' },
    templatesDir: '/Users/demo/.switchboard/templates',
  },
};

const field = (key: string): SettingsField => {
  for (const tab of ['application', 'agents', 'editor'] as const) {
    for (const section of fieldsFor(tab)) {
      const found = section.fields.find((f) => f.key === key);
      if (found) return found;
    }
  }
  throw new Error(`no field ${key}`);
};

describe('fieldsFor', () => {
  it('Agents: the desktop\'s sections, in order', () => {
    expect(fieldsFor('agents').map((s) => s.section)).toEqual(['CLI Agents', 'Claude CLI Options', 'Codex CLI Options', 'Session Launch']);
  });

  it('Application: the desktop\'s fields, in order', () => {
    expect(fieldsFor('application').map((s) => s.section)).toEqual(['Application']);
    expect(fieldsFor('application')[0].fields.map((f) => f.label)).toEqual([
      'Terminal Theme', 'Accent Color', 'Shell Profile', 'Max Visible Sessions', 'Session Max Age (days)', 'Terminal Engine', 'Projects Folder', 'IDE Emulation',
    ]);
  });

  it('Application: Project Templates between Projects Folder and IDE Emulation, as on the desktop', () => {
    const rows = fieldsFor('application')[0].fields.flatMap((f) => (f.key === TEMPLATES_AFTER ? [f.label, 'Project Templates'] : [f.label]));
    expect(rows.slice(-3)).toEqual(['Projects Folder', 'Project Templates', 'IDE Emulation']);
  });

  it('Editor: the five switches, one per preference', () => {
    const [editor] = fieldsFor('editor');
    expect(editor.section).toBe('Editor');
    expect(editor.fields.map((f) => [f.key, f.kind, f.label])).toEqual([
      ['editorPrefs.minimap', 'bool', 'Minimap'],
      ['editorPrefs.stickyScroll', 'bool', 'Sticky Scroll'],
      ['editorPrefs.whitespace', 'bool', 'Show Whitespace'],
      ['editorPrefs.vim', 'bool', 'Vim Mode'],
      ['languageServers', 'bool', 'Language Servers'],
    ]);
  });
});

describe('parseFieldInput', () => {
  const count = field('visibleSessionCount');

  it('a number that is empty, not a number, 0 or 101 is refused', () => {
    for (const raw of ['0', '', '   ', 'abc', '101', '2.5']) {
      const res = parseFieldInput(count, raw, info);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('Max Visible Sessions must be a whole number from 1 to 100');
    }
  });

  it('a new number is its patch, as a number', () => {
    expect(parseFieldInput(count, '12', info)).toEqual({ ok: true, patch: { visibleSessionCount: 12 } });
    expect(parseFieldInput(count, ' 12 ', info)).toEqual({ ok: true, patch: { visibleSessionCount: 12 } });
  });

  it('the value already saved writes nothing', () => {
    expect(parseFieldInput(count, '5', info)).toEqual({ ok: true, patch: null });
    expect(parseFieldInput(field('codexModel'), '   ', info)).toEqual({ ok: true, patch: null });
    expect(parseFieldInput(field('worktree'), false, info)).toEqual({ ok: true, patch: null });
    expect(parseFieldInput(field('editorPrefs.minimap'), true, info)).toEqual({ ok: true, patch: null });
  });

  it('a text is saved trimmed', () => {
    expect(parseFieldInput(field('codexModel'), ' gpt-5 ', info)).toEqual({ ok: true, patch: { codexModel: 'gpt-5' } });
  });

  it('a path must be a full one, a Windows one too', () => {
    expect(parseFieldInput(field('projectsRoot'), 'projects', info)).toEqual({ ok: false, error: 'Projects Folder must be a full path, like ~/Code' });
    expect(parseFieldInput(field('projectsRoot'), '~/Code', info)).toEqual({ ok: true, patch: { projectsRoot: '~/Code' } });
    expect(parseFieldInput(field('projectsRoot'), 'C:\\Code', info)).toEqual({ ok: true, patch: { projectsRoot: 'C:\\Code' } });
    expect(parseFieldInput(field('projectsRoot'), '\\\\server\\share', info)).toEqual({ ok: true, patch: { projectsRoot: '\\\\server\\share' } });
  });

  it('an Editor preference is saved under editorPrefs', () => {
    expect(parseFieldInput(field('editorPrefs.vim'), true, info)).toEqual({ ok: true, patch: { editorPrefs: { vim: true } } });
    expect(parseFieldInput(field('languageServers'), false, info)).toEqual({ ok: true, patch: { languageServers: false } });
  });

  it('a choice: Default (none) of Permission Mode is null, Sandbox\'s Default is empty', () => {
    expect(parseFieldInput(field('permissionMode'), '', info)).toEqual({ ok: true, patch: { permissionMode: null } });
    expect(parseFieldInput(field('codexSandbox'), '', info)).toEqual({ ok: true, patch: { codexSandbox: '' } });
    expect(parseFieldInput(field('codexSandbox'), 'workspace-write', info)).toEqual({ ok: true, patch: null });
  });

  it('a shell is one of the computer\'s profiles', () => {
    expect(parseFieldInput(field('shellProfile'), 'zsh', info)).toEqual({ ok: true, patch: { shellProfile: 'zsh' } });
    expect(parseFieldInput(field('shellProfile'), 'fish', info)).toEqual({ ok: false, error: 'Invalid Shell Profile' });
  });

  it('the default accent is saved as null, as the desktop does', () => {
    expect(parseFieldInput(field('accentColor'), ACCENT_DEFAULT, info)).toEqual({ ok: true, patch: { accentColor: null } });
    expect(parseFieldInput(field('accentColor'), '#5b9dff', info)).toEqual({ ok: true, patch: null });
    expect(parseFieldInput(field('accentColor'), '#2FC4B2', info)).toEqual({ ok: true, patch: { accentColor: '#2fc4b2' } });
    const onDefault = { ...info, values: { ...info.values, accentColor: ACCENT_DEFAULT } };
    expect(parseFieldInput(field('accentColor'), ACCENT_DEFAULT, onDefault)).toEqual({ ok: true, patch: null });
  });

  it('CLI Agents: the switched-off CLIs, checked against the computer\'s', () => {
    const clis = field('disabledHarnesses');
    expect(parseFieldInput(clis, ['codex', 'opencode'], info)).toEqual({ ok: true, patch: { disabledHarnesses: ['codex', 'opencode'] } });
    expect(parseFieldInput(clis, ['opencode'], info)).toEqual({ ok: true, patch: null });
    expect(parseFieldInput(clis, ['gemini'], info)).toEqual({ ok: false, error: 'Unknown CLI agent' });
  });
});

describe('the pieces a control shows', () => {
  it('harnessesOff: one switch flipped, the others as shown', () => {
    expect(harnessesOff(info.options.harnesses, ['opencode'], 'codex', false)).toEqual(['codex', 'opencode']);
    expect(harnessesOff(info.options.harnesses, ['opencode'], 'opencode', true)).toEqual([]);
  });

  it('savedValue reads an Editor preference and the accent', () => {
    expect(savedValue(field('editorPrefs.stickyScroll'), info)).toBe(true);
    expect(savedValue(field('accentColor'), info)).toBe('#5b9dff');
    expect(savedValue(field('visibleSessionCount'), info)).toBe(5);
  });

  it('choicesFor: Default (none) as on the desktop, and the computer\'s shells', () => {
    expect(choicesFor(field('permissionMode'), info)[0]).toEqual({ key: '', label: 'Default (none)', value: null });
    expect(choicesFor(field('shellProfile'), info)).toEqual([
      { key: 'auto', label: 'Auto (detect)', value: 'auto' },
      { key: 'zsh', label: 'zsh', value: 'zsh' },
    ]);
  });

  it('terminalEngineNow: the desktop\'s "Now:" line', () => {
    expect(terminalEngineNow(info.options.terminalEngine)).toBe('Now: herdr-core 0.6.1 (the copy inside the app), session "switchboard".');
    expect(terminalEngineNow({ engine: 'hc', version: '0.6.1', source: 'installed', path: '/usr/local/bin/herdr-core', session: 'switchboard' }))
      .toBe('Now: herdr-core 0.6.1 (/usr/local/bin/herdr-core), session "switchboard".');
    expect(terminalEngineNow({ engine: 'inside', reason: 'Turned off in settings' })).toBe('Now: inside Switchboard. Turned off in settings');
    expect(terminalEngineNow({ engine: 'inside' })).toBe('Now: inside Switchboard.');
  });
});

describe('commitField', () => {
  const count = field('visibleSessionCount');

  it('a refused value is not sent, and says why', async () => {
    const save = jest.fn(async (_patch: Record<string, unknown>) => {});
    expect(await commitField(count, 'abc', info, save)).toEqual({ saved: false, error: 'Max Visible Sessions must be a whole number from 1 to 100' });
    expect(save).not.toHaveBeenCalled();
  });

  it('an unchanged value is not sent', async () => {
    const save = jest.fn(async (_patch: Record<string, unknown>) => {});
    expect(await commitField(count, ' 5 ', info, save)).toEqual({ saved: false, error: null });
    expect(save).not.toHaveBeenCalled();
  });

  it('a new value is sent as its patch', async () => {
    const save = jest.fn(async (_patch: Record<string, unknown>) => {});
    expect(await commitField(count, '12', info, save)).toEqual({ saved: true, error: null });
    expect(save).toHaveBeenCalledWith({ visibleSessionCount: 12 });
  });

  it('a value the computer refuses comes back as the error', async () => {
    const save = jest.fn(async (_patch: Record<string, unknown>) => { throw new Error('Projects Folder must be a full path, like ~/Code'); });
    expect(await commitField(field('projectsRoot'), '~/Code', info, save)).toEqual({ saved: false, error: 'Projects Folder must be a full path, like ~/Code' });
  });

  it('without the settings yet, nothing is sent', async () => {
    const save = jest.fn(async (_patch: Record<string, unknown>) => {});
    expect(await commitField(count, '12', undefined, save)).toEqual({ saved: false, error: 'The computer\'s settings are not loaded yet.' });
    expect(save).not.toHaveBeenCalled();
  });
});
