import { hc } from "hono/client";

import type { Api } from "../../server/app/api.ts";

export const api = hc<Api>("/");
