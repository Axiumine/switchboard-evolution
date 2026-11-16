# Shared by release-android.sh, release-ios.sh and build-apk.sh, which source
# it.
#
# A store release from this computer: the tests, a build made here with
# `eas build --local` (the `production` profile in eas.json), then
# `eas submit` uploads it. Both commands run interactively, so the first time
# EAS asks for what it is missing (signing keys, store logins) and keeps it.
# The signing keys live on EAS, so a build made here and one made in CI are
# signed alike. See docs/releasing.md.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() {
  echo "error: $*" >&2
  exit 1
}

# The global eas when there is one, otherwise the latest from npm.
eas_cli() {
  if command -v eas >/dev/null 2>&1; then
    eas "$@"
  else
    npx --yes eas-cli@latest "$@"
  fi
}

# JDK 17 and the Android SDK, for a build made here; JAVA_HOME and ANDROID_HOME
# point at them.
android_toolchain() {
  # JDK 17, the one React Native asks for: newer ones can break the native steps.
  local jdk jdk17=""
  for jdk in \
    "${JAVA_HOME_17:-}" \
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
    "$(/usr/libexec/java_home -v 17 2>/dev/null || true)"; do
    if [[ -n "$jdk" && -x "$jdk/bin/java" ]]; then
      jdk17="$jdk"
      break
    fi
  done
  [[ -n "$jdk17" ]] || fail "JDK 17 not found: brew install openjdk@17, or point JAVA_HOME_17 at one"
  export JAVA_HOME="$jdk17"

  export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  [[ -d "$ANDROID_HOME/platforms" ]] ||
    fail "Android SDK not found at $ANDROID_HOME: install it (Android Studio), or set ANDROID_HOME"
}

# Files to put back as they were when the script ends: see keep_file.
kept_dir=$(mktemp -d)
restore_kept_files() {
  local file
  for file in "$kept_dir"/*; do
    if [[ -e "$file" ]]; then cp "$file" .; fi
  done
  rm -rf "$kept_dir"
}
trap restore_kept_files EXIT

# Puts <file>, in the project root, back as it is now when the script ends.
keep_file() {
  if [[ ! -e "$kept_dir/$1" ]]; then cp "$1" "$kept_dir/$1"; fi
}

# Writes expo.version, and expo.android.versionCode when given, into app.json
# for this build only.
pin_app_json() {
  keep_file app.json
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync("app.json", "utf8"));
    cfg.expo.version = process.argv[1];
    if (process.argv[2]) cfg.expo.android.versionCode = Number(process.argv[2]);
    fs.writeFileSync("app.json", JSON.stringify(cfg, null, 2) + "\n");
  ' "$@"
}

# [1.2.3] [--no-test] [--no-submit] into $version, $run_tests and $submit.
release_args() {
  version=""
  run_tests=1
  submit=1
  while (($#)); do
    case "$1" in
      --no-test) run_tests=0 ;;
      --no-submit) submit=0 ;;
      -h | --help)
        awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
        exit 0
        ;;
      -*) fail "unknown option '$1' (see --help)" ;;
      *)
        [[ -z "$version" ]] || fail "one version only (see --help)"
        version="${1#v}"
        ;;
    esac
    shift
  done
  if [[ -n "$version" && ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "'$version' is not MAJOR.MINOR.PATCH"
  fi
}

# Everything before the build: the checks, the tests, the version.
release_prepare() {
  # What goes to a store is a commit; a build kept here can be anything.
  if ((submit)) && [[ -n "$(git status --porcelain)" ]]; then
    fail "uncommitted changes: commit them first, or build without uploading (--no-submit)"
  fi

  local who owner
  who=$(FORCE_COLOR=0 eas_cli whoami 2>/dev/null | sed -n 1p) ||
    fail "not logged in to EAS: run 'npx eas-cli@latest login'"
  if ! node -e 'process.exit(require("./app.json").expo?.extra?.eas?.projectId ? 0 : 1)'; then
    fail "app.json has no EAS project yet. You are logged in to EAS as '$who': if the app belongs to that account, run 'npx eas-cli@latest init' and commit app.json (docs/releasing.md)"
  fi
  owner=$(node -p 'require("./app.json").expo.owner || "?"')
  echo "EAS: logged in as $who, app owned by $owner"

  if ((run_tests)); then
    npm test -- --ci
    npm run typecheck
    npm run lint
  fi

  # eas build packs the working tree, uncommitted edits included, so the
  # pinned version reaches it. The build number is EAS's (appVersionSource
  # remote with autoIncrement).
  if [[ -n "$version" ]]; then
    pin_app_json "$version"
  else
    version=$(node -p 'require("./app.json").expo.version')
  fi
  echo "Version $version"
  mkdir -p dist
}

# Uploads the build to the store for <android|ios>, unless --no-submit.
release_submit() {
  local platform="$1" file="$2"
  if ((submit)); then
    eas_cli submit --platform "$platform" --profile production --path "$file"
  else
    echo "Built, not uploaded: $file"
    echo "Upload it later with: npx eas-cli@latest submit --platform $platform --profile production --path $file"
  fi
}
