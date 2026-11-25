import Svg, { Circle, Path } from 'react-native-svg';

import { ACTION_ICONS, type ActionIconName } from '@/shared/vendor/action-icons';

/**
 * One of the shared action icons (packages/shared/action-icons.js), the same as
 * on the desktop: it says where an "open" button opens things. folderSearch
 * opens a folder inside the app, fileOutput a file with another application,
 * folderOpen the system's file manager. Ionicons' open-outline keeps its one
 * meaning, "open in a window of its own".
 */
export function ActionIcon({ name, size = 16, color }: { name: ActionIconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {ACTION_ICONS[name].map(([tag, attrs], index) => (tag === 'circle'
        ? <Circle key={index} cx={attrs.cx} cy={attrs.cy} r={attrs.r} />
        : <Path key={index} d={attrs.d} />))}
    </Svg>
  );
}
