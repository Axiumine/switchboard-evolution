import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { DONATE_AMOUNTS, DONATE_DEFAULT_AMOUNT, donateLabel, donateUrl } from '@/shared/vendor/donate';
import { useDonate } from '@/store/donate';
import { colors, spacing } from '@/theme';

// The desktop's Donate button: a soft coral, apart from the accent of the rest.
const CORAL = '#f6a39a';

/**
 * The donation box, the same as the desktop's: an amount (1.49 at first) and
 * Donate, which opens its PayPal page. `onClose` adds the X of the box under
 * the projects list; the one in Settings has none.
 */
export function DonateBox({ onClose, style }: { onClose?: () => void; style?: StyleProp<ViewStyle> }) {
  const [amount, setAmount] = useState(DONATE_DEFAULT_AMOUNT);
  const [choosing, setChoosing] = useState(false);
  const recordDonation = useDonate((s) => s.recordDonation);

  const donate = () => {
    Linking.openURL(donateUrl(amount)).catch(() => {});
    recordDonation();
  };

  return (
    <View style={[styles.box, style]}>
      {onClose ? (
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={16} color={colors.textFaint} />
        </Pressable>
      ) : null}
      <View style={[styles.copy, onClose ? styles.copyBesideClose : null]}>
        <Text style={styles.title}>Enjoying Switchboard Evolution?</Text>
        <Text style={styles.sub}>Support the work done so far with a donation.</Text>
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() => setChoosing(true)}
          style={({ pressed }) => [styles.amount, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Donation amount, ${donateLabel(amount)}`}
        >
          <Text style={styles.amountText}>{donateLabel(amount)}</Text>
          <Ionicons name="chevron-down" size={13} color={colors.textDim} />
        </Pressable>
        <Pressable
          onPress={donate}
          style={({ pressed }) => [styles.donate, pressed && styles.donatePressed]}
          accessibilityRole="button"
          accessibilityLabel={`Donate ${donateLabel(amount)}`}
        >
          <Ionicons name="heart" size={14} color={CORAL} />
          <Text style={styles.donateText}>Donate</Text>
        </Pressable>
      </View>
      <Sheet
        visible={choosing}
        title="Donation amount"
        options={DONATE_AMOUNTS.map((a) => ({ label: donateLabel(a), hint: a === amount ? 'current' : undefined, onPress: () => setAmount(a) }))}
        onClose={() => setChoosing(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  close: { position: 'absolute', top: spacing.sm, right: spacing.sm, width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  copy: { gap: 2 },
  copyBesideClose: { paddingRight: 24 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sub: { color: colors.textDim, fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.sm },
  amount: { width: 92, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: colors.border },
  amountText: { color: colors.text, fontSize: 14 },
  donate: { flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, backgroundColor: 'rgba(242,125,114,0.14)', borderWidth: 1, borderColor: 'rgba(242,125,114,0.4)' },
  donatePressed: { backgroundColor: 'rgba(242,125,114,0.24)' },
  donateText: { color: CORAL, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
