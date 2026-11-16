import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatImage } from '@/sessions/transcript';
import { colors } from '@/theme';
import { openImages } from './ImageViewer';

const GAP = 6;
const SINGLE = { width: 240, height: 180 };

/** The size of a picture of `aspect` (width / height) that fits in `box`. */
function fit(aspect: number, box: { width: number; height: number }) {
  if (!(aspect > 0)) return box;
  return aspect >= box.width / box.height
    ? { width: box.width, height: Math.round(box.width / aspect) }
    : { width: Math.round(box.height * aspect), height: box.height };
}

function Tile({ images, index, style, more }: { images: ChatImage[]; index: number; style: object; more?: number }) {
  return (
    <Pressable
      onPress={() => openImages(images, index)}
      style={[styles.tile, style]}
      accessibilityRole="imagebutton"
      accessibilityLabel={more ? `${more} more images` : `Image ${index + 1} of ${images.length}, opens full screen`}
    >
      <Image source={{ uri: images[index].uri }} style={styles.fill} contentFit="cover" cachePolicy="memory" />
      {more ? <View style={styles.more}><Text style={styles.moreText}>+{more}</Text></View> : null}
    </Pressable>
  );
}

/**
 * The images of a message, above its text: one picture up to 240x180, two
 * squares side by side, three or four in a 2x2 grid, and "+N" on the fourth
 * tile when there are more. A tap opens the viewer.
 */
export function ImageTiles({ images, width }: { images: ChatImage[]; width: number }) {
  const [aspect, setAspect] = useState(0);
  if (!images.length) return null;
  if (images.length === 1) {
    const size = fit(aspect, { width: Math.min(SINGLE.width, width), height: SINGLE.height });
    return (
      <Pressable onPress={() => openImages(images, 0)} style={[styles.tile, size]} accessibilityRole="imagebutton" accessibilityLabel="Image, opens full screen">
        <Image
          source={{ uri: images[0].uri }}
          style={styles.fill}
          contentFit="cover"
          cachePolicy="memory"
          onLoad={(e) => { if (e.source.height) setAspect(e.source.width / e.source.height); }}
        />
      </Pressable>
    );
  }
  const side = Math.floor((width - GAP) / 2);
  const shown = images.slice(0, 4);
  const extra = images.length - 4;
  return (
    <View style={[styles.grid, { width: side * 2 + GAP }]}>
      {shown.map((image, index) => (
        <Tile key={index} images={images} index={index} style={{ width: side, height: side }} more={index === 3 && extra > 0 ? extra + 1 : undefined} />
      ))}
    </View>
  );
}

/** An image in a tool's result (a screenshot): the width it is given, at most 240 tall. */
export function ResultImage({ images, index, width }: { images: ChatImage[]; index: number; width: number }) {
  const [aspect, setAspect] = useState(0);
  const size = fit(aspect || 4 / 3, { width, height: 240 });
  return (
    <Pressable onPress={() => openImages(images, index)} style={[styles.tile, size]} accessibilityRole="imagebutton" accessibilityLabel="Screenshot, opens full screen">
      <Image
        source={{ uri: images[index].uri }}
        style={styles.fill}
        contentFit="contain"
        cachePolicy="memory"
        onLoad={(e) => { if (e.source.height) setAspect(e.source.width / e.source.height); }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  fill: { width: '100%', height: '100%' },
  more: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(17,17,24,0.6)', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
