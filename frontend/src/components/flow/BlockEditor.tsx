import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Markdown from '@/components/shared/Markdown';
import BlockSource from '@/components/flow/BlockSource';
import SlashMenu from '@/components/flow/SlashMenu';
import StepCell from '@/components/flow/StepCell';
import { cn } from '@/lib/utils';
import {
  type Block,
  type BlockKind,
  blockKind,
  createBlock,
  fenceParts,
  isAtomicKind,
  isStepBlock,
  isStepInfo,
  parseDocument,
  serializeDocument,
  stepBody,
  stepIndexes,
  withFenceBody,
} from '@/lib/markdown-blocks';
import { type SlashCommand, expandTemplate, filterSlashCommands } from '@/lib/slash-commands';

/** What the block editor needs to draw a step cell and its execution output. */
export interface StepBinding {
  step?: any;
  stepData?: any;
  xrayTest?: any;
  jiraBaseUrl?: string;
  inputRequest?: any;
  error?: string;
}

interface BlockEditorProps {
  /** The whole document, frontmatter included. */
  value: string;
  onChange: (next: string) => void;
  /** Everything the step cell at `stepIndex` shows besides its own YAML. */
  resolveStep: (stepIndex: number) => StepBinding;
  onAnswerInput?: any;
}

const LIST_LINE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
const QUOTE_LINE = /^([ \t]*>[ \t]?)(.*)$/;

/** Drop target meaning "after the last block" — the tail of the document. */
const END_DROP_ID = '__end__';

/** The Markdown the caret edits: a step block is edited through its YAML. */
const sourceOf = (block: Block): string => (isStepBlock(block) ? stepBody(block.text) : block.text);

/** The block that results from replacing that source. */
const withSource = (block: Block, source: string): Block =>
  isStepBlock(block)
    ? { ...block, text: withFenceBody(block.text, source) }
    : { ...block, text: source };

/**
 * Where the caret sits inside a freshly inserted template, measured in the
 * text the editor will actually show — the fence lines of a step block are
 * not part of it.
 */
const caretInTemplate = (text: string, offset: number): number => {
  const parts = fenceParts(text);
  if (!parts || !isStepInfo(parts.info)) return offset;
  return Math.max(0, offset - (parts.open.length + 1));
};

/** True when the event target is the block wrapper itself, not its contents. */
const isBlockElement = (target: EventTarget | null, id: string): boolean =>
  target instanceof HTMLElement && target.dataset.blockId === id;

