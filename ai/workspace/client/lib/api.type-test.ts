import { api } from "./api.ts";

export function assertDiagnosticClientTypes(): void {
  void api.api.diagnostic.$post({ json: { message: "valid diagnostic input" } });

  // @ts-expect-error Diagnostic messages must be strings.
  void api.api.diagnostic.$post({ json: { message: 1 } });
}
