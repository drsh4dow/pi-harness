import { expect, test } from "bun:test";

import { routeChecks } from "./extension.ts";

const bin = `${import.meta.dirname}/../../../agent/bin/check`;

const routed = (env: Readonly<Record<string, string | undefined>>, toolName: string) => {
	const call = { toolName, input: { command: "bun test" } };

	routeChecks(env)(call);

	return call.input.command;
};

test("a bash or watch call's check runs through agent/bin/check, at a lower priority in a leaf", () => {
	expect([routed({}, "bash"), routed({ PI_OWNED_WORK_ROLE: "owner" }, "watch")]).toEqual([
		`'${bin}' -- bun test`,
		`'${bin}' -- bun test`,
	]);
	expect([routed({ PI_OWNED_WORK_ROLE: "leaf" }, "bash"), routed({ PI_OWNED_WORK_ROLE: "leaf" }, "watch")]).toEqual([
		`'${bin}' --nice -- bun test`,
		`'${bin}' --nice -- bun test`,
	]);
});

test("another tool's command is left alone", () => {
	expect(routed({}, "custom")).toBe("bun test");
});
