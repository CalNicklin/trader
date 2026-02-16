# Developer Skills

Quick-reference for common local development tasks.

## Database

### Browse live DB with Drizzle Studio
Connects to the live database on the server (real-time, no snapshots):
```bash
bun run db:studio:live
```
Opens at https://local.drizzle.studio — Ctrl+C to stop.

### Browse DB snapshot with Drizzle Studio
Pulls a snapshot of the DB and opens it locally:
```bash
bun run db:studio
```
Opens at https://local.drizzle.studio

### Pull DB snapshot only
```bash
bun run db:pull
```
Downloads the live DB to `./data/trader.db` for local queries.

### Run a one-off SQL query on the server
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"SELECT * FROM trades ORDER BY created_at DESC LIMIT 5;\""'
```

## Server

### Tail live logs
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --tail 50 -f"
```

### Container status
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml ps"
```

### Restart trader
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml restart trader"
```

## Local Development

### Run with hot reload
```bash
bun run dev
```

### Type check / lint
```bash
bun run typecheck
bun run lint:fix
```

### Run tests
```bash
bun test
```

### Generate DB migration
```bash
bun run db:generate
```
