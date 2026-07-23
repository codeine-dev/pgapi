# pgapi - Exposing your Postgres database as a GraphQL API, without writing code

## Overview

pgapi is a command-line tool, not unlike Hasura 2.0, whereby you provide your entity model in
Postgres schema, and have it exposed via a GraphQL endpoint.

pgapi has the following arguments:

--connection-string <string>

The postgres connection string to connect to the database with ALL permissions.

--port <number>

The bind port to use. Default: 3000

--host <IP address>

The bind address to use. Default: 127.0.0.1

--console

This boolean flag gates the serving of a Graphiql frontend at the root "/console" path.

## Operation

On startup, the tool should connect to the database and read the entire schema, plus any related schemas. After this is should build a memory model of the schema and create GraphQL schema from this model. When it is complete, it should serve this GrapgQL schema as an endpoint at "http://<host>:<port>/graphql". If the "--console" flag is present then also serve an instance of Graphiql at "http://<host>:<port>/console".

## Permissions

pgapi supports row-level permissions through Postgres functions. If you define specific functions in your database, pgapi discovers them at startup and automatically modifies the generated SQL to enforce access control.

### How It Works

1. **Discovery** — On startup, pgapi queries `pg_proc` for functions matching known naming patterns. If found, they're recorded against the relevant table.

2. **Session Variables** — Before each GraphQL request, pgapi sets two session variables from the JWT claims:
   - `x_pgapi.sub` — the `sub` claim (typically the user ID)
   - `x_pgapi.role` — the `role` claim (if present)

   Your functions read these via `current_setting('x_pgapi.sub')::jsonb`.

3. **Query Modification** — When a filter function exists for an operation, pgapi replaces the table source with the function. When a check function exists, pgapi creates a BEFORE INSERT/UPDATE trigger that calls it.

4. **No Functions = No Change** — If no permission functions are found, pgapi behaves exactly as before. The system is entirely opt-in.

### Function Types

There are two kinds of permission functions: **filters** and **checks**.

#### Filters (row-limiters)

Filter functions return `SETOF {table_type}` — a subset of rows the caller is allowed to see. They take **no arguments** and read the session variables directly.

| Function | Operation | SQL Change |
|----------|-----------|------------|
| `{table}_select_filter()` | SELECT (list + byPk + FK resolution) | `FROM "schema"."table_select_filter"()` instead of the table |
| `{table}_delete_filter()` | DELETE | `DELETE FROM "schema"."table_delete_filter"()` instead of the table |
| `{table}_update_filter()` | UPDATE | `AND "pk" IN (SELECT "pk" FROM "schema"."table_update_filter")` added to WHERE |

Your user-supplied WHERE clauses are applied **within** the filter result, so a user can only narrow what the filter already permits.

#### Checks (row-validators)

Check functions return `boolean` and validate that a new or modified row is within allowed limits. They take **three jsonb arguments**: the user's sub, role, and the row data.

| Function | When Called |
|----------|------------|
| `{table}_insert_check(sub, role, row)` | BEFORE INSERT trigger — validates the new row |
| `{table}_update_check(sub, role, row)` | BEFORE UPDATE trigger — validates the modified row |

pgapi creates these triggers automatically at startup. If the check function returns `false`, the trigger raises an exception and the mutation is rejected.

### Example: Blog Schema

Given a `posts` table and a `users` table:

```sql
CREATE TABLE users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'user'
);

CREATE TABLE posts (
  id serial PRIMARY KEY,
  title text NOT NULL,
  body text,
  public boolean DEFAULT false,
  owned_by int REFERENCES users(id)
);
```

#### Define the filter functions

```sql
-- Only return public posts, or private posts owned by the current user
CREATE FUNCTION posts_select_filter()
RETURNS SETOF posts AS $$
  SELECT * FROM posts
  WHERE public = true
     OR (public = false AND owned_by = (current_setting('x_pgapi.sub')::jsonb ->> 'user_id')::int)
$$ LANGUAGE sql STABLE;

-- Only allow deleting your own posts
CREATE FUNCTION posts_delete_filter()
RETURNS SETOF posts AS $$
  SELECT * FROM posts
  WHERE owned_by = (current_setting('x_pgapi.sub')::jsonb ->> 'user_id')::int
$$ LANGUAGE sql STABLE;

-- Only allow updating your own posts
CREATE FUNCTION posts_update_filter()
RETURNS SETOF posts AS $$
  SELECT * FROM posts
  WHERE owned_by = (current_setting('x_pgapi.sub')::jsonb ->> 'user_id')::int
$$ LANGUAGE sql STABLE;
```

