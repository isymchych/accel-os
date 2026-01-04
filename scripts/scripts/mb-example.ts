import { formatGreeting } from "@lib/strings.ts";

const name = Deno.args[0] ?? "world";
console.log(formatGreeting(name));
