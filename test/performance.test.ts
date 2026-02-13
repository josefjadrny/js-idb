import { createDB } from '../src/database.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RECORD_COUNT = 1000;

const schema = {
  name: { type: 'string' as const, index: true, indexSetting: { ignoreCase: true } },
  age: { type: 'number' as const, index: true },
  active: { type: 'boolean' as const, index: true, default: true },
  meta: { type: 'object' as const },
};

function generateRecords(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `User_${i}`,
    age: 18 + (i % 60),
    active: i % 5 !== 0,
    meta: { role: i % 3 === 0 ? 'admin' : 'user' },
  }));
}

function measure(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(2)}ms`);
  return ms;
}

describe('Performance — in-memory', () => {
  const records = generateRecords(RECORD_COUNT);

  test(`addMany ${RECORD_COUNT} records`, () => {
    const db = createDB({ collections: { users: { schema } } });
    const ms = measure(`addMany x${RECORD_COUNT}`, () => {
      db.users.addMany(records);
    });
    expect(db.users.count).toBe(RECORD_COUNT);
    expect(ms).toBeLessThan(1000);
  });

  test(`add ${RECORD_COUNT} records one by one`, () => {
    const db = createDB({ collections: { users: { schema } } });
    const ms = measure(`add x${RECORD_COUNT}`, () => {
      for (const record of records) {
        db.users.add(record);
      }
    });
    expect(db.users.count).toBe(RECORD_COUNT);
    expect(ms).toBeLessThan(2000);
  });

  test(`get ${RECORD_COUNT} records by id`, () => {
    const db = createDB({ collections: { users: { schema } } });
    const docs = db.users.addMany(records);
    const ids = docs.map(d => d._id);

    const ms = measure(`get x${RECORD_COUNT}`, () => {
      for (const id of ids) {
        db.users.get(id);
      }
    });
    expect(ms).toBeLessThan(500);
  });

  test('all() returns all records', () => {
    const db = createDB({ collections: { users: { schema } } });
    db.users.addMany(records);

    const ms = measure(`all x${RECORD_COUNT}`, () => {
      const result = db.users.all();
      expect(result).toHaveLength(RECORD_COUNT);
    });
    expect(ms).toBeLessThan(500);
  });

  test('find — exact string match', () => {
    const db = createDB({ collections: { users: { schema } } });
    db.users.addMany(records);

    const ms = measure('find exact string', () => {
      const result = db.users.find({ name: 'user_500' });
      expect(result).toHaveLength(1);
    });
    expect(ms).toBeLessThan(100);
  });

  test('find — prefix search', () => {
    const db = createDB({ collections: { users: { schema } } });
    db.users.addMany(records);

    const ms = measure('find prefix', () => {
      const result = db.users.find({ name: 'user_5%' });
      expect(result.length).toBeGreaterThan(0);
    });
    expect(ms).toBeLessThan(200);
  });

  test('find — number range', () => {
    const db = createDB({ collections: { users: { schema } } });
    db.users.addMany(records);

    const ms = measure('find age > 50', () => {
      const result = db.users.find({ age: '>50' });
      expect(result.length).toBeGreaterThan(0);
    });
    expect(ms).toBeLessThan(200);
  });

  test('find — boolean', () => {
    const db = createDB({ collections: { users: { schema } } });
    db.users.addMany(records);

    const ms = measure('find active=true', () => {
      const result = db.users.find({ active: 'true' });
      expect(result.length).toBeGreaterThan(0);
    });
    expect(ms).toBeLessThan(200);
  });

  test('find — compound query', () => {
    const db = createDB({ collections: { users: { schema } } });
    db.users.addMany(records);

    const ms = measure('find compound', () => {
      const result = db.users.find({ name: 'user_%', age: '<=30' });
      expect(result.length).toBeGreaterThan(0);
    });
    expect(ms).toBeLessThan(200);
  });

  test(`update ${RECORD_COUNT} records`, () => {
    const db = createDB({ collections: { users: { schema } } });
    const docs = db.users.addMany(records);

    const ms = measure(`update x${RECORD_COUNT}`, () => {
      for (const doc of docs) {
        db.users.update(doc._id, { age: doc.age + 1 });
      }
    });
    expect(ms).toBeLessThan(2000);
  });

  test(`remove ${RECORD_COUNT} records`, () => {
    const db = createDB({ collections: { users: { schema } } });
    const docs = db.users.addMany(records);

    const ms = measure(`remove x${RECORD_COUNT}`, () => {
      for (const doc of docs) {
        db.users.remove(doc._id);
      }
    });
    expect(db.users.count).toBe(0);
    expect(ms).toBeLessThan(2000);
  });
});

describe('Performance — file persistence', () => {
  let tmpDir: string;
  const records = generateRecords(RECORD_COUNT);

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jsdb-perf-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test(`addMany ${RECORD_COUNT} records`, () => {
    const db = createDB({ path: tmpDir, collections: { users: { schema } } });
    const ms = measure(`file addMany x${RECORD_COUNT}`, () => {
      db.users.addMany(records);
    });
    expect(db.users.count).toBe(RECORD_COUNT);
    expect(ms).toBeLessThan(2000);
  });

  test(`add ${RECORD_COUNT} records one by one`, () => {
    const db = createDB({ path: tmpDir, collections: { users: { schema } } });
    const ms = measure(`file add x${RECORD_COUNT}`, () => {
      for (const record of records) {
        db.users.add(record);
      }
    });
    expect(db.users.count).toBe(RECORD_COUNT);
    expect(ms).toBeLessThan(10000);
  });

  test('startup with persisted indexes', () => {
    const db1 = createDB({ path: tmpDir, collections: { users: { schema } } });
    db1.users.addMany(records);

    const ms = measure(`file startup x${RECORD_COUNT}`, () => {
      createDB({ path: tmpDir, collections: { users: { schema } } });
    });
    expect(ms).toBeLessThan(2000);
  });

  test('find reads from disk', () => {
    const db1 = createDB({ path: tmpDir, collections: { users: { schema } } });
    db1.users.addMany(records);

    const db2 = createDB({ path: tmpDir, collections: { users: { schema } } });
    const ms = measure('file find from disk', () => {
      const result = db2.users.find({ name: 'user_500' });
      expect(result).toHaveLength(1);
    });
    expect(ms).toBeLessThan(500);
  });

  test(`update ${RECORD_COUNT} records`, () => {
    const db = createDB({ path: tmpDir, collections: { users: { schema } } });
    const docs = db.users.addMany(records);

    const ms = measure(`file update x${RECORD_COUNT}`, () => {
      for (const doc of docs) {
        db.users.update(doc._id, { age: doc.age + 1 });
      }
    });
    expect(ms).toBeLessThan(15000);
  });
});
