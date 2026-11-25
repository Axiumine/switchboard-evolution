// lsp/servers.js — the language servers the editor can use, as data.
//
// The app never downloads a server: it starts one the user installed (found
// by lsp/locate.js), for the files of a project folder, when that project has
// it on (lsp/project-servers.js). Each entry: the languages it serves (the
// LSP languageId, the file extensions and names that map to it), the
// commands to try in order (the first one installed wins), the files that
// mark a workspace's root (shown in Settings), how to install it, whether it
// runs the project's own code when it starts (build scripts, Gradle, MSBuild…)
// and how heavy it is. `settings` answers the server's workspace/configuration
// requests; `initializationOptions` goes with initialize; `timeout` is how
// long the editor waits for an answer (ms).
//
// Sources: nvim-lspconfig's lsp/*.lua, each server's README, the Stack
// Overflow Developer Survey 2025 for which languages are used most.

const path = require('path');
const crypto = require('crypto');

/** A short stable name for a folder, for a server that wants a data directory per project. */
function folderKey(root) {
  return crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
}

const SERVERS = [
  {
    id: 'typescript',
    label: 'TypeScript and JavaScript',
    languages: [
      { id: 'javascript', extensions: ['.js', '.mjs', '.cjs'] },
      { id: 'javascriptreact', extensions: ['.jsx'] },
      { id: 'typescript', extensions: ['.ts', '.mts', '.cts'] },
      { id: 'typescriptreact', extensions: ['.tsx'] },
    ],
    commands: [{ bin: 'typescript-language-server', args: ['--stdio'] }],
    roots: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    install: 'npm install -g typescript typescript-language-server',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 15000,
  },
  {
    id: 'python',
    label: 'Python',
    languages: [{ id: 'python', extensions: ['.py', '.pyi'] }],
    commands: [
      { bin: 'pyright-langserver', args: ['--stdio'] },
      { bin: 'basedpyright-langserver', args: ['--stdio'] },
    ],
    roots: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pyrightconfig.json'],
    install: 'npm install -g pyright   (or: pip install basedpyright)',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 15000,
    settings: { python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly' } } },
  },
  {
    id: 'go',
    label: 'Go',
    languages: [
      { id: 'go', extensions: ['.go'] },
      { id: 'gomod', filenames: ['go.mod'] },
      { id: 'gowork', filenames: ['go.work'] },
    ],
    commands: [{ bin: 'gopls', args: [] }],
    roots: ['go.work', 'go.mod'],
    install: 'go install golang.org/x/tools/gopls@latest',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 15000,
  },
  {
    id: 'rust',
    label: 'Rust',
    languages: [{ id: 'rust', extensions: ['.rs'] }],
    // rustup puts a rust-analyzer shim in ~/.cargo/bin even without the component: it must answer --version.
    commands: [{ bin: 'rust-analyzer', args: [], verify: ['--version'] }],
    roots: ['Cargo.toml', 'rust-project.json'],
    install: 'rustup component add rust-analyzer',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 30000,
  },
  {
    id: 'clangd',
    label: 'C, C++ and Objective-C',
    languages: [
      { id: 'c', extensions: ['.c', '.h'] },
      { id: 'cpp', extensions: ['.cc', '.cpp', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.ipp'] },
      { id: 'objective-c', extensions: ['.m'] },
      { id: 'objective-cpp', extensions: ['.mm'] },
      { id: 'cuda-cpp', extensions: ['.cu', '.cuh'] },
    ],
    commands: [{ bin: 'clangd', args: ['--background-index'] }],
    roots: ['compile_commands.json', 'compile_flags.txt', '.clangd'],
    install: 'brew install llvm   (on macOS it comes with the Xcode tools)',
    runsProjectCode: false,
    weight: 'medium',
    timeout: 15000,
  },
  {
    id: 'json',
    label: 'JSON',
    languages: [{ id: 'json', extensions: ['.json'] }, { id: 'jsonc', extensions: ['.jsonc'] }],
    commands: [{ bin: 'vscode-json-language-server', args: ['--stdio'] }],
    roots: ['package.json'],
    install: 'npm install -g vscode-langservers-extracted',
    runsProjectCode: false,
    weight: 'light',
    settings: { json: { validate: { enable: true }, format: { enable: true } } },
  },
  {
    id: 'css',
    label: 'CSS, SCSS and Less',
    languages: [{ id: 'css', extensions: ['.css'] }, { id: 'scss', extensions: ['.scss'] }, { id: 'less', extensions: ['.less'] }],
    commands: [{ bin: 'vscode-css-language-server', args: ['--stdio'] }],
    roots: ['package.json'],
    install: 'npm install -g vscode-langservers-extracted',
    runsProjectCode: false,
    weight: 'light',
    settings: { css: { validate: true }, scss: { validate: true }, less: { validate: true } },
  },
  {
    id: 'html',
    label: 'HTML',
    languages: [{ id: 'html', extensions: ['.html', '.htm'] }],
    commands: [{ bin: 'vscode-html-language-server', args: ['--stdio'] }],
    roots: ['package.json'],
    install: 'npm install -g vscode-langservers-extracted',
    runsProjectCode: false,
    weight: 'light',
    initializationOptions: { provideFormatter: true },
  },
  {
    id: 'yaml',
    label: 'YAML',
    languages: [{ id: 'yaml', extensions: ['.yml', '.yaml'] }],
    commands: [{ bin: 'yaml-language-server', args: ['--stdio'] }],
    roots: [],
    install: 'npm install -g yaml-language-server',
    runsProjectCode: false,
    weight: 'light',
    settings: { yaml: { validate: true, hover: true, completion: true, format: { enable: true }, schemaStore: { enable: true } } },
  },
  {
    id: 'bash',
    label: 'Shell (Bash)',
    languages: [{ id: 'shellscript', extensions: ['.sh', '.bash'], filenames: ['.bashrc', '.bash_profile', '.profile'] }],
    commands: [{ bin: 'bash-language-server', args: ['start'] }],
    roots: [],
    install: 'npm install -g bash-language-server',
    runsProjectCode: false,
    weight: 'light',
  },
  {
    id: 'java',
    label: 'Java',
    languages: [{ id: 'java', extensions: ['.java'] }],
    // A data folder of its own for each project, as the README asks.
    commands: [{ bin: 'jdtls', args: ({ root, dataDir }) => ['-data', path.join(dataDir, 'jdtls', folderKey(root))] }],
    roots: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'build.xml'],
    install: 'brew install jdtls   (needs Java 21 or later)',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 60000,
  },
  {
    id: 'kotlin',
    label: 'Kotlin',
    languages: [{ id: 'kotlin', extensions: ['.kt', '.kts'] }],
    commands: [
      { bin: 'kotlin-lsp', args: ['--stdio'] },
      { bin: 'kotlin-language-server', args: [] },
    ],
    roots: ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle', 'pom.xml'],
    install: 'brew install JetBrains/utils/kotlin-lsp',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 60000,
  },
  {
    id: 'csharp',
    label: 'C#',
    languages: [{ id: 'csharp', extensions: ['.cs', '.csx'] }],
    commands: [
      { bin: 'roslyn-language-server', args: ({ dataDir }) => ['--stdio', '--autoLoadProjects', '--logLevel', 'Information', '--extensionLogDirectory', path.join(dataDir, 'roslyn-logs')] },
      { bin: 'csharp-ls', args: [] },
    ],
    roots: ['*.sln', '*.slnx', '*.csproj'],
    install: 'dotnet tool install --global roslyn-language-server --prerelease',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 60000,
  },
  {
    id: 'php',
    label: 'PHP',
    languages: [{ id: 'php', extensions: ['.php', '.phtml'] }],
    commands: [
      { bin: 'intelephense', args: ['--stdio'] },
      { bin: 'phpactor', args: ['language-server'] },
    ],
    roots: ['composer.json'],
    install: 'npm install -g intelephense',
    runsProjectCode: false,
    weight: 'medium',
    timeout: 15000,
  },
  {
    id: 'ruby',
    label: 'Ruby',
    languages: [{ id: 'ruby', extensions: ['.rb', '.rake', '.gemspec', '.ru'], filenames: ['Gemfile', 'Rakefile'] }],
    commands: [
      { bin: 'ruby-lsp', args: [] },
      { bin: 'solargraph', args: ['stdio'] },
    ],
    roots: ['Gemfile'],
    install: 'gem install ruby-lsp',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 30000,
  },
  {
    id: 'lua',
    label: 'Lua',
    languages: [{ id: 'lua', extensions: ['.lua'] }],
    commands: [{ bin: 'lua-language-server', args: [] }],
    roots: ['.luarc.json', '.luarc.jsonc', 'stylua.toml'],
    install: 'brew install lua-language-server',
    runsProjectCode: false,
    weight: 'medium',
  },
  {
    id: 'swift',
    label: 'Swift',
    languages: [{ id: 'swift', extensions: ['.swift'] }],
    commands: [{ bin: 'sourcekit-lsp', args: [] }],
    roots: ['Package.swift', 'buildServer.json'],
    install: 'comes with Xcode and the swift.org toolchains',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 30000,
  },
  {
    id: 'dart',
    label: 'Dart and Flutter',
    languages: [{ id: 'dart', extensions: ['.dart'] }],
    commands: [{ bin: 'dart', args: ['language-server', '--protocol=lsp'] }],
    roots: ['pubspec.yaml'],
    install: 'install the Dart SDK (or Flutter)',
    runsProjectCode: false,
    weight: 'medium',
    timeout: 30000,
  },
  {
    id: 'zig',
    label: 'Zig',
    languages: [{ id: 'zig', extensions: ['.zig', '.zon'] }],
    commands: [{ bin: 'zls', args: [] }],
    roots: ['build.zig', 'zls.json'],
    install: 'brew install zls',
    runsProjectCode: true,
    weight: 'light',
  },
  {
    id: 'elixir',
    label: 'Elixir',
    languages: [
      { id: 'elixir', extensions: ['.ex', '.exs'] },
      { id: 'eex', extensions: ['.eex'] },
      { id: 'phoenix-heex', extensions: ['.heex'] },
    ],
    commands: [
      { bin: 'expert', args: ['--stdio'] },
      { bin: 'elixir-ls', args: [] },
    ],
    roots: ['mix.exs'],
    install: 'brew install expert',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 60000,
  },
  {
    id: 'scala',
    label: 'Scala',
    languages: [{ id: 'scala', extensions: ['.scala', '.sc', '.sbt'] }],
    commands: [{ bin: 'metals', args: [] }],
    roots: ['build.sbt', 'build.sc', 'build.mill'],
    install: 'cs install metals   (or: brew install metals)',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 60000,
  },
  {
    id: 'haskell',
    label: 'Haskell',
    languages: [{ id: 'haskell', extensions: ['.hs', '.lhs'] }],
    commands: [{ bin: 'haskell-language-server-wrapper', args: ['--lsp'] }],
    roots: ['hie.yaml', 'cabal.project', 'stack.yaml', 'package.yaml'],
    install: 'ghcup install hls',
    runsProjectCode: true,
    weight: 'heavy',
    timeout: 60000,
  },
  {
    id: 'svelte',
    label: 'Svelte',
    languages: [{ id: 'svelte', extensions: ['.svelte'] }],
    commands: [{ bin: 'svelteserver', args: ['--stdio'] }],
    roots: ['svelte.config.js', 'package.json'],
    install: 'npm install -g svelte-language-server',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 15000,
  },
  {
    id: 'terraform',
    label: 'Terraform',
    languages: [{ id: 'terraform', extensions: ['.tf'] }, { id: 'terraform-vars', extensions: ['.tfvars'] }],
    commands: [{ bin: 'terraform-ls', args: ['serve'] }],
    roots: ['.terraform'],
    install: 'brew install hashicorp/tap/terraform-ls',
    runsProjectCode: false,
    weight: 'light',
  },
  {
    id: 'dockerfile',
    label: 'Dockerfile',
    languages: [{ id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile', 'Containerfile'], prefixes: ['Dockerfile.'] }],
    commands: [
      { bin: 'docker-langserver', args: ['--stdio'] },
      { bin: 'docker-language-server', args: ['start', '--stdio'] },
    ],
    roots: [],
    install: 'npm install -g dockerfile-language-server-nodejs',
    runsProjectCode: false,
    weight: 'light',
  },
  {
    id: 'toml',
    label: 'TOML',
    languages: [{ id: 'toml', extensions: ['.toml'] }],
    commands: [{ bin: 'taplo', args: ['lsp', 'stdio'] }],
    roots: ['.taplo.toml', 'taplo.toml'],
    install: 'brew install taplo',
    runsProjectCode: false,
    weight: 'light',
  },
  {
    id: 'markdown',
    label: 'Markdown',
    languages: [{ id: 'markdown', extensions: ['.md', '.markdown'] }],
    commands: [{ bin: 'marksman', args: ['server'] }],
    roots: ['.marksman.toml'],
    install: 'brew install marksman',
    runsProjectCode: false,
    weight: 'light',
  },
  {
    id: 'ocaml',
    label: 'OCaml',
    languages: [{ id: 'ocaml', extensions: ['.ml'] }, { id: 'ocaml.interface', extensions: ['.mli'] }],
    commands: [{ bin: 'ocamllsp', args: [] }],
    roots: ['dune-project', 'dune-workspace'],
    install: 'opam install ocaml-lsp-server',
    runsProjectCode: true,
    weight: 'medium',
    timeout: 30000,
  },
];

const DEFAULT_TIMEOUT = 10000;
const byId = new Map(SERVERS.map(s => [s.id, s]));

function serverById(id) {
  return byId.get(id) || null;
}

/** The server and languageId for a file: { server, languageId } or null. */
function serverForFile(filePath) {
  const base = path.basename(String(filePath || ''));
  const ext = path.extname(base).toLowerCase();
  for (const server of SERVERS) {
    for (const lang of server.languages) {
      if ((lang.filenames || []).includes(base)
        || (lang.prefixes || []).some(prefix => base.startsWith(prefix))
        || (ext && (lang.extensions || []).includes(ext))) {
        return { server, languageId: lang.id };
      }
    }
  }
  return null;
}

/** The arguments of a command for a folder (a function for the servers that need one). */
function commandArgs(command, context) {
  return typeof command.args === 'function' ? command.args(context) : [...(command.args || [])];
}

module.exports = { SERVERS, DEFAULT_TIMEOUT, serverById, serverForFile, commandArgs, folderKey };
