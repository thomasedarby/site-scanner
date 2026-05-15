# Site Scanner

Internal website scanner with a Node.js backend, a plain static dashboard, background scan execution, Mermaid sitemap output, and local scan history storage.

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

3. Review `allowedDomains` before scanning anything.

4. Start the backend in watch mode:

```bash
npm run dev
```

5. Open the dashboard:

```text
http://localhost:8080
```

6. Check the health endpoint if needed:

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

The same container also works behind a reverse proxy because the frontend uses same-origin API calls by default.

## Scanner Configuration

- Keep [`scanner.config.example.json`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/scanner.config.example.json) committed as the example.
- Create a local `scanner.config.json` from that example and keep it uncommitted.
- `scanner.config.json` is gitignored because it is an environment-specific safety control, not shared application code.
- `allowedDomains` protects against misuse by limiting scans to explicitly approved public hostnames only.
- If `allowedDomains` is empty, the backend still starts safely, but scan creation is rejected by the API layer.
- For section scans, keep `allowedDomains` as hostnames only and use `pathBoundary` to restrict crawling to a subsection such as `/jsna/`.

### Allowed Domains

`allowedDomains` entries must be plain hostnames only. Use exact hostnames such as:

- `parksmarter.org.uk`
- `www.parksmarter.org.uk`
- `travelderbyshire.co.uk`

Do not use full URLs or paths in `allowedDomains`.

### Configured sites and section scans

`sites` is optional. It lets you predefine named scan targets for the frontend, including section-limited scans.

Example:

```json
{
  "sites": [
    {
      "name": "JSNA",
      "url": "https://observatory.derbyshire.gov.uk/jsna/",
      "pathBoundary": "/jsna/"
    }
  ],
  "allowedDomains": [
    "observatory.derbyshire.gov.uk",
    "www.observatory.derbyshire.gov.uk"
  ]
}
```

Important:

- `site.url` must be a full `http` or `https` URL.
- `site.url` hostname must already be present in `allowedDomains`.
- `pathBoundary` must be a path only, such as `/jsna/`.
- `pathBoundary` is how you restrict a scan to one section without putting paths into `allowedDomains`.

### www and non-www crawling

The scanner can now follow links between `www` and non-`www` host variants when all of these are true:

- `crawlAllowedHostVariants` is `true`
- both hostnames are explicitly listed in `allowedDomains`
- the variant belongs to the current scan boundary
- the URL still passes the existing private/local/unsafe URL checks

Example:

- if the scan starts at `https://parksmarter.org.uk`
- and `allowedDomains` contains both `parksmarter.org.uk` and `www.parksmarter.org.uk`
- the crawler may follow links between those two hosts

It will still not crawl unrelated allowlisted domains during the same scan.

### Path boundaries

If a scan starts at `https://observatory.derbyshire.gov.uk/jsna/` and uses `pathBoundary: "/jsna/"`, the crawler will stay inside that section.

Allowed:

- `https://observatory.derbyshire.gov.uk/jsna/`
- `https://observatory.derbyshire.gov.uk/jsna`
- `https://observatory.derbyshire.gov.uk/jsna/page-one/`
- `https://observatory.derbyshire.gov.uk/jsna/subfolder/page-two/`

Rejected as outside the path boundary:

- `https://observatory.derbyshire.gov.uk/`
- `https://observatory.derbyshire.gov.uk/about/`
- `https://observatory.derbyshire.gov.uk/other-section/`
- `https://observatory.derbyshire.gov.uk/jsna-old/`

Path boundaries still respect the existing allowlisted host rules. If `crawlAllowedHostVariants` is enabled and both `observatory.derbyshire.gov.uk` and `www.observatory.derbyshire.gov.uk` are allowlisted, the crawler may cross between those two hosts only when the URL is still inside the same path boundary.

If you want the older strict behavior, set:

```json
{
  "crawlAllowedHostVariants": false
}
```

## Environment and Runtime Paths

- Do not commit a real `.env` file.
- Use [`.env.example`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/.env.example) as the documented source of supported environment variables.
- Runtime data is written under `DATA_DIR`.
- If `DATA_DIR` is not set locally, the backend defaults to `./data/site-scanner.sqlite`.
- In Docker, use `DATA_DIR=/app/data` and mount that path to persistent storage.
- In Docker, set `SCANNER_CONFIG_PATH=/app/config/scanner.config.json` and mount the config file read-only.

## Frontend

- The frontend is plain HTML, CSS and JavaScript under [`frontend/`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/frontend).
- The dashboard is served by the backend from `GET /`.
- API requests use same-origin URLs by default, so the frontend works when accessed via `localhost`, a hostname, an IP address, or a reverse proxy.
- If you have an unusual deployment where the frontend must call a different API origin, you can override the base URL with `window.API_BASE_URL` before loading [`frontend/app.js`](/Users/thomasdarby/Desktop/internal%20crawler/site-scanner/frontend/app.js).

### Dashboard flow

- `New Scan` lets users start a scan with a hostname or full URL.
- `New Scan` can also use configured site presets and an optional path boundary.
- `Results` shows live scan status while a scan is running, then the stored summary, including the path boundary used, the page table, CSV links, and sitemap actions.
- `Previous Scans` lists stored scans and lets users reopen them in the Results tab.

### URL entry

Users can enter hostnames without typing `https://`, for example:

- `parksmarter.org.uk`
- `www.parksmarter.org.uk`
- `travelderbyshire.co.uk`

The backend will normalize those to `https://...` automatically.

### Scanning only one section such as `/jsna/`

1. Enter the full section URL, for example `https://observatory.derbyshire.gov.uk/jsna/`
2. Enable `Restrict crawl to this URL path`
3. Confirm the boundary is `/jsna/`
4. Start the scan
5. Watch the Results tab for live progress, including pages crawled, queue size, current URL, and elapsed time

If the site is configured in `scanner.config.json`, selecting that preset fills in the URL and path boundary automatically.

### Scan progress

- New scans return quickly and continue in the background inside the Node process.
- The frontend polls scan status until the scan completes or fails.
- Progress percentage is approximate and based on the configured max pages.
- While a scan is still running, the Results tab shows live counts, current URL, and elapsed time.

### Page list

- The Results tab shows a filterable page table.
- `Copy Page List` copies the current page rows as tab-separated text.
- `Download CSV` uses the stored CSV export for the full page list.

### Sitemap viewing

- `Open Sitemap` opens a larger full-page viewer in a new tab.
- The full-page viewer renders the Mermaid diagram, lets you copy Mermaid, download Mermaid, and attempts PNG export in the browser.
- If the browser blocks PNG export, the viewer falls back to SVG download with a friendly message.
- SVG is the most reliable scalable export format for Mermaid sitemaps. PNG is generated client-side in the browser.
- `View Diagram Inline` keeps the existing in-page Mermaid preview for quick checks.
- Large diagrams may need horizontal or vertical scrolling.

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

- Background scans currently run inside the same Node process. If the process restarts mid-scan, the interrupted scan is marked as failed.
- There is no authentication yet.
- `respectRobotsTxt` is present in config but not implemented in the crawler yet.
- Mermaid rendering and client-side PNG export depend on browser support and the Mermaid CDN being reachable.
- Path boundaries only limit which pages are crawled. Links outside the boundary may still be counted as links on in-boundary pages.
- Previous scans loaded from storage do not currently preserve every transient request setting in the summary view, such as the requested page cap, unless they came from the current POST response.
