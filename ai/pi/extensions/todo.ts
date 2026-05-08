/**
 * Session-local todo extension for Pi.
 *
 * Provides a `todo` tool for the agent and a `/todos` command for the user.
 * Todo state is persisted in tool-result details, so it follows the current
 * session branch and stays historically correct across `/tree`, forks, and reloads.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
}

const TodoParamsSchema = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const),
  text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
  id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
});

type TodoParams = Static<typeof TodoParamsSchema>;

function isTodo(value: unknown): value is Todo {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "id" in value &&
    typeof value.id === "number" &&
    "text" in value &&
    typeof value.text === "string" &&
    "done" in value &&
    typeof value.done === "boolean"
  );
}

function isTodoDetails(value: unknown): value is TodoDetails {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const action = "action" in value ? value.action : undefined;
  const todos = "todos" in value ? value.todos : undefined;
  const nextId = "nextId" in value ? value.nextId : undefined;
  const error = "error" in value ? value.error : undefined;

  return (
    (action === "list" || action === "add" || action === "toggle" || action === "clear") &&
    Array.isArray(todos) &&
    todos.every((todo) => isTodo(todo)) &&
    typeof nextId === "number" &&
    (error === undefined || typeof error === "string")
  );
}

function createTextResult(
  text: string,
  details: TodoDetails,
): { content: [{ type: "text"; text: string }]; details: TodoDetails } {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function cloneTodos(todos: Todo[]): Todo[] {
  return todos.map((todo) => ({ ...todo }));
}

function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) {
    return "No todos";
  }

  return todos.map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`).join("\n");
}

function renderListResult(todoList: Todo[], expanded: boolean, theme: Theme): Text {
  if (todoList.length === 0) {
    return new Text(theme.fg("dim", "No todos"), 0, 0);
  }

  let listText = theme.fg("muted", `${todoList.length} todo(s):`);
  const visibleTodos = expanded ? todoList : todoList.slice(0, 5);
  for (const todo of visibleTodos) {
    const check = todo.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
    const itemText = todo.done ? theme.fg("dim", todo.text) : theme.fg("muted", todo.text);
    listText += `\n${check} ${theme.fg("accent", `#${todo.id}`)} ${itemText}`;
  }

  if (!expanded && todoList.length > 5) {
    listText += `\n${theme.fg("dim", `... ${todoList.length - 5} more`)}`;
  }

  return new Text(listText, 0, 0);
}

function renderAddedTodo(todoList: Todo[], theme: Theme): Text {
  const added = todoList[todoList.length - 1];
  if (added === undefined) {
    return new Text(theme.fg("warning", "Added todo, but no item was recorded"), 0, 0);
  }

  return new Text(
    theme.fg("success", "✓ Added ") +
      theme.fg("accent", `#${added.id}`) +
      " " +
      theme.fg("muted", added.text),
    0,
    0,
  );
}

function renderResultMessage(
  result: { content: Array<{ type: string; text?: string }> },
  theme: Theme,
): Text {
  const firstBlock = result.content[0];
  const message = firstBlock?.type === "text" ? (firstBlock.text ?? "") : "";
  return new Text(theme.fg("success", "✓ ") + theme.fg("muted", message), 0, 0);
}

class TodoListComponent {
  private todos: Todo[];
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  public constructor(todos: Todo[], theme: Theme, onClose: () => void) {
    this.todos = todos;
    this.theme = theme;
    this.onClose = onClose;
  }

  public handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  public render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    lines.push("");
    const title = th.fg("accent", " Todos ");
    const headerLine =
      th.fg("borderMuted", "─".repeat(3)) +
      title +
      th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");

    if (this.todos.length === 0) {
      lines.push(
        truncateToWidth(`  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`, width),
      );
    } else {
      const done = this.todos.filter((todo) => todo.done).length;
      const total = this.todos.length;
      lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${total} completed`)}`, width));
      lines.push("");

      for (const todo of this.todos) {
        const check = todo.done ? th.fg("success", "✓") : th.fg("dim", "○");
        const id = th.fg("accent", `#${todo.id}`);
        const text = todo.done ? th.fg("dim", todo.text) : th.fg("text", todo.text);
        lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  public invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function todoExtension(pi: ExtensionAPI): void {
  let todos: Todo[] = [];
  let nextId = 1;

  const reconstructState = (ctx: ExtensionContext): void => {
    todos = [];
    nextId = 1;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") {
        continue;
      }

      const message = entry.message;
      if (message.role !== "toolResult" || message.toolName !== "todo") {
        continue;
      }

      if (isTodoDetails(message.details)) {
        todos = cloneTodos(message.details.todos);
        nextId = message.details.nextId;
      }
    }
  };

  const createTodoDetails = (action: TodoDetails["action"], error?: string): TodoDetails => {
    const details: TodoDetails = {
      action,
      todos: cloneTodos(todos),
      nextId,
    };

    if (error !== undefined) {
      details.error = error;
    }

    return details;
  };

  const executeTodoAction = async (
    _toolCallId: string,
    params: TodoParams,
  ): Promise<{ content: [{ type: "text"; text: string }]; details: TodoDetails }> => {
    switch (params.action) {
      case "list": {
        return createTextResult(formatTodoList(todos), createTodoDetails("list"));
      }

      case "add": {
        if (params.text === undefined || params.text.length === 0) {
          return createTextResult(
            "Error: text required for add",
            createTodoDetails("add", "text required"),
          );
        }

        const newTodo: Todo = { id: nextId, text: params.text, done: false };
        nextId += 1;
        todos.push(newTodo);
        return createTextResult(
          `Added todo #${newTodo.id}: ${newTodo.text}`,
          createTodoDetails("add"),
        );
      }

      case "toggle": {
        if (params.id === undefined) {
          return createTextResult(
            "Error: id required for toggle",
            createTodoDetails("toggle", "id required"),
          );
        }

        const todo = todos.find((item) => item.id === params.id);
        if (todo === undefined) {
          return createTextResult(
            `Todo #${params.id} not found`,
            createTodoDetails("toggle", `#${params.id} not found`),
          );
        }

        todo.done = !todo.done;
        return createTextResult(
          `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`,
          createTodoDetails("toggle"),
        );
      }

      case "clear": {
        const count = todos.length;
        todos = [];
        nextId = 1;
        return createTextResult(`Cleared ${count} todos`, {
          action: "clear",
          todos: [],
          nextId: 1,
        });
      }

      default: {
        return createTextResult("Unknown action", createTodoDetails("list", "unknown action"));
      }
    }
  };

  const renderTodoResult = (
    result: { content: Array<{ type: string; text?: string }>; details: TodoDetails | undefined },
    expanded: boolean,
    theme: Theme,
  ): Text => {
    const details = result.details;
    if (details === undefined) {
      return renderResultMessage(result, theme);
    }

    if (details.error !== undefined) {
      return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
    }

    switch (details.action) {
      case "list":
        return renderListResult(details.todos, expanded, theme);
      case "add":
        return renderAddedTodo(details.todos, theme);
      case "toggle":
        return renderResultMessage(result, theme);
      case "clear":
        return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "Cleared all todos"), 0, 0);
      default:
        return new Text(theme.fg("warning", "Unknown todo action"), 0, 0);
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    reconstructState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructState(ctx);
  });

  pi.registerTool<typeof TodoParamsSchema, TodoDetails>({
    name: "todo",
    label: "Todo",
    description:
      "Manage the current session's todo list. Actions: list, add (text), toggle (id), clear.",
    promptSnippet:
      "Use todo to track plans and progress for multi-step work on the current Pi conversation branch.",
    promptGuidelines: [
      "When the user asks for a plan, or the task is clearly multi-step, use todo to create and maintain a short task list for the current session branch.",
      "Keep the list current while working: add planned steps, toggle items as you complete them, and list todos when you need to review progress.",
      "Clear the list when the work is finished or the plan is no longer relevant.",
    ],
    parameters: TodoParamsSchema,

    async execute(toolCallId, params) {
      return executeTodoAction(toolCallId, params);
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
      if (args.text !== undefined) {
        text += ` ${theme.fg("dim", `"${args.text}"`)}`;
      }
      if (args.id !== undefined) {
        text += ` ${theme.fg("accent", `#${args.id}`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      return renderTodoResult(result, expanded, theme);
    },
  });

  pi.registerCommand("todos", {
    description: "Show all todos on the current session branch",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/todos requires interactive mode", "error");
        return;
      }

      await ctx.ui.custom(
        (_tui, theme, _keybindings, done) =>
          new TodoListComponent(todos, theme, () => {
            done(undefined);
          }),
      );
    },
  });
}
