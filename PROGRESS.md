# pgapi - Progress Log

## Phase 8: Realtime Subscriptions (complete)

- [x] `src/realtime.ts`: `ensureChangeTriggers()` creates `pgapi_change_notify()` trigger function + AFTER INSERT/UPDATE/DELETE triggers on all tables, publishing `{schema, table, operation, row}` to the `pgapi_changes` channel
- [x] `SubscriptionManager`: LISTEN/UNLISTEN lifecycle, per-`schema.table` listener fan-out, tolerant of malformed/foreign payloads
- [x] `src/graphql.ts`: `Subscription` root type with `{table}Changed` fields; `event` enum (`INSERT`/`UPDATE`/`DELETE`) and `where` filter args; in-memory row matching with query operators
- [x] Custom `SubscriptionIterator` (interruptible async iterable) so `mapAsyncIterable` return() can cancel blocked subscriptions without hanging
- [x] Shared cached `Where`/`OrderBy` input types across Query/Mutation/Subscription (fixes duplicate-type-name schema errors)
- [x] `src/websocket.ts`: `graphql-transport-ws` protocol server at `/graphql` (connection_init auth → `connection_ack`/`connection_error` + 4401, subscribe/complete/error/next, ping keepalive every 30s, close 1002 on invalid JSON, session variables set for authenticated subscriptions)
- [x] Server startup wiring: wss attached to HTTP server; manager `start()`/`stop()` lifecycle in `startServer` and `index.ts`
- [x] GraphiQL console: bundled `graphql-ws` client (`scripts/graphql-ws-entry.ts`, embedded at build via `embed-assets.ts`), `wsClient` passed to `createFetcher`
- [x] Unit tests: realtime (5), schema subscription generation, subscription resolvers, websocket protocol + auth, graphql-ws static asset (136 total at completion of phase, typecheck clean)
- [x] Integration tests (28): subscription delivery of real INSERT/DELETE via triggers against live Postgres (`examples/test-schema.sql` fixture; `PGAPI_TEST_DB_URL` env override)
- [x] Documentation in README.md and PROJECT.md

## Phase 7: CLI --help (complete)

- [x] `--help` / `-h` prints usage text listing all arguments and endpoints
- [x] Help works without a connection string
- [x] Exits 0 after printing help
- [x] Unit tests for --help, -h, and combined with other args
- [x] Documentation in README.md and PROJECT.md

## Phase 1: Project Setup (complete)

- [x] Initialize git repo
- [x] Set up bun project
- [x] Install dependencies: fp-ts, io-ts, graphql, pg, vitest
- [x] Create project structure (src/, tests/)
- [x] CLI argument parsing (--connection-string, --port, --host, --console)
- [x] Database connection module (fp-ts Reader pattern)
- [x] Schema reading from Postgres (information_schema)
- [x] In-memory schema model (Table, Column, ForeignKey)
- [x] GraphQL schema generation from model
- [x] GraphQL HTTP server with /graphql endpoint
- [x] GraphiQL console endpoint at /console
- [x] Entry point wiring everything together
- [x] Unit tests for CLI (5 tests, all passing)
- [x] Typecheck passing

## Phase 2: Schema Reading (complete)

- [x] Read tables, columns, types, constraints
- [x] Read foreign key relationships (with schema qualifiers)
- [x] Handle schemas beyond public (--schema flag, repeatable)
- [x] Build internal model from Postgres catalog
- [x] Read enum types from pg_type/pg_enum
- [x] Column defaults and unique constraints
- [x] Array column detection
- [x] 12 tests passing, typecheck clean

## Phase 3: GraphQL Generation (complete)

- [x] Map Postgres types to GraphQL scalar types
- [x] Generate query types for each table (list + byPk)
- [x] Generate mutation types (insert, update, delete)
- [x] Resolve relationships as nested types (FK fields)
- [x] Implement resolvers (list, byPk, insert, update, delete, FK)
- [x] SQL query builder with parameterized queries
- [x] Where input types per table (eq, neq, gt, gte, lt, lte, like, in)
- [x] OrderBy input types per table
- [x] InsertInput / UpdateInput per table (skips PK columns)
- [x] ResolverContext with persistent DB client + model
- [x] 34 tests passing, typecheck clean

## Phase 4: Server & Console (complete)

