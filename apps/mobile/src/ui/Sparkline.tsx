/**
 * A value chart drawn out of plain Views.
 *
 * No SVG dependency and no charting library: the shape is a line, and a line
 * is a row of thin rectangles. That keeps the bundle and the native module list
 * exactly where they are, which matters more here than a smooth curve - every
 * native module added is another thing that can fail on a device build.
 *
 * It draws nothing at all with fewer than two points, because a chart of one
 * day is a dot pretending to be a trend.
 */

import { StyleSheet, Text, View } from 'react-native';

import { c, r, s, t } from './theme';

export default function Sparkline({
  points,
  height = 52,
  tone = 'up',
}: {
  points: Array<{ x: number; y: number }>;
  height?: number;
  tone?: 'up' | 'down' | 'flat';
}) {
  if (points.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>
          Value is recorded once a day. The chart appears tomorrow.
        </Text>
      </View>
    );
  }

  const colour = tone === 'down' ? c.bad : tone === 'flat' ? c.dim : c.money;
  const n = points.length;

  return (
    <View style={[styles.wrap, { height }]}>
      {points.slice(0, -1).map((p, i) => {
        const q = points[i + 1];
        // One column per gap, filled from the lower of the two ends up to the
        // higher one - a staircase that reads as a line at this size, without
        // any transform maths that react-native-web and iOS disagree about.
        const lo = Math.min(p.y, q.y);
        const hi = Math.max(p.y, q.y);
        return (
          <View key={i} style={[styles.col, { width: `${100 / (n - 1)}%` }]}>
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: `${lo * 100}%`,
                height: Math.max(2, (hi - lo) * height),
                backgroundColor: colour,
                opacity: 0.9,
                borderRadius: 1,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: `${lo * 100}%`,
                backgroundColor: colour,
                opacity: 0.1,
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', overflow: 'hidden' },
  col: { height: '100%' },
  empty: {
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: c.surface, borderRadius: r.md,
    borderWidth: 1, borderColor: c.lineSoft, paddingHorizontal: s.md,
  },
  emptyText: { ...t.tiny, color: c.faint, textAlign: 'center' },
});
