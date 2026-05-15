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
- `data/` is reserved for runtime files and remains gitignored.
