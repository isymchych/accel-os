import { createServer } from "node:http";
import process from "node:process";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Deferred, Effect, Fiber, FileSystem, Option, Schema } from "effect";
import type { PlatformError } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { logEvent, withExecutionLog } from "../lib/execution-log.ts";

const redirectUri = "http://127.0.0.1:53682/callback";
const scopes =
  "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-read";
const optionalString = Schema.optionalKey(Schema.String);

const Token = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: optionalString,
  expires_at: Schema.Number,
  scope: optionalString,
  token_type: optionalString,
});

const Config = Schema.Struct({
  client_id: Schema.NonEmptyString,
  token: Schema.optionalKey(Token),
});

const Track = Schema.Struct({
  uri: Schema.String,
  name: optionalString,
  artists: Schema.optionalKey(Schema.Array(Schema.String)),
  album: optionalString,
  type: optionalString,
});

const Playlist = Schema.Struct({
  version: Schema.Literal(1),
  playlist_id: optionalString,
  name: optionalString,
  description: optionalString,
  public: Schema.optionalKey(Schema.Boolean),
  tracks: Schema.Array(Track),
});

const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: optionalString,
  expires_in: Schema.Number,
  scope: optionalString,
  token_type: optionalString,
});

const ApiTrack = Schema.Struct({
  uri: Schema.String,
  name: optionalString,
  album: Schema.optionalKey(Schema.Struct({ name: optionalString })),
  artists: Schema.optionalKey(Schema.Array(Schema.Struct({ name: optionalString }))),
  type: optionalString,
});

const TracksPage = Schema.Struct({
  items: Schema.Array(Schema.Struct({ track: Schema.NullOr(ApiTrack) })),
  next: Schema.NullOr(Schema.String),
});

const PlaylistsPage = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  next: Schema.NullOr(Schema.String),
});

const PlaylistDetails = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  public: Schema.NullOr(Schema.Boolean),
  tracks: Schema.Struct({ total: Schema.Number }),
});

const Id = Schema.Struct({ id: Schema.String });
const Snapshot = Schema.Struct({ snapshot_id: Schema.String });

type ConfigValue = typeof Config.Type;
type TokenValue = typeof Token.Type;
type PlaylistValue = typeof Playlist.Type;
type TrackValue = typeof Track.Type;
type FileError = PlatformError.PlatformError;
type SpotifyEffect<A> = Effect.Effect<
  A,
  Error | FileError,
  FileSystem.FileSystem | HttpClient.HttpClient
>;

const configDir = (): string =>
  `${process.env["XDG_CONFIG_HOME"] ?? (process.env["HOME"] ? `${process.env["HOME"]}/.config` : ".")}/mb-scripts`;
const configPath = (): string => `${configDir()}/spotify.json`;

function readJson<S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  label: string,
): Effect.Effect<S["Type"], Error | FileError, FileSystem.FileSystem | S["DecodingServices"]> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path);
    const value: unknown = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new Error(`Invalid JSON in ${label}`),
    });

    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(() => new Error(`Invalid ${label}`)),
    );
  });
}

function readConfig(): Effect.Effect<ConfigValue | null, Error | FileError, FileSystem.FileSystem> {
  return readJson(configPath(), Config, "Spotify config").pipe(
    Effect.catchIf(
      (error) => "reason" in error && error.reason["_tag"] === "NotFound",
      () => Effect.succeed(null),
    ),
  );
}

function writeJson(
  path: string,
  value: unknown,
): Effect.Effect<void, FileError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path, JSON.stringify(value, null, 2) + "\n");
  });
}

function writeConfig(config: ConfigValue): Effect.Effect<void, FileError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(configDir(), { recursive: true });
    yield* writeJson(configPath(), config);
  });
}

function request<S extends Schema.ConstraintDecoder<unknown>>(
  req: HttpClientRequest.HttpClientRequest,
  schema: S,
  context: string,
): Effect.Effect<S["Type"], Error, HttpClient.HttpClient | S["DecodingServices"]> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    // Never expose request headers, bodies, or provider response data in errors/logs.
    const response = yield* client
      .execute(req)
      .pipe(Effect.mapError(() => new Error(`${context}: request failed`)));

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(new Error(`${context}: HTTP ${response.status}`));
    }

    const json = yield* response.json.pipe(
      Effect.mapError(() => new Error(`${context}: invalid JSON`)),
    );

    return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
      Effect.mapError(() => new Error(`${context}: invalid response`)),
    );
  });
}

function api<S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  token: string,
  schema: S,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown,
): Effect.Effect<S["Type"], Error, HttpClient.HttpClient | S["DecodingServices"]> {
  let req = HttpClientRequest.make(method)(`https://api.spotify.com/v1${path}`).pipe(
    HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
  );

  if (body !== undefined) req = req.pipe(HttpClientRequest.bodyJsonUnsafe(body));
  return request(req, schema, "Spotify API");
}

function tokenRequest(
  params: URLSearchParams,
): Effect.Effect<typeof TokenResponse.Type, Error, HttpClient.HttpClient> {
  return request(
    HttpClientRequest.post("https://accounts.spotify.com/api/token").pipe(
      HttpClientRequest.bodyText(params.toString(), "application/x-www-form-urlencoded"),
    ),
    TokenResponse,
    "Spotify token request",
  );
}

