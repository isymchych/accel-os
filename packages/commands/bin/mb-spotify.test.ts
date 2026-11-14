import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";

import { accessToken, exportPlaylist, importPlaylist, waitForCallback } from "./mb-spotify.ts";

function fixture(): { dir: string; config: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "mb-spotify-"));
  const previous = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = dir;
  mkdirSync(join(dir, "mb-scripts"));
  const config = join(dir, "mb-scripts", "spotify.json");
  return {
    dir,
    config,
    dispose(): void {
      if (previous === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = previous;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function client(
  handler: (req: HttpClientRequest.HttpClientRequest) => { body: unknown; status?: number },
): HttpClient.HttpClient {
  return HttpClient.make((req) =>
    Effect.sync(() => {
      const result = handler(req);
      return HttpClientResponse.fromWeb(
        req,
        Response.json(result.body, { status: result.status ?? 200 }),
      );
    }),
  );
}

function body(req: HttpClientRequest.HttpClientRequest): string {
  assert.ok(req.body instanceof HttpBody.Uint8Array);
  return new TextDecoder().decode(req.body.body);
}

test("refresh preserves refresh token and scope and stores the new access token", async () => {
  const f = fixture();
  try {
    writeFileSync(
      f.config,
      JSON.stringify({
        client_id: "client",
        token: {
          access_token: "old",
          refresh_token: "refresh",
          scope: "user-library-read",
          expires_at: 0,
        },
      }),
    );
    const mock = client((req) => {
      assert.equal(req.url, "https://accounts.spotify.com/api/token");
      assert.equal(new URLSearchParams(body(req)).get("refresh_token"), "refresh");
      return { body: { access_token: "new", expires_in: 3600 } };
    });
    const token = await Effect.runPromise(
      accessToken("user-library-read").pipe(
        Effect.provideService(HttpClient.HttpClient, mock),
        Effect.provide(NodeServices.layer),
      ),
    );
    assert.equal(token, "new");
    const saved = JSON.parse(readFileSync(f.config, "utf8")) as {
      token: { refresh_token: string; scope: string; access_token: string };
    };
    assert.equal(saved.token.refresh_token, "refresh");
    assert.equal(saved.token.scope, "user-library-read");
    assert.equal(saved.token.access_token, "new");
  } finally {
    f.dispose();
  }
});

test("export liked follows pagination and skips unavailable tracks", async () => {
  const f = fixture();
  try {
    writeFileSync(
      f.config,
      JSON.stringify({
        client_id: "client",
        token: {
          access_token: "token",
          scope: "user-library-read",
          expires_at: Date.now() + 3600000,
        },
      }),
    );
    const paths: string[] = [];
    const mock = client((req) => {
      paths.push(req.url);
      return paths.length === 1
        ? {
            body: {
              items: [{ track: { uri: "spotify:track:1", name: "first" } }, { track: null }],
              next: "next",
            },
          }
        : { body: { items: [{ track: { uri: "spotify:track:2" } }], next: null } };
    });
    const out = join(f.dir, "playlist.json");
    await Effect.runPromise(
      exportPlaylist(out).pipe(
        Effect.provideService(HttpClient.HttpClient, mock),
        Effect.provide(NodeServices.layer),
      ),
    );
    assert.deepEqual(paths, [
      "https://api.spotify.com/v1/me/tracks?limit=50&offset=0",
      "https://api.spotify.com/v1/me/tracks?limit=50&offset=2",
    ]);
    const result = JSON.parse(readFileSync(out, "utf8")) as { tracks: unknown };
    assert.deepEqual(result.tracks, [
      { uri: "spotify:track:1", name: "first" },
      { uri: "spotify:track:2" },
    ]);
  } finally {
    f.dispose();
  }
});

for (const count of [0, 100, 101]) {
  test(`import replaces then appends in order for ${count} tracks`, async () => {
    const f = fixture();
    try {
      writeFileSync(
        f.config,
        JSON.stringify({
          client_id: "client",
          token: {
            access_token: "token",
            expires_at: Date.now() + 3600000,
          },
        }),
      );
      const tracks = Array.from({ length: count }, (_, i) => ({ uri: `spotify:track:${i}` }));
      const input = join(f.dir, "playlist.json");
      writeFileSync(input, JSON.stringify({ version: 1, playlist_id: "dest", tracks }));
      const calls: { method: string; uris: string[] }[] = [];
      const mock = client((req) => {
        const parsed = JSON.parse(body(req)) as { uris: string[] };
        calls.push({ method: req.method, uris: parsed.uris });
        assert.equal(req.url, "https://api.spotify.com/v1/playlists/dest/tracks");
        return { body: { snapshot_id: "snapshot" } };
      });
      await Effect.runPromise(
        importPlaylist(input, undefined, false).pipe(
          Effect.provideService(HttpClient.HttpClient, mock),
          Effect.provide(NodeServices.layer),
        ),
      );
      assert.deepEqual(
        calls.map((call) => call.method),
        count > 100 ? ["PUT", "POST"] : ["PUT"],
      );
      assert.deepEqual(
        calls.flatMap((call) => call.uris),
        tracks.map((track) => track.uri),
      );
      assert.equal(calls[0]?.uris.length, Math.min(count, 100));
    } finally {
      f.dispose();
    }
  });
}

test("import stops after a failed batch", async () => {
  const f = fixture();
  try {
    writeFileSync(
      f.config,
      JSON.stringify({
        client_id: "client",
        token: {
          access_token: "token",
          expires_at: Date.now() + 3600000,
        },
      }),
    );
    const input = join(f.dir, "playlist.json");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        playlist_id: "dest",
        tracks: Array.from({ length: 201 }, (_, i) => ({ uri: `spotify:track:${i}` })),
      }),
    );
    let calls = 0;
    const mock = client(() => {
      calls += 1;
      return calls === 2 ? { status: 500, body: {} } : { body: { snapshot_id: "snapshot" } };
    });
    await assert.rejects(
      Effect.runPromise(
        importPlaylist(input, undefined, false).pipe(
          Effect.provideService(HttpClient.HttpClient, mock),
          Effect.provide(NodeServices.layer),
        ),
      ),
      /HTTP 500/u,
    );
    assert.equal(calls, 2);
  } finally {
    f.dispose();
  }
});

