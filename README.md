# Bun Tests

A set of userland bun tests that might be useful to compare the behaviour of different bun versions.

## Getting started

To install dependencies:

```bash
bun install
```

To run:

```bash
bun test
```

## Limitations

- **Redis**: all redis tests are skipped unless you define the environment variable REDIS_URL:

```
REDIS_URL='redis://localhost:6379'
```

Installing a local redis server from eg Homebrew will work.

- **Postgresql**: this test suite uses pglite to test most Postgresql functionality, but there may be some differences between pglite and other postegresql-like databases. Please file bugs / submit PRs for these. If you can, try running a local postgresql server or a cloud-based server like [Neon](https://neon.tech) to run all tests.
