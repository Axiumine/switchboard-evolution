import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import type { ChatImage } from '@/sessions/transcript';
import { colors, spacing } from '@/theme';

const MAX_SCALE = 6;

// One viewer for the whole chat; any image opens it with its neighbours.
const useViewer = create<{ images: ChatImage[]; index: number }>(() => ({ images: [], index: 0 }));

/** Show `images` full screen, starting at `index`. */
export function openImages(images: ChatImage[], index = 0) {
  useViewer.setState({ images, index });
}

const close = () => useViewer.setState({ images: [], index: 0 });

/** Save the image in the cache, where the share sheet can read it, and open the sheet. */
async function shareImage(image: ChatImage) {
  try {
    const ext = (image.mediaType.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
    const file = new File(Paths.cache, `image-${Date.now()}.${ext}`);
    await file.write(image.uri.slice(image.uri.indexOf(',') + 1), { encoding: 'base64' });
    await Sharing.shareAsync(file.uri, { mimeType: image.mediaType, dialogTitle: 'Share image' });
  } catch (err: any) {
    Alert.alert('Could not share the image', err?.message || String(err));
  }
}

/** The picture itself: pinch to zoom, drag when zoomed, double-tap to fit again. */
function ZoomableImage({ image }: { image: ChatImage }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
    },
    onDeactivate: () => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        x.value = withTiming(0);
        y.value = withTiming(0);
        startX.value = 0;
        startY.value = 0;
      }
    },
  });
  const pan = usePanGesture({
    averageTouches: true,
    onUpdate: (e) => {
      if (scale.value <= 1) return;
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    },
    onDeactivate: () => {
      startX.value = x.value;
      startY.value = y.value;
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      x.value = withTiming(0);
      y.value = withTiming(0);
      startX.value = 0;
      startY.value = 0;
    },
  });
  const zoom = useSimultaneousGestures(pinch, pan);
  const gesture = useExclusiveGestures(doubleTap, zoom);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.stage, style]}>
        <Image source={{ uri: image.uri }} style={styles.image} contentFit="contain" cachePolicy="memory" accessibilityIgnoresInvertColors />
      </Animated.View>
    </GestureDetector>
  );
}

/** The full-screen image viewer of the chat: close and share at the top, the image, and a way between several. */
export function ImageViewer() {
  const { images, index } = useViewer();
  const insets = useSafeAreaInsets();
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { Sharing.isAvailableAsync().then(setCanShare, () => setCanShare(false)); }, []);
  const image = images[index];
  const step = (by: number) => useViewer.setState({ index: Math.min(Math.max(index + by, 0), images.length - 1) });

  return (
    <Modal visible={!!image} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.screen}>
        {/* A new image starts unzoomed. */}
        {image ? <ZoomableImage key={index} image={image} /> : null}
        <View style={[styles.top, { paddingTop: insets.top + spacing.xs }]}>
          <Pressable onPress={close} style={styles.button} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {images.length > 1 ? <Text style={styles.count}>{index + 1} / {images.length}</Text> : null}
          {canShare && image ? (
            <Pressable onPress={() => shareImage(image)} style={styles.button} accessibilityRole="button" accessibilityLabel="Share image">
              <Ionicons name="share-outline" size={23} color="#fff" />
            </Pressable>
          ) : <View style={styles.button} />}
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.sm }]}>
          {images.length > 1 ? (
            <Pressable onPress={() => step(-1)} disabled={index === 0} style={[styles.button, index === 0 && styles.off]} accessibilityRole="button" accessibilityLabel="Previous image">
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
          ) : null}
          <Text style={styles.caption}>Pinch to zoom · double-tap to reset</Text>
          {images.length > 1 ? (
            <Pressable onPress={() => step(1)} disabled={index === images.length - 1} style={[styles.button, index === images.length - 1 && styles.off]} accessibilityRole="button" accessibilityLabel="Next image">
              <Ionicons name="chevron-forward" size={24} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  stage: { ...StyleSheet.absoluteFill, paddingHorizontal: spacing.md, paddingVertical: 96 },
  image: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.sm },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.3 },
  count: { color: colors.text, fontSize: 13 },
  caption: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
});
