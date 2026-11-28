// The app's entry: Expo Router's root ("main"), and the root of a tab opened
// in a window of its own ("window", modules/switchboard-window).
import 'expo-router/entry';

import { AppRegistry } from 'react-native';

import { startNotifications } from '@/notifications/controller';
import { WindowRoot } from '@/windows/WindowRoot';

AppRegistry.registerComponent('window', () => WindowRoot);
// Apart from any screen: they keep coming while the app is in the background.
startNotifications();
