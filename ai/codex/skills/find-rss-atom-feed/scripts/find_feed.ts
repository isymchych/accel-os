#!/usr/bin/env -S deno run --quiet --allow-net

type CandidateSource = "input" | "alternate-link" | "html-link" | "common-endpoint";

type Candidate = {
  url: string;
  source: CandidateSource;
  discoveredFrom: string;
};

type Validation = {
  url: string;
  source: CandidateSource;
  discoveredFrom: string;
  status: number;
  format: "rss" | "atom";
  marker: string;
  canonicalUrl: string;
};

const COMMON_ENDPOINTS = [
  "/feed",
  "/feed.xml",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/index.xml",
  "/blog.xml",
  "/blog/feed",
  "/blog/feed.xml",
  "/blog/index.xml",
];

const FEED_HINT_RE = /(rss|atom|feed|\.xml($|[?#]))/i;

function usage(): never {
  console.error("Usage: find_feed.ts <website-or-page-url>");
  Deno.exit(2);
}

function normalizeInput(raw: string): URL {
  const maybeWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(maybeWithScheme);
}

function uniqueUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function pageCandidates(input: URL): string[] {
  const out = new Set<string>();
  out.add(input.toString());
  out.add(new URL("/", input).toString());

  const segments = input.pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    out.add(new URL(`/${segments[0]}/`, input).toString());
  }
  if (segments.includes("blog")) {
    out.add(new URL("/blog/", input).toString());
  }
  return [...out];
}

function parseAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

  for (const match of tag.matchAll(attrRe)) {
    const key = match[1].toLowerCase();
    const value = (match[3] ?? match[4] ?? match[5] ?? "").trim();
    attrs.set(key, value);
  }
  return attrs;
}

function resolveHref(baseUrl: string, href: string): string | null {
  if (!href) return null;
  try {
    const absolute = new URL(href, baseUrl);
    if (!(absolute.protocol === "http:" || absolute.protocol === "https:")) return null;
    return absolute.toString();
  } catch {
    return null;
  }
}

function hasTargetHost(url: string, targetHost: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === targetHost.toLowerCase();
  } catch {
    return false;
  }
}

function isAlternateFeedLink(attrs: Map<string, string>): boolean {
  const rel = (attrs.get("rel") ?? "").toLowerCase();
  const type = (attrs.get("type") ?? "").toLowerCase();
  if (!rel.split(/\s+/).includes("alternate")) return false;
  return (
    type.includes("application/rss+xml") ||
    type.includes("application/atom+xml") ||
    type.includes("application/xml") ||
    type.includes("text/xml")
  );
}

function collectCandidatesFromHtml(html: string, pageUrl: string, targetHost: string): Candidate[] {
  const candidates: Candidate[] = [];

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = parseAttributes(tag);
    const href = resolveHref(pageUrl, attrs.get("href") ?? "");
    if (!href) continue;
    if (!hasTargetHost(href, targetHost)) continue;

    if (isAlternateFeedLink(attrs)) {
      candidates.push({ url: href, source: "alternate-link", discoveredFrom: pageUrl });
      continue;
    }

    if (FEED_HINT_RE.test(href)) {
      candidates.push({ url: href, source: "html-link", discoveredFrom: pageUrl });
    }
  }

  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = parseAttributes(tag);
    const href = resolveHref(pageUrl, attrs.get("href") ?? "");
    if (!href) continue;
    if (!hasTargetHost(href, targetHost)) continue;
    if (!FEED_HINT_RE.test(href)) continue;
    candidates.push({ url: href, source: "html-link", discoveredFrom: pageUrl });
  }

  return candidates;
}

function detectFeed(raw: string): { format: "rss" | "atom"; marker: string } | null {
  const data = raw.slice(0, 100_000).toLowerCase();
  if (data.includes("<rss")) return { format: "rss", marker: "<rss" };
  if (data.includes('xmlns="http://www.w3.org/2005/atom"')) {
    return { format: "atom", marker: "atom-namespace" };
  }
  if (/<(?:[a-z0-9_]+:)?feed(?:\s|>)/i.test(data)) {
    return { format: "atom", marker: "<feed-tag" };
  }
  if (data.includes("rdf:rdf") && data.includes("rss")) {
    return { format: "rss", marker: "rdf+rss" };
  }
  return null;
}

