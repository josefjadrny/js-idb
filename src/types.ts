export type FieldType = 'string' | 'number' | 'boolean' | 'object';

export interface IndexSetting {
  ignoreCase?: boolean;
}

export interface FieldDefinition {
  type: FieldType;
  index?: boolean;
  /** Only valid for string fields with index: true */
  indexSetting?: IndexSetting;
}

export type Schema = Record<string, FieldDefinition>;

export type InferFieldType<T extends FieldType> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'boolean' ? boolean :
  T extends 'object' ? Record<string, unknown> :
  never;

export type InferDocument<S extends Schema> = {
  [K in keyof S]: InferFieldType<S[K]['type']>;
};

export type Document<S extends Schema> = InferDocument<S> & { _id: string };

export interface CollectionConfig {
  schema: Schema;
}

export interface DatabaseOptions<T extends Record<string, CollectionConfig> = Record<string, CollectionConfig>> {
  /** Omit for in-memory (browser). Provide for file persistence (Node.js). */
  path?: string;
  collections: T;
}

export interface StorageAdapter {
  readData(collection: string): Record<string, Record<string, unknown>> | null;
  writeData(collection: string, data: Record<string, Record<string, unknown>>): void;
  readMeta(collection: string): CollectionMeta | null;
  writeMeta(collection: string, meta: CollectionMeta): void;
}

/** Indexes are rebuilt from data on load, so meta only stores the schema */
export interface CollectionMeta {
  schema: Schema;
}
