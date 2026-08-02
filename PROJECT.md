# pgapi - Exposing your Postgres database as a GraphQL API, without writing code

## Overview

pgapi is a command-line tool, not unlike Hasura 2.0, whereby you provide your entity model in
Postgres schema, and have it exposed via a GraphQL endpoint.

pgapi has the following arguments:

--help

Print the usage text listing all available arguments and endpoints, then exit.

--connection-string <string>

The postgres connection string to connect to the database with ALL permissions.

--port <number>

The bind port to use. Default: 3000

--host <IP address>

The bind address to use. Default: 127.0.0.1

--console

This boolean flag gates the serving of a Graphiql frontend at the root "/console" path.

--oauth-issuer <URL>

The issuer URL of an OAuth 2.0 / OpenID Connect provider. When set, pgapi fetches the provider's OpenID configuration via the discovery endpoint (`/.well-known/openid-configuration`) and uses the published JWKS to validate Bearer tokens on every request. Supports RS256, RS384, RS512, ES256, ES384, and ES512 signatures.

Requires authentication (same as `--jwt-secret`). Override with `--auth optional`.

--oauth-audience <string>

Optional expected value for the `aud` (audience) claim in the JWT. If the token contains an `aud` claim, it must match this value. Accepts both string and array audiences (matches if the array includes the expected value).

--oauth-clock-skew <seconds>

Optional clock skew tolerance in seconds (default 10). Allows a token's `exp` and `iat` claims to differ from the server clock by up to this amount, which helps with clock drift between the IdP and pgapi.

## Operation

On startup, the tool should connect to the database and read the entire schema, plus any related schemas. After this is should build a memory model of the schema and create GraphQL schema from this model. When it is complete, it should serve this GrapgQL schema as an endpoint at "http://<host>:<port>/graphql". If the "--console" flag is present then also serve an instance of Graphiql at "http://<host>:<port>/console".

## Permissions

pgapi supports row-level permissions through Postgres functions. If you define specific functions in your database, pgapi discovers them at startup and automatically modifies the generated SQL to enforce access control.

### How It Works

1. **Discovery** — On startup, pgapi queries `pg_proc` for functions matching known naming patterns. If found, they're recorded against the relevant table.

2. **Session Variables** — Before each GraphQL request, pgapi sets two session variables from the JWT claims:
   - `x_pgapi.sub` — the `sub` claim (typically the user ID)
   - `x_pgapi.role` — the `role` claim (if present)

   Your functions read these via `current_setting('x_pgapi.sub')`.

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

Check functions return `boolean` and validate that a new or modified row is within allowed limits. They take **two text and one jsonb argument**: the user's sub, role, and the row data.

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
     OR (public = false AND owned_by = current_setting('x_pgapi.sub')::int)
$$ LANGUAGE sql STABLE;

-- Only allow deleting your own posts
CREATE FUNCTION posts_delete_filter()
RETURNS SETOF posts AS $$
  SELECT * FROM posts
   WHERE owned_by = current_setting('x_pgapi.sub')::int
$$ LANGUAGE sql STABLE;

-- Only allow updating your own posts
CREATE FUNCTION posts_update_filter()
RETURNS SETOF posts AS $$
  SELECT * FROM posts
  WHERE owned_by = current_setting('x_pgapi.sub')::int
$$ LANGUAGE sql STABLE;
```

#### Define the check functions

```sql
-- Ensure new posts are owned by the inserting user
CREATE FUNCTION posts_insert_check(_sub text, _role text, _row jsonb)
RETURNS boolean AS $$
  SELECT (_row ->> 'owned_by')::int = _sub::int
$$ LANGUAGE sql STABLE;

