/**
 * What the collection has been worth, drawn out of plain Views.
 *
 * No SVG dependency and no charting library. The shape is a line, and a line is
 * a row of thin rectangles rotated to the angle between their two points; the
 * fill under it is the area beneath the same segments. That keeps the native
 * module list exactly where it is, which matters more here than a bezier -
 * every native module this app has added cost a build cycle to link on iOS.
 *
 * The width has to be measured rather than assumed. An earlier version worked
 * in percentages and computed each segment's angle from a percentage run and a
 * pixel rise, which is two different units in one right-angled triangle: the
 * lengths came out wrong and the line drew as a row of disconnected dashes. So
 * the plot reports its own width on layout and everything after that is pixels.
 *
 * What it will not do is invent history. There is one price snapshot on the
 * device, so the only honest series is the collection's own value recorded once
 * a day from the day the feature shipped - and with fewer than two days of that
 * it says so rather than drawing a curve.
 */

import { Fragment, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

import { c, money, nums, r, s, t } from './theme';

export interface ChartPoint { x: number; y: number }

export default function ValueChart({
  points,
  height = 96,
  tone = 'up',
  low,
  high,
  labels,
}: {
  /** x and y both in 0..1, y measured up from the bottom. */
  points: ChartPoint[];
  height?: number;
  tone?: 'up' | 'down' | 'flat';
  /** The real values at the bottom and top of the plot, for the axis labels. */
  low?: number;
  high?: number;
  /** Two captions under the plot: usually the first and last date. */
  labels?: [string, string];
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>
          Value is recorded once a day. The chart fills in as the days pass.
        </Text>
      </View>
    );
  }

  const colour = tone === 'down' ? c.bad : tone === 'flat' ? c.dim : c.money;
  const last = points[points.length - 1];

  return (
    <View>
      <View style={[styles.plot, { height }]} onLayout={onLayout}>
        {/* Rules, so the eye has something to measure the line against. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <View key={f} style={[styles.rule, { bottom: f * height }]} />
        ))}

        {width > 0
          ? points.slice(0, -1).map((p, i) => {
            const q = points[i + 1];
            // Both ends in pixels from the bottom-left of the plot.
            const xA = p.x * width;
            const xB = q.x * width;
            const yA = p.y * height;
            const yB = q.y * height;
            const run = xB - xA;
            const rise = yB - yA;
            const len = Math.sqrt(run * run + rise * rise);
            // Screen y grows downwards, so a rising value is a negative angle.
            const deg = (Math.atan2(-rise, run) * 180) / Math.PI;
            /*
             * A fragment, not a wrapping View. A plain View here would be a
             * flow child of the plot with no size of its own, and the three
             * absolutely positioned pieces inside it would be measured from
             * *it* rather than from the plot - which drew an empty chart.
             */
            return (
              <Fragment key={i}>
                {/* The area under this segment: a rectangle to the lower end,
                    plus a half-height band for the wedge above it. Two
                    rectangles approximate the trapezium closely enough at the
                    one- or two-pixel steps a 45-day chart actually produces. */}
                <View
                  style={{
                    position: 'absolute', left: xA, width: run, bottom: 0,
                    height: Math.min(yA, yB),
                    backgroundColor: colour, opacity: 0.11,
                  }}
                />
                <View
                  style={{
                    position: 'absolute', left: xA, width: run,
                    bottom: Math.min(yA, yB), height: Math.abs(rise) / 2,
                    backgroundColor: colour, opacity: 0.11,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    left: xA,
                    bottom: yA - LINE / 2,
                    width: len,
                    height: LINE,
                    borderRadius: LINE,
                    backgroundColor: colour,
                    transform: [{ rotate: `${deg}deg` }],
                    transformOrigin: 'left center',
                  }}
                />
              </Fragment>
            );
          })
          : null}

        {/* The head of the line, so the eye lands on today. */}
        {width > 0 ? (
          <View
            style={[
              styles.head,
              {
                // Kept inside the plot: the head sits on the last point, and
                // the last point is the right-hand edge, which `overflow:
                // hidden` would otherwise slice in half.
                left: Math.min(last.x * width - 5, width - 11),
                bottom: Math.min(Math.max(last.y * height - 5, 0), height - 11),
                borderColor: colour,
              },
            ]}
          />
        ) : null}

        {high != null && low != null ? (
          <View style={styles.axis} pointerEvents="none">
            <Text style={styles.axisText}>{money(high)}</Text>
            <Text style={styles.axisText}>{money(low)}</Text>
          </View>
        ) : null}
      </View>

      {labels ? (
        <View style={styles.labels}>
          <Text style={styles.labelText}>{labels[0]}</Text>
          <Text style={styles.labelText}>{labels[1]}</Text>
        </View>
      ) : null}
    </View>
  );
}

const LINE = 2;

const styles = StyleSheet.create({
  plot: { position: 'relative', overflow: 'hidden' },
  rule: {
    position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth,
    backgroundColor: c.line, opacity: 0.55,
  },
  head: {
    position: 'absolute', width: 10, height: 10, borderRadius: 6,
    borderWidth: 2.5, backgroundColor: c.bg,
  },
  /*
   * The axis sits on the left, because the right-hand end of the line is where
   * today is and a label there lands on top of it.
   */
  axis: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    justifyContent: 'space-between',
  },
  axisText: {
    ...t.tiny, ...nums, color: c.faint,
    backgroundColor: 'rgba(18,20,28,0.82)', borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  labels: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 6,
  },
  labelText: { ...t.tiny, color: c.faint },
  empty: {
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: c.surface, borderRadius: r.md,
    borderWidth: 1, borderColor: c.lineSoft, paddingHorizontal: s.lg,
  },
  emptyText: { ...t.meta, color: c.faint, textAlign: 'center', lineHeight: 18 },
});
