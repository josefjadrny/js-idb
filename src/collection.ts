import type { Schema, Document, InferDocument, StorageAdapter } from './types.js';
import { Index } from './index-store.js';
import { generateId } from './id.js';
import { validateRecord } from './validation.js';

export class Collection<S extends Schema> {
  readonly name: string;
  private schema: S;
  private data: Map<string, Record<string, unknown>>;
  private indexes: Map<string, Index>;
  private storage: StorageAdapter;

  constructor(name: string, schema: S, storage: StorageAdapter) {
    this.name = name;
    this.schema = schema;
    this.storage = storage;
    this.data = new Map();
    this.indexes = new Map();

    for (const [field, def] of Object.entries(schema)) {
      if (def.index) {
        this.indexes.set(field, new Index(field, def.type, def.indexSetting?.ignoreCase));
      }
    }

    this.load();
  }

  private load(): void {
    const rawData = this.storage.readData(this.name);
    if (!rawData) return;

    for (const [id, record] of Object.entries(rawData)) {
      this.data.set(id, record);
      for (const [field, index] of this.indexes) {
        const val = record[field];
        if (val !== undefined) {
          index.add(id, val as string | number | boolean);
        }
      }
    }
  }

  private save(): void {
    const obj: Record<string, Record<string, unknown>> = {};
    for (const [id, record] of this.data) {
      obj[id] = record;
    }
    this.storage.writeData(this.name, obj);
    this.storage.writeMeta(this.name, { schema: this.schema });
  }

  private toDocument(id: string, record: Record<string, unknown>): Document<S> {
    return { _id: id, ...record } as Document<S>;
  }

  add(record: InferDocument<S>): Document<S> {
    validateRecord(record as Record<string, unknown>, this.schema, false);

    const id = generateId();
    const raw = { ...record } as Record<string, unknown>;
    this.data.set(id, raw);

    for (const [field, index] of this.indexes) {
      const val = raw[field];
      if (val !== undefined) {
        index.add(id, val as string | number | boolean);
      }
    }

    this.save();
    return this.toDocument(id, raw);
  }

  /** Single save at the end instead of per-record */
  addMany(records: InferDocument<S>[]): Document<S>[] {
    const docs: Document<S>[] = [];

    for (const record of records) {
      validateRecord(record as Record<string, unknown>, this.schema, false);

      const id = generateId();
      const raw = { ...record } as Record<string, unknown>;
      this.data.set(id, raw);

      for (const [field, index] of this.indexes) {
        const val = raw[field];
        if (val !== undefined) {
          index.add(id, val as string | number | boolean);
        }
      }

      docs.push(this.toDocument(id, raw));
    }

    this.save();
    return docs;
  }

  get(id: string): Document<S> | undefined {
    const record = this.data.get(id);
    if (!record) return undefined;
    return this.toDocument(id, record);
  }

  all(): Document<S>[] {
    return [...this.data.entries()].map(([id, record]) => this.toDocument(id, record));
  }

  /** All queried fields must be indexed. Compound queries intersect results. */
  find(query: Record<string, string>): Document<S>[] {
    const queryEntries = Object.entries(query);
    if (queryEntries.length === 0) {
      return this.all();
    }

    let resultIds: Set<string> | null = null;

    for (const [field, queryStr] of queryEntries) {
      const index = this.indexes.get(field);
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

    return [...resultIds!].map(id => this.get(id)!);
  }

  update(id: string, partial: Partial<InferDocument<S>>): Document<S> {
    const existing = this.data.get(id);
    if (!existing) {
      throw new Error(`Record "${id}" not found`);
    }

    validateRecord(partial as Record<string, unknown>, this.schema, true);

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
    this.save();
    return this.toDocument(id, existing);
  }

  remove(id: string): void {
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
    this.save();
  }

  clear(): void {
    this.data.clear();
    for (const index of this.indexes.values()) {
      index.clear();
    }
    this.save();
  }

  get count(): number {
    return this.data.size;
  }
}