export function accessToken(requiredScope?: string): SpotifyEffect<string> {
  return Effect.gen(function* () {
    const config = yield* readConfig();

    if (!config?.token)
      return yield* Effect.fail(new Error("Missing Spotify token; run mb-spotify auth"));

    const token = config.token;

    if (requiredScope && !token.scope?.split(/\s+/u).includes(requiredScope)) {
      return yield* Effect.fail(
        new Error(`Missing Spotify scope ${requiredScope}; run mb-spotify auth`),
      );
    }

    if (Date.now() + 60_000 < token.expires_at) return token.access_token;
    if (!token.refresh_token)
      return yield* Effect.fail(new Error("Missing refresh token; run mb-spotify auth"));

    const data = yield* tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: config.client_id,
      }),
    );

    const refreshed: TokenValue = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? token.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      ...((data.scope ?? token.scope) ? { scope: data.scope ?? token.scope } : {}),
      ...(data.token_type === undefined ? {} : { token_type: data.token_type }),
    };

    yield* writeConfig({ ...config, token: refreshed });
    return refreshed.access_token;
  });
}

function trackEntry(track: typeof ApiTrack.Type | null): TrackValue | undefined {
  if (!track?.uri) return undefined;

  return {
    uri: track.uri,
    ...(track.name === undefined ? {} : { name: track.name }),
    ...(track.album?.name === undefined ? {} : { album: track.album.name }),
    ...(track.artists === undefined
      ? {}
      : { artists: track.artists.flatMap((a) => (a.name === undefined ? [] : [a.name])) }),
    ...(track.type === undefined ? {} : { type: track.type }),
  };
}

function list(): SpotifyEffect<void> {
  return Effect.gen(function* () {
    yield* logEvent("operation_started", { operation: "list" });

    const token = yield* accessToken();
    let path: string | null = "/me/playlists?limit=50";

    while (path) {
      const page: typeof PlaylistsPage.Type = yield* api(path, token, PlaylistsPage);
      for (const item of page.items) yield* Console.log(`${item.id}\t${item.name}`);
      path = page.next?.replace("https://api.spotify.com/v1", "") ?? null;
    }
  });
}

export function exportPlaylist(out: string, playlistId?: string): SpotifyEffect<void> {
  return Effect.gen(function* () {
    yield* logEvent("operation_started", {
      operation: playlistId === undefined ? "export_liked" : "export",
    });

    const token = yield* accessToken(playlistId === undefined ? "user-library-read" : undefined);
    const details =
      playlistId === undefined
        ? undefined
        : yield* api(`/playlists/${playlistId}`, token, PlaylistDetails);
    let offset = 0;
    const tracks: TrackValue[] = [];

    while (true) {
      const path =
        playlistId === undefined
          ? `/me/tracks?limit=50&offset=${offset}`
          : `/playlists/${playlistId}/tracks?limit=100&offset=${offset}&additional_types=track,episode`;
      const page = yield* api(path, token, TracksPage);

      for (const item of page.items) {
        const entry = trackEntry(item.track);
        if (entry) tracks.push(entry);
      }

      offset += page.items.length;
      yield* Console.error(`exported ${tracks.length}${details ? `/${details.tracks.total}` : ""}`);
      if (!page.next) break;
    }

    const file: PlaylistValue = {
      version: 1,
      ...(playlistId === undefined ? {} : { playlist_id: playlistId }),
      name: details?.name ?? "Liked Songs",
      ...(details
        ? details.description === null
          ? {}
          : { description: details.description }
        : { description: "Saved tracks from Your Library" }),
      ...(details?.public === null || details?.public === undefined
        ? {}
        : { public: details.public }),
      tracks,
    };

    yield* writeJson(out, file);
    yield* Console.error(`saved ${tracks.length} tracks to ${out}`);
  });
}

export function importPlaylist(
  input: string,
  playlist: string | undefined,
  create: boolean,
): SpotifyEffect<void> {
  return Effect.gen(function* () {
    yield* logEvent("operation_started", { operation: "import", create });

    if (create && playlist)
      return yield* Effect.fail(new Error("Cannot use --create with --playlist"));

    const file = yield* readJson(input, Playlist, "playlist file");
    const token = yield* accessToken();
    let id = playlist ?? file.playlist_id;

    if (create) {
      const profile = yield* api("/me", token, Id);
      const created = yield* api(`/users/${profile.id}/playlists`, token, Id, "POST", {
        name: file.name ?? "Imported Playlist",
        description: file.description ?? "",
        public: file.public ?? false,
      });

      id = created.id;
      yield* Console.error(`created playlist ${id}`);
    }

    if (!id)
      return yield* Effect.fail(new Error("Playlist id missing; use --playlist or --create"));

    const uris = file.tracks.map((track) => track.uri.trim()).filter(Boolean);
    yield* Console.error(`replacing playlist ${id} with ${uris.length} items`);
    yield* api(`/playlists/${id}/tracks`, token, Snapshot, "PUT", { uris: uris.slice(0, 100) });
    yield* Console.error(`uploaded ${Math.min(100, uris.length)}/${uris.length}`);

    for (let i = 100; i < uris.length; i += 100) {
      yield* api(`/playlists/${id}/tracks`, token, Snapshot, "POST", {
        uris: uris.slice(i, i + 100),
      });
      yield* Console.error(`uploaded ${Math.min(i + 100, uris.length)}/${uris.length}`);
    }

    return yield* Effect.void;
  });
}

