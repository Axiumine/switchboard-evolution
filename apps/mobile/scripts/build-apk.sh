#!/usr/bin/env bash
# Builds an Android APK on this computer, to install on a phone by hand.
#
#   scripts/build-apk.sh [1.2.3] [--install]
#   npm run build:apk -- 1.2.3 --install
#
# No EAS and no Expo account: `expo prebuild` makes the native project and
# Gradle builds a release APK, signed with a key of your own.
#
#   1.2.3      the app version (expo.version); app.json's when left out
#   --install  install it on the phone connected with USB (adb)
#
# The APK goes to dist/Switchboard-Evolution-<version>.apk. It is for arm64
# phones, nearly all of them today: set ANDROID_ABIS (e.g.
# "armeabi-v7a,arm64-v8a") for others. The version code is the number of
# commits, so a newer build installs over an older one.
#
# The signing key is made the first time, in ~/.config/switchboard-mobile/
# (outside the repository): keep a copy of it. An update must be signed with
# the same key, and the APKs from CI and the stores are signed with other keys,
# so switching from one to the other means uninstalling the app first.
#
# Needs JDK 17 and the Android SDK (ANDROID_HOME).
source "$(dirname "$0")/release-common.sh"

version=""
install=0
while (($#)); do
  case "$1" in
    --install) install=1 ;;
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

android_toolchain

keys="${XDG_CONFIG_HOME:-$HOME/.config}/switchboard-mobile"
keystore="$keys/android-apk.keystore"
password_file="$keys/android-apk.password"
if [[ ! -f "$keystore" ]]; then
  mkdir -p "$keys"
  chmod 700 "$keys"
  (umask 077 && openssl rand -hex 24 >"$password_file")
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$keystore" -storetype PKCS12 \
    -alias switchboard -keyalg RSA -keysize 4096 -validity 36500 \
    -dname "CN=Switchboard Mobile" \
    -storepass:file "$password_file" -keypass:file "$password_file"
  echo "Made a signing key in $keys: keep a copy of it"
fi
password=$(<"$password_file")

[[ -n "$version" ]] || version=$(node -p 'require("./app.json").expo.version')
pin_app_json "$version" "$(git rev-list --count HEAD)"

# The native project is made again from app.json every time (android/ is not
# committed), so a change to app.json or a plugin always reaches the APK.
# Prebuild also rewrites the android and ios scripts in package.json.
#
# When android/ was made for another package id (the app was renamed), prebuild
# clears it and makes it afresh by itself, so the APK never keeps the old id.
keep_file package.json
CI=1 npx expo prebuild --platform android --no-install

(cd android && ./gradlew assembleRelease \
  -PreactNativeArchitectures="${ANDROID_ABIS:-arm64-v8a}" \
  -Pandroid.injected.signing.store.file="$keystore" \
  -Pandroid.injected.signing.store.password="$password" \
  -Pandroid.injected.signing.key.alias=switchboard \
  -Pandroid.injected.signing.key.password="$password")

mkdir -p dist
out="dist/Switchboard-Evolution-$version.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$out"
echo "Built $out"

if ((install)); then
  "$ANDROID_HOME/platform-tools/adb" install -r "$out"
fi
