# js-idb

A lightweight JSON database for TypeScript with schema validation and indexed search. Zero dependencies. Works in-memory or persisted to disk.

- Written in TypeScript with full type inference
- Schema validation with `string`, `number`, `boolean`, `object` types
- Fast indexed search with prefix, suffix, contains, and range queries
- In-memory or file-based persistence
- Zero dependencies, Node.js 24+

## Install

```bash
npm install js-idb
```

## Quick start

```ts
import { createDB } from "js-idb";

const db = createDB({
  collections: {
    users: {
      schema: {
        name: { type: "string", index: true, indexSetting: { ignoreCase: true } },
        age: { type: "number", index: true },
        active: { type: "boolean", default: true },
        meta: { type: "object" },
      },
    },
  },
});

db.users.add({ name: "Josef", age: 30, active: true, meta: { role: "admin" } });
db.users.find({ name: "josef" }); // case-insensitive match
```

## Schema

Each collection requires a schema. Fields support four types:

| Type | JS type | Indexable | Notes |
|------|---------|-----------|-------|
| `string` | `string` | Yes | Supports `ignoreCase` index setting |
| `number` | `number` | Yes | NaN is rejected |
| `boolean` | `boolean` | Yes | |
| `object` | `Record<string, unknown>` | No | Arbitrary data, nesting allowed, no type checking on contents |

### Field options

```ts
{
  type: "string",            // required — field type
  index: true,               // optional — enable search via find()
  indexSetting: {             // optional — only for indexed string fields
    ignoreCase: true,
  },
  default: "",               // optional — applied when field is omitted on add
}
```

- All fields are required on `add` unless they have a `default`
- `default` values are validated against the field type at database creation
- `update` always accepts partial records

## API

### `createDB(options)`

Creates a database instance.

```ts
const db = createDB({
  path: "./data",  // optional — omit for in-memory only
  collections: {
    users: { schema: { /* ... */ } },
  },
});
```

With file persistence, each collection is stored as `<name>.data.json` and `<name>.meta.json`. Indexes are rebuilt from data on load.

### `collection.add(record): Document`

Inserts a single record. Returns the record with an auto-generated `_id`.

```ts
const doc = db.users.add({ name: "Josef", age: 30, active: true, meta: {} });
// doc._id — auto-generated unique ID
```

### `collection.addMany(records): Document[]`

Inserts multiple records in a single batch (one write operation).

```ts
const docs = db.users.addMany([
  { name: "Karel", age: 25, active: true, meta: {} },
  { name: "Anna", age: 35, active: false, meta: {} },
]);
```

### `collection.get(id): Document | undefined`

Retrieves a single record by ID.

```ts
const doc = db.users.get("some-id");
```

### `collection.all(): Document[]`

Returns all records in the collection.

```ts
const docs = db.users.all();
```

### `collection.find(query): Document[]`

Searches indexed fields. All queried fields must have `index: true`. Multiple fields are intersected (AND).

```ts
// String queries
db.users.find({ name: "josef" });       // exact match
db.users.find({ name: "jos%" });        // prefix
db.users.find({ name: "%sef" });        // suffix
db.users.find({ name: "%ose%" });       // contains

// Number queries
db.users.find({ age: "30" });           // exact
db.users.find({ age: ">20" });          // greater than
db.users.find({ age: ">=20" });         // greater than or equal
db.users.find({ age: "<30" });          // less than
db.users.find({ age: "<=30" });         // less than or equal

// Boolean queries
db.users.find({ active: "true" });

// Compound (intersection)
db.users.find({ name: "jos%", age: "<=30" });
```

### `collection.update(id, partial): Document`

Updates specific fields on an existing record. Accepts a partial record.

```ts
const updated = db.users.update(doc._id, { name: "Josef II" });
```

### `collection.remove(id): void`

Deletes a record by ID.

```ts
db.users.remove(doc._id);
```

### `collection.clear(): void`

Removes all records from the collection.

```ts
db.users.clear();
```

### `collection.count: number`

Returns the number of records in the collection.

```ts
db.users.count; // 42
```

### `db.collection(name)`

Access a collection by name (useful for dynamic access).

```ts
const col = db.collection("users");
```

## TypeScript

Types are inferred from the schema automatically:

```ts
const db = createDB({
  collections: {
    users: {
      schema: {
        name: { type: "string" },
        age: { type: "number" },
      },
    },
  },
});

const doc = db.users.add({ name: "Josef", age: 30 });
doc.name; // string
doc.age;  // number
doc._id;  // string
```

For more control (e.g. making fields with defaults optional), provide your own interface:

```ts
interface User {
  name: string;
  age: number;
  active?: boolean; // optional — schema has default: true
}

const db = createDB<{ users: User }>({
  collections: {
    users: {
      schema: {
        name: { type: "string", index: true },
        age: { type: "number" },
        active: { type: "boolean", default: true },
      },
    },
  },
});

db.users.add({ name: "Josef", age: 30 }); // active is optional
db.users.update(id, { age: 31 });         // Partial<User>
const doc = db.users.get(id);             // User & { _id: string } | undefined
```

## License

MIT
