import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes edits in order', () => {
    const h = new History();
    h.reset('a');
    h.record('b');
    h.record('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.canRedo).toBe(false);
  });

  it('ignores unchanged snapshots', () => {
    const h = new History();
    h.reset('a');
    h.record('a');
    expect(h.canUndo).toBe(false);
  });

  it('drops the redo branch on a new edit', () => {
    const h = new History();
    h.reset('a');
    h.record('b');
    h.undo();
    h.record('c');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('a');
  });

  it('keeps at most `limit` steps', () => {
    const h = new History(2);
    h.reset('a');
    for (const s of ['b', 'c', 'd']) h.record(s);
    expect(h.undo()).toBe('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBeUndefined();
  });
});
