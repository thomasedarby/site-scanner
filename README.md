# Site Scanner

Internal website scanner with a Node.js backend and a simple static dashboard.

## Requirements

- Node.js 22+
- npm
- Docker and Docker Compose

## Local development

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Start the backend in watch mode:

```bash
npm run dev
```

3. Open the frontend dashboard:

```bash
http://localhost:8080
```

4. Check the health endpoint if needed:

```bash
curl http://localhost:8080/health
```

5. Create a local scanner config from the example:

```bash
cp scanner.config.example.json scanner.config.json
```

## Tests

Run the backend test suite:

```bash
cd backend
npm test
```

## Docker

Start the backend with Docker Compose:

```bash
docker compose up --build
```

The API will be available at `http://localhost:8080/health`.
The dashboard is served from `http://localhost:8080`.

## Environment and config

- Do not commit a real `.env` file.
- Use [`.env.example`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/.env.example) as the documented source of environment variable names and defaults.
- Create `scanner.config.json` locally by copying [`scanner.config.example.json`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/scanner.config.example.json).
- `scanner.config.json` is gitignored because it is an environment-specific safety control, not shared application code.
- `allowedDomains` protects against misuse by limiting future scans to explicitly approved public hostnames only.
- If `allowedDomains` is empty, the backend still starts with safe defaults, but future scan creation must be rejected by the API layer.
- `data/` is reserved for runtime files and remains gitignored.
- SQLite scan history is stored under `DATA_DIR`. If `DATA_DIR` is not set locally, the backend defaults to `./data/site-scanner.sqlite`. In Docker, the existing `.env.example` value points this to `/app/data/site-scanner.sqlite`.

## Frontend

- The frontend is plain HTML, CSS and JavaScript under [`frontend/`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/frontend).
- By default the dashboard uses `http://localhost:8080` as `API_BASE_URL`.
- If you need a different API host, set `window.API_BASE_URL` before loading [`frontend/app.js`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/frontend/app.js), or edit the constant at the top of that file.
- The easiest way to use the dashboard is to run the backend and open `http://localhost:8080`, so the UI and API share the same origin.
- The sitemap can now be viewed as a rendered Mermaid diagram inside the dashboard.
- The Mermaid source can still be copied or downloaded.
- Large diagrams may need horizontal or vertical scrolling inside the diagram panel.

## Current Limitations

- Scans run synchronously inside the POST request, so large scans will take longer to return.
- There is no authentication yet.
- `respectRobotsTxt` is present in config but not implemented in the crawler yet.
