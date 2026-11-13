import type { ReactElement } from "react";

import type { SessionControls } from "../../contracts/index.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import type { ControlsChange } from "./session-state.ts";

export function ModelControls({
  controls,
  idle,
  change,
}: {
  controls: SessionControls | null;
  idle: boolean;
  change: (change: ControlsChange) => void;
}): ReactElement {
  if (!controls) return <p className="text-xs text-muted-foreground">Loading model controls…</p>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="min-w-0">
        <span id="model-label" className="sr-only">
          Model
        </span>
        <Select
          disabled={!idle}
          value={
            controls.model ? JSON.stringify([controls.model.provider, controls.model.id]) : null
          }
          onValueChange={(value) => {
            const model = controls.models.find(
              (item) => JSON.stringify([item.provider, item.id]) === value,
            );
            if (model) change({ type: "model", provider: model.provider, modelId: model.id });
          }}
        >
          <SelectTrigger
            aria-labelledby="model-label"
            className="max-w-[min(18rem,60vw)] border-transparent bg-transparent text-xs text-muted-foreground hover:text-foreground dark:bg-transparent"
          >
            <SelectValue placeholder="Select model">
              {controls.model ? `${controls.model.provider}/${controls.model.id}` : "Select model"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {controls.models.map((model) => (
              <SelectItem
                key={JSON.stringify([model.provider, model.id])}
                value={JSON.stringify([model.provider, model.id])}
              >
                {model.provider}/{model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <span id="thinking-label" className="sr-only">
          Thinking
        </span>
        <Select
          disabled={!idle}
          value={controls.thinkingLevel}
          onValueChange={(value) => {
            if (value) change({ type: "thinking", level: value });
          }}
        >
          <SelectTrigger
            aria-labelledby="thinking-label"
            className="border-transparent bg-transparent text-xs text-muted-foreground hover:text-foreground dark:bg-transparent"
          >
            <SelectValue placeholder="Thinking level">
              Thinking: {controls.thinkingLevel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {controls.levels.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