/** The "/…" being typed right before the caret, if any. */
const detectSlash = (source: string, caret: number): { start: number; query: string } | null => {
  const match = /(?:^|[\s>([{])\/([^\s/]{0,24})$/.exec(source.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
};

/** Viewport coordinates of the line the caret is on, to hang the menu from. */
const caretPosition = (textarea: HTMLTextAreaElement, caret: number): { top: number; left: number } => {
  const rect = textarea.getBoundingClientRect();
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const line = textarea.value.slice(0, caret).split('\n').length - 1;

  return {
    top: rect.top + (parseFloat(style.paddingTop) || 0) + (line + 1) * lineHeight + 4,
    left: rect.left,
  };
};

/**
 * Which character of the source a click on the rendered Markdown points at.
 *
 * The rendered text of a node appears verbatim in its source often enough
 * (prose, list items, headings) that looking it up is a good approximation of
 * what Obsidian does natively. When it cannot be found — a link, a table cell,
 * anything the renderer rewrote — the caret falls back to the end of the block.
 */
const caretFromPoint = (event: MouseEvent, source: string): number | undefined => {
  const api = document as any;
  let node: Node | null = null;
  let offset = 0;

  if (typeof api.caretRangeFromPoint === 'function') {
    const range = api.caretRangeFromPoint(event.clientX, event.clientY);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  else if (typeof api.caretPositionFromPoint === 'function') {
    const position = api.caretPositionFromPoint(event.clientX, event.clientY);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return undefined;

  const text = node.textContent || '';
  if (!text.trim()) return undefined;

  const at = source.indexOf(text);
  if (at !== -1) return at + offset;

  const probe = text.slice(0, 24);
  const near = probe.trim() ? source.indexOf(probe) : -1;
  return near === -1 ? undefined : near + Math.min(offset, probe.length);
};

/**
 * One rendered block. Memoized on its own Markdown: typing in one paragraph
 * must not re-render (and re-parse) every other block of the document.
 */
const RenderedBlock = React.memo(function RenderedBlock({ text }: { text: string }) {
  return <Markdown className="flow-block-rendered">{text}</Markdown>;
});

/**
 * The Document view: rendered Markdown you can type into.
 *
 * Every block is rendered until the caret enters it, and then — and only then
 * — that block shows its Markdown, the way Obsidian's live preview does. The
 * file is the model: what is edited here is the same text the Source tab
 * shows, so both views are always looking at one document.
 *
 * Keys follow the same conventions:
 *
 * - `/` opens the block menu (headings, lists, callouts, steps…).
 * - Enter splits the block, continues a list or closes an empty item.
 * - Backspace at the start merges into the block above; when that block is a
 *   step or a code block it gets selected instead, and the next Backspace (or
 *   Delete) removes it.
 * - Arrows walk from block to block, entering each one's source.
 *
 * Blocks also move as a whole, the way notebook cells do: each block shows a
 * small toolbar on hover — arrows to move it one place up or down, and a grip
 * to drag it anywhere — and Alt+↑/↓ moves the selected block from the keyboard.
 */
export function BlockEditor({ value, onChange, resolveStep, onAnswerInput }: BlockEditorProps) {
  const [doc, setDoc] = useState(() => parseDocument(value));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Where the caret goes when a block starts being edited. The token makes
  // every request a new one, so asking for the same offset twice still moves.
  const [caret, setCaret] = useState<{ offset?: number; token: number }>({ token: 0 });
  const [slash, setSlash] = useState<{
    blockId: string;
    start: number;
    query: string;
    index: number;
    position: { top: number; left: number };
  } | null>(null);
  // The block being dragged by its grip, and where it would land if dropped
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; where: 'above' | 'below' } | null>(null);
  // The block whose toolbar trash was clicked, while the confirm dialog is up
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusBlockRef = useRef<string | null>(null);
  // The blank block an insertion point opened, while nothing has been
  // written in it: an insertion nobody used must leave no trace in the file
  const pendingRef = useRef<string | null>(null);
  // The last document this editor handed upwards: anything else arriving
  // through `value` (undo, the Source tab, an AI rewrite) is an outside edit
  const emittedRef = useRef(value);

  // Read inside the handlers, which must not be re-created on every keystroke
  const docRef = useRef(doc);
  const editingRef = useRef(editingId);
  // Written directly by the drag handlers: dragover fires before a state
  // update from dragstart would have made it back into a re-render
  const dragIdRef = useRef<string | null>(null);

  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => { editingRef.current = editingId; }, [editingId]);

  /* ------------------------------ plumbing ------------------------------ */

  /** Take the blocks as the document, and hand the file upwards. */
  const commit = useCallback((blocks: Block[], head?: string) => {
    const next = { head: head ?? docRef.current.head, blocks };
    setDoc(next);

    const text = serializeDocument(next);
    // A staged block that was never written in leaves on the way out: the
    // file never heard about it, and does not have to hear about it going
    if (text === emittedRef.current) return;
    emittedRef.current = text;
    onChange(text);
  }, [onChange]);

  /**
   * Take the blocks as the document, but keep them to the editor.
   *
   * An insertion point is a place to write, not a change: until something is
   * typed in it, the file — and the diff, and the autosave — know nothing
   * about the empty block holding the caret.
   */
  const stage = useCallback((blocks: Block[]) => {
    setDoc({ head: docRef.current.head, blocks });
  }, []);

  const startEdit = useCallback((id: string, offset?: number) => {
    setCaret((current) => ({ offset, token: current.token + 1 }));
    setSelectedId(null);
    setEditingId(id);
    setSlash(null);
  }, []);

  const selectBlock = useCallback((id: string) => {
    focusBlockRef.current = id;
    setEditingId(null);
    setSelectedId(id);
    setSlash(null);
  }, []);

  /**
   * Take out the blank block a previous insertion point opened, unless
   * something was written in it. The block that came before it takes its
   * separator back, so the file reads exactly as it did.
   *
   * @param {Block[]} blocks - The blocks to prune
   * @returns {Object} The blocks, and where one was removed (-1 for none)
   */
  const dropPending = useCallback((blocks: Block[]): { blocks: Block[]; removed: number } => {
    const id = pendingRef.current;
    if (!id) return { blocks, removed: -1 };
    pendingRef.current = null;

    const index = blocks.findIndex((block) => block.id === id);
    if (index < 0 || blocks[index].text.trim() !== '') return { blocks, removed: -1 };

    const next = [...blocks];
    const previous = next[index - 1];
    if (previous) next[index - 1] = { ...previous, sep: next[index].sep };
    next.splice(index, 1);

    return { blocks: next, removed: index };
  }, []);

  const stopEdit = useCallback(() => {
    const { blocks, removed } = dropPending(docRef.current.blocks);
    if (removed >= 0) commit(blocks);
    setEditingId(null);
    setSlash(null);
  }, [commit, dropPending]);

  // An outside edit replaces the document; the caret stays on the block it
  // was on when that block survived, so undo does not throw the writer out
  useEffect(() => {
    if (value === emittedRef.current) return;
    emittedRef.current = value;

    const editingIndex = editingRef.current
      ? docRef.current.blocks.findIndex((block) => block.id === editingRef.current)
      : -1;

    const next = parseDocument(value);
    setDoc(next);
    setSlash(null);

    const survivor = editingIndex >= 0 ? next.blocks[editingIndex] : undefined;
    if (survivor) {
      setCaret((current) => ({ offset: sourceOf(survivor).length, token: current.token + 1 }));
      setEditingId(survivor.id);
    }
    else {
      setEditingId(null);
    }
  }, [value]);

  // Selecting a block moves the browser focus onto it, so the next Backspace
  // reaches the editor rather than whatever had focus before
  useEffect(() => {
    const id = focusBlockRef.current;
    if (!id) return;
    focusBlockRef.current = null;
    const element = containerRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    element?.focus({ preventScroll: true });
  });

  /* --------------------------- block operations --------------------------- */

  const removeBlockAt = useCallback((index: number, focus: 'previous' | 'next') => {
    const blocks = [...docRef.current.blocks];
    if (!blocks[index]) return;
    blocks.splice(index, 1);

    if (!blocks.length) {
      const fresh = createBlock('', '\n');
      commit([fresh]);
      startEdit(fresh.id, 0);
      return;
    }

    commit(blocks);

    const target = focus === 'previous'
      ? blocks[Math.max(0, index - 1)]
      : blocks[Math.min(blocks.length - 1, index)];
    startEdit(target.id, focus === 'previous' ? sourceOf(target).length : 0);
  }, [commit, startEdit]);

  const moveTo = useCallback((index: number, where: 'start' | 'end') => {
    const target = docRef.current.blocks[index];
    if (!target) return;
    startEdit(target.id, where === 'end' ? sourceOf(target).length : 0);
  }, [startEdit]);

  /**
   * Reorder: take the block at `from` out and put it back in at `to`. The
   * blank lines between blocks stay with their positions rather than with
   * their blocks, so the move shows up in the file as exactly the lines
   * that moved — and the file keeps ending the way it ended.
   */
  const applyMove = useCallback((blocks: Block[], from: number, to: number) => {
    const seps = blocks.map((block) => block.sep);
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    commit(next.map((block, index) => ({ ...block, sep: seps[index] })));
    selectBlock(moved.id);
  }, [commit, selectBlock]);

  /** Move a block one place up or down — the toolbar arrows and Alt+↑/↓. */
  const moveBlockBy = useCallback((id: string, delta: -1 | 1) => {
    const { blocks } = dropPending(docRef.current.blocks);
    const from = blocks.findIndex((block) => block.id === id);
    const to = from + delta;

    // Nowhere to go: keep the (possibly pruned) blocks as the document
    if (from < 0 || to < 0 || to >= blocks.length) {
      commit(blocks);
      return;
    }
    applyMove(blocks, from, to);
  }, [applyMove, commit, dropPending]);

  /** Put the dragged block above or below another one, or at the very end. */
  const moveBlockTo = useCallback((sourceId: string, targetId: string, where: 'above' | 'below') => {
    const { blocks } = dropPending(docRef.current.blocks);
    const from = blocks.findIndex((block) => block.id === sourceId);
    const at = targetId === END_DROP_ID
      ? blocks.length
      : blocks.findIndex((block) => block.id === targetId);

    let to = targetId !== END_DROP_ID && where === 'below' ? at + 1 : at;
    if (from < to) to -= 1;

    if (from < 0 || at < 0 || to === from) {
      commit(blocks);
      return;
    }
    applyMove(blocks, from, to);
  }, [applyMove, commit, dropPending]);

  /**
   * Delete a block — what the toolbar trash asks for once the dialog has
   * confirmed it. Unlike the keyboard deletes, the neighbor that takes the
   * block's place is selected rather than opened for writing.
   */
  const deleteBlock = useCallback((id: string) => {
    const { blocks } = dropPending(docRef.current.blocks);
    const index = blocks.findIndex((block) => block.id === id);
    if (index < 0) {
      commit(blocks);
      return;
    }

    const next = [...blocks];
    next.splice(index, 1);

    if (!next.length) {
      const fresh = createBlock('', '\n');
      commit([fresh]);
      startEdit(fresh.id, 0);
      return;
    }

    // Deleting the last block must not delete the way the file ends: the
    // block before it takes over the closing newline(s)
    if (index === next.length) {
      next[index - 1] = { ...next[index - 1], sep: blocks[index].sep };
    }

    commit(next);
    selectBlock(next[Math.min(index, next.length - 1)].id);
  }, [commit, dropPending, selectBlock, startEdit]);

  /**
   * Open an empty paragraph at `index`, and put the caret in it.
   *
   * Two steps one after the other leave no line between them to click on,
   * and neither does a step at the top of the document: this is that line.
   *
   * @param {number} index - Where the new block goes, in block positions
   */
  const insertBlockAt = useCallback((index: number) => {
    const { blocks, removed } = dropPending(docRef.current.blocks);
    // Pruning the last unused insertion point may have shifted the target
    const at = removed >= 0 && removed < index ? index - 1 : index;

    const next = [...blocks];
    const previous = next[at - 1];
    // The new block takes over the gap that used to follow the block above
    // it, so the only blank line added is the one being written in. Opening
    // the document itself gets the single newline a file ends on.
    const fresh = createBlock('', previous ? previous.sep : (next.length ? '\n\n' : '\n'));
    if (previous) next[at - 1] = { ...previous, sep: '\n\n' };
    next.splice(at, 0, fresh);

    stage(next);
    pendingRef.current = fresh.id;
    startEdit(fresh.id, 0);
  }, [dropPending, stage, startEdit]);

  /** Split the block at the caret; the second half becomes a new block. */
  const splitBlock = useCallback((index: number, caret: number) => {
    const blocks = [...docRef.current.blocks];
    const block = blocks[index];
    const source = sourceOf(block);

    const rest = createBlock(source.slice(caret), block.sep);
    blocks[index] = { ...withSource(block, source.slice(0, caret)), sep: '\n\n' };
    blocks.splice(index + 1, 0, rest);

    commit(blocks);
    startEdit(rest.id, 0);
  }, [commit, startEdit]);

  /**
   * Close a list or a blockquote: the empty item the caret is on is dropped
   * and a plain paragraph opens under the block.
   */
  const endStructure = useCallback((index: number, lineStart: number, caret: number) => {
    const blocks = [...docRef.current.blocks];
    const block = blocks[index];
    const source = sourceOf(block);
    const before = source.slice(0, lineStart).replace(/\n$/, '');
    const after = source.slice(caret);

    if (!before.trim()) {
      const replaced = { ...block, text: after };
      blocks[index] = replaced;
      commit(blocks);
      startEdit(replaced.id, 0);
      return;
    }

    const rest = createBlock(after, block.sep);
    blocks[index] = { ...withSource(block, before), sep: '\n\n' };
    blocks.splice(index + 1, 0, rest);

    commit(blocks);
    startEdit(rest.id, 0);
  }, [commit, startEdit]);

  /** Type text at the caret of the block being edited. */
  const insertAt = useCallback((index: number, caret: number, text: string) => {
    const blocks = [...docRef.current.blocks];
    const block = blocks[index];
    const source = sourceOf(block);

    blocks[index] = withSource(block, source.slice(0, caret) + text + source.slice(caret));
    commit(blocks);
    startEdit(block.id, caret + text.length);
  }, [commit, startEdit]);

  /* ------------------------------ the / menu ------------------------------ */

  const applyCommand = useCallback((command: SlashCommand, index: number) => {
    const textarea = textareaRef.current;
    const open = slash;
    if (!textarea || !open) return;

    const blocks = [...docRef.current.blocks];
    const block = blocks[index];
    const source = textarea.value;
    const head = source.slice(0, open.start);
    const tail = source.slice(textarea.selectionStart);
    const { text: template, caret: templateCaret } = expandTemplate(command.template);

    setSlash(null);

    if (command.mode === 'inline') {
      blocks[index] = withSource(block, head + template + tail);
      commit(blocks);
      startEdit(block.id, head.length + templateCaret);
      return;
    }

    if (command.mode === 'line') {
      const merged = head + tail;
      const lineStart = merged.lastIndexOf('\n', Math.max(0, head.length - 1)) + 1;
      blocks[index] = withSource(
        block,
        merged.slice(0, lineStart) + template + merged.slice(lineStart)
      );
      commit(blocks);
      startEdit(block.id, head.length + template.length);
      return;
    }

    // A block of its own. Whatever was already being written stays around it,
    // as the paragraph before and (when there was one) the paragraph after.
    const before = head.replace(/[ \t]+$/, '');
    const after = tail.replace(/^[ \t]+/, '');
    const caret = caretInTemplate(template, templateCaret);

    if (!before.trim() && !after.trim()) {
      const replaced = { ...block, text: template };
      blocks[index] = replaced;
      commit(blocks);
      startEdit(replaced.id, caret);
      return;
    }

    const inserted = createBlock(template, after.trim() ? '\n\n' : block.sep);
    let at = index;

    if (before.trim()) {
      blocks[index] = { ...withSource(block, before), sep: '\n\n' };
      at = index + 1;
      blocks.splice(at, 0, inserted);
    }
    else {
      blocks.splice(index, 1, inserted);
    }

    if (after.trim()) {
      blocks.splice(at + 1, 0, createBlock(after, block.sep));
    }

    commit(blocks);
    startEdit(inserted.id, caret);
  }, [commit, slash, startEdit]);

  /* ------------------------------- keyboard ------------------------------- */

  const handleChange = useCallback((index: number, source: string, caret: number) => {
    const blocks = [...docRef.current.blocks];
    const block = blocks[index];
    const updated = withSource(block, source);
    blocks[index] = updated;
    commit(blocks);

    const kind = blockKind(updated.text);
    // Slashes are ordinary characters inside YAML and code
    if (kind === 'step' || kind === 'code') {
      setSlash(null);
      return;
    }

    const hit = detectSlash(source, caret);
    if (!hit || !filterSlashCommands(hit.query).length) {
      setSlash(null);
      return;
    }

    setSlash({
      blockId: block.id,
      start: hit.start,
      query: hit.query,
      index: 0,
      position: textareaRef.current
        ? caretPosition(textareaRef.current, caret)
        : { top: 0, left: 0 },
    });
  }, [commit]);

  const handleEnter = useCallback((index: number, source: string, caret: number, kind: BlockKind) => {
    const lineStart = source.lastIndexOf('\n', caret - 1) + 1;
    const lineEnd = source.indexOf('\n', caret) === -1 ? source.length : source.indexOf('\n', caret);
    const line = source.slice(lineStart, lineEnd);

    if (kind === 'list') {
      const match = LIST_LINE.exec(line);
      if (match) {
        const [marker, indent, bullet, number, delimiter, space, task] = match;
        if (!line.slice(marker.length).trim()) {
          endStructure(index, lineStart, caret);
          return;
        }
        const next = bullet
          ? `${indent}${bullet}${space}`
          : `${indent}${Number(number) + 1}${delimiter}${space}`;
        insertAt(index, caret, `\n${next}${task ? '[ ] ' : ''}`);
        return;
      }
    }

    if (kind === 'quote' || kind === 'callout') {
      const match = QUOTE_LINE.exec(line);
      if (match) {
        if (!match[2].trim()) {
          endStructure(index, lineStart, caret);
          return;
        }
        insertAt(index, caret, '\n> ');
        return;
      }
    }

    splitBlock(index, caret);
  }, [endStructure, insertAt, splitBlock]);

  const handleBackspace = useCallback((index: number, source: string, kind: BlockKind) => {
    const blocks = docRef.current.blocks;
    const block = blocks[index];

    if (source === '') {
      removeBlockAt(index, 'previous');
      return;
    }

    // A step or a code block is not prose: it is selected, and goes as a whole
    if (isAtomicKind(kind)) {
      selectBlock(block.id);
      return;
    }

    const previous = blocks[index - 1];
    if (!previous) return;

    if (isAtomicKind(blockKind(previous.text))) {
      selectBlock(previous.id);
      return;
    }

    const merged = [...blocks];
    const caret = sourceOf(previous).length;
    merged[index - 1] = { ...withSource(previous, sourceOf(previous) + source), sep: block.sep };
    merged.splice(index, 1);

    commit(merged);
    startEdit(previous.id, caret);
  }, [commit, removeBlockAt, selectBlock, startEdit]);

  const handleDelete = useCallback((index: number, source: string, kind: BlockKind) => {
    const blocks = docRef.current.blocks;
    const block = blocks[index];
    const next = blocks[index + 1];

    if (source === '') {
      removeBlockAt(index, 'next');
      return;
    }
    if (!next) return;

    if (isAtomicKind(kind) || isAtomicKind(blockKind(next.text))) {
      selectBlock(next.id);
      return;
    }

    const merged = [...blocks];
    merged[index] = { ...withSource(block, source + sourceOf(next)), sep: next.sep };
    merged.splice(index + 1, 1);

    commit(merged);
    startEdit(block.id, source.length);
  }, [commit, removeBlockAt, selectBlock, startEdit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    const textarea = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value: source } = textarea;
    const block = docRef.current.blocks[index];
    if (!block) return;

    const kind = blockKind(block.text);
    const literal = kind === 'step' || kind === 'code';

    // Enter is a newline inside YAML and code, and splits the block
    // everywhere else, so opening a block of its own has a key to itself
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      insertBlockAt(event.shiftKey ? index : index + 1);
      return;
    }

    // While the menu is open it owns the keys that drive it
    if (slash && slash.blockId === block.id) {
      const matches = filterSlashCommands(slash.query);
      if (matches.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : matches.length - 1;
          setSlash({ ...slash, index: (slash.index + step) % matches.length });
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          applyCommand(matches[slash.index] || matches[0], index);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setSlash(null);
          return;
        }
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      stopEdit();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !literal && start === end) {
      event.preventDefault();
      handleEnter(index, source, start, kind);
      return;
    }

    if (event.key === 'Backspace' && start === 0 && end === 0) {
      event.preventDefault();
      handleBackspace(index, source, kind);
      return;
    }

    if (event.key === 'Delete' && start === source.length && end === source.length) {
      event.preventDefault();
      handleDelete(index, source, kind);
      return;
    }

    if (start === end && (event.key === 'ArrowUp' || event.key === 'ArrowLeft')) {
      const atStart = event.key === 'ArrowLeft'
        ? start === 0
        : source.lastIndexOf('\n', Math.max(0, start - 1)) === -1;
      if (atStart && index > 0) {
        event.preventDefault();
        moveTo(index - 1, 'end');
      }
      return;
    }

    if (start === end && (event.key === 'ArrowDown' || event.key === 'ArrowRight')) {
      const atEnd = event.key === 'ArrowRight'
        ? start === source.length
        : source.indexOf('\n', start) === -1;
      if (atEnd && index < docRef.current.blocks.length - 1) {
        event.preventDefault();
        moveTo(index + 1, 'start');
      }
      return;
    }

    if (event.key === 'Tab' && literal && start === end) {
      event.preventDefault();
      insertAt(index, start, '  ');
    }
  }, [applyCommand, handleBackspace, handleDelete, handleEnter, insertAt, insertBlockAt, moveTo, slash, stopEdit]);

  /** Keys that reach a block nobody is typing in — a selected step, say. */
  const handleBlockKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLDivElement>,
    index: number,
    blockId: string
  ) => {
    // Keys typed inside the source textarea bubble up here too
    if (editingRef.current === blockId) return;

    const block = docRef.current.blocks[index];
    if (!block) return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      removeBlockAt(index, event.key === 'Backspace' ? 'previous' : 'next');
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      insertBlockAt(event.shiftKey ? index : index + 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      startEdit(block.id, sourceOf(block).length);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setSelectedId(null);
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    // Alt+↑/↓ moves the block itself; the bare arrows move the caret
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey) {
      event.preventDefault();
      moveBlockBy(blockId, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      moveTo(index - 1, 'end');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(index + 1, 'start');
    }
  }, [insertBlockAt, moveBlockBy, moveTo, removeBlockAt, startEdit]);

  /* ----------------------------- drag & drop ----------------------------- */

  const handleDragStart = useCallback((event: React.DragEvent<HTMLElement>, id: string) => {
    event.dataTransfer.effectAllowed = 'move';
    // Firefox will not start a drag that carries no data
    event.dataTransfer.setData('text/plain', '');

    // The whole block is what travels with the pointer, not just the grip
    const wrapper = event.currentTarget.closest('[data-block-id]');
    if (wrapper instanceof HTMLElement) event.dataTransfer.setDragImage(wrapper, 24, 16);

    dragIdRef.current = id;
    setDragId(id);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIdRef.current = null;
    setDragId(null);
    setDropAt(null);
  }, []);

  /** Above or below `id`, from where the pointer sits over it. */
  const dropSide = (event: React.DragEvent<HTMLElement>, id: string): 'above' | 'below' => {
    if (id === END_DROP_ID) return 'below';
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY >= rect.top + rect.height / 2 ? 'below' : 'above';
  };

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>, id: string) => {
    if (!dragIdRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (id === dragIdRef.current) {
      setDropAt(null);
      return;
    }
    const where = dropSide(event, id);
    setDropAt((current) =>
      current && current.id === id && current.where === where ? current : { id, where }
    );
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>, id: string) => {
    const source = dragIdRef.current;
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();

    const where = dropSide(event, id);
    dragIdRef.current = null;
    setDragId(null);
    setDropAt(null);

    if (id !== source) moveBlockTo(source, id, where);
  }, [moveBlockTo]);

  /* ------------------------------ rendering ------------------------------ */

  const stepNumbers = stepIndexes(doc.blocks);

  // What the delete dialog is about, while it is open. A step is named by
  // its number — deleting one renumbers the cells after it.
  const deleting = deleteId ? doc.blocks.find((block) => block.id === deleteId) : undefined;
  const deletingStep = deleting && isStepBlock(deleting)
    ? (stepNumbers.get(deleting.id) ?? 0) + 1
    : null;

  /** Write at the end of the document — the click target under the last block. */
  const appendBlock = useCallback(() => {
    const blocks = docRef.current.blocks;
    const last = blocks[blocks.length - 1];

    // An empty block at the end is the one to keep writing in
    if (last && sourceOf(last).trim() === '' && !isStepBlock(last)) {
      pendingRef.current = last.id;
      startEdit(last.id, 0);
      return;
    }

    insertBlockAt(blocks.length);
  }, [insertBlockAt, startEdit]);

  /**
   * The line between two blocks. A step followed by a step has nothing to
   * click on between them, so the gutter itself is the place to start a
   * heading, a paragraph or another step.
   *
   * @param {number} index - The block position the new block would take
   */
  const renderGap = (index: number) => (
    <div
      // While a block is being dragged the gaps step out of the way, so the
      // blocks under them are what the pointer is over
      className={cn('flow-block-gap', dragId && 'flow-block-gap-inert')}
      title="Write here"
      // Taking the mousedown keeps the caret where it is until the new block
      // has one of its own — a blur in between would close the block first
      onMouseDown={(event) => { event.preventDefault(); insertBlockAt(index); }}
    >
      <Plus className="flow-block-gap-hint" aria-hidden="true" />
    </div>
  );

  /**
   * The notebook-cell toolbar at the top-right of a hovered block: move it
   * one place up or down, take the grip and drag it anywhere, or delete it
   * — behind the confirm dialog. The buttons take the mousedown so the
   * caret stays where it is; the grip cannot, or the browser would never
   * start the drag.
   */
  const renderTools = (block: Block, index: number) => (
    <div className="flow-block-tools" onClick={(event) => event.stopPropagation()}>
      <div
        role="button"
        aria-label="Drag to move this block"
        title="Drag to move"
        draggable
        className="flow-block-tool flow-block-drag"
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => handleDragStart(event, block.id)}
        onDragEnd={handleDragEnd}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </div>
      <button
        type="button"
        aria-label="Move this block up"
        title="Move up (Alt+↑)"
        className="flow-block-tool"
        disabled={index === 0}
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => { event.stopPropagation(); moveBlockBy(block.id, -1); }}
      >
        <ArrowUp className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Move this block down"
        title="Move down (Alt+↓)"
        className="flow-block-tool"
        disabled={index === doc.blocks.length - 1}
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => { event.stopPropagation(); moveBlockBy(block.id, 1); }}
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
      </button>
      <div className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />
      <button
        type="button"
        aria-label="Delete this block"
        title="Delete"
        className="flow-block-tool flow-block-tool-danger"
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => { event.stopPropagation(); setDeleteId(block.id); }}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );

  const renderSource = (block: Block, index: number, kind: BlockKind) => (
    <BlockSource
      key={`${block.id}-${caret.token}`}
      textareaRef={textareaRef}
      value={sourceOf(block)}
      initialCaret={caret.offset}
      placeholder={kind === 'paragraph' ? 'Write, or press / for headings, callouts and steps…' : undefined}
      className={kind === 'step' || kind === 'code' ? 'flow-block-source-mono' : undefined}
      onChange={(source, caret) => handleChange(index, source, caret)}
      onKeyDown={(event) => handleKeyDown(event, index)}
      onBlur={() => {
        // Clicking the menu keeps the caret; anything else closes the source
        if (!slash) stopEdit();
      }}
      // Moving the caret by hand leaves the "/…" behind: the menu is done
      onClick={() => { if (slash) setSlash(null); }}
    />
  );

  return (
    <div ref={containerRef} className="flow-blocks">
      {doc.blocks.map((block, index) => {
        const kind = blockKind(block.text);
        const editing = editingId === block.id;
        const selected = selectedId === block.id;

        // A step keeps its notebook cell (header, output) and edits its YAML
        // inside it; everything else is rendered Markdown, or its source
        let content: React.ReactNode;
        let extra: React.HTMLAttributes<HTMLDivElement> = {};

        if (kind === 'step') {
          const stepIndex = stepNumbers.get(block.id) ?? 0;
          const binding = resolveStep(stepIndex);

          content = (
            <StepCell
              segment={{ type: 'step', stepIndex, content: stepBody(block.text), error: binding.error }}
              step={binding.step}
              stepData={binding.stepData}
              xrayTest={binding.xrayTest}
              jiraBaseUrl={binding.jiraBaseUrl}
              inputRequest={binding.inputRequest}
              onAnswerInput={onAnswerInput}
              sourceEditor={editing ? renderSource(block, index, kind) : null}
              onSourceClick={(event) => {
                startEdit(block.id, caretFromPoint(event.nativeEvent, stepBody(block.text)));
              }}
            />
          );
        }
        else if (editing) {
          content = renderSource(block, index, kind);
        }
        else {
          content = <RenderedBlock text={block.text} />;
          extra = {
            onClick: (event: React.MouseEvent<HTMLDivElement>) => {
              // Links, checkboxes and buttons keep doing what they do
              if ((event.target as HTMLElement).closest('a, button, input')) return;
              startEdit(block.id, caretFromPoint(event.nativeEvent, block.text));
            },
          };
        }

        return (
          <React.Fragment key={block.id}>
            {renderGap(index)}
            <div
              data-block-id={block.id}
              data-block-kind={kind}
              tabIndex={editing ? -1 : 0}
              className={cn(
                'flow-block',
                editing && 'flow-block-editing',
                selected && 'flow-block-selected',
                dragId === block.id && 'flow-block-dragging',
                dropAt?.id === block.id &&
                  (dropAt.where === 'above' ? 'flow-block-drop-above' : 'flow-block-drop-below')
              )}
              {...extra}
              onDragOver={(event) => handleDragOver(event, block.id)}
              onDrop={(event) => handleDrop(event, block.id)}
              onKeyDown={(event) => handleBlockKeyDown(event, index, block.id)}
              onFocus={(event) => {
                // Focus on the block itself — rather than on the textarea
                // inside it — is the block being selected
                if (isBlockElement(event.target, block.id)) setSelectedId(block.id);
              }}
              onBlur={(event) => {
                if (isBlockElement(event.target, block.id)) setSelectedId(null);
              }}
            >
              {renderTools(block, index)}
              {content}
            </div>
          </React.Fragment>
        );
      })}

      {/* Room to keep writing under the document, the way a page has a bottom
          — and the place to drop a block being dragged past the last one */}
      <div
        className={cn('flow-block-tail', dropAt?.id === END_DROP_ID && 'flow-block-tail-drop')}
        onMouseDown={(event) => { event.preventDefault(); appendBlock(); }}
        onDragOver={(event) => handleDragOver(event, END_DROP_ID)}
        onDrop={(event) => handleDrop(event, END_DROP_ID)}
      >
        {!doc.blocks.length && (
          <p className="text-muted-foreground text-sm">
            This flow is empty. Click here and start writing — press <kbd>/</kbd> for headings,
            callouts and executable steps.
          </p>
        )}
      </div>

      {slash && (
        <SlashMenu
          commands={filterSlashCommands(slash.query)}
          activeIndex={slash.index}
          position={slash.position}
          onHover={(index) => setSlash((current) => (current ? { ...current, index } : current))}
          onSelect={(command) => {
            const index = docRef.current.blocks.findIndex((block) => block.id === slash.blockId);
            if (index >= 0) applyCommand(command, index);
          }}
        />
      )}

      {/* Deleting from the toolbar goes through a confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent
          // The block that takes the deleted one's place is what gets the
          // focus back, not the trash button that no longer exists
          onCloseAutoFocus={(event: Event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Delete {deletingStep !== null ? `step ${deletingStep}` : 'this block'}</DialogTitle>
            <DialogDescription>
              {deletingStep !== null
                ? 'The step and its definition will be removed from the flow, and the steps after it will renumber.'
                : 'The block will be removed from the document.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = deleteId;
                setDeleteId(null);
                if (id) deleteBlock(id);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BlockEditor;
