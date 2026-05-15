import { describe, expect, it } from "vitest";

import { CrawlerService } from "../src/crawler/crawlerService.js";
import type { CrawlConfig, FetchLike, FetchResponseLike } from "../src/crawler/types.js";

interface MockResponseInit {
  body?: string;
  headers?: Record<string, string>;
  status?: number;
  url?: string;
}

function createResponse(init: MockResponseInit): FetchResponseLike {
  return {
    headers: {
      get(name: string) {
        const value = init.headers?.[name.toLowerCase()] ?? init.headers?.[name] ?? null;
        return value ?? null;
      }
    },
    status: init.status ?? 200,
    async text() {
      return init.body ?? "";
    },
    url: init.url ?? ""
  };
}

function createCrawlerConfig(overrides: Partial<CrawlConfig> = {}): CrawlConfig {
  return {
    allowedDomains: ["example.com"],
    crawlAllowedHostVariants: true,
    crawlDelayMs: 0,
    maxPages: 10,
    requestTimeoutMs: 1000,
    stripQueryStrings: true,
    userAgent: "Internal-SiteScanner/0.1",
    ...overrides
  };
}

describe("CrawlerService", () => {
  it("crawls a simple two-page site", async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input === "https://example.com/") {
        return createResponse({
          body: `
            <html><head><title>Home</title><meta name="description" content="Home"></head>
            <body><h1>Home</h1><a href="/about">About</a></body></html>
          `,
          headers: { "content-type": "text/html; charset=utf-8" },
          url: input
        });
      }

      if (input === "https://example.com/about") {
        return createResponse({
          body: `
            <html><head><title>About</title><meta name="description" content="About"></head>
            <body><h1>About</h1><a href="/">Home</a></body></html>
          `,
          headers: { "content-type": "text/html; charset=utf-8" },
          url: input
        });
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].title).toBe("Home");
    expect(result.pages[1].parentUrl).toBe("https://example.com/");
  });

  it("avoids crawling duplicate links more than once", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      if (input === "https://example.com/") {
        return createResponse({
          body: `
            <html><head><title>Home</title><meta name="description" content="Home"></head>
            <body>
              <h1>Home</h1>
              <a href="/about">About</a>
              <a href="/about">About Again</a>
            </body></html>
          `,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      if (input === "https://example.com/about") {
        return createResponse({
          body: `<html><head><title>About</title></head><body><h1>About</h1></body></html>`,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages).toHaveLength(2);
    expect(calls.filter((url) => url === "https://example.com/about")).toHaveLength(1);
  });

  it("respects the max page limit", async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input === "https://example.com/") {
        return createResponse({
          body: `
            <html><head><title>Home</title><meta name="description" content="Home"></head>
            <body><h1>Home</h1><a href="/a">A</a><a href="/b">B</a></body></html>
          `,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      if (input === "https://example.com/a") {
        return createResponse({
          body: `<html><head><title>A</title></head><body><h1>A</h1></body></html>`,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig({ maxPages: 2 })
    });

    expect(result.pages).toHaveLength(2);
  });

  it("counts external links but does not crawl them", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      return createResponse({
        body: `
          <html><head><title>Home</title><meta name="description" content="Home"></head>
          <body><h1>Home</h1><a href="https://other.example.org/out">Out</a></body></html>
        `,
        headers: { "content-type": "text/html" },
        url: input
      });
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages[0].externalLinkCount).toBe(1);
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("counts document links but does not crawl them", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      return createResponse({
        body: `
          <html><head><title>Home</title><meta name="description" content="Home"></head>
          <body><h1>Home</h1><a href="/files/report.pdf">Report</a></body></html>
        `,
        headers: { "content-type": "text/html" },
        url: input
      });
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages[0].documentLinkCount).toBe(1);
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("counts images on the page", async () => {
    const fetchImpl: FetchLike = async (input) =>
      createResponse({
        body: `
          <html><head><title>Home</title><meta name="description" content="Home"></head>
          <body><h1>Home</h1><img src="/a.jpg"><img src="/b.png"></body></html>
        `,
        headers: { "content-type": "text/html" },
        url: input
      });

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages[0].imageCount).toBe(2);
  });

  it("records missing title, meta description, and h1 counts accurately", async () => {
    const fetchImpl: FetchLike = async (input) =>
      createResponse({
        body: `<html><head></head><body><p>No headings here</p></body></html>`,
        headers: { "content-type": "text/html" },
        url: input
      });

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages[0].title).toBe("");
    expect(result.pages[0].hasMetaDescription).toBe(false);
    expect(result.pages[0].h1Count).toBe(0);
  });

  it("records a safe error when redirected to a disallowed host", async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input === "https://example.com/") {
        return createResponse({
          headers: {
            "content-type": "text/html",
            location: "https://evil.example.org/"
          },
          status: 302,
          url: input
        });
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].crawlError).toContain("Redirect target is not allowed");
  });

  it("records a failed page request without crashing the crawl", async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input === "https://example.com/") {
        return createResponse({
          body: `
            <html><head><title>Home</title><meta name="description" content="Home"></head>
            <body><h1>Home</h1><a href="/broken">Broken</a></body></html>
          `,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      if (input === "https://example.com/broken") {
        throw new Error("Network failure");
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig()
    });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].crawlError).toContain("Network failure");
    expect(result.pages[0].crawlError).toBeNull();
  });

  it("allows a non-www root to follow allowlisted www links", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      if (input === "https://example.com/") {
        return createResponse({
          body: `
            <html><head><title>Home</title><meta name="description" content="Home"></head>
            <body><h1>Home</h1><a href="https://www.example.com/about">About</a></body></html>
          `,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      if (input === "https://www.example.com/about") {
        return createResponse({
          body: `<html><head><title>About</title></head><body><h1>About</h1></body></html>`,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig({
        allowedDomains: ["example.com", "www.example.com"]
      })
    });

    expect(result.pages).toHaveLength(2);
    expect(calls).toContain("https://www.example.com/about");
  });

  it("allows a www root to follow allowlisted non-www links", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      if (input === "https://www.example.com/") {
        return createResponse({
          body: `
            <html><head><title>Home</title><meta name="description" content="Home"></head>
            <body><h1>Home</h1><a href="https://example.com/about">About</a></body></html>
          `,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      if (input === "https://example.com/about") {
        return createResponse({
          body: `<html><head><title>About</title></head><body><h1>About</h1></body></html>`,
          headers: { "content-type": "text/html" },
          url: input
        });
      }

      throw new Error(`Unexpected fetch for ${input}`);
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://www.example.com/",
      config: createCrawlerConfig({
        allowedDomains: ["example.com", "www.example.com"]
      })
    });

    expect(result.pages).toHaveLength(2);
    expect(calls).toContain("https://example.com/about");
  });

  it("does not crawl unrelated allowlisted domains during the same scan", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      return createResponse({
        body: `
          <html><head><title>Home</title><meta name="description" content="Home"></head>
          <body><h1>Home</h1><a href="https://another-site.org/about">Elsewhere</a></body></html>
        `,
        headers: { "content-type": "text/html" },
        url: input
      });
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig({
        allowedDomains: ["example.com", "www.example.com", "another-site.org"]
      })
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].externalLinkCount).toBe(1);
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("does not crawl an unallowlisted host variant", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      return createResponse({
        body: `
          <html><head><title>Home</title><meta name="description" content="Home"></head>
          <body><h1>Home</h1><a href="https://www.example.com/about">About</a></body></html>
        `,
        headers: { "content-type": "text/html" },
        url: input
      });
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig({
        allowedDomains: ["example.com"]
      })
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].externalLinkCount).toBe(1);
    expect(calls).toEqual(["https://example.com/"]);
  });

  it("keeps strict same-origin crawling when host variants are disabled", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input);

      return createResponse({
        body: `
          <html><head><title>Home</title><meta name="description" content="Home"></head>
          <body><h1>Home</h1><a href="https://www.example.com/about">About</a></body></html>
        `,
        headers: { "content-type": "text/html" },
        url: input
      });
    };

    const crawler = new CrawlerService({ fetchImpl });
    const result = await crawler.crawl({
      rootUrl: "https://example.com/",
      config: createCrawlerConfig({
        allowedDomains: ["example.com", "www.example.com"],
        crawlAllowedHostVariants: false
      })
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].externalLinkCount).toBe(1);
    expect(calls).toEqual(["https://example.com/"]);
  });
});
