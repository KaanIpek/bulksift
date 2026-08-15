/**
 * Icons drawn out of Views.
 *
 * There is no icon font and no SVG library here, and that is deliberate rather
 * than frugal. Every native module this app has added cost a build cycle to get
 * linking on iOS - VisionCamera, worklets, the Nitro modules, the C++ pod - and
 * a tab bar is not worth another one. These are rectangles and circles with
 * border radii, which react-native-web and iOS render identically, so what is
 * checked in the browser is what appears on the phone.
 *
 * Every icon takes the same props and draws inside a `size` box, so they line
 * up wherever they are used.
 */

import { View } from 'react-native';

import { c } from './theme';

export interface IconProps {
  size?: number;
  color?: string;
  /** Icons in a tab bar thicken when selected; everything else ignores this. */
  strong?: boolean;
}

const box = (size: number) => ({
  width: size,
  height: size,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});

/** The scan target: four corner brackets around empty space. */
export function ScanIcon({ size = 22, color = c.text, strong }: IconProps) {
  const w = strong ? 2.4 : 1.9;
  const arm = size * 0.34;
  const corner = (top: boolean, left: boolean) => ({
    position: 'absolute' as const,
    width: arm,
    height: arm,
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
    borderColor: color,
    borderTopWidth: top ? w : 0,
    borderBottomWidth: top ? 0 : w,
    borderLeftWidth: left ? w : 0,
    borderRightWidth: left ? 0 : w,
    [top && left ? 'borderTopLeftRadius' : top ? 'borderTopRightRadius'
      : left ? 'borderBottomLeftRadius' : 'borderBottomRightRadius']: 4,
  });
  return (
    <View style={box(size)}>
      <View style={corner(true, true)} />
      <View style={corner(true, false)} />
      <View style={corner(false, true)} />
      <View style={corner(false, false)} />
      <View
        style={{
          width: size * 0.62, height: w, backgroundColor: color, borderRadius: w,
        }}
      />
    </View>
  );
}

/** A stack of cards, fanned. */
export function CollectionIcon({ size = 22, color = c.text, strong }: IconProps) {
  const w = strong ? 2.2 : 1.7;
  const cw = size * 0.46;
  const ch = size * 0.66;
  return (
    <View style={box(size)}>
      <View
        style={{
          position: 'absolute', width: cw, height: ch, borderRadius: 3,
          borderWidth: w, borderColor: color, opacity: 0.45,
          transform: [{ rotate: '-16deg' }, { translateX: -size * 0.17 }],
        }}
      />
      <View
        style={{
          position: 'absolute', width: cw, height: ch, borderRadius: 3,
          borderWidth: w, borderColor: color, opacity: 0.45,
          transform: [{ rotate: '16deg' }, { translateX: size * 0.17 }],
        }}
      />
      <View
        style={{
          width: cw, height: ch, borderRadius: 3,
          borderWidth: w, borderColor: color, backgroundColor: c.bg,
        }}
      />
    </View>
  );
}

/** Four panes - the sets grid. */
export function SetsIcon({ size = 22, color = c.text, strong }: IconProps) {
  const w = strong ? 2.2 : 1.7;
  const cell = size * 0.4;
  const gap = size * 0.1;
  const pane = { width: cell, height: cell, borderRadius: 3, borderWidth: w, borderColor: color };
  return (
    <View style={box(size)}>
      <View style={{ gap }}>
        <View style={{ flexDirection: 'row', gap }}>
          <View style={pane} /><View style={pane} />
        </View>
        <View style={{ flexDirection: 'row', gap }}>
          <View style={pane} /><View style={pane} />
        </View>
      </View>
    </View>
  );
}

