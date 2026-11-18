const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Invoke (request-response)
  getPlans: () => ipcRenderer.invoke('get-plans'),
  readPlan: (filename) => ipcRenderer.invoke('read-plan', filename),
  savePlan: (filePath, content) => ipcRenderer.invoke('save-plan', filePath, content),
  getStats: () => ipcRenderer.invoke('get-stats'),
  refreshStats: () => ipcRenderer.invoke('refresh-stats'),
  getUsage: () => ipcRenderer.invoke('get-usage'),
  getCodexUsage: () => ipcRenderer.invoke('get-codex-usage'),
  getMemories: () => ipcRenderer.invoke('get-memories'),
  readMemory: (filePath) => ipcRenderer.invoke('read-memory', filePath),
  saveMemory: (filePath, content) => ipcRenderer.invoke('save-memory', filePath, content),
  getProjects: (showArchived) => ipcRenderer.invoke('get-projects', showArchived),
  getHarnesses: () => ipcRenderer.invoke('get-harnesses'),
  getCodexModels: () => ipcRenderer.invoke('get-codex-models'),
  getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
  getActiveTerminals: () => ipcRenderer.invoke('get-active-terminals'),
  stopSession: (id) => ipcRenderer.invoke('stop-session', id),
  // RAM task manager: memory per session/task tree, and the ways to end one
  getProcessUsage: () => ipcRenderer.invoke('get-process-usage'),
  getProjectDiskUsage: (force) => ipcRenderer.invoke('get-project-disk-usage', force === true),
  stopOwner: (owner) => ipcRenderer.invoke('stop-owner', owner),
  killOwnedProcess: (owner, pid, force) => ipcRenderer.invoke('kill-owned-process', owner, pid, force),
  forceStopOwner: (owner) => ipcRenderer.invoke('force-stop-owner', owner),
  // The Task Manager and Stats in a window of their own ('task-manager', 'stats'),
  // and whether the window a page runs in stays above the others.
  openToolWindow: (kind) => ipcRenderer.invoke('open-tool-window', kind),
  // A project's tab in a window of its own, and what that window asks the main window to do.
  openProjectWindow: (projectId, tab) => ipcRenderer.invoke('open-project-window', projectId, tab),
  openGitCompareWindow: (projectId, repoPath, hashes, labels, subjects) => ipcRenderer.invoke('open-git-compare-window', projectId, repoPath, hashes, labels, subjects),
  openGitFileWindow: (projectId, repoPath, file) => ipcRenderer.invoke('open-git-file-window', projectId, repoPath, file),
  runInMainWindow: (name, args) => ipcRenderer.invoke('project-window-run', name, args),
  onProjectWindowRun: (callback) => {
    ipcRenderer.on('project-window-run', (_event, name, args) => callback(name, args));
  },
  getWindowOnTop: () => ipcRenderer.invoke('get-window-on-top'),
  setWindowOnTop: (onTop) => ipcRenderer.invoke('set-window-on-top', onTop),
  openInMainWindow: (owner) => ipcRenderer.invoke('task-manager-open-owner', owner),
  onTaskManagerOpenOwner: (callback) => {
    ipcRenderer.on('task-manager-open-owner', (_event, owner) => callback(owner));
  },
  getTerminalEngine: () => ipcRenderer.invoke('get-terminal-engine'),
  toggleStar: (id) => ipcRenderer.invoke('toggle-star', id),
  renameSession: (id, name) => ipcRenderer.invoke('rename-session', id, name),
  archiveSession: (id, archived) => ipcRenderer.invoke('archive-session', id, archived),
  openTerminal: (id, projectPath, isNew, sessionOptions) => ipcRenderer.invoke('open-terminal', id, projectPath, isNew, sessionOptions),
  search: (type, query, titleOnly) => ipcRenderer.invoke('search', type, query, titleOnly),
  searchSessionIds: (query, sessionIds) => ipcRenderer.invoke('search-session-ids', query, sessionIds),
  readSessionJsonl: (sessionId) => ipcRenderer.invoke('read-session-jsonl', sessionId),
  getSessionLastMessage: (sessionId) => ipcRenderer.invoke('get-session-last-message', sessionId),
  readSessionEntries: (sessionId, cursor) => ipcRenderer.invoke('read-session-entries', sessionId, cursor),
  getSessionStates: () => ipcRenderer.invoke('get-session-states'),
  // Remote access (the mobile companion app)
  remoteAccessStatus: () => ipcRenderer.invoke('remote-access-status'),
  setRemoteAccessEnabled: (enabled) => ipcRenderer.invoke('remote-access-set-enabled', enabled),
  setRemoteAccessPort: (port) => ipcRenderer.invoke('remote-access-set-port', port),
  startRemotePairing: () => ipcRenderer.invoke('remote-access-start-pairing'),
  setupRemoteTunnel: (provider, params) => ipcRenderer.invoke('remote-tunnel-setup', provider, params),
  removeRemoteTunnel: (provider, params) => ipcRenderer.invoke('remote-tunnel-remove', provider, params),
  cancelRemotePairing: () => ipcRenderer.invoke('remote-access-cancel-pairing'),
  listRemoteDevices: () => ipcRenderer.invoke('remote-access-list-devices'),
  revokeRemoteDevice: (id) => ipcRenderer.invoke('remote-access-revoke-device', id),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  deleteSetting: (key) => ipcRenderer.invoke('delete-setting', key),
  getEffectiveSettings: (projectPath) => ipcRenderer.invoke('get-effective-settings', projectPath),
  getShellProfiles: () => ipcRenderer.invoke('get-shell-profiles'),

  // Project/worktree tasks
  listProjectTasks: (projectPath) => ipcRenderer.invoke('list-project-tasks', projectPath),
  listTasksForProjects: (projectPaths) => ipcRenderer.invoke('list-tasks-for-projects', projectPaths),
  getTaskRun: (projectPath, label) => ipcRenderer.invoke('get-task-run', projectPath, label),
  startTask: (projectPath, label) => ipcRenderer.invoke('start-task', projectPath, label),
  stopTask: (projectPath, label) => ipcRenderer.invoke('stop-task', projectPath, label),
  stopAllTasks: (projectPath) => ipcRenderer.invoke('stop-all-tasks', projectPath),
  restartTask: (projectPath, label) => ipcRenderer.invoke('restart-task', projectPath, label),

  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  addProject: (projectPath) => ipcRenderer.invoke('add-project', projectPath),
  removeProject: (projectPath) => ipcRenderer.invoke('remove-project', projectPath),

  // Projects (a piece of work with a folder on disk; see projects.js)
  getProjectTree: (showArchived) => ipcRenderer.invoke('get-project-tree', showArchived),
  createProject: (spec) => ipcRenderer.invoke('create-project', spec),
  updateProject: (id, patch) => ipcRenderer.invoke('update-project', id, patch),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),
  attachProjectFolder: (id, spec) => ipcRenderer.invoke('attach-project-folder', id, spec),
  detachProjectFolder: (id, folderPath, opts) => ipcRenderer.invoke('detach-project-folder', id, folderPath, opts),
  setSessionAssignment: (sessionId, projectId, trackId) => ipcRenderer.invoke('set-session-assignment', sessionId, projectId, trackId),
  getProjectsRoot: () => ipcRenderer.invoke('get-projects-root'),
  getProjectGitStatus: (id, opts) => ipcRenderer.invoke('get-project-git-status', id, opts),
  getProjectGitInfo: (id) => ipcRenderer.invoke('get-project-git-info', id),
  getProjectGitDiff: (id, folderPath, filePath, side) => ipcRenderer.invoke('get-project-git-diff', id, folderPath, filePath, side),
  stageProjectGitFiles: (id, folderPath, paths, stage) => ipcRenderer.invoke('stage-project-git-files', id, folderPath, paths, stage),
  stageProjectGitLines: (id, folderPath, filePath, side, diffId, lines) => ipcRenderer.invoke('stage-project-git-lines', id, folderPath, filePath, side, diffId, lines),
  discardProjectGitFiles: (id, folderPath, paths) => ipcRenderer.invoke('discard-project-git-files', id, folderPath, paths),
  ignoreProjectGitPaths: (id, folderPath, paths, untrack) => ipcRenderer.invoke('ignore-project-git-paths', id, folderPath, paths, untrack),
  readProjectGitEditFile: (id, folderPath, filePath) => ipcRenderer.invoke('read-project-git-edit-file', id, folderPath, filePath),
  saveProjectGitEditFile: (id, folderPath, filePath, content, version) => ipcRenderer.invoke('save-project-git-edit-file', id, folderPath, filePath, content, version),
  getFolderGitStatus: (folderPath) => ipcRenderer.invoke('get-folder-git-status', folderPath),

  // Git Graph tab
  getProjectGitGraph: (id, folderPath, opts) => ipcRenderer.invoke('get-project-git-graph', id, folderPath, opts),
  getGitGraphCommitDetail: (id, folderPath, hash) => ipcRenderer.invoke('get-git-graph-commit-detail', id, folderPath, hash),
  getGitGraphCompareDetail: (id, folderPath, fromHash, toHash) => ipcRenderer.invoke('get-git-graph-compare-detail', id, folderPath, fromHash, toHash),
  getGitGraphFileAtRevision: (id, folderPath, rev, filePath) => ipcRenderer.invoke('get-git-graph-file-at-revision', id, folderPath, rev, filePath),
  getGitGraphFileDiffBetween: (id, folderPath, fromRev, toRevOrNull, filePath) => ipcRenderer.invoke('get-git-graph-file-diff-between', id, folderPath, fromRev, toRevOrNull, filePath),
  getGitGraphRepoConfig: (id, folderPath) => ipcRenderer.invoke('get-git-graph-repo-config', id, folderPath),
  setGitGraphRepoConfig: (id, folderPath, patch) => ipcRenderer.invoke('set-git-graph-repo-config', id, folderPath, patch),
  trustGitGraphRepoConfig: (id, folderPath, trusted) => ipcRenderer.invoke('trust-git-graph-repo-config', id, folderPath, trusted),
  exportGitGraphRepoConfig: (id, folderPath) => ipcRenderer.invoke('export-git-graph-repo-config', id, folderPath),
  getGitGraphUserDetails: (id, folderPath) => ipcRenderer.invoke('get-git-graph-user-details', id, folderPath),
  getGitGraphGlobalPreferences: () => ipcRenderer.invoke('get-git-graph-global-preferences'),
  setGitGraphGlobalPreferences: (patch) => ipcRenderer.invoke('set-git-graph-global-preferences', patch),
  getGitGraphRemotes: (id, folderPath) => ipcRenderer.invoke('get-git-graph-remotes', id, folderPath),
  getGitGraphTagDetails: (id, folderPath, tagName) => ipcRenderer.invoke('get-git-graph-tag-details', id, folderPath, tagName),
  getGitGraphAvatarUrl: (id, folderPath, email) => ipcRenderer.invoke('get-git-graph-avatar-url', id, folderPath, email),
  clearGitGraphAvatarCache: () => ipcRenderer.invoke('clear-git-graph-avatar-cache'),
  runGitGraphAction: (id, folderPath, actionId, params) => ipcRenderer.invoke('run-git-graph-action', id, folderPath, actionId, params),
  cancelGitGraphAction: (id, folderPath, actionId) => ipcRenderer.invoke('cancel-git-graph-action', id, folderPath, actionId),
  saveGitGraphArchive: (id, folderPath, opts) => ipcRenderer.invoke('save-git-graph-archive', id, folderPath, opts),
  confirmGitGraphAvatarsGitLabHost: (id, folderPath, host) => ipcRenderer.invoke('confirm-git-graph-avatars-gitlab-host', id, folderPath, host),
  onGitGraphRepoChanged: (callback) => {
    ipcRenderer.on('git-graph-repo-changed', (_event, folderPath, info) => callback(folderPath, info));
  },
  onGitGraphActionProgress: (callback) => {
    ipcRenderer.on('git-graph-action-progress', (_event, payload) => callback(payload));
  },
  listEnvFiles: (folderPath) => ipcRenderer.invoke('list-env-files', folderPath),
  saveProjectBrief: (id, content) => ipcRenderer.invoke('save-project-brief', id, content),
  createProjectFile: (id, name, content) => ipcRenderer.invoke('create-project-file', id, name, content),
  addProjectFiles: (id, sourcePaths) => ipcRenderer.invoke('add-project-files', id, sourcePaths),
  listRecentProjectFiles: (id) => ipcRenderer.invoke('list-recent-project-files', id),
  getProjectPlan: (id) => ipcRenderer.invoke('get-project-plan', id),
  setPlanItem: (id, kind, line, done) => ipcRenderer.invoke('set-plan-item', id, kind, line, done),
  appendPlanItem: (id, kind, text) => ipcRenderer.invoke('append-plan-item', id, kind, text),
  editPlanItem: (id, kind, line, text) => ipcRenderer.invoke('edit-plan-item', id, kind, line, text),
  adoptPlan: (id, filename, opts) => ipcRenderer.invoke('adopt-plan', id, filename, opts),
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  // Worktrees tab (worktrees.js)
  getProjectWorktrees: (id) => ipcRenderer.invoke('get-project-worktrees', id),
  getWorktreeSettings: (id) => ipcRenderer.invoke('get-worktree-settings', id),
  setWorktreeSettings: (id, patch) => ipcRenderer.invoke('set-worktree-settings', id, patch),
  listWorktreeBranches: (id, repoPath) => ipcRenderer.invoke('list-worktree-branches', id, repoPath),
  suggestWorktreePath: (id, repoPath, ref) => ipcRenderer.invoke('suggest-worktree-path', id, repoPath, ref),
  createWorktree: (id, spec) => ipcRenderer.invoke('worktree-create', id, spec),
  runWorktreePostCreate: (id, worktreePath) => ipcRenderer.invoke('worktree-run-post-create', id, worktreePath),
  removeWorktree: (id, worktreePath, opts) => ipcRenderer.invoke('worktree-remove', id, worktreePath, opts),
  deleteWorktreeBranch: (id, repoPath, branch, opts) => ipcRenderer.invoke('worktree-delete-branch', id, repoPath, branch, opts),
  getMergedWorktrees: (id, repoPath, base) => ipcRenderer.invoke('worktree-merged', id, repoPath, base),
  lockWorktree: (id, worktreePath, reason) => ipcRenderer.invoke('worktree-lock', id, worktreePath, reason),
  unlockWorktree: (id, worktreePath) => ipcRenderer.invoke('worktree-unlock', id, worktreePath),
  moveWorktree: (id, worktreePath, newPath) => ipcRenderer.invoke('worktree-move', id, worktreePath, newPath),
  repairWorktrees: (id, repoPath, paths) => ipcRenderer.invoke('worktree-repair', id, repoPath, paths),
  previewWorktreePrune: (id, repoPath) => ipcRenderer.invoke('worktree-prune-preview', id, repoPath),
  pruneWorktrees: (id, repoPath, opts) => ipcRenderer.invoke('worktree-prune', id, repoPath, opts),
  attachWorktreeToProject: (id, worktreePath) => ipcRenderer.invoke('worktree-attach', id, worktreePath),
  detachWorktreeFromProject: (id, worktreePath) => ipcRenderer.invoke('worktree-detach', id, worktreePath),
  onProjectPlanChanged: (callback) => {
    ipcRenderer.on('project-plan-changed', (_event, projectId) => callback(projectId));
  },
  listSchedules: () => ipcRenderer.invoke('list-schedules'),
  createSchedule: (spec) => ipcRenderer.invoke('create-schedule', spec),
  updateSchedule: (id, patch) => ipcRenderer.invoke('update-schedule', id, patch),
  deleteSchedule: (id) => ipcRenderer.invoke('delete-schedule', id),
  resolveScheduleLaunch: (id) => ipcRenderer.invoke('resolve-schedule-launch', id),
  getScheduleContext: (spec) => ipcRenderer.invoke('get-schedule-context', spec),
  onScheduleDue: (callback) => {
    ipcRenderer.on('schedule-due', (_event, launch) => callback(launch));
  },
  createTrack: (projectId, spec) => ipcRenderer.invoke('create-track', projectId, spec),
  updateTrack: (id, patch) => ipcRenderer.invoke('update-track', id, patch),
  deleteTrack: (id, options) => ipcRenderer.invoke('delete-track', id, options),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard-write-text', text),

  // Send (fire-and-forget)
  sendInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal-resize', id, cols, rows),
  closeTerminal: (id) => ipcRenderer.send('close-terminal', id),
  sendTaskInput: (projectPath, label, data) => ipcRenderer.send('task-input', projectPath, label, data),
  resizeTask: (projectPath, label, cols, rows) => ipcRenderer.send('task-resize', projectPath, label, cols, rows),

  // Listeners (main → renderer)
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal-data', (_event, sessionId, data) => callback(sessionId, data));
  },
  onSessionDetected: (callback) => {
    ipcRenderer.on('session-detected', (_event, tempId, realId) => callback(tempId, realId));
  },
  onHarnessesChanged: (callback) => {
    ipcRenderer.on('harnesses-changed', () => callback());
  },
  onProcessExited: (callback) => {
    ipcRenderer.on('process-exited', (_event, sessionId, exitCode, signal, userStopped) =>
      callback(sessionId, exitCode, signal, userStopped));
  },
  onTerminalNotification: (callback) => {
    ipcRenderer.on('terminal-notification', (_event, sessionId, message, kind) => callback(sessionId, message, kind));
  },
  onCliBusyState: (callback) => {
    ipcRenderer.on('cli-busy-state', (_event, sessionId, busy) => callback(sessionId, busy));
  },
  onSessionForked: (callback) => {
    ipcRenderer.on('session-forked', (_event, oldId, newId) => callback(oldId, newId));
  },
  onProjectsChanged: (callback) => {
    ipcRenderer.on('projects-changed', (_e, reason) => callback(reason || 'project'));
  },
  onRemoteAccessStatus: (callback) => {
    ipcRenderer.on('remote-access-status', (_event, status) => callback(status));
  },
  // Seen elsewhere, and marks shared with paired phones (session-notices.js)
  onWindowVisibility: (callback) => {
    ipcRenderer.on('window-visibility', (_event, visible) => callback(visible));
  },
  onRemoteViewing: (callback) => {
    ipcRenderer.on('remote-viewing', (_event, sessionIds) => callback(sessionIds));
  },
  onRemoteMarkRead: (callback) => {
    ipcRenderer.on('remote-mark-read', (_event, sessionId, read) => callback(sessionId, read));
  },
  publishSessionNotices: (notices) => ipcRenderer.send('session-notices', notices),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_event, text, type) => callback(text, type));
  },
  onTaskOutput: (callback) => {
    ipcRenderer.on('task-output', (_event, projectPath, label, data) => callback(projectPath, label, data));
  },
  onTaskStateChanged: (callback) => {
    ipcRenderer.on('task-state-changed', (_event, run) => callback(run));
  },
  onProjectTasksChanged: (callback) => {
    ipcRenderer.on('project-tasks-changed', (_event, projectPath) => callback(projectPath));
  },

  // File drag-and-drop
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Platform
  platform: process.platform,

  // App version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  onUpdaterEvent: (callback) => {
    ipcRenderer.on('updater-event', (_event, type, data) => callback(type, data));
  },

  // MCP bridge (main → renderer)
  onMcpOpenDiff: (callback) => {
    ipcRenderer.on('mcp-open-diff', (_event, sessionId, diffId, data) => callback(sessionId, diffId, data));
  },
  onMcpOpenFile: (callback) => {
    ipcRenderer.on('mcp-open-file', (_event, sessionId, data) => callback(sessionId, data));
  },
  onMcpCloseAllDiffs: (callback) => {
    ipcRenderer.on('mcp-close-all-diffs', (_event, sessionId) => callback(sessionId));
  },
  onMcpCloseTab: (callback) => {
    ipcRenderer.on('mcp-close-tab', (_event, sessionId, diffId) => callback(sessionId, diffId));
  },
  onMcpDiffResolved: (callback) => {
    ipcRenderer.on('mcp-diff-resolved', (_event, sessionId, diffId, action) => callback(sessionId, diffId, action));
  },

  // MCP bridge (renderer → main)
  // Resolves whether this answer was the one taken (the first answer wins).
  mcpDiffResponse: (sessionId, diffId, action, editedContent) =>
    ipcRenderer.invoke('mcp-diff-response', sessionId, diffId, action, editedContent),
  readFileForPanel: (filePath) => ipcRenderer.invoke('read-file-for-panel', filePath),
  openFileExternally: (filePath, projectRoot) => ipcRenderer.invoke('open-file-externally', filePath, projectRoot),
  shareFile: (filePath) => ipcRenderer.invoke('share-file', filePath),
  resolveTerminalFiles: (references, context) => ipcRenderer.invoke('resolve-terminal-files', references, context),
  listProjectDirectory: (projectPath, relativePath) => ipcRenderer.invoke('list-project-directory', projectPath, relativePath),
  readProjectFile: (projectPath, relativePath) => ipcRenderer.invoke('read-project-file', projectPath, relativePath),
  searchProjectFiles: (root, options) => ipcRenderer.invoke('search-project-files', root, options),
  replaceInProjectFiles: (root, options) => ipcRenderer.invoke('replace-in-project-files', root, options),
  manageProjectEntry: (projectPath, relativePath, action, newName) => ipcRenderer.invoke('manage-project-entry', projectPath, relativePath, action, newName),
  trashProjectEntries: (projectPath, relativePaths) => ipcRenderer.invoke('trash-project-entries', projectPath, relativePaths),
  createProjectEntry: (projectPath, folderRelative, name, kind) => ipcRenderer.invoke('create-project-entry', projectPath, folderRelative, name, kind),
  duplicateProjectEntry: (projectPath, relativePath) => ipcRenderer.invoke('duplicate-project-entry', projectPath, relativePath),
  pasteProjectEntry: (sourcePath, sourceRelative, targetPath, targetRelative, mode) => ipcRenderer.invoke('paste-project-entry', sourcePath, sourceRelative, targetPath, targetRelative, mode),
  getFileTimeline: (projectPath, relativePath) => ipcRenderer.invoke('get-file-timeline', projectPath, relativePath),
  getFileTimelineDiff: (projectPath, relativePath, hash, repoPath, oldPath) => ipcRenderer.invoke('get-file-timeline-diff', projectPath, relativePath, hash, repoPath, oldPath),
  getFileAtCommit: (projectPath, relativePath, hash, repoPath) => ipcRenderer.invoke('get-file-at-commit', projectPath, relativePath, hash, repoPath),
  openFileWithApp: (filePath, projectRoot, appPath) => ipcRenderer.invoke('open-file-with-app', filePath, projectRoot, appPath),
  saveFileForPanel: (filePath, content) => ipcRenderer.invoke('save-file-for-panel', filePath, content),
  watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
  unwatchFile: (filePath) => ipcRenderer.invoke('unwatch-file', filePath),
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (_event, filePath) => callback(filePath));
  },
});
