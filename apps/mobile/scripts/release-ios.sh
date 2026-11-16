#!/usr/bin/env bash
# Builds the iOS app on this Mac and uploads it to App Store Connect.
#
#   scripts/release-ios.sh [1.2.3] [--no-test] [--no-submit]
#   npm run release:ios -- 1.2.3
#
# An App Store build (.ipa) from the `production` profile in eas.json, built
# here with `eas build --local`. `eas submit` then uploads it to App Store
# Connect, where it shows up in TestFlight once Apple has processed it;
# sending it for review stays a decision made in App Store Connect.
#
#   1.2.3        the app version (expo.version); app.json's when left out
#   --no-test    skip the tests, typecheck and lint
#   --no-submit  build only: the .ipa stays in dist/
#
# Needs a paid Apple Developer Program membership: EAS signs the build with a
# distribution certificate, which a free Apple ID cannot have. Needs Xcode,
# CocoaPods and fastlane on this Mac. See docs/releasing.md.
source "$(dirname "$0")/release-common.sh"
release_args "$@"

[[ "$(uname)" == Darwin ]] || fail "iOS builds need a Mac"
command -v xcodebuild >/dev/null 2>&1 || fail "Xcode not found: install it from the App Store"
command -v pod >/dev/null 2>&1 || fail "CocoaPods not found: brew install cocoapods"
command -v fastlane >/dev/null 2>&1 || fail "fastlane not found: brew install fastlane"

release_prepare

out="dist/Switchboard-Evolution-$version.ipa"
eas_cli build --platform ios --profile production --local --output "$out"
release_submit ios "$out"
