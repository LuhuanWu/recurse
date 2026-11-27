// Opaque per-owner browser resources share the bounded session-owner lifecycle.
// Promotion transfers; removal/eviction disposes. No owner-named storage/side maps.
// Store pins protect the separately bounded retained drafts; ordinary saved and
// ephemeral owners still compete for the same cache limit.
import { MAX_RETAINED_OWNERS } from "./schema.js";

export interface OwnerResourceStore<T> {
  get(ownerId: string): T | undefined;
  set(ownerId: string, value: T): boolean;
  take(ownerId: string): T | undefined;
  remove(ownerId: string): void;
  entries(): [string, T][];
}

export interface ManagedOwnerResource {
  transfer(fromOwnerId: string, toOwnerId: string): void;
  remove(ownerId: string): void;
}

export class OwnerResourceStoreImpl<T>
  implements OwnerResourceStore<T>, ManagedOwnerResource
{
  private values = new Map<string, T>();

  constructor(
    private retain: (ownerId: string) => boolean,
    private dispose: (value: T) => void,
    private pinned: (ownerId: string) => boolean = () => false,
  ) {}

  get(ownerId: string): T | undefined {
    return this.values.get(ownerId);
  }

  set(ownerId: string, value: T): boolean {
    if (!this.retain(ownerId)) return false;
    const previous = this.values.get(ownerId);
    if (previous !== undefined && previous !== value) this.dispose(previous);
    this.values.delete(ownerId);
    this.values.set(ownerId, value);
    for (const id of this.values.keys()) {
      if (this.values.size <= MAX_RETAINED_OWNERS) break;
      if (!this.pinned(id)) this.remove(id);
    }
    return true;
  }

  take(ownerId: string): T | undefined {
    const value = this.values.get(ownerId);
    this.values.delete(ownerId);
    return value;
  }

  remove(ownerId: string): void {
    const value = this.take(ownerId);
    if (value !== undefined) this.dispose(value);
  }

  entries(): [string, T][] {
    return [...this.values.entries()];
  }

  transfer(fromOwnerId: string, toOwnerId: string): void {
    if (fromOwnerId === toOwnerId) return;
    const value = this.take(fromOwnerId);
    if (value === undefined) return;
    const previous = this.values.get(toOwnerId);
    if (previous !== undefined && previous !== value) this.dispose(previous);
    this.values.delete(toOwnerId);
    this.values.set(toOwnerId, value);
  }
}