function parseSelfLink(raw: string, baseUrl: string): string | null {
  const firstChunk = raw.slice(0, 120_000);
  const xmlSelfRe = /<link\b[^>]*rel=(["'])self\1[^>]*>/i;
  const match = firstChunk.match(xmlSelfRe);
  if (!match) return null;
  const attrs = parseAttributes(match[0]);
  return resolveHref(baseUrl, attrs.get("href") ?? "");
}

async function fetchText(url: string): Promise<{ status: number; text: string; contentType: string }> {
  const response = await fetch(url, { redirect: "follow" });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();
  return { status: response.status, text, contentType };
}

async function validateCandidate(candidate: Candidate): Promise<Validation | null> {
  try {
    const { status, text, contentType } = await fetchText(candidate.url);
    if (status !== 200) return null;
    const detection = detectFeed(text);
    if (!detection) {
      if (!(contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom"))) {
        return null;
      }
      return null;
    }
    if (detection.marker === "<feed-tag" && contentType.includes("html")) {
      return null;
    }

    const selfLink = parseSelfLink(text, candidate.url);
    return {
      url: candidate.url,
      source: candidate.source,
      discoveredFrom: candidate.discoveredFrom,
      status,
      format: detection.format,
      marker: detection.marker,
      canonicalUrl: selfLink ?? candidate.url,
    };
  } catch {
    return null;
  }
}

function sourceWeight(source: CandidateSource): number {
  if (source === "alternate-link") return 0;
  if (source === "input") return 1;
  if (source === "html-link") return 2;
  return 3;
}

const rawInput = Deno.args[0];
if (!rawInput) usage();

let inputUrl: URL;
try {
  inputUrl = normalizeInput(rawInput);
} catch {
  console.error(`ERROR: invalid URL: ${rawInput}`);
  Deno.exit(2);
}

const initialCandidates: Candidate[] = [
  { url: inputUrl.toString(), source: "input", discoveredFrom: inputUrl.toString() },
];

const pages = pageCandidates(inputUrl);
const targetHost = inputUrl.hostname;
for (const pageUrl of pages) {
  try {
    const { status, text, contentType } = await fetchText(pageUrl);
    if (status !== 200) continue;
    if (!contentType.includes("html")) continue;
    initialCandidates.push(...collectCandidatesFromHtml(text, pageUrl, targetHost));
  } catch {
    // Ignore fetch failures and continue with other candidate sources.
  }
}

for (const endpoint of COMMON_ENDPOINTS) {
  const candidateUrl = new URL(endpoint, inputUrl).toString();
  initialCandidates.push({
    url: candidateUrl,
    source: "common-endpoint",
    discoveredFrom: new URL("/", inputUrl).toString(),
  });
}

const dedupedCandidates = uniqueUrls(initialCandidates.map((item) => item.url)).map((url) =>
  initialCandidates.find((item) => item.url === url)!
);

const validations = (await Promise.all(dedupedCandidates.map(validateCandidate))).filter((item): item is Validation =>
  item !== null
);

if (validations.length === 0) {
  console.error("ERROR: no valid RSS/Atom feed discovered");
  Deno.exit(3);
}

validations.sort((a, b) => sourceWeight(a.source) - sourceWeight(b.source));

const recommended = validations[0];

const result = {
  input: inputUrl.toString(),
  recommended: {
    url: recommended.canonicalUrl,
    format: recommended.format,
    source: recommended.source,
    status: recommended.status,
    marker: recommended.marker,
  },
  feeds: validations.map((item) => ({
    url: item.canonicalUrl,
    discovered_url: item.url,
    format: item.format,
    source: item.source,
    discovered_from: item.discoveredFrom,
    status: item.status,
    marker: item.marker,
  })),
};

console.log(JSON.stringify(result, null, 2));