#### Define the check functions

```sql
-- Ensure new posts are owned by the inserting user
CREATE FUNCTION posts_insert_check(_sub jsonb, _role jsonb, _row jsonb)
RETURNS boolean AS $$
  SELECT (_row ->> 'owned_by')::int = (_sub ->> 'user_id')::int
$$ LANGUAGE sql STABLE;

-- Ensure updated posts remain owned by the same user
CREATE FUNCTION posts_update_check(_sub jsonb, _role jsonb, _row jsonb)
RETURNS boolean AS $$
  SELECT (_row ->> 'owned_by')::int = (_sub ->> 'user_id')::int
$$ LANGUAGE sql STABLE;
```

#### What pgapi generates

With these functions in place, pgapi modifies the SQL for each operation:

**SELECT** — filter applied as table source:
```sql
SELECT "id", "title", "body", "public", "owned_by"
FROM "public.posts_select_filter"()
WHERE "public" = $1
```

**DELETE** — filter applied as table source:
```sql
DELETE FROM "public.posts_delete_filter"()
WHERE "id" = $1
RETURNING *
```

**UPDATE** — filter applied via subquery:
```sql
UPDATE "public"."posts"
SET "title" = $1
WHERE "id" = $2
  AND "id" IN (SELECT "id" FROM "public.posts_update_filter"())
RETURNING *
```

**INSERT** — unchanged SQL, but a BEFORE INSERT trigger validates the row:
```sql
INSERT INTO "public"."posts" ("title", "body", "public", "owned_by")
VALUES ($1, $2, $3, $4) RETURNING *
-- Trigger calls posts_insert_check() and raises if it returns false
```

### Check Function Signature

Check functions must follow this exact signature:

```sql
CREATE FUNCTION {table}_{insert|update}_check(
  _sub jsonb,    -- current_setting('x_pgapi.sub')::jsonb
  _role jsonb,   -- current_setting('x_pgapi.role')::jsonb
  _row jsonb     -- ROW_TO_JSON(NEW)::jsonb
) RETURNS boolean;
```

The row argument is the entire row as a JSONB object. Access column values with `(_row->> 'column_name')` and cast as needed.

### Session Variables

pgapi sets these before each GraphQL request:

| Variable | Source | Type |
|----------|--------|------|
| `x_pgapi.sub` | JWT `sub` claim | jsonb string |
| `x_pgapi.role` | JWT `role` claim | jsonb string |

Read them in your functions with:
```sql
current_setting('x_pgapi.sub')::jsonb
current_setting('x_pgapi.role')::jsonb
```

When no authenticated user is present, both are set to `'{}'`.

### Naming Convention Summary

| Function | Args | Returns | Purpose |
|----------|------|---------|---------|
| `{table}_select_filter()` | none | `SETOF {table}` | Limits visible rows for SELECT |
| `{table}_delete_filter()` | none | `SETOF {table}` | Limits deletable rows |
| `{table}_update_filter()` | none | `SETOF {table}` | Limits updatable rows |
| `{table}_insert_check(sub, role, row)` | 3 jsonb | `boolean` | Validates new rows |
| `{table}_update_check(sub, role, row)` | 3 jsonb | `boolean` | Validates modified rows |

Only define the functions you need. A missing function means no restriction for that operation.

## Agent Guide

- Language: Typescript, using "fp-ts" functional styles, "io-ts" codecs for wire types, bun package manager/runtime. The Reader-pattern will be our dependency injection. Programs should have Reader types which handle all their external actions, never pass an environment-specific client/property directly. Eg. no AWS clients, only "doAction() => TaskEither<E,A>".
- Development: AI agents are a developer, but so is a human. Keep "bun run dev" to run a watched build, "bun test" to run unit testing. Consider what you write tests for, preferably any module.
- Production: Aim for a single executable, which could be added to a basic Docker image.
- Progress: Keep a build plan/log; PROGRESS.md, so that work can be staged. Make this plan if it's missing and ALWAYS keep it updated.
- Git: Assume there's a Git repo and make use of it. Keep work in commits with sensible messages. We want this repo to make sense.
- Workflow: Question eveything, assume little. Ask the developer what they want, let them tell you. If you need to track choices then keep them in a RULES.md and make sure that doesn't go stale.
