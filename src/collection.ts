import type { Schema, Document, StorageAdapter, CollectionMeta } from './types.js';
import { Index } from './index-store.js';
import { generateId } from './id.js';
import { validateRecord } from './validation.js';
import { FileAdapter } from './storage.js';

export class Collection<T = Record<string, unknown>> {
  readonly name: string;
  private schema: Schema;
  private storage: StorageAdapter;
  private fileMode: boolean;

  // Only used in memory mode
  private data: Map<string, Record<string, unknown>>;
  private indexes: Map<string, Index>;

  constructor(name: string, schema: Schema, storage: StorageAdapter) {
    this.name = name;
    this.schema = schema;
    this.storage = storage;
    this.fileMode = storage instanceof FileAdapter;
    this.data = new Map();
    this.indexes = new Map();

    if (this.fileMode) {
      this.initFileMode();
    } else {
      this.initMemoryIndexes();
    }
  }

  private initMemoryIndexes(): void {
    for (const [field, def] of Object.entries(this.schema)) {
      if (def.index) {
        this.indexes.set(field, new Index(field, def.type, def.indexSetting?.ignoreCase));
      }
    }
  }

  private initFileMode(): void {
    const meta = this.storage.readMeta(this.name);
    if (meta) {
      if (!this.schemasMatch(meta.schema)) {
        // Schema changed — wipe stale data and start fresh
        this.storage.writeData(this.name, {});
        this.storage.writeMeta(this.name, this.buildMeta(new Map()));
      }
    } else {
      // First run — create empty files
      this.storage.writeData(this.name, {});
      this.storage.writeMeta(this.name, this.buildMeta(new Map()));
    }
  }

  private schemasMatch(stored: Schema): boolean {
    const currentKeys = Object.keys(this.schema).sort();
    const storedKeys = Object.keys(stored).sort();

    if (currentKeys.length !== storedKeys.length) return false;

    for (let i = 0; i < currentKeys.length; i++) {
      if (currentKeys[i] !== storedKeys[i]) return false;

      const curr = this.schema[currentKeys[i]!]!;
      const prev = stored[storedKeys[i]!]!;

      if (curr.type !== prev.type) return false;
      if (!!curr.index !== !!prev.index) return false;
      if (curr.indexSetting?.ignoreCase !== prev.indexSetting?.ignoreCase) return false;
    }
    return true;
  }

  private buildMeta(indexes: Map<string, Index>): CollectionMeta {
    const serialized: Record<string, { value: string | number | boolean; id: string }[]> = {};
    for (const [field, index] of indexes) {
      serialized[field] = index.serialize();
    }
    return { schema: this.schema, indexes: serialized };
  }

  private buildIndexes(): Map<string, Index> {
    const indexes = new Map<string, Index>();
    for (const [field, def] of Object.entries(this.schema)) {
      if (def.index) {
        indexes.set(field, new Index(field, def.type, def.indexSetting?.ignoreCase));
      }
    }
    return indexes;
  }

  private loadIndexesFromMeta(): Map<string, Index> {
    const meta = this.storage.readMeta(this.name);
    if (!meta || !meta.indexes) return this.buildIndexes();

    const indexes = new Map<string, Index>();
    for (const [field, def] of Object.entries(this.schema)) {
      if (def.index) {
        const entries = meta.indexes[field];
        if (entries) {
          indexes.set(field, Index.fromEntries(field, def.type, def.indexSetting?.ignoreCase ?? false, entries));
        } else {
          indexes.set(field, new Index(field, def.type, def.indexSetting?.ignoreCase));
        }
      }
    }
    return indexes;
  }

  private readData(): Map<string, Record<string, unknown>> {
    const rawData = this.storage.readData(this.name);
    if (!rawData) return new Map();
    return new Map(Object.entries(rawData));
  }

  private writeData(data: Map<string, Record<string, unknown>>): void {
    const obj: Record<string, Record<string, unknown>> = {};
    for (const [id, record] of data) {
      obj[id] = record;
    }
    this.storage.writeData(this.name, obj);
  }

  private applyDefaults(record: Record<string, unknown>): Record<string, unknown> {
    const result = { ...record };
    for (const [field, def] of Object.entries(this.schema)) {
      if (result[field] === undefined && def.default !== undefined) {
        result[field] = def.type === 'object'
          ? { ...(def.default as Record<string, unknown>) }
          : def.default;
      }
    }
    return result;
  }

