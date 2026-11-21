import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DonateBox } from '@/components/DonateBox';
import { RoutePicker } from '@/components/RoutePicker';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

const REPOSITORY = 'https://github.com/vivi7/switchboard-evolution';
/** This app's version as it was built (app.json's, embedded in the build). */
const MOBILE_VERSION = Constants.expoConfig?.version ?? null;

function describe(status: ReturnType<typeof useConnection.getState>['status']): string {
  switch (status.state) {
    case 'online': return `Connected through ${status.address}`;
    case 'connecting': return 'Connecting…';
    case 'offline': return status.error;
    case 'rejected': return status.message;
    default: return 'Not connected';
  }
}

/**
 * The Settings tab: the paired computer with its dot (green while connected),
 * the way it is reached (local network, Cloudflare, ngrok), the versions of
 * the paired Switchboard Evolution and of this app side by side, the source
 * code on GitHub, forgetting the computer, and the donation box.
 */
export default function SettingsScreen() {
  const desktop = useConnection((s) => s.desktop);
  const status = useConnection((s) => s.status);
  const reconnect = useConnection((s) => s.reconnect);
  const setRoute = useConnection((s) => s.setRoute);
  const forget = useConnection((s) => s.forget);

  if (!desktop) return null;
  const hello = status.state === 'online' ? status.hello : null;

  const confirmForget = () => Alert.alert(
    `Forget ${desktop.name}?`,
    'This phone deletes its key for that computer. To be sure it can never connect again, also remove it in Switchboard Evolution on the computer (right-click the Mobile app access switch, then Phones and port).',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { await forget(); router.replace('/pair'); } },
    ],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <View style={styles.computer}>
          <View style={[styles.dot, { backgroundColor: status.state === 'online' ? colors.running : colors.textFaint }]} />
          <Text style={styles.computerName} numberOfLines={1}>{desktop.name}</Text>
        </View>
        <Text style={styles.status} selectable>{describe(status)}</Text>
      </View>
      <RoutePicker internet={desktop.internet} value={desktop.route ?? 'lan'} onChange={setRoute} style={styles.card} />
      <View style={styles.versions}>
        <View style={styles.half}>
          <Text style={styles.label}>Paired Switchboard Evolution</Text>
          {hello
            ? <Text style={styles.value} selectable>{`version ${hello.appVersion}`}</Text>
            : <Text style={[styles.value, styles.faint]}>not connected</Text>}
        </View>
        <View style={styles.divider} />
        <View style={styles.half}>
          <Text style={styles.label}>This Switchboard Mobile</Text>
          <Text style={styles.value} selectable>{MOBILE_VERSION ? `version ${MOBILE_VERSION}` : 'unknown'}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => { Linking.openURL(REPOSITORY).catch(() => {}); }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="link"
        accessibilityLabel="Source code on GitHub"
      >
        <Text style={styles.label}>Source code</Text>
        <Text style={[styles.value, styles.link]}>github.com/vivi7/switchboard-evolution</Text>
      </Pressable>
      {hello ? <Row label="This phone on the computer" value={hello.device.name} /> : null}
      <Row label="Addresses" value={`${desktop.addresses.join(', ')} (port ${desktop.port})`} />
      <Row label="Paired" value={new Date(desktop.pairedAt).toLocaleString()} />
      {status.state === 'offline' ? (
        <Pressable onPress={reconnect} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>Reconnect now</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push('/pair')} style={styles.button} accessibilityRole="button">
        <Text style={styles.buttonText}>Pair again</Text>
      </Pressable>
      <Pressable onPress={confirmForget} style={styles.button} accessibilityRole="button">
        <Text style={[styles.buttonText, { color: colors.danger }]}>Forget this computer</Text>
      </Pressable>
      {/* The donation box of the Projects tab, always here and without its X. */}
      <DonateBox style={styles.donate} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md },
  row: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, gap: 3 },
  computer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  computerName: { color: colors.text, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  status: { color: colors.textDim, fontSize: 13 },
  label: { color: colors.textFaint, fontSize: 12 },
  value: { color: colors.text, fontSize: 15 },
  faint: { color: colors.textFaint },
  link: { color: colors.accent },
  pressed: { opacity: 0.7 },
  // One card, two halves: the computer's version and this app's.
  versions: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, gap: spacing.md },
  half: { flex: 1, minWidth: 0, gap: 3 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border },
  button: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  donate: { marginTop: spacing.md },
});