/** A magnifier. */
export function SearchIcon({ size = 22, color = c.text, strong }: IconProps) {
  const w = strong ? 2.2 : 1.8;
  const d = size * 0.6;
  return (
    <View style={box(size)}>
      <View
        style={{
          width: d, height: d, borderRadius: d / 2, borderWidth: w, borderColor: color,
          position: 'absolute', top: size * 0.08, left: size * 0.08,
        }}
      />
      <View
        style={{
          position: 'absolute', right: size * 0.11, bottom: size * 0.12,
          width: size * 0.3, height: w, borderRadius: w, backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/**
 * A heart, for the want list.
 *
 * A star is the convention in this category, but a five-pointed star is a path,
 * and the nearest thing rectangles can manage - three bars crossed at sixty
 * degrees - renders as an asterisk at the 13 px this is actually used at. It
 * was tried and it was unreadable. A heart is two circles and a rotated square,
 * which is exact at any size and says "want" just as plainly.
 */
export function WantIcon({ size = 20, color = c.accent, strong }: IconProps) {
  const lobe = size * 0.5;
  const fill = strong ? color : 'transparent';
  const ring = { borderWidth: strong ? 0 : 1.8, borderColor: color };
  return (
    <View style={box(size)}>
      <View style={{ width: size, height: size, transform: [{ rotate: '-45deg' }] }}>
        <View
          style={{
            position: 'absolute', left: size * 0.25, top: size * 0.5,
            width: lobe, height: lobe, backgroundColor: fill, ...ring,
          }}
        />
        <View
          style={{
            position: 'absolute', left: size * 0.25, top: size * 0.25,
            width: lobe, height: lobe, borderRadius: lobe / 2,
            backgroundColor: fill, ...ring,
          }}
        />
        <View
          style={{
            position: 'absolute', left: size * 0.5, top: size * 0.5,
            width: lobe, height: lobe, borderRadius: lobe / 2,
            backgroundColor: fill, ...ring,
          }}
        />
        {/* The seam where the three pieces meet, painted out when filled. */}
        {strong ? (
          <View
            style={{
              position: 'absolute', left: size * 0.3, top: size * 0.3,
              width: lobe * 0.9, height: lobe * 0.9, backgroundColor: color,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

export function PlusIcon({ size = 20, color = c.text, strong }: IconProps) {
  const w = strong ? 2.6 : 2;
  const arm = size * 0.62;
  return (
    <View style={box(size)}>
      <View style={{
        position: 'absolute', width: arm, height: w, borderRadius: w, backgroundColor: color,
      }} />
      <View style={{
        position: 'absolute', width: w, height: arm, borderRadius: w, backgroundColor: color,
      }} />
    </View>
  );
}

export function CloseIcon({ size = 20, color = c.dim, strong }: IconProps) {
  const w = strong ? 2.4 : 1.9;
  const arm = size * 0.62;
  const bar = (deg: number) => ({
    position: 'absolute' as const,
    width: arm, height: w, borderRadius: w, backgroundColor: color,
    transform: [{ rotate: `${deg}deg` }],
  });
  return <View style={box(size)}><View style={bar(45)} /><View style={bar(-45)} /></View>;
}

export function CheckIcon({ size = 18, color = c.good, strong }: IconProps) {
  const w = strong ? 2.6 : 2.1;
  return (
    <View style={box(size)}>
      <View style={{
        position: 'absolute', width: size * 0.3, height: w, borderRadius: w,
        backgroundColor: color, left: size * 0.14, top: size * 0.56,
        transform: [{ rotate: '45deg' }],
      }} />
      <View style={{
        position: 'absolute', width: size * 0.56, height: w, borderRadius: w,
        backgroundColor: color, right: size * 0.09, top: size * 0.46,
        transform: [{ rotate: '-45deg' }],
      }} />
    </View>
  );
}

/** A chevron. `dir` is where the point aims. */
export function ChevronIcon({
  size = 16, color = c.faint, dir = 'right',
}: IconProps & { dir?: 'up' | 'down' | 'left' | 'right' }) {
  const w = 1.8;
  const arm = size * 0.42;
  const spin = { up: 180, down: 0, left: 90, right: -90 }[dir];
  return (
    <View style={box(size)}>
      <View style={{ transform: [{ rotate: `${spin}deg` }], width: size, height: size,
                     alignItems: 'center', justifyContent: 'center' }}>
        <View style={{
          position: 'absolute', width: arm, height: w, borderRadius: w, backgroundColor: color,
          left: size * 0.14, transform: [{ rotate: '45deg' }],
        }} />
        <View style={{
          position: 'absolute', width: arm, height: w, borderRadius: w, backgroundColor: color,
          right: size * 0.14, transform: [{ rotate: '-45deg' }],
        }} />
      </View>
    </View>
  );
}

/** A solid triangle, for the value delta. `up` decides which way it points. */
export function TrendIcon({ size = 9, color = c.money, up = true }:
IconProps & { up?: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0, height: 0,
          borderLeftWidth: size / 2, borderRightWidth: size / 2,
          borderLeftColor: 'transparent', borderRightColor: 'transparent',
          ...(up
            ? { borderBottomWidth: size * 0.78, borderBottomColor: color }
            : { borderTopWidth: size * 0.78, borderTopColor: color }),
        }}
      />
    </View>
  );
}

/** A torch, for the camera's flash toggle. */
export function FlashIcon({ size = 20, color = c.text }: IconProps) {
  return (
    <View style={box(size)}>
      <View style={{
        position: 'absolute', top: size * 0.08, width: size * 0.26, height: size * 0.46,
        backgroundColor: color, borderTopLeftRadius: 2, borderTopRightRadius: 2,
        transform: [{ skewX: '-14deg' }, { translateX: size * 0.05 }],
      }} />
      <View style={{
        position: 'absolute', bottom: size * 0.08, width: size * 0.26, height: size * 0.46,
        backgroundColor: color, borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
        transform: [{ skewX: '-14deg' }, { translateX: -size * 0.05 }],
      }} />
    </View>
  );
}

/** Three sliders - the sort and filter control. */
export function SortIcon({ size = 18, color = c.dim }: IconProps) {
  const w = 1.8;
  const line = (frac: number) => ({
    height: w, width: size * frac, borderRadius: w, backgroundColor: color,
  });
  return (
    <View style={[box(size), { gap: size * 0.16, alignItems: 'center' as const }]}>
      <View style={line(1)} />
      <View style={line(0.68)} />
      <View style={line(0.36)} />
    </View>
  );
}

/** A bin, for deleting a pile. */
export function TrashIcon({ size = 18, color = c.bad }: IconProps) {
  const w = 1.7;
  return (
    <View style={box(size)}>
      <View style={{
        position: 'absolute', top: size * 0.14, width: size * 0.78, height: w,
        borderRadius: w, backgroundColor: color,
      }} />
      <View style={{
        position: 'absolute', top: size * 0.04, width: size * 0.3, height: w,
        borderRadius: w, backgroundColor: color,
      }} />
      <View style={{
        position: 'absolute', top: size * 0.24, width: size * 0.58, height: size * 0.62,
        borderWidth: w, borderColor: color,
        borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
      }} />
    </View>
  );
}

/** An arrow leaving a box - export and share. */
export function ShareIcon({ size = 18, color = c.dim }: IconProps) {
  const w = 1.7;
  return (
    <View style={box(size)}>
      <View style={{
        position: 'absolute', bottom: 0, width: size * 0.82, height: size * 0.52,
        borderWidth: w, borderColor: color, borderTopWidth: 0, borderRadius: 3,
      }} />
      <View style={{
        position: 'absolute', top: size * 0.02, width: w, height: size * 0.5,
        borderRadius: w, backgroundColor: color,
      }} />
      <View style={{
        position: 'absolute', top: size * 0.1, left: size * 0.28, width: size * 0.26, height: w,
        borderRadius: w, backgroundColor: color, transform: [{ rotate: '-45deg' }],
      }} />
      <View style={{
        position: 'absolute', top: size * 0.1, right: size * 0.28, width: size * 0.26, height: w,
        borderRadius: w, backgroundColor: color, transform: [{ rotate: '45deg' }],
      }} />
    </View>
  );
}

/**
 * Settings, as a slider panel rather than a gear.
 *
 * A gear at 22px turns into a fuzzy circle: its teeth are under a pixel and
 * anti-aliasing smears them together. That is the same trap the star icon fell
 * into before it became a heart, and it is worth avoiding twice. Three sliders
 * stay legible because every stroke is axis-aligned and at least a pixel wide.
 */
export function SettingsIcon({ size = 22, color = c.text, strong }: IconProps) {
  const w = strong ? 2.3 : 1.8;
  const knob = size * 0.26;
  // Track y, and where the knob sits along it. Staggering the knobs is what
  // makes this read as controls rather than as a list.
  const rows: Array<[number, number]> = [[0.24, 0.66], [0.5, 0.3], [0.76, 0.55]];
  return (
    <View style={box(size)}>
      {rows.map(([y, x]) => (
        <View key={y}>
          <View style={{
            position: 'absolute', top: size * y - w / 2, left: size * 0.1,
            width: size * 0.8, height: w, borderRadius: w, backgroundColor: color,
          }} />
          <View style={{
            position: 'absolute',
            top: size * y - knob / 2,
            left: size * x - knob / 2,
            width: knob, height: knob, borderRadius: knob,
            borderWidth: w, borderColor: color, backgroundColor: c.bg,
          }} />
        </View>
      ))}
    </View>
  );
}
