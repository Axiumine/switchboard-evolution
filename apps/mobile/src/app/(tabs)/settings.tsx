import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RoutePicker } from '@/components/RoutePicker';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

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
 * the way it is reached (local network, Cloudflare, ngrok), and forgetting it.
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
      {hello ? <Row label="Switchboard Evolution" value={`version ${hello.appVersion}`} /> : null}
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
  button: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
