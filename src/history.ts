/** Undo/redo over plan snapshots (serialized text). */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private current = '';

  constructor(private limit = 100) {}

  /** Start over from this state with nothing to undo. */
  reset(snapshot: string): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = snapshot;
  }

  /** Call after every edit: records a step only when the plan actually changed. */
  record(snapshot: string): void {
    if (snapshot === this.current) return;
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = snapshot;
  }

  /** The state before the last edit, or undefined when there is none. */
  undo(): string | undefined {
    const prev = this.undoStack.pop();
    if (prev === undefined) return undefined;
    this.redoStack.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | undefined {
    const next = this.redoStack.pop();
    if (next === undefined) return undefined;
    this.undoStack.push(this.current);
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
