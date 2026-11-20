# Releasing

There are three ways to make a build:

- **A tag**: GitHub Actions builds the desktop app (macOS, Windows, Linux) and the Android APK, and puts them in a draft GitHub release. This page starts there.
- **A script on your computer**: it builds for Google Play or the App Store and uploads the build there. See [From your computer, to the stores](#from-your-computer-to-the-stores).
- **An APK built on your computer**, without EAS or an Expo account: see [An APK from your computer](#an-apk-from-your-computer). The desktop app builds on your computer with `npm run build:mac` (or `build:win`, `build:linux`) in `apps/desktop`.

Local builds are made by hand, whenever you want one; only a tag starts the builds on GitHub.

## A tag

Both apps carry one version: `apps/desktop/package.json`, `apps/mobile/package.json` and `apps/mobile/app.json`. A release is the commit that numbers them, tagged with that number:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

The **Release** workflow (`.github/workflows/release.yml`, at the root of the repository) checks that the tag is the version the apps carry, and stops before any build when it is not. It runs the tests, the typecheck and the lint, then builds:

| | What | Signed |
| --- | --- | --- |
| macOS | dmg and zip, Apple silicon (arm64) and Intel (x64) | ad hoc, without an Apple Developer ID |
| Windows | installer, x64 and arm64 | no |
| Linux | AppImage, deb and pacman, x64 | no |
| Android | APK, arm64 | with your key, from the repository's secrets |

When every build has finished, a **draft** GitHub release holds them all. Publishing it is up to you, on GitHub. If one build fails, no release is made; run the workflow again from the failed run once it is fixed.

There is no iOS build: without a paid Apple Developer account there is nothing to sign it with. [From your computer, to the stores](#from-your-computer-to-the-stores) makes one when there is.

From the Actions tab, **Release** also runs on a branch: it builds without a release, and the builds stay as workflow artifacts.

The APK is made as [An APK from your computer](#an-apk-from-your-computer) makes it: `expo prebuild` and Gradle, no EAS and no Expo account. Its version code is the number of commits, so a newer APK installs over an older one, and over one built on your computer from an older commit.

## One-time setup (Android)

The workflow signs the APK with the key `npm run build:apk` made on your computer, in `~/.config/switchboard-mobile/`, so an APK from a release and one built at home install over each other. Add that key to the GitHub repository as two Actions secrets:

```bash
base64 -i ~/.config/switchboard-mobile/android-apk.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD < ~/.config/switchboard-mobile/android-apk.password
```

Without them the Android build stops with an error, and no release is made.

## Installing

- **Android**: download the APK on the phone and open it; allow installs from that source when asked. A newer APK installs over the old one and keeps the pairing.
- **macOS**: the app is not signed with an Apple Developer ID. The first time, open it with right-click › Open, or run `xattr -dr com.apple.quarantine "/Applications/Switchboard Evolution.app"`.
- **Windows**: the installer is not signed. On the SmartScreen warning, choose More info › Run anyway.

## From your computer, to the stores

Two scripts build on your computer and upload to the stores:

```bash
npm run release:android -- 1.2.3   # Google Play: a draft release on the internal testing track
npm run release:ios -- 1.2.3       # App Store Connect, then TestFlight
```

Each one runs the tests, builds with `eas build --local` (the `production` profile: an App Bundle for Android, an App Store IPA for iOS) and uploads with `eas submit`. The version works as in a tag; when you leave it out, the script uses the version in `app.json`. The build is kept in `dist/`. `--no-submit` builds without uploading, and is the only way to build with uncommitted changes: an upload must come from a commit. `--no-test` skips the tests. `--help` lists the options.

Nothing reaches users by itself. On Google Play the build is a draft, rolled out from Play Console. On iOS it lands in TestFlight; sending it for review is done in App Store Connect.

Both commands are interactive, so the first time EAS asks for what it is missing (signing keys, store logins) and keeps it for next time. The signing keys live on EAS.

### What each needs

- **Both**: the EAS project from steps 1 and 2 of the one-time setup above, and EAS logged in with the account that owns it (`npx eas-cli@latest whoami`).
- **Android**: JDK 17 (`brew install openjdk@17`), the Android SDK (`ANDROID_HOME`, from Android Studio) and a [Google Play developer account](https://play.google.com/console/signup).
- **iOS**: Xcode, CocoaPods and fastlane (`brew install cocoapods fastlane`), and a paid [Apple Developer Program](https://developer.apple.com/programs/) membership. A free Apple ID can sign a build for your own phone (Sideloadly, AltStore) but not for the App Store.

### First time on Google Play

1. In Play Console, create the app with the package name in `app.json`.
2. `npm run release:android -- 1.0.0 --no-submit`. If EAS has no Android signing key for the app yet, the build offers to create one: accept. Upload the `.aab` from `dist/` by hand to a release on the internal testing track, because Google accepts an app's first upload only through Play Console.
3. Create a Google service account with access to the app ([how](https://expo.fyi/creating-google-service-account)). The next `npm run release:android` asks for its JSON key and keeps it on EAS. Keep the file outside this repository.

From then on, the script uploads by itself. The Play Store app and the APK from a GitHub release are signed with different keys, because Google signs store builds again with its own key. To switch from one to the other, uninstall the app and pair it again.

### First time on App Store Connect

The first `npm run release:ios` asks you to log in with the Apple ID of your developer account. EAS creates the distribution certificate and the provisioning profile. `eas submit` creates the app in App Store Connect if it is missing, and an App Store Connect API key for later uploads.

To skip the Apple login on later uploads, put the app's Apple ID in `eas.json` as `submit.production.ios.ascAppId`. It is the number under App Store Connect › App Information.

## An APK from your computer

```bash
npm run build:apk -- 1.2.3 --install
```

This builds an APK on your computer, with no EAS and no Expo account. `npx expo prebuild` generates the native project from `app.json`, and Gradle builds a release APK into `dist/`. With `--install`, the script installs it on the phone connected with USB; without it, copy the APK to the phone and open it there. The version works as in a tag. The version code is the number of commits, so a newer APK installs over an older one.

The APK is signed with a key of your own, made the first time in `~/.config/switchboard-mobile/`. Keep a copy of that folder: an update must be signed with the same key. The APK of a GitHub release is signed with this key too (see the [one-time setup](#one-time-setup-android)), so the two install over each other. The stores sign with other keys, so to switch from a store build to this one, uninstall the app first.

It needs JDK 17 and the Android SDK, as the Google Play script does. The APK is for arm64 phones, which is nearly all of them; for others, set `ANDROID_ABIS` (for example `ANDROID_ABIS=armeabi-v7a,arm64-v8a`).
