/**
 * The handful of pieces every screen is built from.
 *
 * Small on purpose. A component library would be more than this app needs, but
 * five screens hand-rolling their own chips and rows drift apart within a day.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { c, r, s, t } from './theme';

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{String(children).toUpperCase()}</Text>;
}

export function Chip({
  label,
  active,
  tone = 'plain',
  onPress,
}: {
  label: string;
  active?: boolean;
  tone?: 'plain' | 'good' | 'warn';
  onPress?: () => void;
}) {
  const toneStyle =
    tone === 'good' ? styles.chipGood : tone === 'warn' ? styles.chipWarn : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        toneStyle,
        pressed && onPress ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'plain',
  disabled,
  grow,
}: {
  label: string;
  onPress: () => void;
  kind?: 'plain' | 'primary' | 'good' | 'danger';
  disabled?: boolean;
  grow?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' && styles.btnPrimary,
        kind === 'good' && styles.btnGood,
        kind === 'danger' && styles.btnDanger,
        grow && { flex: 1 },
        disabled && styles.btnOff,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.btnText, disabled && { color: c.faint }]}>{label}</Text>
    </Pressable>
  );
}

/** A headline number with a caption under it. */
export function Stat({
  label,
  value,
  tone = 'text',
}: {
  label: string;
  value: string;
  tone?: 'text' | 'money' | 'dim';
}) {
  return (
    <View>
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

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

/** A thin proportion bar, for set completion. */
export function Meter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.meter}>
      <View style={[styles.meterFill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { ...t.section, color: c.faint, marginBottom: s.sm },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: r.pill,
    backgroundColor: c.surfaceHi,
    borderWidth: 1,
    borderColor: c.line,
  },
  chipActive: { backgroundColor: c.accentDim, borderColor: c.accent },
  chipGood: { backgroundColor: c.goodBg, borderColor: c.good },
  chipWarn: { backgroundColor: 'rgba(251,191,36,0.14)', borderColor: c.warn },
  chipText: { ...t.tiny, color: c.dim },
  chipTextActive: { color: c.text, fontWeight: '700' },
  btn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: r.md,
    backgroundColor: c.surfaceHi,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: c.accentDim, borderColor: '#2563eb' },
  btnGood: { backgroundColor: c.goodBg, borderColor: c.good },
  btnDanger: { backgroundColor: 'rgba(248,113,113,0.12)', borderColor: c.bad },
  btnOff: { opacity: 0.45 },
  btnText: { ...t.body, color: c.text },
  pressed: { opacity: 0.7 },
  statLabel: { ...t.section, color: c.faint },
  statValue: { fontSize: 26, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
  card: {
    backgroundColor: c.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: c.lineSoft,
    padding: s.lg,
  },
  empty: { padding: s.xxl, alignItems: 'center', gap: s.sm },
  emptyTitle: { ...t.body, color: c.dim, textAlign: 'center' },
  emptyHint: { ...t.meta, color: c.faint, textAlign: 'center', lineHeight: 18 },
  meter: {
    height: 5,
    borderRadius: r.pill,
    backgroundColor: c.lineSoft,
    overflow: 'hidden',
  },
  meterFill: { height: 5, borderRadius: r.pill, backgroundColor: c.accent },
});
