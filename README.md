# pgapi

Automatic GraphQL API from your PostgreSQL schema — no code generation required.

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/codeine-dev/pgapi/refs/heads/master/install.sh | bash
```

Or pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/codeine-dev/pgapi/refs/heads/master/install.sh | bash -s -- --version v0.0.0-alpha9
```

## Docker

```bash
docker pull ghcr.io/codeine-dev/pgapi:latest
docker run -e PGAPI_CONNECTION_STRING=postgres://... ghcr.io/codeine-dev/pgapi
```

## Usage

```
pgapi --connection-string postgres://user:pass@host:5432/db
```

Visit http://localhost:3000/console for the GraphiQL console.

Run `pgapi --help` to see all available options and endpoints.

## Realtime subscriptions

pgapi exposes Postgres changes as GraphQL subscriptions over WebSockets at
`/graphql` (the `graphql-transport-ws` protocol). Triggers are installed
automatically at startup.

```graphql
subscription {
  usersChanged(event: INSERT) {
    id
    name
  }
}
```

Subscriptions work in the GraphiQL console out of the box.

## Service accounts

Authenticate machine clients with a static API key sent in the `x-api-key` header:

```bash
# generate a key + its sha256 hash
pgapi --keygen

# serve with a hashed key
pgapi --connection-string postgres://... \
  --service-account "deploy:sha256:51d517db0162..."

# or via env var (plaintext key)
PGAPI_SERVICE_ACCOUNTS='[{"name":"deploy","key":"my-secret"}]' pgapi --connection-string postgres://...
```

```bash
curl -H "x-api-key: my-secret" http://localhost:3000/graphql
```

`--service-account` is repeatable for multiple accounts. See PROJECT.md for details.

## Development

```bash
bun install
bun run dev
```
