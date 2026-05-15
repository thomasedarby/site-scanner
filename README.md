# Site Scanner

Initial backend scaffold for the internal website scanner.

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

3. Check the health endpoint:

```bash
curl http://localhost:8080/health
```

4. Create a local scanner config from the example:

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

## Environment and config

- Do not commit a real `.env` file.
- Use [`.env.example`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/.env.example) as the documented source of environment variable names and defaults.
- Create `scanner.config.json` locally by copying [`scanner.config.example.json`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/scanner.config.example.json).
- `scanner.config.json` is gitignored because it is an environment-specific safety control, not shared application code.
- `allowedDomains` protects against misuse by limiting future scans to explicitly approved public hostnames only.
- If `allowedDomains` is empty, the backend still starts with safe defaults, but future scan creation must be rejected by the API layer.
- `data/` is reserved for runtime files and remains gitignored.
