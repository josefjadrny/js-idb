# js-db Implementation Plan

## Context

Build a zero-dependency JSON file-based database library with schema validation, indexed field search (including wildcard and range queries), and TypeScript type safety. Works on Node.js (file-based persistence) and browser (in-memory).

## API Surface

```ts
import { createDB } from 'js-db';

const db = createDB({
  path: './data',           // optional, omit for in-memory (browser)
  collections: {
    users: {
      schema: {
        name: { type: 'string', index: true, indexSetting: { ignoreCase: true } },
        age:  { type: 'number', index: true },
        sex:  { type: 'string' }
      }
    }
  }
});

// CRUD
const doc = db.users.add({ name: 'Josef', age: 30, sex: 'male' }); // → full Document with _id
db.users.get('some-id')                    // → single Document by _id, or undefined
db.users.all()                             // → all Documents
db.users.addMany([{...}, {...}])           // → bulk insert, single write to disk
db.users.update('some-id', { name: 'K' }) // → update by _id, reindexes
db.users.remove('some-id')                // → remove by _id, deindexes
db.users.clear()                           // → wipe all records + indexes

// Search — object syntax, all queried fields must be indexed (throws otherwise)
db.users.find({ name: 'josef' })                    // single field exact match
db.users.find({ name: 'josef%' })                   // prefix → "josefina"
db.users.find({ name: '%josef' })                   // suffix → "ajosef"
db.users.find({ name: '%josef%' })                  // contains → "ajosefina"
db.users.find({ age: '>10' })                       // numeric range
db.users.find({ age: '>=20' })
db.users.find({ name: 'josef%', age: '>20' })       // compound — intersects results
db.users.find({ sex: 'male' })                      // ERROR: 'sex' not indexed

// Dynamic collection name access (for when name is a variable)
db.collection('users').find({ name: 'josef' })
```

### Why `createDB()` instead of `db.collections()`

`import { db }; db.collections({...}); db.users.find(...)` has a TypeScript problem: calling `db.collections()` can't retroactively change the type of `db` to add `.users`. TypeScript types are static.

`createDB()` solves this — the return type is inferred from the config, so `db.users` is fully typed at compile time.

No `db('users')` callable pattern (Proxy complexity not worth it). Instead, `db.collection('users')` as a simple method for dynamic name access.

## Schema Field Definition

```ts
{
  type: 'string' | 'number' | 'boolean' | 'object',
  index?: boolean,           // default false — only indexed fields are searchable
  indexSetting?: {
    ignoreCase?: boolean,    // default false, only valid for 'string' fields
  }
}
```

Validation at schema registration time:
- `index: true` on `type: 'object'` → throws (can't index objects)
- `indexSetting` on non-string field → throws
- `ignoreCase` on non-string field → throws

## Known Limitations (documented, by design)

- `%` is reserved as wildcard in `find()` queries — cannot search for literal `%`
- All data loaded into memory — not suitable for datasets > ~100MB
- Sorted array index: O(n) insert, O(log n) search — fine for JSON DB scale

## Files to Create/Modify

### 1. `src/types.ts` — REWRITE
- `FieldType`: `'string' | 'number' | 'boolean' | 'object'`
- `IndexSetting`: `{ ignoreCase?: boolean }`
- `FieldDefinition`: `{ type, index?, indexSetting? }`
- `Schema`, `InferDocument<S>`, `Document<S>` (adds `_id: string`)
- `CollectionConfig`, `DatabaseOptions`
- `StorageAdapter` interface (readData/writeData/readMeta/writeMeta)
- `CollectionMeta` for serialization (schema only — indexes rebuilt from data)

### 2. `src/id.ts` — CREATE (~10 lines)
- `generateId()`: `crypto.randomUUID()` with `Math.random` hex fallback

### 3. `src/validation.ts` — CREATE
- `validateRecord(record, schema, isPartial)`:
  - Rejects unknown fields not in schema
  - Checks types via `typeof`
  - `isPartial=false` (add): all fields required
  - `isPartial=true` (update): only provided fields checked
  - Rejects nested objects in `'object'` type fields
- `validateSchema(schema)`:
  - Rejects `index: true` on `'object'` fields
  - Rejects `indexSetting` on non-string fields

### 4. `src/storage.ts` — CREATE
- `MemoryAdapter`: in-memory Maps (browser + Node)
- `FileAdapter`: sync `node:fs` read/write — **lazy imported** to avoid breaking browser bundlers
  - `{path}/{collection}.data.json` — `{ "id1": {...}, "id2": {...} }`
  - `{path}/{collection}.meta.json` — `{ schema: {...} }` (schema only, no index data)
- Indexes are always rebuilt from data on startup (simpler, no stale index bugs)

### 5. `src/index-store.ts` — REWRITE
Sorted array of `{ value, id }` entries with binary search.

| Query | Algorithm | Complexity |
|---|---|---|
| `'Josef'` exact | Binary search → collect | O(log n + k) |
| `'josef%'` prefix | Binary search start → scan | O(log n + k) |
| `'%josef'` suffix | Linear `endsWith` | O(n) |
| `'%josef%'` contains | Linear `includes` | O(n) |
| `'>10'` `'>=20'` `'<50'` `'<=30'` | Binary search boundary → range | O(log n + k) |
| `'30'` (number exact) | Parse as number → binary search | O(log n + k) |

- Constructor: `(field, fieldType, ignoreCase)`
- `ignoreCase=true` → lowercases values for comparison
- Methods: `add()`, `remove()`, `find()`, `clear()`

### 6. `src/collection.ts` — REWRITE
- `add(record)` → validate → _id → store → index → save → return Document
- `addMany(records)` → same as add but single save at the end
- `get(id)` → lookup by _id → return Document | undefined
- `all()` → return all Documents
- `find(query)` → for each field in query: check indexed → index.find → intersect ID sets → return Documents
- `update(id, partial)` → validate → deindex changed fields only → reindex → merge → save
- `remove(id)` → deindex → delete → save
- `clear()` → reset data + indexes → save

### 7. `src/database.ts` — REWRITE
- `createDB<T>(options)` factory
- Returns object with collection name properties + `.collection(name)` method
- Type: `{ [K in keyof T]: Collection<T[K]['schema']> } & { collection(name): Collection }`
- Validates all schemas at creation time
- Picks `FileAdapter` if `path` given, else `MemoryAdapter`

### 8. `src/index.ts` — UPDATE
Export `createDB`, `Collection`, `Index`, `MemoryAdapter`, `FileAdapter`, types

### 9. `src/__tests__/database.test.ts` — CREATE
- **ID generation**: uniqueness, format
- **Validation**: type checks, unknown fields, partial mode, nested rejection, schema validation
- **Index**: all query patterns, ignoreCase, add/remove/clear
- **Collection**: full CRUD, `get()`, `all()`, `addMany()`, validation errors, non-indexed find error
- **createDB**: factory, typed `db.users`, `db.collection('users')`, file persistence (temp dir)

## Verification
1. `npm run build` — compiles cleanly
2. `npm test` — all tests pass
3. Smoke test: create db with file path, add records, find with patterns, verify JSON files
