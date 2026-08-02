-- ============================================================================
-- pgapi Integration Test Schema
-- ============================================================================
--
-- Fixture schema used by src/integration.test.ts. It is intentionally a plain
-- schema with no permission functions so that permission behaviour can be
-- layered on and torn down by the tests themselves.
--
-- Load it into the test database before running integration tests, e.g.:
--   docker exec -i pgapi-pg psql -U postgres -d pgapi_test -f - < examples/test-schema.sql
--   PGAPI_TEST_DB_URL=postgres://postgres:postgres@127.0.0.1:5434/pgapi_test \
--     bun run vitest run src/integration.test.ts
-- =============================================================================

DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id    serial PRIMARY KEY,
    name  text NOT NULL,
    email text NOT NULL UNIQUE,
    role  text NOT NULL
);

CREATE TABLE posts (
    id         serial PRIMARY KEY,
    title      text NOT NULL,
    published  boolean NOT NULL DEFAULT false,
    author_id  integer NOT NULL REFERENCES users(id)
);

CREATE TABLE comments (
    id        serial PRIMARY KEY,
    body      text NOT NULL,
    post_id   integer NOT NULL REFERENCES posts(id),
    author_id integer NOT NULL REFERENCES users(id)
);
