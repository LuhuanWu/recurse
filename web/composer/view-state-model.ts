// DOM-free ownership and navigation rules for per-conversation composer drafts.
import type { ComposerViewState } from "../conversation-ui-state/schema.js";
import type { ConversationUiStateStore } from "../conversation-ui-state/store.js";

interface ComposerField {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange(start: number, end: number): void;
}

export class ComposerViewStateController {
  private ownerId: string;
  // Over-bound text survives live navigation even when it cannot persist.
  private volatile = new Map<string, ComposerViewState>();

  constructor(
    private store: ConversationUiStateStore,
    private field: ComposerField,
    initialOwnerId: string,
  ) {
    this.ownerId = initialOwnerId;
    // Invariant: The shell accepts typing before the bundle loads. Until boot
    // selects an owner, that text belongs to the field, not an empty
    // saved-owner record.
    if (initialOwnerId) this.restore(initialOwnerId);
  }

  owner(): string {
    return this.ownerId;
  }
  hasVolatileWork(): boolean {
    for (const value of this.volatile.values()) if (value.text) return true;
    return false;
  }

  snapshot(ownerId = this.ownerId): boolean {
    if (ownerId !== this.ownerId) return false;
    const value = {
      text: this.field.value,
      selectionStart: this.field.selectionStart ?? this.field.value.length,
      selectionEnd: this.field.selectionEnd ?? this.field.value.length,
    };
    const saved = this.store.setComposer(ownerId, value);
    if (saved) this.volatile.delete(ownerId);
    else this.volatile.set(ownerId, value);
    return true;
  }

  noteInput(ownerId: string): boolean {
    return ownerId === this.ownerId && this.snapshot(ownerId);
  }

  switchTo(ownerId: string, dropPrevious = false): ComposerViewState {
    if (ownerId === this.ownerId) return this.store.composer(ownerId);
    const previous = this.ownerId;
    if (!previous) {
      const early = {
        text: this.field.value,
        selectionStart: this.field.selectionStart ?? this.field.value.length,
        selectionEnd: this.field.selectionEnd ?? this.field.value.length,
      };
      this.volatile.delete(previous);
      this.ownerId = ownerId;
      const saved = this.restore(ownerId);
      if (early.text) {
        // Invariant: Preserve both a same-tab saved draft and new text typed
        // during boot.
        const prefix =
          saved.text && saved.text !== early.text ? `${saved.text}\n` : "";
        this.put(ownerId, {
          text: prefix + early.text,
          selectionStart: prefix.length + early.selectionStart,
          selectionEnd: prefix.length + early.selectionEnd,
        });
      }
      return this.volatile.get(ownerId) || this.store.composer(ownerId);
    }
    if (dropPrevious) {
      this.store.remove(previous);
      this.volatile.delete(previous);
    } else {
      this.snapshot(previous);
      this.store.flush(previous);
    }
    this.ownerId = ownerId;
    return this.restore(ownerId);
  }

  promoteTo(ownerId: string): ComposerViewState {
    if (ownerId === this.ownerId) return this.store.composer(ownerId);
    this.snapshot(this.ownerId);
    this.transfer(this.ownerId, ownerId);
    this.ownerId = ownerId;
    return this.restore(ownerId);
  }

  transfer(from: string, to: string, preserveTarget = false): void {
    if (from === to) return;
    if (preserveTarget && to === this.ownerId) this.snapshot(to);
    const source = this.volatile.get(from) || this.store.composer(from);
    const target = preserveTarget
      ? this.volatile.get(to) || this.store.composer(to)
      : null;
    this.store.transfer(from, to, preserveTarget);
    this.volatile.delete(from);
    const prefix =
      target?.text && target.text !== source.text && source.text
        ? `${source.text}\n`
        : "";
    this.put(
      to,
      target?.text
        ? {
            text: prefix + target.text,
            selectionStart: prefix.length + target.selectionStart,
            selectionEnd: prefix.length + target.selectionEnd,
          }
        : source,
    );
  }

  discard(ownerId: string): void {
    this.volatile.delete(ownerId);
    this.store.remove(ownerId);
    // Do not snapshot the discarded owner again during the following switch.
    if (this.ownerId === ownerId) {
      this.ownerId = "";
      this.field.value = "";
      this.field.setSelectionRange(0, 0);
    }
  }

  clear(ownerId: string): boolean {
    if (ownerId !== this.ownerId) return false;
    this.field.value = "";
    this.field.setSelectionRange(0, 0);
    this.volatile.delete(ownerId);
    return this.store.setComposer(ownerId, {
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
  }

  put(ownerId: string, value: ComposerViewState): boolean {
    const saved = this.store.setComposer(ownerId, value);
    if (saved) this.volatile.delete(ownerId);
    else this.volatile.set(ownerId, { ...value });
    if (ownerId === this.ownerId) this.restore(ownerId);
    return saved;
  }

  private restore(ownerId: string): ComposerViewState {
    const value = this.volatile.get(ownerId) || this.store.composer(ownerId);
    this.field.value = value.text;
    try {
      this.field.setSelectionRange(value.selectionStart, value.selectionEnd);
    } catch {}
    return value;
  }
}
