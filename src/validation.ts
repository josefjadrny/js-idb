import type { Schema } from './types.js';

export function validateSchema(schema: Schema): void {
  for (const [field, def] of Object.entries(schema)) {
    if (def.index && def.type === 'object') {
      throw new Error(`Field "${field}": cannot index 'object' type fields`);
    }
    if (def.indexSetting && !def.index) {
      throw new Error(`Field "${field}": indexSetting requires index: true`);
    }
    if (def.indexSetting && def.type !== 'string') {
      throw new Error(`Field "${field}": indexSetting is only valid for 'string' type fields`);
    }
  }
}

/**
 * @param isPartial - true for update (missing fields allowed), false for add (all required)
 */
export function validateRecord(
  record: Record<string, unknown>,
  schema: Schema,
  isPartial: boolean,
): void {
  const schemaKeys = new Set(Object.keys(schema));

  for (const key of Object.keys(record)) {
    if (!schemaKeys.has(key)) {
      throw new Error(`Unknown field "${key}" is not defined in the schema`);
    }
  }

  for (const [field, def] of Object.entries(schema)) {
    const value = record[field];

    if (value === undefined) {
      if (!isPartial) {
        throw new Error(`Missing required field "${field}"`);
      }
      continue;
    }

    switch (def.type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Field "${field}" must be of type string, got ${typeof value}`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new Error(`Field "${field}" must be of type number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Field "${field}" must be of type boolean, got ${typeof value}`);
        }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error(`Field "${field}" must be a plain object`);
        }
        // Flat only — no nested objects allowed
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'object' && v !== null) {
            throw new Error(`Field "${field}.${k}" contains a nested object — only flat objects are allowed`);
          }
        }
        break;
    }
  }
}
