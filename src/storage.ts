import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageAdapter, CollectionMeta } from './types.js';

export class MemoryAdapter implements StorageAdapter {
  private dataStore = new Map<string, Record<string, Record<string, unknown>>>();
  private metaStore = new Map<string, CollectionMeta>();

  readData(collection: string): Record<string, Record<string, unknown>> | null {
    return this.dataStore.get(collection) ?? null;
  }

  writeData(collection: string, data: Record<string, Record<string, unknown>>): void {
    this.dataStore.set(collection, data);
  }

  readMeta(collection: string): CollectionMeta | null {
    return this.metaStore.get(collection) ?? null;
  }

  writeMeta(collection: string, meta: CollectionMeta): void {
    this.metaStore.set(collection, meta);
  }
}

export class FileAdapter implements StorageAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }
  }

  private dataPath(collection: string): string {
    return join(this.basePath, `${collection}.data.json`);
  }

  private metaPath(collection: string): string {
    return join(this.basePath, `${collection}.meta.json`);
  }

  readData(collection: string): Record<string, Record<string, unknown>> | null {
    const p = this.dataPath(collection);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, Record<string, unknown>>;
  }

  writeData(collection: string, data: Record<string, Record<string, unknown>>): void {
    writeFileSync(this.dataPath(collection), JSON.stringify(data, null, 2));
  }

  readMeta(collection: string): CollectionMeta | null {
    const p = this.metaPath(collection);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as CollectionMeta;
  }

  writeMeta(collection: string, meta: CollectionMeta): void {
    writeFileSync(this.metaPath(collection), JSON.stringify(meta, null, 2));
  }
}
