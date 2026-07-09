import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";
import { parseArgs as parseNodeArgs } from "node:util";

import { getErrorMessage } from "@accel-os/shared/guards";
import { fetchJsonWithSchema } from "@accel-os/shared/http";
import { parseJsonWithSchema } from "@accel-os/shared/json";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";

const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
].join(" ");

const REDIRECT_HOST = "127.0.0.1";
const REDIRECT_PORT = 53682;
const REDIRECT_PATH = "/callback";
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;

type Token = {
  access_token: string;
  refresh_token?: string | undefined;
  expires_at: number;
  scope?: string | undefined;
  token_type?: string | undefined;
};

type Config = {
  client_id: string;
  token?: Token | undefined;
};

type TrackEntry = {
  uri: string;
  name?: string | undefined;
  artists?: string[] | undefined;
  album?: string | undefined;
  type?: string | undefined;
};

type PlaylistFile = {
  version: 1;
  playlist_id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  public?: boolean | undefined;
  tracks: TrackEntry[];
};

const TokenSchema = Type.Object(
  {
    access_token: Type.String({ minLength: 1 }),
    refresh_token: Type.Optional(Type.String()),
    expires_at: Type.Number(),
    scope: Type.Optional(Type.String()),
    token_type: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const ConfigSchema = Type.Object(
  {
    client_id: Type.String({ minLength: 1 }),
    token: Type.Optional(TokenSchema),
  },
  { additionalProperties: false },
);

const TrackEntrySchema = Type.Object(
  {
    uri: Type.String(),
    name: Type.Optional(Type.String()),
    artists: Type.Optional(Type.Array(Type.String())),
    album: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const PlaylistFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    playlist_id: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    public: Type.Optional(Type.Boolean()),
    tracks: Type.Array(TrackEntrySchema),
  },
  { additionalProperties: false },
);

const TokenResponseSchema = Type.Object({
  access_token: Type.String({ minLength: 1 }),
  refresh_token: Type.Optional(Type.String()),
  expires_in: Type.Number(),
  scope: Type.Optional(Type.String()),
  token_type: Type.Optional(Type.String()),
});

const AuthTokenResponseSchema = Type.Object({
  access_token: Type.String({ minLength: 1 }),
  refresh_token: Type.String({ minLength: 1 }),
  expires_in: Type.Number(),
  scope: Type.Optional(Type.String()),
  token_type: Type.Optional(Type.String()),
});

const PlaylistsPageSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
    }),
  ),
  next: Type.Union([Type.String(), Type.Null()]),
});

const SpotifyTrackSchema = Type.Object({
  uri: Type.String(),
  name: Type.Optional(Type.String()),
  album: Type.Optional(
    Type.Object({
      name: Type.Optional(Type.String()),
    }),
  ),
  artists: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.Optional(Type.String()),
      }),
    ),
  ),
  type: Type.Optional(Type.String()),
});

const TracksPageSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      track: Type.Union([SpotifyTrackSchema, Type.Null()]),
    }),
  ),
  next: Type.Union([Type.String(), Type.Null()]),
});

const PlaylistDetailsSchema = Type.Object({
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  public: Type.Union([Type.Boolean(), Type.Null()]),
  tracks: Type.Object({
    total: Type.Number(),
  }),
});

const ProfileSchema = Type.Object({
  id: Type.String(),
});

const CreatedPlaylistSchema = Type.Object({
  id: Type.String(),
});

const SnapshotResponseSchema = Type.Object({
  snapshot_id: Type.String(),
});

type SpotifyTrack = Static<typeof SpotifyTrackSchema>;

type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: CliFlags;
};

type CliFlags = {
  help?: boolean | undefined;
  create?: boolean | undefined;
  "client-id"?: string | undefined;
  playlist?: string | undefined;
  out?: string | undefined;
  in?: string | undefined;
};

const usage = `mb-spotify auth --client-id <id>
mb-spotify list
mb-spotify export --playlist <id> --out <path>
mb-spotify export-liked --out <path>
mb-spotify import --in <path> [--playlist <id>] [--create]

Export format (JSON):
{
  "version": 1,
  "playlist_id": "...",
  "name": "...",
  "description": "...",
  "public": false,
  "tracks": [
    { "uri": "spotify:track:...", "name": "...", "artists": ["..."], "album": "..." }
  ]
}
`;

const encoder = new TextEncoder();

