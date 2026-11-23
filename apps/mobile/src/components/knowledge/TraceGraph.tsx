import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { riskColor, traceLayout, type TraceLayoutNode, type TraceTree } from '@/shared/vendor/knowledge-model';
import { colors } from '@/theme';
import { MONO } from './parts';

const COL = 170;
const ROW = 40;
const NODE_W = 140;
const NODE_H = 28;
const PAD = 12;

/**
 * A trace as on the desktop: callers to the left of the function, callees to
 * the right, a coloured edge for each node's risk. A node with + has a next
 * step not yet opened; tapping a node hands it to onNode.
 */
export function TraceGraph({ tree, selected, onNode }: { tree: TraceTree; selected?: string | null; onNode: (node: TraceLayoutNode) => void }) {
  const layout = traceLayout(tree, { colWidth: COL, rowHeight: ROW });
  const ox = -layout.minX + PAD;
  const width = layout.maxX - layout.minX + NODE_W + PAD * 2;
  const height = layout.height + PAD * 2;
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const name = (n: TraceLayoutNode) => (n.name.length > 17 ? `${n.name.slice(0, 16)}…` : n.name) + (n.expandable ? '  +' : '');
  return (
    <ScrollView horizontal style={styles.frame} contentContainerStyle={styles.content}>
      <ScrollView nestedScrollEnabled>
        <View style={{ width, height }}>
          <Svg width={width} height={height}>
            {layout.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + ox + NODE_W;
              const y1 = a.y + PAD + NODE_H / 2;
              const x2 = b.x + ox;
              const y2 = b.y + PAD + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return <Path key={`${e.from}>${e.to}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} stroke="rgba(160,166,255,0.4)" strokeWidth={1.3} fill="none" />;
            })}
            {layout.nodes.map((n) => {
              const root = n.side === 'root';
              const on = selected === n.id;
              return (
                <G key={n.id} onPress={() => onNode(n)} accessibilityLabel={`${n.name}${n.risk ? `, ${n.risk.toLowerCase()} risk` : ''}`}>
                  <Rect x={n.x + ox} y={n.y + PAD} width={NODE_W} height={NODE_H} rx={6} fill={root ? 'rgba(128,136,255,0.2)' : '#1d1d26'} stroke={on ? colors.accent : root ? 'rgba(128,136,255,0.6)' : 'rgba(255,255,255,0.12)'} strokeWidth={on ? 2 : 1} />
                  <Rect x={n.x + ox} y={n.y + PAD} width={3} height={NODE_H} fill={riskColor(n.risk)} />
                  <SvgText x={n.x + ox + 10} y={n.y + PAD + NODE_H / 2 + 4} fill={root ? '#e8e8ff' : colors.text} fontSize={11.5} fontFamily={MONO} fontWeight={root ? 'bold' : 'normal'}>{name(n)}</SvgText>
                </G>
              );
            })}
          </Svg>
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 10, backgroundColor: '#15151b', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, maxHeight: 420 },
  content: { minWidth: '100%' },
});