- [x] HTTP server with graphql endpoint
- [x] GraphiQL console at /console
- [x] Error handling & logging
- [x] Structured logging with levels (debug, info, warn, error)
- [x] Request logging (method, path, status, duration)
- [x] Graceful shutdown (SIGTERM/SIGINT, DB client cleanup)
- [x] GET /graphql support for queries
- [x] Single executable build (bun build --compile)
- [x] Dockerfile (multi-stage: build with bun, runtime on debian-slim)
- [x] 34 tests passing, typecheck clean

## Phase 6: OAuth 2.0 / OpenID Connect (complete)

- [x] CLI arg: --oauth-issuer for IdP URL
- [x] OpenID Connect Discovery (fetches .well-known/openid-configuration)
- [x] JWKS retrieval and caching at startup
- [x] RS256/RS384/RS512 signature verification via Web Crypto
- [x] Token validation: exp, iat, iss, kid matching, alg=none rejection
- [x] On-demand JWKS refresh on unknown kid (auto-refetch before rejecting)
- [x] Periodic JWKS refresh every 60 minutes
- [x] ECDSA support (ES256/ES384/ES512)
- [x] Audience claim validation (--oauth-audience)
- [x] Clock skew tolerance (--oauth-clock-skew)
- [x] Server-side auth failure logging (kid, token prefix, error message)
- [x] Integration with existing auth middleware (prefers OIDC over jwtSecret)
- [x] Tests: valid token, invalid signature, expired, issuer, audience, clock skew, ECDSA, unknown kid, alg=none, refresh
- [x] Documentation in PROJECT.md
- [x] 50 tests passing (auth + cli + codecs), typecheck clean (3 pre-existing errors)

## Phase 5: Stretch Goals (complete)

### io-ts Runtime Validation

- [x] Define io-ts codecs for CLI arguments (connection-string, port, host, console, schema)
- [x] Define io-ts codecs for wire types (WhereInput, OrderByInput, InsertInput, UpdateInput)
- [x] Replace manual type assertions with io-ts validation
- [x] Add validation error handling with structured error messages
- [x] Tests for codec validation (valid/invalid inputs)

### Auth Middleware

- [x] JWT verification middleware (configurable via --jwt-secret)
- [x] API key header validation (configurable via --api-key-header)
- [x] Optional auth mode (--auth optional/required)
- [x] Pass auth context to resolvers (user/sub claims)
- [x] Tests for auth middleware (valid/invalid tokens, missing auth)

### Row-Level Permissions

- [x] Schema discovery: read permission functions from pg_proc (filter + check patterns)
- [x] Session variables: set x_pgapi.sub and x_pgapi.role from JWT before each request
- [x] Filter-aware SQL builders (buildSelectWithFilter, buildDeleteWithFilter, buildUpdateWithFilter, buildSelectByFkWithFilter)
- [x] Permission-aware resolvers: all 6 resolvers route to filter builders when functions exist
- [x] Check trigger creation: generic pgapi_check_trigger() with dynamic EXECUTE, BEFORE INSERT/UPDATE triggers
- [x] Startup integration: ensureCheckTriggers() called after schema discovery
- [x] Permissions tests (unit: setSessionVariables, ensureCheckTriggers; integration: filter limiting, check reject/allow)
- [x] SQL builder tests for all 4 new builders
- [x] 96 tests passing, typecheck clean

### Integration Tests

- [x] Set up test database with schema fixtures
- [x] CRUD operation tests (create, read, update, delete)
- [x] Relationship resolution tests (FK nested queries)
- [x] Where clause operator tests (eq, neq, gt, lt, like, in)
- [x] OrderBy and pagination tests
- [x] View query tests
- [x] Auth middleware integration tests
- [x] Error handling tests (invalid input, missing required fields)
- [x] Permission function integration tests (select filter, insert check)

- [x] HTTP server with graphql endpoint
- [x] GraphiQL console at /console
- [x] Error handling & logging
- [x] Structured logging with levels (debug, info, warn, error)
- [x] Request logging (method, path, status, duration)
- [x] Graceful shutdown (SIGTERM/SIGINT, DB client cleanup)
- [x] GET /graphql support for queries
- [x] Single executable build (bun build --compile)
- [x] Dockerfile (multi-stage: build with bun, runtime on debian-slim)
- [x] 96 tests passing, typecheck clean