const parseCliArgs = (args: string[]): ParsedArgs => {
  const parsedArgs = parseNodeArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      create: { type: "boolean" },
      "client-id": { type: "string" },
      playlist: { type: "string" },
      out: { type: "string" },
      in: { type: "string" },
    },
  });
  const positionals = parsedArgs.positionals;
  const [command, ...rest] = positionals;
  return {
    command: command ?? null,
    positionals: rest,
    flags: parsedArgs.values,
  };
};

const stringFlag = (flags: CliFlags, name: keyof CliFlags): string | undefined =>
  typeof flags[name] === "string" ? flags[name] : undefined;

const hasHelpFlag = (flags: CliFlags): boolean => flags.help === true;

const hasBooleanFlag = (flags: CliFlags, name: keyof CliFlags): boolean => flags[name] === true;

const configDir = (): string => {
  const home = process.env["HOME"] ?? "";
  const configHome = process.env["XDG_CONFIG_HOME"] ?? (home ? `${home}/.config` : ".");
  return `${configHome}/mb-scripts`;
};

const configPath = (): string => `${configDir()}/spotify.json`;

const readConfig = async (): Promise<Config | null> => {
  try {
    const raw = await readFile(configPath(), "utf8");
    return parseJsonWithSchema(raw, ConfigSchema, "Spotify config");
  } catch {
    return null;
  }
};

const writeConfig = async (config: Config): Promise<void> => {
  await mkdir(configDir(), { recursive: true });
  const data = JSON.stringify(config, null, 2);
  await writeFile(configPath(), `${data}\n`);
};

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const sha256 = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return base64UrlEncode(new Uint8Array(digest));
};

const randomVerifier = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
};

