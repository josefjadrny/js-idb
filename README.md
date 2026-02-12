# js-db

A lightweight JSON database for TypeScript with schema validation and indexed search. Works in-memory or persisted to disk.

## Install

```bash
npm install js-db
```

## Usage

```ts
import { createDB } from "js-db";

const db = createDB({
  collections: {
    users: {
      schema: {
        name: { type: "string", index: true, indexSetting: { ignoreCase: true } },
        age: { type: "number", index: true },
        active: { type: "boolean" },
        meta: { type: "object" },
      },
    },
  },
});

// Add
const doc = db.users.add({ name: "Josef", age: 30, active: true, meta: { role: "admin" } });
// doc._id is auto-generated

// Bulk insert
db.users.addMany([
  { name: "Karel", age: 25, active: true, meta: {} },
  { name: "Anna", age: 35, active: false, meta: {} },
]);

// Get by ID
db.users.get(doc._id);

// Get all
db.users.all();

// Search (indexed fields only)
db.users.find({ name: "josef" });         // exact (case-insensitive)
db.users.find({ name: "jos%" });          // prefix
db.users.find({ name: "%sef" });          // suffix
db.users.find({ name: "%ose%" });         // contains
db.users.find({ age: ">20" });            // range: >, >=, <, <=
db.users.find({ name: "jos%", age: "<=30" }); // compound (intersection)

// Update
db.users.update(doc._id, { name: "Josef II" });

// Remove
db.users.remove(doc._id);

// Clear collection
db.users.clear();
```

## File persistence

Pass a `path` to persist data as JSON files on disk. Omit it for in-memory only.

```ts
const db = createDB({
  path: "./data",
  collections: {
    users: {
      schema: {
        name: { type: "string", index: true },
      },
    },
  },
});
```

Each collection is stored as `<name>.data.json` and `<name>.meta.json`. Indexes are rebuilt from data on load.

## Schema

Fields support four types: `string`, `number`, `boolean`, `object`.

- `index: true` enables search on the field via `find()` (not supported for `object`)
- `indexSetting: { ignoreCase: true }` for case-insensitive string indexes
- `object` fields must be flat (no nesting)
- All fields are required on `add`, partial updates are allowed on `update`

## License

MIT