test("malformed config is not treated as missing", async () => {
  const f = fixture();
  try {
    writeFileSync(f.config, "{");
    await assert.rejects(
      Effect.runPromise(
        accessToken().pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            client(() => {
              throw new Error("unexpected request");
            }),
          ),
          Effect.provide(NodeServices.layer),
        ),
      ),
      /Invalid JSON in Spotify config/u,
    );
  } finally {
    f.dispose();
  }
});

test("OAuth callback validates state and closes its listener", async () => {
  let ready!: (port: number) => void;
  const portReady = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const result = Effect.runPromise(waitForCallback("expected", ready, () => {}, 0));
  const rejected = assert.rejects(result, /state mismatch/u);
  const port = await portReady;
  const response = await fetch(`http://127.0.0.1:${port}/callback?code=secret&state=wrong`);
  assert.equal(response.status, 400);
  await rejected;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/callback`));
});

test("OAuth callback returns a valid code", async () => {
  let ready!: (port: number) => void;
  const portReady = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const result = Effect.runPromise(waitForCallback("expected", ready, () => {}, 0));
  const port = await portReady;
  const response = await fetch(`http://127.0.0.1:${port}/callback?code=code&state=expected`);
  assert.equal(response.status, 200);
  assert.equal(await result, "code");
});

test("interrupting OAuth closes the callback listener", async () => {
  let ready!: (port: number) => void;
  const portReady = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const controller = new AbortController();
  const result = Effect.runPromise(
    waitForCallback("expected", ready, () => {}, 0),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(result);
  const port = await portReady;
  controller.abort();
  await rejected;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/callback`));
});
