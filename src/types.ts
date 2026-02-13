export type FieldType = 'string' | 'number' | 'boolean' | 'object';

export interface IndexSetting {
  ignoreCase?: boolean;
}

export interface FieldDefinition {
  type: FieldType;
  index?: boolean;
  /** Only valid for string fields with index: true */
  indexSetting?: IndexSetting;
  /** Default value applied when field is omitted during add/addMany */
  default?: unknown;
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

export type Document<T> = T & { _id: string };

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

export interface CollectionMeta {
  schema: Schema;
  indexes: Record<string, { value: string | number | boolean; id: string }[]>;
}
