/**
 * The pieces every screen is built from.
 *
 * Small on purpose. A component library would be more than this app needs, but
 * five screens hand-rolling their own chips and rows drift apart within a day.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon, TrendIcon } from './icons';
import { c, money, r, s, shadow, t } from './theme';

export function SectionLabel({
  children, right,
}: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{String(children).toUpperCase()}</Text>
      {right}
    </View>
  );
}

export function Chip({
  label,
  active,
  tone = 'plain',
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  tone?: 'plain' | 'good' | 'warn';
  onPress?: () => void;
  icon?: ReactNode;
}) {
  const toneStyle =
    tone === 'good' ? styles.chipGood : tone === 'warn' ? styles.chipWarn : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.chip,
        toneStyle,
        active && styles.chipActive,
        pressed && onPress ? styles.pressed : null,
      ]}
    >
      {icon}
      <Text style={[
        styles.chipText,
        tone === 'warn' && !active ? { color: c.warn } : null,
        active && styles.chipTextActive,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A segmented control: one track, one selected cell.
 *
 * Distinct from a row of chips, and the distinction is the point - chips are
 * independent filters you can turn on and off, a segment is a choice where
 * exactly one option is always true. Using chips for both is why the old
 * collection header read as a wall of pills with no hierarchy.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  small,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  small?: boolean;
}) {
  return (
    <View style={[styles.segTrack, small && styles.segTrackSmall]}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => [
              styles.segCell,
              small && styles.segCellSmall,
              on && styles.segCellOn,
              pressed && !on ? styles.pressed : null,
            ]}
          >
            <Text style={[
              styles.segText, small && styles.segTextSmall, on && styles.segTextOn,
            ]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'plain',
  disabled,
  grow,
  icon,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: 'plain' | 'primary' | 'good' | 'danger' | 'quiet';
  disabled?: boolean;
  grow?: boolean;
  icon?: ReactNode;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        kind === 'primary' && styles.btnPrimary,
        kind === 'good' && styles.btnGood,
        kind === 'danger' && styles.btnDanger,
        kind === 'quiet' && styles.btnQuiet,
        grow ? { flex: 1 } : null,
        disabled && styles.btnOff,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {icon}
      <Text style={[
        styles.btnText,
        small && styles.btnTextSmall,
        kind === 'primary' && styles.btnTextPrimary,
        disabled ? { color: c.faint } : null,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A headline number with a caption under it. */
