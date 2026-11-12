/**
 * Desktop-only control bridge using public Pi command APIs. It adds discovery,
 * non-interrupting native-history snapshots, and guarded tree navigation to RPC.
 * Results are correlated control records, never model messages or agent tools.
 */
import { realpath } from "node:fs/promises";

import { parseJsonWithSchema } from "@accel-os/shared/json";
import { contentText } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { listDesktopSessions, snapshotDesktopSession } from "./desktop-sessions.ts";

const RequestSchema = Type.Object({
  id: Type.String(),
  operation: Type.Union([
    Type.Literal("list"),
    Type.Literal("list-all"),
    Type.Literal("navigate"),
    Type.Literal("snapshot"),
  ]),
  value: Type.String(),
});

export default function desktopExtension(pi: ExtensionAPI): void {
  pi.registerCommand("workspace-control", {
    description: "Desktop session controls (not model input)",
    handler: async (args, ctx) => {
      const request = parseJsonWithSchema(args, RequestSchema, "Desktop control");
      try {
        let data: unknown;
        switch (request.operation) {
          case "list":
            data = await listDesktopSessions(
              ctx.sessionManager.getSessionDir(),
              await realpath(request.value),
            );
            break;
          case "list-all":
            data = await listDesktopSessions(ctx.sessionManager.getSessionDir());
            break;
          case "navigate": {
            // The public command wrapper drops Pi's editorText. Recover it from
            // the selected native entry, but only expose it after successful navigation.
            const currentLeaf = ctx.sessionManager.getLeafId();
            const entry = ctx.sessionManager.getEntry(request.value);
            const editorText =
              entry?.type === "message" && entry.message.role === "user"
                ? contentText(entry.message.content, "")
                : entry?.type === "custom_message"
                  ? contentText(entry.content, "")
                  : undefined;
            const result = await ctx.navigateTree(request.value, { summarize: false });
            data = {
              ...result,
              ...(result.cancelled || currentLeaf === request.value ? {} : { editorText }),
            };
            break;
          }
          case "snapshot": {
            const source = ctx.sessionManager.getSessionFile();
            if (!source) throw new Error("This session has no persisted history yet");
            data = {
              path: await snapshotDesktopSession(
                source,
                request.value,
                ctx.sessionManager.getSessionDir(),
              ),
            };
            break;
          }
          default:
            throw new Error("Unknown desktop control");
        }
        ctx.ui.notify(
          `workspace-control:${JSON.stringify({ type: "workspace_result", id: request.id, success: true, data })}`,
        );
      } catch (error) {
        ctx.ui.notify(
          `workspace-control:${JSON.stringify({
            type: "workspace_result",
            id: request.id,
            success: false,
            error: error instanceof Error ? error.message : "Desktop control failed",
          })}`,
        );
      }
    },
  });
}
