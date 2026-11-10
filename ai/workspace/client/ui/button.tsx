import type { ComponentProps, ReactElement } from "react";

export function Button(props: ComponentProps<"button">): ReactElement {
  return (
    <button
      {...props}
      className={`rounded-sm border border-input bg-primary px-4 py-2 text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ""}`}
    />
  );
}
