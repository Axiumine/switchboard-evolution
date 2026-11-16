#!/usr/bin/env bash
# Builds the Android app on this computer and uploads it to Google Play.
#
#   scripts/release-android.sh [1.2.3] [--no-test] [--no-submit]
#   npm run release:android -- 1.2.3
#
# An Android App Bundle (.aab) from the `production` profile in eas.json, built
# here with `eas build --local` and signed with the key EAS keeps. `eas submit`
# then puts it on the internal testing track as a draft (submit.production in
# eas.json); rolling it out stays a decision made in Play Console.
#
#   1.2.3        the app version (expo.version); app.json's when left out
#   --no-test    skip the tests, typecheck and lint
#   --no-submit  build only: the .aab stays in dist/
#
# Needs JDK 17 and the Android SDK (ANDROID_HOME). Google Play takes the
# first upload of an app only by hand: see docs/releasing.md.
source "$(dirname "$0")/release-common.sh"
release_args "$@"

android_toolchain
release_prepare

out="dist/Switchboard-Mobile-$version.aab"
eas_cli build --platform android --profile production --local --output "$out"
release_submit android "$out"
