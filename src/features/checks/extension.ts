import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as Schema from "effect/Schema";

import { throughCheck } from "./commands.ts";

const runsCommands = new Set(["bash", "watch"]);

const isCommandCall = Schema.is(Schema.Struct({ command: Schema.String }));

const bin = `${import.meta.dirname}/../../../agent/bin/check`;

/** A check that a bash or watch call runs goes through `agent/bin/check`, and a leaf's runs at a lower priority. */
export const checks = (env: Readonly<Record<string, string | undefined>>) => (pi: ExtensionAPI) => {
	const nice = env["PI_OWNED_WORK_ROLE"] === "leaf" ? " --nice" : "";
	const wrap = throughCheck(`'${bin}'${nice} -- `);

	pi.on("tool_call", ({ toolName, input }) => {
		if (runsCommands.has(toolName) && isCommandCall(input)) {
			Object.assign(input, { command: wrap(input.command) });
		}
	});
};
