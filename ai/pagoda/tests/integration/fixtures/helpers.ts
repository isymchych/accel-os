import type { DesktopSession } from "../../../src/backend/session.ts";
import type { ContentBlock, SessionSnapshot } from "../../../src/contracts/index.ts";

export { fakePiOptions, fakeSessionFactory } from "./fake-sdk.ts";
export function contentText(content: ContentBlock[] | undefined): string {
  return (content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
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
