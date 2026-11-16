#!/usr/bin/env bash
# Pins expo.version in app.json to the release tag that triggered the build.
#
# Shared by build-android.yml and build-ios.yml so the two platforms never
# drift onto different version strings for the same tag.
#
# Accepted tag grammar (see build-mobile.yml for what each suffix routes to):
#
#   v<MAJOR>.<MINOR>.<PATCH>[-android|-ios][-notest]
#
# The suffixes steer the pipeline, not the app, so they are stripped: both
# `v1.2.3` and `v1.2.3-ios-notest` stamp the app as 1.2.3.
#
# Why it commits: so the checkout the build is made from stays clean. eas build
# would pack the uncommitted edit too, but would record the build as made from
# a dirty tree. The commit lives only in the CI checkout and is never pushed:
# app.json on main stays untouched, and the tag is the one source of truth for
# the version.
#
# Only expo.version is written (Android versionName / iOS
# CFBundleShortVersionString). The integer build number is left alone: eas.json
# sets appVersionSource "remote" with autoIncrement, so EAS hands out a fresh
# versionCode per build, which is what lets a new APK install over the last.
set -euo pipefail

tag="${1:?usage: ci-set-app-version.sh <tag>}"

if ! printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-(android|ios))?(-notest)?$'; then
  echo "::error::tag '$tag' is not v<MAJOR>.<MINOR>.<PATCH>[-android|-ios][-notest]: refusing to build" >&2
  exit 1
fi

version="${tag#v}"       # v1.2.3-ios-notest -> 1.2.3-ios-notest
version="${version%%-*}" #                   -> 1.2.3

node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync("app.json", "utf8"));
  cfg.expo.version = process.argv[1];
  fs.writeFileSync("app.json", JSON.stringify(cfg, null, 2) + "\n");
' "$version"

if git diff --quiet -- app.json; then
  echo "app.json already at $version"
else
  git -c user.name='github-actions[bot]' \
      -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
      commit --quiet --no-verify -m "ci: app version $version (tag $tag)" -- app.json
  echo "app.json expo.version -> $version"
fi
