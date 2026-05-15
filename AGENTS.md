# Site Scanner Project Instructions

## Project purpose

Build an internal Dockerised website scanner for organisation-managed websites.

The tool should allow an authorised team member to scan an approved public website, count frontend pages, collect page-level statistics, generate a Mermaid sitemap, store scan history, and compare the latest scan with the previous scan.

This is for internal website inventory and auditing. It must not be built as a general-purpose public web scraper.

## Working style

Work in small, reviewable tasks.

Before making significant changes:

- Explain the intended approach.
- Identify files likely to change.
- Keep the scope narrow.

After making changes:

- Summarise what changed.
- Run relevant tests where possible.
- Mention any tests that could not be run.
- Update README when commands, setup, or behaviour changes.

Do not rewrite large parts of the app unless explicitly asked.

## Tech stack

Use:

- Node.js 22+
- TypeScript
- Fastify for the backend API
- Cheerio for HTML parsing
- SQLite for local scan history
- Vitest for tests
- Docker and Docker Compose
- Plain HTML/CSS/JavaScript for the first frontend
- Mermaid-compatible text output for sitemap diagrams

Avoid:

- Playwright unless explicitly requested
- React unless explicitly requested
- AWS-specific code in the MVP
- authentication in the MVP unless explicitly requested
- unnecessary dependencies

## MVP features

The MVP should include:

1. Backend API
   - GET /health
   - POST /api/scans
   - GET /api/scans
   - GET /api/scans/:id
   - GET /api/scans/:id/pages.csv
   - GET /api/scans/:id/sitemap.mmd
   - GET /api/scans/:id/compare

2. Crawler
   - Starts from a root URL.
   - Crawls same-origin HTML pages only.
   - Uses an approved domain allowlist.
   - Collects basic page stats.
   - Stops at configured max page limit.
   - Uses a configurable crawl delay.

3. Storage
   - Stores scan summaries.
   - Stores page results.
   - Stores enough data to compare scans.
   - Uses SQLite in the local data directory.

4. Reports
   - JSON scan result.
   - CSV page export.
   - Mermaid sitemap export.
   - Comparison between latest and previous scan for the same origin.

5. Frontend
   - Simple static dashboard.
   - Enter a URL.
   - Start a scan.
   - List previous scans.
   - View summary stats.
   - Download CSV and Mermaid output.

## Page statistics

For each crawled page, collect:

- URL
- Normalised URL
- Path
- Parent URL where available
- HTTP status
- Final URL after redirects
- Page title
- Whether meta description exists
- H1 count
- Internal link count
- External link count
- Image count
- Document link count
- Approximate word count
- Content hash
- Crawl error, if any

## Scan summary

For each scan, store:

- Scan ID
- Root URL
- Origin
- Hostname
- Start time
- End time
- Status: queued, running, completed, failed
- Total pages crawled
- Total images found
- Total documents linked
- Broken internal links
- Pages missing title
- Pages missing meta description
- Pages with no H1
- Mermaid sitemap text
- Error message, if failed

## Security requirements

The scanner must be safe by default.

It must:

- Reject any hostname not in scanner.config.json allowedDomains.
- Reject localhost.
- Reject 127.0.0.1.
- Reject 0.0.0.0.
- Reject private IPv4 ranges.
- Reject link-local addresses.
- Reject AWS metadata address 169.254.169.254.
- Reject non-http and non-https protocols.
- Ignore mailto:, tel:, javascript:, data:, file:, ftp: and anchor-only links.
- Avoid following redirects to disallowed hosts.
- Apply max page limits.
- Apply request timeouts.
- Apply crawl delays.
- Avoid infinite crawl paths caused by query strings, calendars, search filters or repeated parameters.

Do not create an unrestricted crawler.

## Secrets and environment variables

Never commit:

- .env
- .env.\*
- API keys
- access tokens
- cookies
- passwords
- private certificates
- production database files
- generated scan databases
- generated reports

Only commit:

- .env.example
- scanner.config.example.json

If a secret is needed, document the environment variable name in .env.example and README, but do not add the secret value.

Do not print secrets in logs or test output.

## Docker requirements

The app must run with:

```bash
docker compose up --build
```