export function Stat({
  label,
  value,
  tone = 'text',
  align = 'left',
}: {
  label: string;
  value: string;
  tone?: 'text' | 'money' | 'dim';
  align?: 'left' | 'right';
}) {
  return (
    <View style={align === 'right' ? { alignItems: 'flex-end' } : null}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text
        style={[
          styles.statValue,
          tone === 'money' && { color: c.money },
          tone === 'dim' && { color: c.dim },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * A change, with its direction shown three ways: colour, a triangle, and a sign.
 *
 * Colour alone fails for the ~8% of men with a red-green deficiency, and a
 * portfolio app that cannot tell them up from down is useless to them. The
 * sign is there because a triangle can be missed at a glance and "$1,025.78"
 * with no sign in front of it reads as a gain - which is the one mistake this
 * line must never make.
 */
export function Delta({
  amount, fraction, suffix, size = 'md',
}: {
  amount: number;
  fraction?: number | null;
  suffix?: string;
  size?: 'sm' | 'md';
}) {
  const up = amount >= 0;
  const tint = Math.abs(amount) < 0.005 ? c.dim : up ? c.money : c.bad;
  const pct = fraction == null ? null : `${Math.abs(fraction * 100).toFixed(1)}%`;
  return (
    <View style={styles.deltaRow}>
      <TrendIcon size={size === 'sm' ? 8 : 10} color={tint} up={up} />
      <Text style={[
        size === 'sm' ? styles.deltaTextSm : styles.deltaText, { color: tint },
      ]}>
        {up ? '+' : '−'}{money(Math.abs(amount))}
        {pct ? ` · ${pct}` : ''}{suffix ? ` ${suffix}` : ''}
      </Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A small label attached to a row: condition, grade, variant. */
export function Badge({
  label, tone = 'plain', dot,
}: { label: string; tone?: 'plain' | 'accent' | 'warn' | 'good'; dot?: string }) {
  return (
    <View style={[
      styles.badge,
      tone === 'accent' && styles.badgeAccent,
      tone === 'warn' && styles.badgeWarn,
      tone === 'good' && styles.badgeGood,
    ]}>
      {dot ? <View style={[styles.badgeDot, { backgroundColor: dot }]} /> : null}
      <Text style={[
        styles.badgeText,
        tone === 'accent' && { color: c.accent },
        tone === 'warn' && { color: c.warn },
        tone === 'good' && { color: c.good },
      ]}>
        {label}
      </Text>
    </View>
  );
}

export function Empty({
  title, hint, action,
}: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
      {action}
    </View>
  );
}

/** A thin proportion bar, for set completion. */
export function Meter({ value, tone = c.accent }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.meter}>
      <View style={[
        styles.meterFill, { width: `${pct * 100}%`, backgroundColor: tone },
      ]} />
    </View>
  );
}

/** A −/+ stepper. Used for quantity, where typing a number is the wrong verb. */
export function Stepper({
  value, onChange, min = 0, max = 999,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        style={({ pressed }) => [
          styles.stepBtn, value <= min && { opacity: 0.3 }, pressed && styles.pressed,
        ]}
      >
        <View style={styles.stepMinus} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        style={({ pressed }) => [
          styles.stepBtn, value >= max && { opacity: 0.3 }, pressed && styles.pressed,
        ]}
      >
        <View style={styles.stepMinus} />
        <View style={[styles.stepMinus, styles.stepPlusBar]} />
      </Pressable>
    </View>
  );
}

/** A tick in a circle, for "you already own this one". */
export function OwnedTick({ size = 20 }: { size?: number }) {
  return (
    <View style={[
      styles.owned,
      { width: size, height: size, borderRadius: size / 2 },
    ]}>
      <CheckIcon size={size * 0.72} color={c.bg} strong />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: s.sm,
  },
  section: { ...t.section, color: c.faint },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: r.pill,
    backgroundColor: c.surfaceHi,
    borderWidth: 1, borderColor: c.line,
  },
  chipActive: {
    backgroundColor: c.accentWash, borderColor: c.accentLine,
  },
  chipGood: { backgroundColor: c.goodWash, borderColor: 'rgba(52,211,153,0.4)' },
  chipWarn: { backgroundColor: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.4)' },
  chipText: { ...t.tiny, color: c.dim },
  chipTextActive: { color: c.accent, fontWeight: '800' },

  segTrack: {
    flexDirection: 'row', backgroundColor: c.surface, borderRadius: r.md,
    padding: 3, borderWidth: 1, borderColor: c.lineSoft, gap: 3,
  },
  segTrackSmall: { padding: 2, borderRadius: r.sm },
  segCell: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: r.sm,
  },
  segCellSmall: { paddingVertical: 5 },
  segCellOn: { backgroundColor: c.surfaceTop },
  segText: { ...t.meta, color: c.dim, fontWeight: '700' },
  segTextSmall: { ...t.tiny },
  segTextOn: { color: c.text, fontWeight: '800' },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: r.md,
    backgroundColor: c.surfaceHi,
    borderWidth: 1, borderColor: c.line,
  },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: r.sm },
  btnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  btnGood: { backgroundColor: c.goodWash, borderColor: 'rgba(52,211,153,0.45)' },
  btnDanger: { backgroundColor: c.badWash, borderColor: 'rgba(251,113,133,0.4)' },
  btnQuiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btnOff: { opacity: 0.45 },
  btnText: { ...t.body, color: c.text },
  btnTextSmall: { ...t.meta, fontWeight: '700' },
  btnTextPrimary: { color: c.onAccent, fontWeight: '800' },
  pressed: { opacity: 0.65 },

  statLabel: { ...t.section, color: c.faint },
  statValue: {
    fontSize: 24, fontWeight: '800', color: c.text, letterSpacing: -0.6,
    fontVariant: ['tabular-nums'], marginTop: 2,
  },

  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deltaText: { ...t.meta, fontWeight: '700', fontVariant: ['tabular-nums'] },
  deltaTextSm: { ...t.tiny, fontWeight: '700', fontVariant: ['tabular-nums'] },

  card: {
    backgroundColor: c.surface,
    borderRadius: r.lg,
    borderWidth: 1, borderColor: c.lineSoft,
    padding: s.lg,
  },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2.5,
    borderRadius: 5, backgroundColor: c.surfaceTop,
  },
  badgeAccent: { backgroundColor: c.accentWash },
  badgeWarn: { backgroundColor: 'rgba(251,191,36,0.14)' },
  badgeGood: { backgroundColor: c.goodWash },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '800', color: c.dim, letterSpacing: 0.2 },

  empty: { padding: s.xxl, alignItems: 'center', gap: s.md },
  emptyTitle: { ...t.subtitle, color: c.text, textAlign: 'center' },
  emptyHint: {
    ...t.meta, color: c.faint, textAlign: 'center', lineHeight: 19, maxWidth: 290,
  },

  meter: {
    height: 6, borderRadius: r.pill, backgroundColor: c.lineSoft, overflow: 'hidden',
  },
  meterFill: { height: 6, borderRadius: r.pill },

  stepper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.surfaceHi, borderRadius: r.md,
    borderWidth: 1, borderColor: c.line, ...shadow.low,
  },
  stepBtn: {
    width: 44, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  stepMinus: {
    position: 'absolute', width: 14, height: 2, borderRadius: 2, backgroundColor: c.text,
  },
  stepPlusBar: { width: 2, height: 14 },
  stepValue: {
    minWidth: 34, textAlign: 'center', ...t.subtitle, color: c.text,
    fontVariant: ['tabular-nums'],
  },

  owned: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.good,
  },
});
