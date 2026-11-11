import path from "node:path";

import type { PiLaunch } from "../../../src/backend/rpc.ts";
import type { DesktopSession } from "../../../src/backend/session.ts";
import type { SessionSnapshot } from "../../../src/desktop-api.ts";

export function fakePiLaunch(directory: string): PiLaunch {
  return {
    executable: process.execPath,
    args: [path.join(import.meta.dirname, "fake-pi.ts")],
    cwd: directory,
    env: { HOME: directory, FAKE_PI_STATE: directory },
  };
}

export async function waitForSession(
  session: DesktopSession,
  predicate: (snapshot: SessionSnapshot) => boolean,
  options: { timeout: number; description: string },
): Promise<SessionSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(options.description));
    }, options.timeout);
    const receive = (snapshot: SessionSnapshot): void => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(snapshot);
    };
    const unsubscribe = session.subscribe(receive);
    receive(session.snapshot());
  });
}
