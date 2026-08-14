/**
 * Which collection is on screen, and how to get to another one.
 *
 * A collector does not have "a collection" - they have the box they are
 * selling, the binder they are keeping, and the pile going off for grading, and
 * the point of keeping them apart is that the three totals must not be added
 * together.
 *
 * The bar itself is one line, because it sits above a screen whose headline is
 * a number and must not compete with it. Everything else - creating, renaming,
 * deleting - is behind the sheet it opens, which is where a destructive action
 * belongs.
 */

import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { totalCards, totalValue } from './collection';
import type { Collection, Library } from './library';
import { CheckIcon, ChevronIcon, CloseIcon, PlusIcon, TrashIcon } from './ui/icons';
import { Badge, Button, Empty } from './ui/parts';
import { c, money, noOutline, plural, r, s, t } from './ui/theme';

export default function CollectionBar({
  library,
  pro,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onWantPro,
}: {
  library: Library;
  pro: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** The free plan holds one collection; asking for a second opens the paywall. */
  onWantPro: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  const current = library.collections.find((x) => x.id === library.activeId)
    ?? library.collections[0];
  const many = library.collections.length > 1;

  const startCreate = () => {
    if (!pro && library.collections.length >= 1) { setOpen(false); onWantPro(); return; }
    setCreating(true);
    setDraft('');
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.barLabel}>COLLECTION</Text>
        <Text style={styles.barName} numberOfLines={1}>{current?.name ?? '—'}</Text>
        {many ? <Badge label={`${library.collections.length}`} /> : null}
        <ChevronIcon size={14} color={c.dim} dir="down" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide"
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Pressable onPress={() => setOpen(false)} hitSlop={10} style={styles.close}>
            <CloseIcon size={17} color={c.dim} />
          </Pressable>

          <ScrollView contentContainerStyle={{ paddingBottom: s.xxl }}>
            <Text style={styles.title}>Collections</Text>
            <Text style={styles.sub}>
              Kept separate so their totals never add up together.
            </Text>

            {library.collections.map((col) => (
              <Row
                key={col.id}
                col={col}
                active={col.id === library.activeId}
                editing={editing === col.id}
                canDelete={library.collections.length > 1}
                onPick={() => { onSelect(col.id); setOpen(false); }}
                onStartRename={() => { setEditing(col.id); setDraft(col.name); }}
                onCancelRename={() => setEditing(null)}
                onCommitRename={(name) => { onRename(col.id, name); setEditing(null); }}
                onDelete={() => onDelete(col.id)}
              />
            ))}

            {creating ? (
              <View style={styles.newRow}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="To sell, Binder, For grading…"
                  placeholderTextColor={c.faint}
                  style={styles.input}
                  autoFocus
                  maxLength={40}
                  onSubmitEditing={() => {
                    if (draft.trim()) onCreate(draft);
                    setCreating(false);
                    setOpen(false);
                  }}
                />
                <Button
                  label="Create"
                  kind="primary"
                  small
                  disabled={!draft.trim()}
                  onPress={() => { onCreate(draft); setCreating(false); setOpen(false); }}
                />
                <Button label="Cancel" small onPress={() => setCreating(false)} />
              </View>
            ) : (
              <Pressable
                onPress={startCreate}
                style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]}
              >
                <PlusIcon size={16} color={c.accent} strong />
                <Text style={styles.addText}>New collection</Text>
                {!pro ? <Badge label="PRO" tone="accent" /> : null}
              </Pressable>
            )}

            {!library.collections.length ? (
              <Empty title="No collections" hint="Make one to start scanning into it." />
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function Row({
  col, active, editing, canDelete,
  onPick, onStartRename, onCancelRename, onCommitRename, onDelete,
}: {
  col: Collection;
  active: boolean;
  editing: boolean;
  canDelete: boolean;
  onPick: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(col.name);
  /*
   * Deleting takes a collection and everything in it, and there is no undo, so
   * it asks. Twice would be nagging; once, in place, with the count of what is
   * about to go, is the amount of friction this deserves.
   */
  const [confirming, setConfirming] = useState(false);
  const cards = totalCards(col.entries);

  if (editing) {
    return (
      <View style={styles.row}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          autoFocus
          maxLength={40}
          onSubmitEditing={() => onCommitRename(draft)}
        />
        <Button label="Save" kind="primary" small onPress={() => onCommitRename(draft)} />
        <Button label="Cancel" small onPress={onCancelRename} />
      </View>
    );
  }

  if (confirming) {
    return (
      <View style={[styles.row, styles.rowDanger]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Delete “{col.name}”?</Text>
          <Text style={styles.meta}>
            {cards ? `${plural(cards, 'card')} in it will be lost.` : 'It is empty.'}
          </Text>
        </View>
        <Button label="Delete" kind="danger" small onPress={onDelete}
          icon={<TrashIcon size={13} color={c.bad} />} />
        <Button label="Keep" small onPress={() => setConfirming(false)} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPick}
      onLongPress={onStartRename}
      delayLongPress={450}
      style={({ pressed }) => [styles.row, active && styles.rowOn, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.tick}>
        {active ? <CheckIcon size={16} color={c.accent} strong /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{col.name}</Text>
        <Text style={styles.meta}>
          {cards ? `${plural(cards, 'card')} · ${money(totalValue(col.entries))}` : 'Empty'}
        </Text>
      </View>
      <Pressable onPress={onStartRename} hitSlop={8} style={styles.small}>
        <Text style={styles.smallText}>Rename</Text>
      </Pressable>
      {canDelete ? (
        <Pressable onPress={() => setConfirming(true)} hitSlop={8} style={styles.small}>
          <TrashIcon size={15} color={c.bad} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    paddingHorizontal: s.md, paddingVertical: 8,
    backgroundColor: c.surface, borderRadius: r.md,
    borderWidth: 1, borderColor: c.lineSoft,
  },
  barLabel: { ...t.section, fontSize: 9.5, color: c.faint },
  barName: { ...t.body, color: c.text, flex: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,10,0.68)' },
  sheet: {
    backgroundColor: c.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: c.line,
    paddingHorizontal: s.lg, paddingTop: s.sm,
    maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
    backgroundColor: c.line, marginBottom: s.md,
  },
  close: {
    position: 'absolute', right: s.md, top: s.md, zIndex: 5,
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceHi, borderWidth: 1, borderColor: c.line,
  },
  title: { ...t.title, fontSize: 24, color: c.text },
  sub: { ...t.meta, color: c.dim, marginTop: 4, marginBottom: s.md },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    backgroundColor: c.surface, borderRadius: r.md,
    borderWidth: 1, borderColor: c.lineSoft,
    padding: s.md, marginBottom: s.sm,
  },
  rowOn: { borderColor: c.accentLine, backgroundColor: c.accentWash },
  rowDanger: { borderColor: 'rgba(251,113,133,0.4)', backgroundColor: c.badWash },
  tick: { width: 18, alignItems: 'center' },
  name: { ...t.body, color: c.text },
  meta: { ...t.tiny, color: c.dim, marginTop: 2 },
  small: { paddingHorizontal: 6, paddingVertical: 4 },
  smallText: { ...t.tiny, color: c.dim, fontWeight: '700' },

  input: {
    flex: 1, backgroundColor: c.surfaceHi, borderRadius: r.sm,
    borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md, paddingVertical: 9, color: c.text, ...t.body, ...noOutline,
  },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: s.sm, marginBottom: s.sm },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.sm,
    paddingVertical: s.md, borderRadius: r.md,
    borderWidth: 1, borderColor: c.line, borderStyle: 'dashed',
  },
  addText: { ...t.body, color: c.accent, fontWeight: '700' },
});