  private toDocument(id: string, record: Record<string, unknown>): Document<T> {
    return { _id: id, ...record } as Document<T>;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  add(record: T): Document<T> {
    const withDefaults = this.applyDefaults(record as Record<string, unknown>);
    validateRecord(withDefaults, this.schema, false);

    const id = generateId();

    if (this.fileMode) {
      const data = this.readData();
      data.set(id, withDefaults);
      this.writeData(data);

      const indexes = this.loadIndexesFromMeta();
      for (const [field, index] of indexes) {
        const val = withDefaults[field];
        if (val !== undefined) {
          index.add(id, val as string | number | boolean);
        }
      }
      this.storage.writeMeta(this.name, this.buildMeta(indexes));
    } else {
      this.data.set(id, withDefaults);
      for (const [field, index] of this.indexes) {
        const val = withDefaults[field];
        if (val !== undefined) {
          index.add(id, val as string | number | boolean);
        }
      }
    }

    return this.toDocument(id, withDefaults);
  }

  addMany(records: T[]): Document<T>[] {
    const docs: Document<T>[] = [];
    const validated: [string, Record<string, unknown>][] = [];

    for (const record of records) {
      const withDefaults = this.applyDefaults(record as Record<string, unknown>);
      validateRecord(withDefaults, this.schema, false);
      validated.push([generateId(), withDefaults]);
    }

    if (this.fileMode) {
      const data = this.readData();
      const indexes = this.loadIndexesFromMeta();

      for (const [id, raw] of validated) {
        data.set(id, raw);
        for (const [field, index] of indexes) {
          const val = raw[field];
          if (val !== undefined) {
            index.add(id, val as string | number | boolean);
          }
        }
        docs.push(this.toDocument(id, raw));
      }

      this.writeData(data);
      this.storage.writeMeta(this.name, this.buildMeta(indexes));
    } else {
      for (const [id, raw] of validated) {
        this.data.set(id, raw);
        for (const [field, index] of this.indexes) {
          const val = raw[field];
          if (val !== undefined) {
            index.add(id, val as string | number | boolean);
          }
        }
        docs.push(this.toDocument(id, raw));
      }
    }

    return docs;
  }

  get(id: string): Document<T> | undefined {
    if (this.fileMode) {
      const data = this.readData();
      const record = data.get(id);
      if (!record) return undefined;
      return this.toDocument(id, record);
    }

    const record = this.data.get(id);
    if (!record) return undefined;
    return this.toDocument(id, record);
  }

  all(): Document<T>[] {
    if (this.fileMode) {
      const data = this.readData();
      return [...data.entries()].map(([id, record]) => this.toDocument(id, record));
    }

    return [...this.data.entries()].map(([id, record]) => this.toDocument(id, record));
  }

  find(query: Record<string, string>): Document<T>[] {
    const queryEntries = Object.entries(query);
    if (queryEntries.length === 0) {
      return this.all();
    }

    const indexes = this.fileMode ? this.loadIndexesFromMeta() : this.indexes;

    let resultIds: Set<string> | null = null;

    for (const [field, queryStr] of queryEntries) {
      const index = indexes.get(field);
      if (!index) {
        throw new Error(`Field "${field}" is not indexed. Add "index: true" to the schema to enable search.`);
      }

      const ids = new Set(index.find(queryStr));

      if (resultIds === null) {
        resultIds = ids;
      } else {
        for (const id of resultIds) {
          if (!ids.has(id)) {
            resultIds.delete(id);
          }
        }
      }

      if (resultIds.size === 0) return [];
    }

    if (this.fileMode) {
      const data = this.readData();
      return [...resultIds!].map(id => this.toDocument(id, data.get(id)!));
    }

    return [...resultIds!].map(id => this.get(id)!);
  }

  update(id: string, partial: Partial<T>): Document<T> {
    validateRecord(partial as Record<string, unknown>, this.schema, true);

    if (this.fileMode) {
      const data = this.readData();
      const existing = data.get(id);
      if (!existing) {
        throw new Error(`Record "${id}" not found`);
      }

      const indexes = this.loadIndexesFromMeta();
      for (const [field, index] of indexes) {
        const newVal = (partial as Record<string, unknown>)[field];
        if (newVal === undefined) continue;
        const oldVal = existing[field];
        if (oldVal !== undefined) {
          index.remove(id, oldVal as string | number | boolean);
        }
        index.add(id, newVal as string | number | boolean);
      }

      Object.assign(existing, partial);
      this.writeData(data);
      this.storage.writeMeta(this.name, this.buildMeta(indexes));
      return this.toDocument(id, existing);
    }

    const existing = this.data.get(id);
    if (!existing) {
      throw new Error(`Record "${id}" not found`);
    }

    for (const [field, index] of this.indexes) {
      const newVal = (partial as Record<string, unknown>)[field];
      if (newVal === undefined) continue;
      const oldVal = existing[field];
      if (oldVal !== undefined) {
        index.remove(id, oldVal as string | number | boolean);
      }
      index.add(id, newVal as string | number | boolean);
    }

    Object.assign(existing, partial);
    return this.toDocument(id, existing);
  }

  remove(id: string): void {
    if (this.fileMode) {
      const data = this.readData();
      const existing = data.get(id);
      if (!existing) {
        throw new Error(`Record "${id}" not found`);
      }

      const indexes = this.loadIndexesFromMeta();
      for (const [field, index] of indexes) {
        const val = existing[field];
        if (val !== undefined) {
          index.remove(id, val as string | number | boolean);
        }
      }

      data.delete(id);
      this.writeData(data);
      this.storage.writeMeta(this.name, this.buildMeta(indexes));
      return;
    }

    const existing = this.data.get(id);
    if (!existing) {
      throw new Error(`Record "${id}" not found`);
    }

    for (const [field, index] of this.indexes) {
      const val = existing[field];
      if (val !== undefined) {
        index.remove(id, val as string | number | boolean);
      }
    }

    this.data.delete(id);
  }

  clear(): void {
    if (this.fileMode) {
      this.storage.writeData(this.name, {});
      this.storage.writeMeta(this.name, this.buildMeta(new Map()));
      return;
    }

    this.data.clear();
    for (const index of this.indexes.values()) {
      index.clear();
    }
  }

  get count(): number {
    if (this.fileMode) {
      const data = this.readData();
      return data.size;
    }
    return this.data.size;
  }
}
