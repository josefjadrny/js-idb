import { createDB } from '../src/database.js';
import { Collection } from '../src/collection.js';
import { Index } from '../src/index-store.js';
import { MemoryAdapter, FileAdapter } from '../src/storage.js';
import { generateId } from '../src/id.js';
import { validateRecord, validateSchema } from '../src/validation.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------
describe('generateId', () => {
  test('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------
describe('validateSchema', () => {
  test('rejects index on object fields', () => {
    expect(() => validateSchema({ meta: { type: 'object', index: true } }))
      .toThrow('cannot index');
  });

  test('rejects indexSetting on non-string fields', () => {
    expect(() => validateSchema({ age: { type: 'number', index: true, indexSetting: { ignoreCase: true } } }))
      .toThrow('only valid for');
  });

  test('rejects indexSetting without index', () => {
    expect(() => validateSchema({ name: { type: 'string', indexSetting: { ignoreCase: true } } }))
      .toThrow('requires index: true');
  });

  test('accepts valid schema', () => {
    expect(() => validateSchema({
      name: { type: 'string', index: true, indexSetting: { ignoreCase: true } },
      age: { type: 'number', index: true },
      active: { type: 'boolean' },
      meta: { type: 'object' },
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Record validation
// ---------------------------------------------------------------------------
describe('validateRecord', () => {
  const schema = {
    name: { type: 'string' as const },
    age: { type: 'number' as const },
    active: { type: 'boolean' as const },
    meta: { type: 'object' as const },
  };

  test('accepts valid full record', () => {
    expect(() => validateRecord(
      { name: 'Josef', age: 30, active: true, meta: { foo: 'bar' } },
      schema, false,
    )).not.toThrow();
  });

  test('rejects unknown fields', () => {
    expect(() => validateRecord(
      { name: 'Josef', age: 30, active: true, meta: {}, unknown: 'x' },
      schema, false,
    )).toThrow('Unknown field');
  });

  test('rejects missing required fields', () => {
    expect(() => validateRecord({ name: 'Josef' }, schema, false))
      .toThrow('Missing required field');
  });

  test('allows missing fields in partial mode', () => {
    expect(() => validateRecord({ name: 'Karel' }, schema, true))
      .not.toThrow();
  });

  test('rejects wrong type', () => {
    expect(() => validateRecord(
      { name: 123, age: 30, active: true, meta: {} },
      schema, false,
    )).toThrow('must be of type string');
  });

  test('rejects NaN for number fields', () => {
    expect(() => validateRecord(
      { name: 'Josef', age: NaN, active: true, meta: {} },
      schema, false,
    )).toThrow('must be of type number');
  });

  test('rejects nested objects in object fields', () => {
    expect(() => validateRecord(
      { name: 'Josef', age: 30, active: true, meta: { nested: { deep: 1 } } },
      schema, false,
    )).toThrow('nested object');
  });

  test('rejects arrays for object fields', () => {
    expect(() => validateRecord(
      { name: 'Josef', age: 30, active: true, meta: [1, 2] },
      schema, false,
    )).toThrow('plain object');
  });
});

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------
describe('Index', () => {
  describe('string index', () => {
    test('exact match', () => {
      const idx = new Index('name', 'string');
      idx.add('1', 'Josef');
      idx.add('2', 'Karel');
      idx.add('3', 'Josef');
      expect(idx.find('Josef').sort()).toEqual(['1', '3']);
      expect(idx.find('Karel')).toEqual(['2']);
      expect(idx.find('Nobody')).toEqual([]);
    });

    test('prefix search', () => {
      const idx = new Index('name', 'string');
      idx.add('1', 'Josef');
      idx.add('2', 'Josefina');
      idx.add('3', 'Karel');
      expect(idx.find('Josef%').sort()).toEqual(['1', '2']);
    });

    test('suffix search', () => {
      const idx = new Index('name', 'string');
      idx.add('1', 'Josef');
      idx.add('2', 'BigJosef');
      idx.add('3', 'Karel');
      expect(idx.find('%Josef').sort()).toEqual(['1', '2']);
    });

    test('contains search', () => {
      const idx = new Index('name', 'string');
      idx.add('1', 'Josef');
      idx.add('2', 'BigJosefina');
      idx.add('3', 'Karel');
      expect(idx.find('%Josef%').sort()).toEqual(['1', '2']);
    });

    test('ignoreCase', () => {
      const idx = new Index('name', 'string', true);
      idx.add('1', 'Josef');
      idx.add('2', 'JOSEF');
      expect(idx.find('josef').sort()).toEqual(['1', '2']);
      expect(idx.find('Josef%').sort()).toEqual(['1', '2']);
      expect(idx.find('%osef').sort()).toEqual(['1', '2']);
    });

    test('remove', () => {
      const idx = new Index('name', 'string');
      idx.add('1', 'Josef');
      idx.add('2', 'Josef');
      idx.remove('1', 'Josef');
      expect(idx.find('Josef')).toEqual(['2']);
    });

    test('clear', () => {
      const idx = new Index('name', 'string');
      idx.add('1', 'Josef');
      idx.clear();
      expect(idx.size).toBe(0);
      expect(idx.find('Josef')).toEqual([]);
    });
  });

  describe('number index', () => {
    test('exact match', () => {
      const idx = new Index('age', 'number');
      idx.add('1', 30);
      idx.add('2', 25);
      idx.add('3', 30);
      expect(idx.find('30').sort()).toEqual(['1', '3']);
    });

    test('greater than', () => {
      const idx = new Index('age', 'number');
      idx.add('1', 10);
      idx.add('2', 20);
      idx.add('3', 30);
      expect(idx.find('>10').sort()).toEqual(['2', '3']);
    });

    test('greater than or equal', () => {
      const idx = new Index('age', 'number');
      idx.add('1', 10);
      idx.add('2', 20);
      idx.add('3', 30);
      expect(idx.find('>=20').sort()).toEqual(['2', '3']);
    });

    test('less than', () => {
      const idx = new Index('age', 'number');
      idx.add('1', 10);
      idx.add('2', 20);
      idx.add('3', 30);
      expect(idx.find('<20')).toEqual(['1']);
    });

    test('less than or equal', () => {
      const idx = new Index('age', 'number');
      idx.add('1', 10);
      idx.add('2', 20);
      idx.add('3', 30);
      expect(idx.find('<=20').sort()).toEqual(['1', '2']);
    });
  });

  describe('boolean index', () => {
    test('exact match', () => {
      const idx = new Index('active', 'boolean');
      idx.add('1', true);
      idx.add('2', false);
      idx.add('3', true);
      expect(idx.find('true').sort()).toEqual(['1', '3']);
      expect(idx.find('false')).toEqual(['2']);
    });
  });
});

// ---------------------------------------------------------------------------
// Collection (with MemoryAdapter)
// ---------------------------------------------------------------------------
describe('Collection', () => {
  const schema = {
    name: { type: 'string' as const, index: true, indexSetting: { ignoreCase: true } },
    age: { type: 'number' as const, index: true },
    sex: { type: 'string' as const },
  };

  function makeCollection() {
    return new Collection('users', schema, new MemoryAdapter());
  }

  test('add returns document with _id', () => {
    const col = makeCollection();
    const doc = col.add({ name: 'Josef', age: 30, sex: 'male' });
    expect(doc._id).toBeDefined();
    expect(doc.name).toBe('Josef');
    expect(doc.age).toBe(30);
  });

  test('add validates schema', () => {
    const col = makeCollection();
    expect(() => (col as any).add({ name: 'Josef' })).toThrow('Missing required');
    expect(() => (col as any).add({ name: 123, age: 30, sex: 'male' })).toThrow('must be of type string');
  });

  test('addMany inserts multiple', () => {
    const col = makeCollection();
    const docs = col.addMany([
      { name: 'Josef', age: 30, sex: 'male' },
      { name: 'Karel', age: 25, sex: 'male' },
    ]);
    expect(docs).toHaveLength(2);
    expect(col.count).toBe(2);
  });

  test('get returns document by id', () => {
    const col = makeCollection();
    const doc = col.add({ name: 'Josef', age: 30, sex: 'male' });
    const found = col.get(doc._id);
    expect(found).toEqual(doc);
  });

  test('get returns undefined for missing id', () => {
    const col = makeCollection();
    expect(col.get('nonexistent')).toBeUndefined();
  });

  test('all returns all documents', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'Karel', age: 25, sex: 'male' });
    expect(col.all()).toHaveLength(2);
  });

  test('find exact match', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'Karel', age: 25, sex: 'male' });
    const results = col.find({ name: 'josef' }); // ignoreCase
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Josef');
  });

  test('find prefix', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'Josefina', age: 25, sex: 'female' });
    col.add({ name: 'Karel', age: 40, sex: 'male' });
    const results = col.find({ name: 'josef%' });
    expect(results).toHaveLength(2);
  });

  test('find suffix', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'BigJosef', age: 25, sex: 'male' });
    col.add({ name: 'Karel', age: 40, sex: 'male' });
    const results = col.find({ name: '%josef' });
    expect(results).toHaveLength(2);
  });

  test('find contains', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'BigJosefina', age: 25, sex: 'female' });
    col.add({ name: 'Karel', age: 40, sex: 'male' });
    const results = col.find({ name: '%josef%' });
    expect(results).toHaveLength(2);
  });

  test('find numeric range', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'Karel', age: 25, sex: 'male' });
    col.add({ name: 'Anna', age: 10, sex: 'female' });
    const results = col.find({ age: '>20' });
    expect(results).toHaveLength(2);
  });

  test('find compound query (intersection)', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'Josefina', age: 15, sex: 'female' });
    col.add({ name: 'Karel', age: 40, sex: 'male' });
    const results = col.find({ name: 'josef%', age: '>20' });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Josef');
  });

  test('find throws on non-indexed field', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    expect(() => col.find({ sex: 'male' })).toThrow('not indexed');
  });

  test('update by id', () => {
    const col = makeCollection();
    const doc = col.add({ name: 'Josef', age: 30, sex: 'male' });
    const updated = col.update(doc._id, { name: 'Karel' });
    expect(updated.name).toBe('Karel');
    expect(updated.age).toBe(30);

    // Verify reindexed
    expect(col.find({ name: 'josef' })).toHaveLength(0);
    expect(col.find({ name: 'karel' })).toHaveLength(1);
  });

  test('update validates partial', () => {
    const col = makeCollection();
    const doc = col.add({ name: 'Josef', age: 30, sex: 'male' });
    expect(() => (col as any).update(doc._id, { name: 123 })).toThrow('must be of type string');
  });

  test('update throws on missing id', () => {
    const col = makeCollection();
    expect(() => col.update('nonexistent', { name: 'Karel' })).toThrow('not found');
  });

  test('remove by id', () => {
    const col = makeCollection();
    const doc = col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.remove(doc._id);
    expect(col.count).toBe(0);
    expect(col.find({ name: 'josef' })).toHaveLength(0);
  });

  test('remove throws on missing id', () => {
    const col = makeCollection();
    expect(() => col.remove('nonexistent')).toThrow('not found');
  });

  test('clear wipes everything', () => {
    const col = makeCollection();
    col.add({ name: 'Josef', age: 30, sex: 'male' });
    col.add({ name: 'Karel', age: 25, sex: 'male' });
    col.clear();
    expect(col.count).toBe(0);
    expect(col.all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createDB factory
// ---------------------------------------------------------------------------
describe('createDB', () => {
  test('creates typed collection properties', () => {
    const db = createDB({
      collections: {
        users: {
          schema: {
            name: { type: 'string', index: true },
            age: { type: 'number', index: true },
          },
        },
      },
    });

    const doc = db.users.add({ name: 'Josef', age: 30 });
    expect(doc._id).toBeDefined();
    expect(db.users.count).toBe(1);
  });

  test('collection() method for dynamic access', () => {
    const db = createDB({
      collections: {
        users: {
          schema: {
            name: { type: 'string', index: true },
          },
        },
      },
    });

    db.users.add({ name: 'Josef' });
    const col = db.collection('users');
    expect(col.count).toBe(1);
  });

  test('collection() throws for unknown collection', () => {
    const db = createDB({
      collections: {
        users: { schema: { name: { type: 'string' } } },
      },
    });

    expect(() => (db as any).collection('nonexistent')).toThrow('does not exist');
  });

  test('validates schema at creation time', () => {
    expect(() => createDB({
      collections: {
        users: {
          schema: {
            meta: { type: 'object', index: true },
          },
        },
      },
    })).toThrow('cannot index');
  });
});

// ---------------------------------------------------------------------------
// FileAdapter persistence
// ---------------------------------------------------------------------------
describe('FileAdapter persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jsdb-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('data persists across createDB calls', () => {
    const schema = {
      name: { type: 'string' as const, index: true, indexSetting: { ignoreCase: true } },
      age: { type: 'number' as const, index: true },
    };

    // Write
    const db1 = createDB({ path: tmpDir, collections: { users: { schema } } });
    const doc = db1.users.add({ name: 'Josef', age: 30 });

    // Read in new instance
    const db2 = createDB({ path: tmpDir, collections: { users: { schema } } });
    expect(db2.users.count).toBe(1);
    const found = db2.users.get(doc._id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Josef');

    // Indexes rebuilt — search works
    const results = db2.users.find({ name: 'josef' });
    expect(results).toHaveLength(1);
  });

  test('clear persists', () => {
    const schema = { name: { type: 'string' as const } };
    const db1 = createDB({ path: tmpDir, collections: { items: { schema } } });
    db1.items.add({ name: 'test' });
    db1.items.clear();

    const db2 = createDB({ path: tmpDir, collections: { items: { schema } } });
    expect(db2.items.count).toBe(0);
  });
});



