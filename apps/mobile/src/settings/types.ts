import type { EditorPrefs } from '@/shared/vendor/settings-model';

// What the computer's get-global-settings answers (main.js, through
// remote-settings.js): the values in force of every setting of the shared
// catalog, and what the phone needs to show their fields.

/** The value in force of each setting (settings-model.js, effectiveGlobalValues). */
export interface GlobalSettingsValues {
  disabledHarnesses: string[];
  permissionMode: string | null;
  worktree: boolean;
  worktreeName: string;
  chrome: boolean;
  addDirs: string;
  codexSandbox: string;
  codexApproval: string;
  codexModel: string;
  preLaunchCmd: string;
  terminalTheme: string;
  /** Always '#rrggbb': the default accent when none was chosen. */
  accentColor: string;
  shellProfile: string;
  visibleSessionCount: number;
  sessionMaxAgeDays: number;
  terminalEngine: 'hc' | 'inside';
  projectsRoot: string;
  mcpEmulation: boolean;
  editorPrefs: EditorPrefs;
  languageServers: boolean;
}

/** A CLI the computer can start a session with. */
export interface HarnessOption { id: string; label: string; enabled: boolean }

export interface ShellProfileOption { id: string; name: string }

/** Which engine runs the computer's sessions right now (main.js, terminalEngineStatus). */
export interface TerminalEngineStatus {
  engine: 'hc' | 'inside';
  version?: string;
  /** 'bundled': the copy inside the app. */
  source?: string;
  path?: string;
  session?: string;
  /** Why sessions run inside the app. */
  reason?: string;
}

export interface GlobalSettingsInfo {
  values: GlobalSettingsValues;
  options: {
    harnesses: HarnessOption[];
    shellProfiles: ShellProfileOption[];
    terminalEngine: TerminalEngineStatus;
    /** The folder of the project templates; null when the computer has none. */
    templatesDir: string | null;
  };
}
