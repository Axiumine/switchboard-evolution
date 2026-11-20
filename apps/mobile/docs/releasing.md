# Releasing

There are two ways to make a build:

- **A tag**: CI builds an Android APK and an iOS IPA to install by hand, and puts them in a draft GitHub release. This page starts there.
- **A script on your computer**: it builds for Google Play or the App Store and uploads the build there. See [From your computer, to the stores](#from-your-computer-to-the-stores).
- **An APK built on your computer**, without EAS or an Expo account: see [An APK from your computer](#an-apk-from-your-computer).

Push a tag. The tag is the version and the instruction:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

`1.2.3` becomes `expo.version` in the build (in the repository, app.json holds the current version). The build number belongs to EAS (`appVersionSource: remote` with `autoIncrement`), so it is never part of the tag.

When the builds finish, a **draft** GitHub release holds the Android APK and the iOS IPA. Publishing it is up to you, on GitHub.

## Tags

| Tag | Android | iOS | Tests |
| --- | --- | --- | --- |
| `v1.2.3` | APK | IPA | yes |
| `v1.2.3-android` | APK | — | yes |
| `v1.2.3-ios` | — | IPA | yes |
| `v1.2.3-notest` | APK | IPA | skipped |
| `v1.2.3-android-notest` | APK | — | skipped |
| `v1.2.3-ios-notest` | — | IPA | skipped |

Any other tag is refused before a build starts. Each workflow also runs from the Actions tab: **Build mobile** (both platforms or one) and **Build Android** / **Build iOS** on their own. A run without a tag keeps its builds as workflow artifacts instead of a release.

## How each platform builds

- **Android** builds on [EAS](https://expo.dev/eas), with the `preview` profile in `eas.json`: an APK for internal distribution, signed with a key EAS keeps. The workflow waits for the build and downloads the APK.
- **iOS** builds on a GitHub macOS runner: `npx expo prebuild` generates the native project, and `xcodebuild` archives it **without signing**. A free Apple ID cannot sign for distribution, and EAS needs a paid Apple Developer account for a build that installs on a phone.

## One-time setup (Android)

On your computer, in this repository:

1. `npx eas-cli@latest login` with your Expo account.
2. `npx eas-cli@latest init`. It creates the EAS project and writes its `projectId` and `owner` into `app.json`: commit that.
3. `npx eas-cli@latest build --platform android --profile preview`. Answer the prompts once (let EAS create the signing key). Later builds reuse it without asking.
4. Create an access token at expo.dev › Account settings › Access tokens, and add it to the GitHub repository as the Actions secret `EXPO_TOKEN`.

iOS needs no setup.

## Installing

- **Android**: download the APK on the phone and open it; allow installs from that source when asked. A newer APK installs over the old one and keeps the pairing.
- **iPhone**: install the IPA with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io), which sign it with your Apple ID. With a free Apple ID the app runs for 7 days; then install it again (AltStore can refresh it for you). On the phone, trust your Apple ID once under Settings › General › VPN & Device Management.

## From your computer, to the stores

Two scripts build on your computer and upload to the stores:

```bash
npm run release:android -- 1.2.3   # Google Play: a draft release on the internal testing track
npm run release:ios -- 1.2.3       # App Store Connect, then TestFlight
```

Each one runs the tests, builds with `eas build --local` (the `production` profile: an App Bundle for Android, an App Store IPA for iOS) and uploads with `eas submit`. The version works as in a tag; when you leave it out, the script uses the version in `app.json`. The build is kept in `dist/`. `--no-submit` builds without uploading, and is the only way to build with uncommitted changes: an upload must come from a commit. `--no-test` skips the tests. `--help` lists the options.

Nothing reaches users by itself. On Google Play the build is a draft, rolled out from Play Console. On iOS it lands in TestFlight; sending it for review is done in App Store Connect.

Both commands are interactive, so the first time EAS asks for what it is missing (signing keys, store logins) and keeps it for next time. The signing keys live on EAS, so builds made here and in CI are signed alike.

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

The APK is signed with a key of your own, made the first time in `~/.config/switchboard-mobile/`. Keep a copy of that folder: an update must be signed with the same key. The APKs from CI and the stores are signed with other keys, so to switch from those to this one, uninstall the app first.

It needs JDK 17 and the Android SDK, as the Google Play script does. The APK is for arm64 phones, which is nearly all of them; for others, set `ANDROID_ABIS` (for example `ANDROID_ABIS=armeabi-v7a,arm64-v8a`).
