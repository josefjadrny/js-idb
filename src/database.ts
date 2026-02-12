import type { Schema, CollectionConfig, StorageAdapter } from './types.js';
import { Collection } from './collection.js';
import { MemoryAdapter, FileAdapter } from './storage.js';
import { validateSchema } from './validation.js';

type DBCollections<T extends Record<string, CollectionConfig>> = {
  [K in keyof T]: Collection<T[K]['schema']>;
};

type DBInstance<T extends Record<string, CollectionConfig>> = DBCollections<T> & {
  collection<K extends keyof T & string>(name: K): Collection<T[K]['schema']>;
};

export function createDB<T extends Record<string, CollectionConfig>>(
  options: { path?: string; collections: T },
): DBInstance<T> {
  const storage: StorageAdapter = options.path
    ? new FileAdapter(options.path)
    : new MemoryAdapter();

  const collections = new Map<string, Collection<Schema>>();

  for (const [name, config] of Object.entries(options.collections)) {
    validateSchema(config.schema);
    const col = new Collection(name, config.schema, storage);
    collections.set(name, col);
  }

  const db = {} as Record<string, unknown>;

  for (const [name, col] of collections) {
    db[name] = col;
  }

  db['collection'] = (name: string) => {
    const col = collections.get(name);
    if (!col) {
      throw new Error(`Collection "${name}" does not exist`);
    }
    return col;
  };

  return db as DBInstance<T>;
}
