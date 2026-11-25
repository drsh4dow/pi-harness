import { expect, test } from "bun:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Order from "effect/Order";
import * as Str from "effect/String";

const repo = Str.replace(/\/tools\/loaded$/u, "")(import.meta.dirname);

const guides = ["read", "tilde", "failed", "nested", "expanded", "pasted"];

const bodyOf = (name: string) =>
	Arr.join(
		Arr.makeBy(5, (line) => `Line ${String(line)} of the ${name} principle, long enough to mark it.`),
		"\n",
	);

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const call = (id: string, name: string, args: Readonly<Record<string, string>>) => ({
	type: "toolCall" as const,
	id,
	name,
	arguments: args,
});

const result = (id: string, text: string, isError: boolean) => ({
	role: "toolResult" as const,
	toolCallId: id,
	toolName: "read",
	content: [{ type: "text" as const, text }],
	isError,
	timestamp: 0,
});

const writeSession = ({ root, sessions }: { readonly root: string; readonly sessions: string }) => {
	const session = SessionManager.create(root, sessions);
	const principle = (name: string) => `${root}/agent/principles/${name}.md`;

	session.appendMessage({ role: "user", content: bodyOf("pasted"), timestamp: 0 });
	session.appendMessage({
		role: "user",
		content: `<skill name="expanded" location="${principle("expanded")}">`,
		timestamp: 0,
	});
	session.appendMessage({
		role: "assistant",
		content: [
			call("a", "read", { path: principle("read") }),
			call("b", "bash", { command: "cat ~/harness/agent/principles/tilde.md" }),
			call("c", "read", { path: principle("failed") }),
			call("d", "codemode", { code: "tools.read()" }),
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-5-5",
		usage: { ...zero, totalTokens: 0, cost: { ...zero, total: 0 } },
		stopReason: "toolUse",
		timestamp: 0,
	});
	session.appendMessage(result("a", bodyOf("read"), false));
	session.appendMessage(result("b", "done", false));
	session.appendMessage(result("c", "ENOENT", true));
	session.appendMessage({
		...result("d", "done", false),
		nestedCalls: {
			calls: [{ id: "e", name: "read", arguments: { path: principle("nested") }, status: "ok" }],
			complete: true,
		},
	});
};

const replayed = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
	const root = `${home}/harness`;
	const sessions = `${root}/agent/sessions`;

	yield* Effect.forEach(
		[`${root}/tools/loaded`, `${root}/agent/skills`, `${root}/agent/principles`, sessions],
		(dir) => fs.makeDirectory(dir, { recursive: true }),
	);
	yield* fs.copyFile(`${import.meta.dirname}/replay.ts`, `${root}/tools/loaded/replay.ts`);
	yield* Effect.forEach(["package.json", "node_modules", "src"], (entry) =>
		fs.symlink(`${repo}/${entry}`, `${root}/${entry}`),
	);
	yield* Effect.forEach(guides, (name) =>
		fs.writeFileString(`${root}/agent/principles/${name}.md`, `# ${name}\n\n${bodyOf(name)}\n`),
	);

	writeSession({ root, sessions });

	const replay = Bun.spawn([process.execPath, `${root}/tools/loaded/replay.ts`], {
		env: { ...Bun.env, HOME: home },
		stdout: "pipe",
	});

	return yield* Effect.promise(() => replay.stdout.text());
}).pipe(Effect.scoped);

const guidesIn = (text: string) =>
	Arr.map([...Str.matchAll(/principles\/(?<name>\w+)\.md/gu)(text)], (match) => match.groups?.["name"] ?? "");

test("replay finds each guide by its text, by a path a successful call, nested call or /skill: names, or by both", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const output = yield* replayed;
			const [counts, pathOnly = ""] = Str.split(output, "pathOnly:");

			expect({
				both: Str.includes("both: 1,")(counts),
				textOnly: guidesIn(counts),
				pathOnly: Arr.sort(guidesIn(pathOnly), Order.String),
			}).toEqual({ both: true, textOnly: ["pasted"], pathOnly: ["expanded", "nested", "tilde"] });
		}).pipe(Effect.provide(NodeServices.layer)),
	));
