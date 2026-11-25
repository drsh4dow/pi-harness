import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import * as Schema from "effect/Schema";

import { throughCheck } from "./commands.ts";

const runsCommands = new Set(["bash", "watch"]);

const isCommandCall = Schema.is(Schema.Struct({ command: Schema.String }));

const bin = `${import.meta.dirname}/../../../agent/bin/check`;

export const checks =
	(env: Readonly<Record<string, string | undefined>>) =>
	(pi: {
		readonly on: (event: "tool_call", handler: (call: Pick<ToolCallEvent, "toolName" | "input">) => void) => void;
	}) => {
		const nice = env["PI_OWNED_WORK_ROLE"] === "leaf" ? " --nice" : "";
		const wrap = throughCheck(`'${bin}'${nice} -- `);

		pi.on("tool_call", ({ toolName, input }) => {
			if (runsCommands.has(toolName) && isCommandCall(input)) {
				Object.assign(input, { command: wrap(input.command) });
			}
		});
	};