function randomString(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

// The callback owns the Node server and closes it on success, failure, or interruption.
export function waitForCallback(
  state: string,
  onReady: (port: number) => void,
  onError: (error: Error) => void,
  port = 53682,
): Effect.Effect<string, Error> {
  return Effect.callback<string, Error>((resume) => {
    let finished = false;

    const finish = (result: Effect.Effect<string, Error>): void => {
      if (finished) return;
      finished = true;
      server.close();
      resume(result);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);

      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.writeHead(400).end("Authorization denied");
        finish(Effect.fail(new Error("Spotify authorization denied")));
      } else if (!code) {
        res.writeHead(400).end("Missing code");
      } else if (url.searchParams.get("state") === state) {
        res.writeHead(200).end("Authorization received. You can close this tab.");
        finish(Effect.succeed(code));
      } else {
        res.writeHead(400).end("State mismatch");
        finish(Effect.fail(new Error("Spotify authorization state mismatch")));
      }
    });

    server.on("error", (error) => {
      onError(error);
      finish(Effect.fail(error));
    });

    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address !== null && typeof address !== "string") onReady(address.port);
    });

    return Effect.sync(() => {
      server.close();
    });
  });
}

function auth(
  clientId: string | undefined,
): Effect.Effect<
  void,
  Error | FileError,
  FileSystem.FileSystem | HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    yield* logEvent("operation_started", { operation: "auth" });

    const existing = yield* readConfig();
    const id = clientId ?? existing?.client_id;
    if (!id) return yield* Effect.fail(new Error("Client ID missing; pass --client-id"));

    const verifier = randomString();
    const challenge = yield* Effect.tryPromise({
      try: async () =>
        Buffer.from(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
        ).toString("base64url"),
      catch: () => new Error("Could not generate PKCE challenge"),
    });

    const state = randomString();
    const url = new URL("https://accounts.spotify.com/authorize");

    for (const [key, value] of Object.entries({
      client_id: id,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: scopes,
      state,
    }))
      url.searchParams.set(key, value);

    yield* Console.log(
      `Register redirect URI: ${redirectUri}\nOpen this URL and authorize:\n${url}`,
    );

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const ready = yield* Deferred.make<undefined, Error>();
    const callback = yield* waitForCallback(
      state,
      () => {
        Deferred.doneUnsafe(ready, Effect.succeed(undefined));
      },
      (error) => {
        Deferred.doneUnsafe(ready, Effect.fail(error));
      },
    ).pipe(Effect.forkChild);
    yield* Deferred.await(ready);

    // Opening a browser is best effort; the URL above remains usable.
    yield* spawner
      .exitCode(
        ChildProcess.make("xdg-open", [url.toString()], {
          // Browser diagnostics can echo the authorization URL and state.
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(
        Effect.flatMap((status) =>
          status === 0 ? Effect.void : Console.error("Could not open browser"),
        ),
        Effect.catch(() => Console.error("Could not open browser")),
        Effect.forkChild,
      );

    const code = yield* Fiber.join(callback);
    const data = yield* tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: id,
        code_verifier: verifier,
      }),
    );

    if (!data.refresh_token)
      return yield* Effect.fail(new Error("Spotify did not return a refresh token"));

    yield* writeConfig({
      client_id: id,
      token: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
        ...(data.scope === undefined ? {} : { scope: data.scope }),
        ...(data.token_type === undefined ? {} : { token_type: data.token_type }),
      },
    });

    yield* Console.log(`Saved token to ${configPath()}`);
    return yield* Effect.void;
  });
}

const app = Command.make("mb-spotify").pipe(
  Command.withSubcommands([
    Command.make(
      "auth",
      { clientId: Flag.String("client-id").pipe(Flag.optional) },
      ({ clientId }) => auth(Option.getOrUndefined(clientId)),
    ),
    Command.make("list", {}, () => list()),
    Command.make(
      "export",
      { playlist: Flag.String("playlist"), out: Flag.String("out") },
      ({ playlist, out }) => exportPlaylist(out, playlist),
    ),
    Command.make("export-liked", { out: Flag.String("out") }, ({ out }) => exportPlaylist(out)),
    Command.make(
      "import",
      {
        input: Flag.String("in"),
        playlist: Flag.String("playlist").pipe(Flag.optional),
        create: Flag.Boolean("create").pipe(Flag.withDefault(false)),
      },
      ({ input, playlist, create }) =>
        importPlaylist(input, Option.getOrUndefined(playlist), create),
    ),
  ]),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    withExecutionLog("mb-spotify", app.pipe(Command.run({ version: "1.0.0" }))).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(NodeServices.layer),
    ),
  );
}
