import { describe, expect, it } from "vitest";

import {
  isAllowedDomain,
  isPrivateOrLocalHostname,
  isSameOrigin,
  normaliseUrl,
  shouldSkipUrl
} from "../src/security/urlSafety.js";

describe("normaliseUrl", () => {
  it("removes hash fragments and strips query strings by default", () => {
    const result = normaliseUrl("https://Example.com/path?q=1#section");

    expect(result.toString()).toBe("https://example.com/path");
  });

  it("keeps query strings when explicitly configured", () => {
    const result = normaliseUrl("https://Example.com/path?q=1#section", undefined, {
      stripQueryString: false
    });

    expect(result.toString()).toBe("https://example.com/path?q=1");
  });

  it("resolves relative URLs against a base URL", () => {
    const result = normaliseUrl("/about?ref=nav#heading", "https://example.com/start");

    expect(result.toString()).toBe("https://example.com/about");
  });

  it("rejects non-http protocols", () => {
    expect(() => normaliseUrl("ftp://example.com/file.txt")).toThrow(
      "Unsupported URL protocol: ftp:"
    );
  });
});

describe("isAllowedDomain", () => {
  const allowedDomains = ["example.com", "www.example.com"];

  it("allows exact hostname matches", () => {
    expect(isAllowedDomain("https://example.com/path", allowedDomains)).toBe(true);
    expect(isAllowedDomain("https://WWW.EXAMPLE.COM/path", allowedDomains)).toBe(true);
  });

  it("rejects hostnames outside the allowlist", () => {
    expect(isAllowedDomain("https://blog.example.com/path", allowedDomains)).toBe(false);
    expect(isAllowedDomain("https://other.test/path", allowedDomains)).toBe(false);
  });
});

describe("isPrivateOrLocalHostname", () => {
  it("rejects localhost and explicit local addresses", () => {
    expect(isPrivateOrLocalHostname("localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("0.0.0.0")).toBe(true);
    expect(isPrivateOrLocalHostname("::1")).toBe(true);
    expect(isPrivateOrLocalHostname("[::1]")).toBe(true);
  });

  it("rejects private and link-local IPv4 ranges", () => {
    expect(isPrivateOrLocalHostname("10.0.0.4")).toBe(true);
    expect(isPrivateOrLocalHostname("172.16.5.10")).toBe(true);
    expect(isPrivateOrLocalHostname("172.31.255.255")).toBe(true);
    expect(isPrivateOrLocalHostname("192.168.1.20")).toBe(true);
    expect(isPrivateOrLocalHostname("169.254.10.20")).toBe(true);
    expect(isPrivateOrLocalHostname("169.254.169.254")).toBe(true);
  });

  it("rejects private and link-local IPv6 ranges", () => {
    expect(isPrivateOrLocalHostname("fc00::1")).toBe(true);
    expect(isPrivateOrLocalHostname("fd12:3456:789a::1")).toBe(true);
    expect(isPrivateOrLocalHostname("fe80::1")).toBe(true);
    expect(isPrivateOrLocalHostname("febf::abcd")).toBe(true);
  });

  it("rejects IPv4-mapped local and private addresses where practical", () => {
    expect(isPrivateOrLocalHostname("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("::ffff:10.0.0.5")).toBe(true);
    expect(isPrivateOrLocalHostname("::ffff:192.168.1.5")).toBe(true);
  });

  it("allows public hostnames and public IPv4 addresses", () => {
    expect(isPrivateOrLocalHostname("example.com")).toBe(false);
    expect(isPrivateOrLocalHostname("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalHostname("172.32.0.1")).toBe(false);
    expect(isPrivateOrLocalHostname("2001:4860:4860::8888")).toBe(false);
    expect(isPrivateOrLocalHostname("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("matches protocol, hostname, and port", () => {
    expect(isSameOrigin("https://example.com/about", "https://example.com")).toBe(true);
    expect(isSameOrigin("https://example.com:8443/about", "https://example.com")).toBe(false);
    expect(isSameOrigin("http://example.com/about", "https://example.com")).toBe(false);
  });
});

describe("shouldSkipUrl", () => {
  it("skips empty and anchor-only links", () => {
    expect(shouldSkipUrl("")).toBe(true);
    expect(shouldSkipUrl("   ")).toBe(true);
    expect(shouldSkipUrl("#section")).toBe(true);
  });

  it("skips explicitly unsupported protocols", () => {
    expect(shouldSkipUrl("mailto:test@example.com")).toBe(true);
    expect(shouldSkipUrl("tel:+441234567890")).toBe(true);
    expect(shouldSkipUrl("javascript:void(0)")).toBe(true);
    expect(shouldSkipUrl("data:text/plain,hello")).toBe(true);
    expect(shouldSkipUrl("file:///tmp/test.txt")).toBe(true);
    expect(shouldSkipUrl("ftp://example.com/file.txt")).toBe(true);
  });

  it("keeps http, https, and relative URLs for later policy checks", () => {
    expect(shouldSkipUrl("https://example.com")).toBe(false);
    expect(shouldSkipUrl("http://example.com")).toBe(false);
    expect(shouldSkipUrl("/relative/path")).toBe(false);
    expect(shouldSkipUrl("../up-one-level")).toBe(false);
  });
});
