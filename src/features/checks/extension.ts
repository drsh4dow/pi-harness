import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import * as Schema from "effect/Schema";

import { throughCheck } from "./commands.ts";

const runsCommands = new Set(["bash", "watch"]);

const isCommandCall = Schema.is(Schema.Struct({ command: Schema.String }));

const bin = `${import.meta.dirname}/../../../agent/bin/check`;

export const routeChecks = (env: Readonly<Record<string, string | undefined>>) => {
	const nice = env["PI_OWNED_WORK_ROLE"] === "leaf" ? " --nice" : "";
	const wrap = throughCheck(`'${bin}'${nice} -- `);

	return ({ toolName, input }: Pick<ToolCallEvent, "toolName" | "input">) => {
		if (runsCommands.has(toolName) && isCommandCall(input)) {
			Object.assign(input, { command: wrap(input.command) });
		}
	};
};

export const checks = (env: Readonly<Record<string, string | undefined>>) => (pi: Pick<ExtensionAPI, "on">) => {
	pi.on("tool_call", routeChecks(env));
};
