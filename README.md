# sqlc-typescript

A super lightweight TypeScript types generator that respects your laziness and love for raw SQL.

Zero runtime dependencies, just types. This is just a super thin wrapper around [sqlc](https://sqlc.dev/) and a file generator - all the real magic is in sqlc. It just makes it more convenient to use in TypeScript projects.

## Demo 🚀

<img alt="image" src="https://github.com/user-attachments/assets/0556e61c-72ab-465e-86b7-3013e1b82c6f" />

<details>
  <summary>Video</summary>
  
  https://github.com/user-attachments/assets/dba59632-6c4c-48fe-80f0-da1514e2da1a
</details>

## Why? 🤔

If you're like me - you just want to write SQL, ship features and not deal with heavy abstractions or spend hours reading documentation (even if it's really good). That's exactly why this exists.

### The Problem

- ORMs are complex and make you learn their quirks
- SQL-like query builders still make you learn their syntax and requires rewriting existing queries to their format
- Writing SQL in separate files is annoying
- Maintaining function names for every query is tedious
- Other tools require database connections for type inference (which isn't always accurate)

### The Solution 🎯

Write SQL directly in your TypeScript files, get perfect types, and ship faster. That's it.

```typescript
// Your SQL lives right in your code
const result = await sqlc(/*sql*/ `
    SELECT 
        customer_id,
        first_name,
        last_name
    FROM
        customer 
    WHERE 
        customer_id = @customer_id
`).exec(client, {
    customer_id: 1,
});

// result: { customer_id: number, first_name: string | null, last_name: string }[]
```

## Installation 🛠️

```bash
# Using npm
npm install sqlc-typescript

# Using yarn
yarn add sqlc-typescript

# Using pnpm
pnpm add sqlc-typescript
```

## Configuration 📝

Create a `sqlc.json` in your project root:

```json
{
    "include": "src/**/*.ts",
    "schema": "schema.sql",
    "output": "src/sqlc.ts",
    "columns": {
        "customer.customer_id": "UUID"
    },
    "imports": ["import { UUID } from '../types'"]
}
```

## Usage 💻

1. Write your SQL queries in TypeScript files using the `/*sql*/` tag:

```typescript
import { sqlc } from './sqlc';

// Get customer details
const customer = await sqlc(/*sql*/ `
    SELECT 
        customer_id,
        first_name,
        last_name,
        email
    FROM 
        customer 
    WHERE 
        customer_id = @customer_id
`).exec(client, {
    customer_id: '123e4567-e89b-12d3-a456-426614174000',
});

// Types are automatically inferred!
customer[0].first_name; // string
customer[0].email; // string | null
```

2. Run the generator:

```bash
npx sqlc-typescript generate -c sqlc.json

# Or watch mode
npx sqlc-typescript watch -c sqlc.json
```

## How It Works Under The Hood 🔧

1. **File Scanning**: The tool scans your TypeScript files for SQL queries marked with `/*sql*/`
2. **Type Generation**: Uses [sqlc](https://github.com/sqlc-dev/sqlc) under the hood to analyze your SQL and generate types
3. **Zero Runtime Overhead**: All the magic happens at build time - no runtime dependencies!

### Why Tagged Templates Can't Be Used 🏷️

Unfortunately, we can't use tagged template literals like `` sql`SELECT * FROM users` `` for proper syntax highlighting. TypeScript template literals [can't be generic](https://github.com/microsoft/TypeScript/issues/33304), so we can use the `/*sql*/` comment approach instead. Your IDE or SQL plugin will still provide syntax highlighting!

### Comparison with Other Tools 🔍

- [pgTyped](https://github.com/adelsz/pgtyped): Requires separate SQL files and function imports. It uses PostgreSQL wire protocol for type inference which requires a database connection and can't handle nullability well.
- [Prisma TypedSQL](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql): SQL files are separate and require function imports and it's Prisma 🫠.
- [SafeQL](https://github.com/ts-safeql/safeql): Great tool but requires ESLint and database connection for type inference.

The key difference: We use sqlc's SQL parser instead of PostgreSQL wire protocol for type inference, which means:

- More accurate types
- Better nullability inference for complex joins
- No database connection needed
- Just need a schema dump (`pg_dump --schema-only`)

## SQL Formatting 💅

You can use Prettier with SQL plugins to format your queries inside the template literals. The generator preserves formatting and comments.

```typescript
// This will be properly formatted
sqlc(/*sql*/ `
    SELECT 
        id, 
        name,
        email 
    FROM 
        users 
    WHERE 
        active = true
`).exec(client);
```

## Roadmap 🛣️

- Support for all sqlc features and database support beyond PostgreSQL
- Automatic result unflattening using column aliases

## Limitations ⚠️

- PostgreSQL only (for now)
- Queries must be statically analyzable (no dynamic SQL) which is good and bad at the same time
- All queries must use the `/*sql*/` tag until TypeScript supports generic template literals

## Credits 🙏

Big thanks to:

- [sqlc](https://github.com/sqlc-dev/sqlc) team for the amazing SQL parser and type generator
- Other projects like pgTyped, Prisma, and SafeQL for inspiration
