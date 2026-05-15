# Site Scanner

Internal website scanner with a Node.js backend and a simple static dashboard.

## Requirements

- Node.js 22+
- npm
- Docker

## Local Development

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Create a local scanner config from the example:

```bash
cp scanner.config.example.json scanner.config.json
```

3. Start the backend in watch mode:

```bash
npm run dev
```

4. Open the dashboard:

```text
http://localhost:8080
```

5. Check the health endpoint if needed:

```bash
curl http://localhost:8080/health
```

## Docker Build

Build the container image from the repository root:

```bash
docker build -t site-scanner:latest -f backend/Dockerfile .
```

## Docker Run

Create a local config first:

```bash
cp scanner.config.example.json scanner.config.json
```

Run the container with mounted data and config:

```bash
docker run --rm \
  -p 8090:8080 \
  -e HOST=0.0.0.0 \
  -e PORT=8080 \
  -e DATA_DIR=/app/data \
  -e SCANNER_CONFIG_PATH=/app/config/scanner.config.json \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/scanner.config.json:/app/config/scanner.config.json:ro" \
  site-scanner:latest
```

Health check:

```bash
curl http://localhost:8090/health
```

Access from another machine on the same network using the Docker host’s address and published port, for example:

- `http://server-hostname:8090`
- `http://server-ip:8090`

The same container also works behind a reverse proxy later because the frontend uses same-origin API calls by default.

## Environment and Config

- Do not commit a real `.env` file.
- Use [`.env.example`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/.env.example) as the documented source of supported environment variables.
- Keep [`scanner.config.example.json`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/scanner.config.example.json) committed as the example.
- Create `scanner.config.json` locally from the example and mount it into the container.
- `scanner.config.json` is gitignored because it is an environment-specific safety control, not shared application code.
- `allowedDomains` protects against misuse by limiting scans to explicitly approved public hostnames only.
- If `allowedDomains` is empty, the backend still starts safely, but scan creation is rejected by the API layer.
- Runtime data is written under `DATA_DIR`.
- If `DATA_DIR` is not set locally, the backend defaults to `./data/site-scanner.sqlite`.
- In Docker, use `DATA_DIR=/app/data` and mount that path to persistent storage.
- In Docker, set `SCANNER_CONFIG_PATH=/app/config/scanner.config.json` and mount the config file read-only.

## Frontend

- The frontend is plain HTML, CSS and JavaScript under [`frontend/`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/frontend).
- The dashboard is served by the backend from `GET /`.
- API requests use same-origin URLs by default, so the frontend works when accessed via `localhost`, a hostname, an IP address, or a reverse proxy.
- If you have an unusual deployment where the frontend must call a different API origin, you can override the base URL with `window.API_BASE_URL` before loading [`frontend/app.js`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/frontend/app.js).
- The sitemap can be viewed as a rendered Mermaid diagram, copied as Mermaid source, or downloaded as raw `.mmd`.
- Large diagrams may need horizontal or vertical scrolling inside the diagram panel.

## Rebuild and Redeploy

After pulling changes:

1. Rebuild the image:

```bash
docker build -t site-scanner:latest -f backend/Dockerfile .
```

2. Stop the old container and run the new one again with the same mounted `data/` directory and `scanner.config.json`.

## Tests

Run the backend test suite:

```bash
cd backend
npm test
```

Build the production backend output:

```bash
cd backend
npm run build
```

## Current Limitations

- Scans run synchronously inside the POST request, so large scans will take longer to return.
- There is no authentication yet.
- `respectRobotsTxt` is present in config but not implemented in the crawler yet.
- The frontend Mermaid library is loaded from a CDN at runtime, so diagram rendering depends on the browser being able to reach that CDN.
