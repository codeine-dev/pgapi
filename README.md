# pgapi

Automatic GraphQL API from your PostgreSQL schema — no code generation required.

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/codeine-dev/pgapi/main/install.sh | bash
```

Or pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/codeine-dev/pgapi/main/install.sh | bash -s -- --version v0.1.0
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

## Development

```bash
bun install
bun run dev
```