const spotifyRequest = async <Schema extends TSchema>(
  path: string,
  token: string,
  schema: Schema,
  context: string,
  init?: RequestInit,
): Promise<Static<Schema>> => {
  const url = `https://api.spotify.com/v1${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body !== undefined && init.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return await fetchJsonWithSchema(url, schema, context, { ...init, headers });
};

const refreshToken = async (config: Config): Promise<Token> => {
  if (!config.token?.refresh_token) {
    throw new Error("refresh token missing; run mb-spotify auth");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.token.refresh_token,
    client_id: config.client_id,
  });

  const data = await fetchJsonWithSchema(
    "https://accounts.spotify.com/api/token",
    TokenResponseSchema,
    "Spotify token refresh response",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? config.token.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
};

const hasGrantedScopes = (grantedScope: string | undefined, requiredScopes: string[]): boolean => {
  if (requiredScopes.length === 0) {
    return true;
  }

  if (!grantedScope) {
    return false;
  }

  const granted = new Set(grantedScope.split(/\s+/).filter((scope) => scope.length > 0));
  return requiredScopes.every((scope) => granted.has(scope));
};

const getAccessToken = async (requiredScopes: string[] = []): Promise<string> => {
  const config = await readConfig();
  if (!config) {
    throw new Error("missing config; run mb-spotify auth");
  }

  const existing = config.token;
  if (!existing) {
    throw new Error("missing token; run mb-spotify auth");
  }

  if (!hasGrantedScopes(existing.scope, requiredScopes)) {
    throw new Error(
      `missing required Spotify scope(s): ${requiredScopes.join(", ")}; run mb-spotify auth again`,
    );
  }

  if (Date.now() + 60_000 < existing.expires_at) {
    return existing.access_token;
  }

  const refreshed = await refreshToken(config);
  const updated = { ...config, token: refreshed };
  await writeConfig(updated);
  return refreshed.access_token;
};

const trackEntryFromSpotifyTrack = (track: SpotifyTrack | null): TrackEntry | null => {
  const uri = track?.uri;
  if (!uri) {
    return null;
  }

  const name = track.name;
  const album = track.album?.name;
  const artists = track.artists
    ?.map((artist) => artist.name ?? null)
    .filter((artist): artist is string => artist !== null);
  const type = track.type;

  return { uri, name, artists, album, type };
};

const readPlaylistFile = async (path: string): Promise<PlaylistFile> => {
  const raw = await readFile(path, "utf8");
  return parseJsonWithSchema(raw, PlaylistFileSchema, "playlist file");
};

const writePlaylistFile = async (path: string, playlist: PlaylistFile): Promise<void> => {
  const data = JSON.stringify(playlist, null, 2);
  await writeFile(path, `${data}\n`);
};

const openInBrowser = (url: string): void => {
  try {
    const child = spawn("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (error) => {
      console.error(`failed to open browser: ${getErrorMessage(error)}`);
    });
    child.unref();
  } catch (error) {
    console.error(`failed to open browser: ${getErrorMessage(error)}`);
  }
};

const waitForAuthCode = async (expectedPath: string, state: string): Promise<string> => {
  let settled = false;

  const codePromise = new Promise<string>((resolve, reject) => {
    const finish = (result: { code?: string; error?: string }): void => {
      if (settled) {
        return;
      }
      settled = true;
      server.close();
      if (result.error) {
        reject(new Error(result.error));
        return;
      }
      if (!result.code) {
        reject(new Error("authorization code missing"));
        return;
      }
      resolve(result.code);
    };

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);

      if (url.pathname !== expectedPath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        finish({ error: `authorization error: ${error}` });
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end(`authorization error: ${error}`);
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (!code) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Missing code");
        return;
      }
      if (returnedState !== state) {
        finish({ error: "state mismatch" });
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("state mismatch");
        return;
      }

      finish({ code });

      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("Authorization received. You can close this tab.");
    });

    server.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    server.listen(REDIRECT_PORT, REDIRECT_HOST);
  });

  return await codePromise;
};

const isErrnoException = (value: unknown): value is NodeJS.ErrnoException => {
  return value instanceof Error && "code" in value;
};

const cmdAuth = async (parsed: ParsedArgs): Promise<void> => {
  const existing = await readConfig();
  const clientId = stringFlag(parsed.flags, "client-id") ?? existing?.client_id;

  if (!clientId) {
    throw new Error(
      "client id missing; create a Spotify app and pass --client-id. See https://developer.spotify.com/documentation/web-api/tutorials/getting-started#create-an-app",
    );
  }

  console.log("Ensure this redirect URI is registered in your Spotify app settings:");
  console.log(REDIRECT_URI);

  const verifier = randomVerifier();
  const challenge = await sha256(verifier);
  const state = randomVerifier();
  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);

  console.log("Open this URL and authorize:");
  console.log(authUrl.toString());
  openInBrowser(authUrl.toString());
  console.log(`Waiting for redirect on ${REDIRECT_URI}`);
  let code: string;
  try {
    code = await waitForAuthCode(REDIRECT_PATH, state);
  } catch (error) {
    if (isErrnoException(error) && error.code === "EADDRINUSE") {
      throw new Error(`port ${REDIRECT_PORT} is in use; free it or change REDIRECT_PORT`, {
        cause: error,
      });
    }
    throw error;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });

  const token = await fetchJsonWithSchema(
    "https://accounts.spotify.com/api/token",
    AuthTokenResponseSchema,
    "Spotify authorization token response",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  await writeConfig({
    client_id: clientId,
    token: {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + token.expires_in * 1000,
      scope: token.scope,
      token_type: token.token_type,
    },
  });

  console.log(`Saved token to ${configPath()}`);
};

const cmdList = async (): Promise<void> => {
  const token = await getAccessToken();
  let url = "/me/playlists?limit=50";

  while (url) {
    const data = await spotifyRequest(url, token, PlaylistsPageSchema, "Spotify playlists page");
    for (const item of data.items) {
      console.log(`${item.id}\t${item.name}`);
    }
    if (!data.next) {
      break;
    }
    url = data.next.replace("https://api.spotify.com/v1", "");
  }
};

const cmdExportLiked = async (parsed: ParsedArgs): Promise<void> => {
  const outPath = stringFlag(parsed.flags, "out") ?? parsed.positionals[0];
  if (!outPath) {
    throw new Error("missing output path");
  }

  const token = await getAccessToken(["user-library-read"]);
  let offset = 0;
  const entries: TrackEntry[] = [];

  while (true) {
    const page = await spotifyRequest(
      `/me/tracks?limit=50&offset=${offset}`,
      token,
      TracksPageSchema,
      "Spotify liked tracks page",
    );

    for (const item of page.items) {
      const entry = trackEntryFromSpotifyTrack(item.track);
      if (!entry) {
        continue;
      }

      entries.push(entry);
    }

    offset += page.items.length;
    console.error(`exported ${entries.length}`);
    if (!page.next) {
      break;
    }
  }

  const file: PlaylistFile = {
    version: 1,
    name: "Liked Songs",
    description: "Saved tracks from Your Library",
    tracks: entries,
  };

  await writePlaylistFile(outPath, file);
  console.error(`saved ${entries.length} tracks to ${outPath}`);
};

const cmdExport = async (parsed: ParsedArgs): Promise<void> => {
  const playlistId = stringFlag(parsed.flags, "playlist") ?? parsed.positionals[0];
  const outPath = stringFlag(parsed.flags, "out") ?? parsed.positionals[1];

  if (!playlistId || !outPath) {
    throw new Error("missing playlist id or output path");
  }

  const token = await getAccessToken();
  const playlist = await spotifyRequest(
    `/playlists/${playlistId}`,
    token,
    PlaylistDetailsSchema,
    "Spotify playlist details",
  );

  const entries: TrackEntry[] = [];
  const total = playlist.tracks.total;
  let offset = 0;

  while (true) {
    const page = await spotifyRequest(
      `/playlists/${playlistId}/tracks?limit=100&offset=${offset}&additional_types=track,episode`,
      token,
      TracksPageSchema,
      "Spotify playlist tracks page",
    );

    for (const item of page.items) {
      const entry = trackEntryFromSpotifyTrack(item.track);
      if (!entry) {
        continue;
      }

      entries.push(entry);
    }

    offset += page.items.length;
    console.error(`exported ${entries.length}/${total}`);

    if (!page.next) {
      break;
    }
  }

  const file: PlaylistFile = {
    version: 1,
    playlist_id: playlistId,
    name: playlist.name,
    description: playlist.description ?? undefined,
    public: playlist.public ?? undefined,
    tracks: entries,
  };

  await writePlaylistFile(outPath, file);
  console.error(`saved ${entries.length} tracks to ${outPath}`);
};

const cmdImport = async (parsed: ParsedArgs): Promise<void> => {
  const inPath = stringFlag(parsed.flags, "in") ?? parsed.positionals[0];
  const playlistOverride = stringFlag(parsed.flags, "playlist");
  const shouldCreate = hasBooleanFlag(parsed.flags, "create");

  if (!inPath) {
    throw new Error("missing input path");
  }

  const file = await readPlaylistFile(inPath);
  if (shouldCreate && playlistOverride) {
    throw new Error("cannot use --create together with --playlist");
  }

  let playlistId = playlistOverride ?? file.playlist_id;
  const token = await getAccessToken();

  if (shouldCreate) {
    const profile = await spotifyRequest("/me", token, ProfileSchema, "Spotify profile");
    const created = await spotifyRequest(
      `/users/${profile.id}/playlists`,
      token,
      CreatedPlaylistSchema,
      "Spotify created playlist",
      {
        method: "POST",
        body: JSON.stringify({
          name: file.name ?? "Imported Playlist",
          description: file.description ?? "",
          public: file.public ?? false,
        }),
      },
    );
    playlistId = created.id;
    console.error(`created playlist ${playlistId}`);
  }

  if (!playlistId) {
    throw new Error(
      "playlist id missing; pass --playlist, export a file with playlist_id, or use --create",
    );
  }

  const uris = file.tracks.map((track) => track.uri.trim()).filter((uri) => uri.length > 0);

  console.error(`replacing playlist ${playlistId} with ${uris.length} items`);

  const firstBatch = uris.slice(0, 100);
  await spotifyRequest(
    `/playlists/${playlistId}/tracks`,
    token,
    SnapshotResponseSchema,
    "Spotify replace playlist tracks response",
    {
      method: "PUT",
      body: JSON.stringify({ uris: firstBatch }),
    },
  );

  let uploaded = firstBatch.length;
  console.error(`uploaded ${uploaded}/${uris.length}`);

  for (let i = 100; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    await spotifyRequest(
      `/playlists/${playlistId}/tracks`,
      token,
      SnapshotResponseSchema,
      "Spotify append playlist tracks response",
      {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
      },
    );
    uploaded += batch.length;
    console.error(`uploaded ${uploaded}/${uris.length}`);
  }
};

const main = async (): Promise<void> => {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.command || hasHelpFlag(parsed.flags)) {
    console.log(usage.trim());
    return;
  }

  switch (parsed.command) {
    case "auth":
      await cmdAuth(parsed);
      return;
    case "list":
      await cmdList();
      return;
    case "export-liked":
      await cmdExportLiked(parsed);
      return;
    case "export":
      await cmdExport(parsed);
      return;
    case "import":
      await cmdImport(parsed);
      return;
    default:
      throw new Error(`unknown command: ${parsed.command}`);
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(getErrorMessage(error));
    console.error("\n" + usage.trim());
    process.exit(1);
  }
}
