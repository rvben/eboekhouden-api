# eboekhouden-api

Browser automation API for [e-Boekhouden](https://www.e-boekhouden.nl/), a Dutch accounting platform. Uses [Playwright](https://playwright.dev/) to drive the web UI for operations not available via the official API.

## Why?

e-Boekhouden has a SOAP/REST API for basic bookkeeping, but offerte (quote) management, email sending, and PDF generation are only available through the web interface. This project wraps those UI flows as a JSON API so they can be called programmatically — from workflow tools like n8n, scripts, or other services.

## Quick start

```bash
cp .env.example .env    # add your e-Boekhouden credentials
npm install
npx playwright install chromium
npm run dev
```

```bash
# List offertes
curl -H "Authorization: Bearer $API_KEY" http://localhost:3000/api/offertes

# Create an offerte
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "relatieCode": "10001",
    "templateId": "123456",
    "kenmerk": "Project Alpha",
    "items": [{
      "quantity": 1,
      "description": "Consulting services",
      "pricePerUnit": 500,
      "btwCode": "hoog 21",
      "ledgerCode": "8000"
    }]
  }' http://localhost:3000/api/offerte
```

```json
{
  "success": true,
  "offerteNumber": "Offerte: OF-401",
  "offerteId": "1234567",
  "cached": false
}
```

## API endpoints

Service info is available at `GET /` and the full OpenAPI 3.0 spec at `GET /api/docs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Service description and endpoint listing |
| GET | `/api/health` | No | Health check (browser state, uptime, cache size) |
| GET | `/api/docs` | No | OpenAPI 3.0 spec |
| GET | `/api/offertes` | Yes | List offertes (`?search=`, `?page=`, `?all=true`) |
| GET | `/api/relaties` | Yes | List relaties (`?search=`, `?page=`, `?all=true`) |
| POST | `/api/relatie` | Yes | Create a relatie (customer) |
| POST | `/api/offerte` | Yes | Create an offerte with line items |
| POST | `/api/offerte/:id/status` | Yes | Update offerte status |
| POST | `/api/offerte/:id/email` | Yes | Send offerte email via template |
| GET | `/api/offerte/:id/pdf` | Yes | Download offerte PDF |

All authenticated endpoints require a `Authorization: Bearer <API_KEY>` header.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | — | Bearer token for API authentication |
| `EBOEKHOUDEN_USERNAME` | Yes | — | e-Boekhouden login username |
| `EBOEKHOUDEN_PASSWORD` | Yes | — | e-Boekhouden login password |
| `PORT` | No | `3000` | Server port |
| `DB_PATH` | No | `/data/offerte-cache.db` | SQLite database path |
| `CACHE_TTL_DAYS` | No | `30` | Idempotency cache TTL in days |
| `IDLE_TIMEOUT_MS` | No | `300000` | Browser idle timeout (5 min) |
| `HANDLER_TIMEOUT_MS` | No | `120000` | Per-request timeout (2 min) |
| `READONLY` | No | `false` | Set to `true` to disable write endpoints |

## Architecture

The API manages a single headless Chromium browser session:

- **Mutex** — requests are serialized (one browser action at a time) to prevent state corruption
- **Idle timeout** — the browser closes after 5 minutes of inactivity to free resources
- **Retry** — if a request fails due to browser issues, the session is recycled and the request retried once
- **Idempotency** — offerte creation is deduplicated by `kenmerk` using a SQLite cache, preventing duplicates from retries or webhook replays

This means the API handles ~1 request at a time with each taking 5-30 seconds depending on the operation. It's designed for workflow automation, not high-throughput use.

## CLI

For one-off operations without running the server:

```bash
node src/cli.mjs offertes                   # list all offertes
node src/cli.mjs offertes "Project Alpha"   # search offertes
node src/cli.mjs relaties                   # list all relaties
node src/cli.mjs create-offerte data.json   # create offerte from JSON file
node src/cli.mjs create-relatie data.json   # create relatie from JSON file
node src/cli.mjs status 1234567 "04. Geaccepteerd"  # update status
node src/cli.mjs pdf 1234567 offerte.pdf    # download PDF
node src/cli.mjs --help                     # all commands
```

## Docker

```bash
make up      # build and run locally
make down    # stop
```

## Deployment

```bash
# Set HOST in .env (e.g. HOST=root@your-server), then:
make deploy    # scp + docker compose on remote
make logs      # tail production logs
make restart   # restart containers
make stop      # stop containers
```

## Limitations

- **Browser automation is inherently fragile.** If e-Boekhouden changes their UI, selectors may break and need updating.
- **Single concurrent request.** The mutex serializes all requests — parallel calls will queue, not fail.
- **Session-based.** The browser maintains a login session. If e-Boekhouden forces re-authentication (e.g. password change, session expiry), the API will re-login automatically.
- **Not a replacement for the official API.** Use the official SOAP/REST API for bookkeeping operations it supports. This project only covers what the official API doesn't.

## Disclaimer

This project is not affiliated with or endorsed by [e-Boekhouden](https://www.e-boekhouden.nl/). It automates the web UI using your own credentials to access your own data. Use at your own risk — automated access may violate the platform's terms of service.

## License

MIT
