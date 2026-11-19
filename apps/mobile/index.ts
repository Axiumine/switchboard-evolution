// The app's entry: Expo Router's root ("main"), and the root of a tab opened
// in a window of its own ("window", modules/switchboard-window).
import 'expo-router/entry';

import { AppRegistry } from 'react-native';

import { WindowRoot } from '@/windows/WindowRoot';

AppRegistry.registerComponent('window', () => WindowRoot);
