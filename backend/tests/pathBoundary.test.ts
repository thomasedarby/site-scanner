import { describe, expect, it } from "vitest";

import {
  derivePathBoundaryFromUrlPath,
  isPathWithinBoundary,
  normalisePathBoundary
} from "../src/security/pathBoundary.js";

describe("normalisePathBoundary", () => {
  it("normalizes section roots to a trailing slash form", () => {
    expect(normalisePathBoundary("/jsna")).toBe("/jsna/");
    expect(normalisePathBoundary("/jsna/")).toBe("/jsna/");
  });

  it("rejects invalid path boundary values", () => {
    expect(() => normalisePathBoundary("jsna")).toThrow("pathBoundary must start with /");
    expect(() => normalisePathBoundary("https://example.com/jsna/")).toThrow(
      "pathBoundary must be a path only"
    );
  });
});

describe("isPathWithinBoundary", () => {
  it("treats /jsna and /jsna/ as the same section root", () => {
    expect(isPathWithinBoundary("/jsna", "/jsna/")).toBe(true);
    expect(isPathWithinBoundary("/jsna/", "/jsna/")).toBe(true);
  });

  it("allows deeper paths inside the section", () => {
    expect(isPathWithinBoundary("/jsna/page-one/", "/jsna/")).toBe(true);
    expect(isPathWithinBoundary("/jsna/subfolder/page-two/", "/jsna/")).toBe(true);
  });

  it("rejects sibling or similarly prefixed paths outside the section", () => {
    expect(isPathWithinBoundary("/about/", "/jsna/")).toBe(false);
    expect(isPathWithinBoundary("/jsna-old/", "/jsna/")).toBe(false);
  });
});

describe("derivePathBoundaryFromUrlPath", () => {
  it("derives a usable boundary from a section URL path", () => {
    expect(derivePathBoundaryFromUrlPath("/jsna/")).toBe("/jsna/");
  });

  it("returns null for the site root", () => {
    expect(derivePathBoundaryFromUrlPath("/")).toBeNull();
  });
});
