import { parseArgs } from "@std/cli/parse-args";

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
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
};

type Config = {
  client_id: string;
  token?: Token;
};

type TrackEntry = {
  uri: string;
  name?: string;
  artists?: string[];
  album?: string;
  type?: string;
};

type PlaylistFile = {
  version: 1;
  playlist_id?: string;
  name?: string;
  description?: string;
  public?: boolean;
  tracks: TrackEntry[];
};

type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
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

const normalizeFlags = (
  parsed: Record<string, unknown>,
): Record<string, string | boolean> => {
  const flags: Record<string, string | boolean> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_") {
      continue;
    }

    if (typeof value === "string" || typeof value === "boolean") {
      flags[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (typeof last === "string" || typeof last === "boolean") {
        flags[key] = last;
      }
    }
  }

  return flags;
};

const parseCliArgs = (args: string[]): ParsedArgs => {
  const parsedArgs = parseArgs(args, {
    boolean: ["help", "create"],
    string: ["client-id", "playlist", "out", "in"],
    alias: { h: "help" },
  });
  const positionals = parsedArgs._.map((item: unknown) => String(item));
  const [command, ...rest] = positionals;
  return {
    command: command ?? null,
    positionals: rest,
    flags: normalizeFlags(parsedArgs as Record<string, unknown>),
  };
};

const stringFlag = (
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined => {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
};

const hasHelpFlag = (flags: Record<string, string | boolean>): boolean =>
  flags.help === true || flags.h === true;

const hasBooleanFlag = (
  flags: Record<string, string | boolean>,
  name: string,
): boolean => flags[name] === true;

const configDir = (): string => {
  const home = Deno.env.get("HOME") ?? "";
  const configHome = Deno.env.get("XDG_CONFIG_HOME") ??
    (home ? `${home}/.config` : ".");
  return `${configHome}/mb-scripts`;
};

const configPath = (): string => `${configDir()}/spotify.json`;

const readConfig = async (): Promise<Config | null> => {
  try {
    const raw = await Deno.readTextFile(configPath());
    const parsed = JSON.parse(raw) as Partial<Config>;
    if (!parsed.client_id) {
      return null;
    }
    return {
      client_id: parsed.client_id,
      token: parsed.token,
    };
  } catch {
    return null;
  }
};

const writeConfig = async (config: Config): Promise<void> => {
  await Deno.mkdir(configDir(), { recursive: true });
  const data = JSON.stringify(config, null, 2);
  await Deno.writeTextFile(configPath(), `${data}\n`);
};

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const sha256 = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return base64UrlEncode(new Uint8Array(digest));
};

const randomVerifier = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return await response.json() as T;
};