-- Ensure updated posts remain owned by the same user
CREATE FUNCTION posts_update_check(_sub text, _role text, _row jsonb)
RETURNS boolean AS $$
  SELECT (_row ->> 'owned_by')::int = _sub::int
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
  _sub text,      -- current_setting('x_pgapi.sub')
  _role text,     -- current_setting('x_pgapi.role')
  _row jsonb      -- ROW_TO_JSON(NEW)::jsonb
) RETURNS boolean;
```

The row argument is the entire row as a JSONB object. Access column values with `(_row->> 'column_name')` and cast as needed.

### Session Variables

pgapi sets these before each GraphQL request:

| Variable | Source | Type |
|----------|--------|------|
| `x_pgapi.sub` | JWT `sub` claim | text |
| `x_pgapi.role` | JWT `role` claim | text |

Read them in your functions with:
```sql
current_setting('x_pgapi.sub')
current_setting('x_pgapi.role')
```

When no authenticated user is present, both are set to `''`.

### Naming Convention Summary

| Function | Args | Returns | Purpose |
|----------|------|---------|---------|
| `{table}_select_filter()` | none | `SETOF {table}` | Limits visible rows for SELECT |
| `{table}_delete_filter()` | none | `SETOF {table}` | Limits deletable rows |
| `{table}_update_filter()` | none | `SETOF {table}` | Limits updatable rows |
| `{table}_insert_check(sub, role, row)` | 2 text + jsonb | `boolean` | Validates new rows |
| `{table}_update_check(sub, role, row)` | 2 text + jsonb | `boolean` | Validates modified rows |

Only define the functions you need. A missing function means no restriction for that operation.

## OAuth 2.0 / OpenID Connect Authentication

When you start pgapi with `--oauth-issuer <URL>`, it performs OpenID Connect Discovery to obtain the provider's JWKS (JSON Web Key Set) and validates every incoming Bearer token against it.

### Flow

1. **Discovery** — On startup, pgapi fetches `{issuer}/.well-known/openid-configuration` to find the `jwks_uri`.
2. **Key Retrieval** — pgapi fetches the JWKS from the `jwks_uri` and caches the keys in memory.
3. **Token Validation** — On each request, pgapi:
   - Extracts the Bearer token from the `Authorization` header.
   - Decodes the JWT header to find the `kid` (key ID) and `alg` (algorithm).
   - Looks up the matching key in the cached JWKS.
   - Verifies the RSA signature using Web Crypto.
   - Validates `exp` (not expired), `iat` (not from the future), and `iss` (matches the issuer, if present).

### Supported Algorithms

- **RSA**: RS256, RS384, RS512
- **ECDSA**: ES256 (P-256), ES384 (P-384), ES512 (P-521)

### Key Rotation

JWKS keys are refreshed automatically:
- **Periodic refresh** every 60 minutes
- **On-demand refresh** — if a token's `kid` isn't found in the cached keys, pgapi fetches fresh keys before rejecting

### Token Claims Validation

| Claim | Check | Configurable |
|-------|-------|-------------|
| `exp` | Must be after current time | `--oauth-clock-skew` for leeway |
| `iat` | Must not be in the future | `--oauth-clock-skew` for leeway |
| `iss` | Must match the issuer (if present) | Derived from discovery |
| `aud` | Must match expected value (if configured) | `--oauth-audience` |
| `alg` | Must be a supported asymmetric algorithm | `none` is rejected |
| `kid` | Must match a key in the JWKS | Auto-refresh on miss |

### Auth Failure Logging

All OIDC validation failures are logged server-side at the `warn` level with the `kid`, a truncated token prefix, and the error message — making it possible to diagnose token issues in production without reproducing them.

### Example

```bash
pgapi \
  --connection-string postgres://localhost/mydb \
  --oauth-issuer https://accounts.google.com \
  --oauth-audience my-client-id \
  --oauth-clock-skew 10
```

You can combine `--oauth-issuer` with `--api-key-header` to support both token and API key authentication. When both are present and a Bearer token is provided, OIDC validation takes priority.

## Agent Guide

- Language: Typescript, using "fp-ts" functional styles, "io-ts" codecs for wire types, bun package manager/runtime. The Reader-pattern will be our dependency injection. Programs should have Reader types which handle all their external actions, never pass an environment-specific client/property directly. Eg. no AWS clients, only "doAction() => TaskEither<E,A>".
- Development: AI agents are a developer, but so is a human. Keep "bun run dev" to run a watched build, "bun test" to run unit testing. Consider what you write tests for, preferably any module.
- Production: Aim for a single executable, which could be added to a basic Docker image.
- Progress: Keep a build plan/log; PROGRESS.md, so that work can be staged. Make this plan if it's missing and ALWAYS keep it updated.
- Git: Assume there's a Git repo and make use of it. Keep work in commits with sensible messages. We want this repo to make sense.
- Workflow: Question eveything, assume little. Ask the developer what they want, let them tell you. If you need to track choices then keep them in a RULES.md and make sure that doesn't go stale.