const spotifyRequest = async <T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> => {
  const url = `https://api.spotify.com/v1${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return await fetchJson<T>(url, { ...init, headers });
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

  const data = await fetchJson<{
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
    refresh_token?: string;
  }>("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? config.token.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
};

const hasGrantedScopes = (
  grantedScope: string | undefined,
  requiredScopes: string[],
): boolean => {
  if (requiredScopes.length === 0) {
    return true;
  }

  if (!grantedScope) {
    return false;
  }

  const granted = new Set(
    grantedScope.split(/\s+/).filter((scope) => scope.length > 0),
  );
  return requiredScopes.every((scope) => granted.has(scope));
};

const getAccessToken = async (
  requiredScopes: string[] = [],
): Promise<string> => {
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
      `missing required Spotify scope(s): ${
        requiredScopes.join(", ")
      }; run mb-spotify auth again`,
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

const trackEntryFromSpotifyTrack = (
  track: Record<string, unknown> | null,
): TrackEntry | null => {
  const uri = typeof track?.uri === "string" ? track.uri : "";
  if (!uri) {
    return null;
  }

  const name = typeof track?.name === "string" ? track.name : undefined;
  const album = typeof track?.album === "object" && track.album !== null &&
      typeof (track.album as Record<string, unknown>).name === "string"
    ? (track.album as Record<string, unknown>).name as string
    : undefined;
  const artists = Array.isArray(track?.artists)
    ? (track.artists as Array<Record<string, unknown>>)
      .map((artist) => typeof artist.name === "string" ? artist.name : null)
      .filter((artist): artist is string => Boolean(artist))
    : undefined;
  const type = typeof track?.type === "string" ? track.type : undefined;

  return { uri, name, artists, album, type };
};

const parsePlaylistFile = (value: unknown): PlaylistFile => {
  if (typeof value !== "object" || value === null) {
    throw new Error("playlist file must be a JSON object");
  }

  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.tracks)) {
    throw new Error("playlist file missing tracks array");
  }

  const tracks = obj.tracks;

  return {
    version: 1,
    playlist_id: typeof obj.playlist_id === "string"
      ? obj.playlist_id
      : undefined,
    name: typeof obj.name === "string" ? obj.name : undefined,
    description: typeof obj.description === "string"
      ? obj.description
      : undefined,
    public: typeof obj.public === "boolean" ? obj.public : undefined,
    tracks: tracks
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return null;
        }
        const entry = item as Record<string, unknown>;
        const uri = typeof entry.uri === "string" ? entry.uri : "";
        const name = typeof entry.name === "string" ? entry.name : undefined;
        const artists = Array.isArray(entry.artists)
          ? entry.artists.filter((artist) =>
            typeof artist === "string"
          ) as string[]
          : undefined;
        const album = typeof entry.album === "string" ? entry.album : undefined;
        const type = typeof entry.type === "string" ? entry.type : undefined;

        return { uri, name, artists, album, type } as TrackEntry;
      })
      .filter((entry): entry is TrackEntry => Boolean(entry)),
  };
};

const ensurePlaylistFile = (playlist: PlaylistFile): PlaylistFile => {
  if (!Array.isArray(playlist.tracks)) {
    throw new Error("playlist file missing tracks array");
  }
  return playlist;
};

const readPlaylistFile = async (path: string): Promise<PlaylistFile> => {
  const raw = await Deno.readTextFile(path);
  const parsed = JSON.parse(raw) as unknown;
  return ensurePlaylistFile(parsePlaylistFile(parsed));
};

const writePlaylistFile = async (
  path: string,
  playlist: PlaylistFile,
): Promise<void> => {
  const data = JSON.stringify(playlist, null, 2);
  await Deno.writeTextFile(path, `${data}\n`);
};

const openInBrowser = (url: string): void => {
  try {
    const child = new Deno.Command("xdg-open", {
      args: [url],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    child.unref();
  } catch (error) {
    console.error(
      `failed to open browser: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const waitForAuthCode = async (
  expectedPath: string,
  state: string,
): Promise<string> => {
  let settled = false;
  const abortController = new AbortController();

  const codePromise = new Promise<string>((resolve, reject) => {
    const finish = (result: { code?: string; error?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      abortController.abort();
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

    const handle = (request: Request): Response => {
      const url = new URL(request.url);

      if (url.pathname !== expectedPath) {
        return new Response("Not found", { status: 404 });
      }

      const error = url.searchParams.get("error");
      if (error) {
        finish({ error: `authorization error: ${error}` });
        return new Response(`authorization error: ${error}`, { status: 400 });
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (!code) {
        return new Response("Missing code", { status: 400 });
      }
      if (returnedState !== state) {
        finish({ error: "state mismatch" });
        return new Response("state mismatch", { status: 400 });
      }

      finish({ code });

      return new Response("Authorization received. You can close this tab.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    };

    try {
      Deno.serve({
        hostname: REDIRECT_HOST,
        port: REDIRECT_PORT,
        signal: abortController.signal,
        onListen: () => {},
      }, handle);
    } catch (error) {
      if (!settled) {
        reject(error);
      }
    }
  });

  return await codePromise;
};

const cmdAuth = async (parsed: ParsedArgs): Promise<void> => {
  const existing = await readConfig();
  const clientId = stringFlag(parsed.flags, "client-id") ?? existing?.client_id;

  if (!clientId) {
    throw new Error(
      "client id missing; create a Spotify app and pass --client-id. See https://developer.spotify.com/documentation/web-api/tutorials/getting-started#create-an-app",
    );
  }

  console.log(
    "Ensure this redirect URI is registered in your Spotify app settings:",
  );
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
    if (error instanceof Deno.errors.AddrInUse) {
      throw new Error(
        `port ${REDIRECT_PORT} is in use; free it or change REDIRECT_PORT`,
      );
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

  const token = await fetchJson<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  }>("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

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
    const data = await spotifyRequest<
      { items: { id: string; name: string }[]; next: string | null }
    >(
      url,
      token,
    );
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
    const page = await spotifyRequest<
      {
        items: Array<{ track: Record<string, unknown> | null }>;
        next: string | null;
      }
    >(
      `/me/tracks?limit=50&offset=${offset}`,
      token,
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
  const playlistId = stringFlag(parsed.flags, "playlist") ??
    parsed.positionals[0];
  const outPath = stringFlag(parsed.flags, "out") ?? parsed.positionals[1];

  if (!playlistId || !outPath) {
    throw new Error("missing playlist id or output path");
  }

  const token = await getAccessToken();
  const playlist = await spotifyRequest<
    {
      name: string;
      description: string | null;
      public: boolean | null;
      tracks: { total: number };
    }
  >(
    `/playlists/${playlistId}`,
    token,
  );

  const entries: TrackEntry[] = [];
  const total = playlist.tracks.total;
  let offset = 0;

  while (true) {
    const page = await spotifyRequest<
      {
        items: Array<{ track: Record<string, unknown> | null }>;
        next: string | null;
      }
    >(
      `/playlists/${playlistId}/tracks?limit=100&offset=${offset}&additional_types=track,episode`,
      token,
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
    const profile = await spotifyRequest<{ id: string }>("/me", token);
    const created = await spotifyRequest<{ id: string }>(
      `/users/${profile.id}/playlists`,
      token,
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

  const uris = file.tracks
    .map((track) => track.uri.trim())
    .filter((uri) => uri.length > 0);

  console.error(`replacing playlist ${playlistId} with ${uris.length} items`);

  const firstBatch = uris.slice(0, 100);
  await spotifyRequest(`/playlists/${playlistId}/tracks`, token, {
    method: "PUT",
    body: JSON.stringify({ uris: firstBatch }),
  });

  let uploaded = firstBatch.length;
  console.error(`uploaded ${uploaded}/${uris.length}`);

  for (let i = 100; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    await spotifyRequest(`/playlists/${playlistId}/tracks`, token, {
      method: "POST",
      body: JSON.stringify({ uris: batch }),
    });
    uploaded += batch.length;
    console.error(`uploaded ${uploaded}/${uris.length}`);
  }
};

const main = async () => {
  const parsed = parseCliArgs(Deno.args);
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
    console.error(error instanceof Error ? error.message : String(error));
    console.error("\n" + usage.trim());
    Deno.exit(1);
  }
}
