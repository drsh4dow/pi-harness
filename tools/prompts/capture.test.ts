import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

const pi = `${import.meta.dirname}/../../node_modules/.bin/pi`;

const prompt = "capture-probe";

const providerRequests = Effect.acquireRelease(
	Effect.sync(() => {
		const received: Array<string> = [];

		const refuse = (body: string) => {
			received.push(body);

			return new Response("refused", { status: 400 });
		};

		const server = Bun.serve({
			port: 0,
			fetch: (request) =>
				Effect.runPromise(
					Effect.map(
						Effect.promise(() => request.text()),
						refuse,
					),
				),
		});

		return { received, server };
	}),
	({ server }) => Effect.promise(() => server.stop(true)),
);

const piRun = (capture: "set" | "unset") =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const { received, server } = yield* providerRequests;
		const folder = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
		const target = `${folder}/payload.json`;
		const baseUrl = `http://127.0.0.1:${String(server.port)}/v1`;

		yield* fs.writeFileString(
			`${folder}/models.json`,
			`{"providers":{"fake":{"baseUrl":"${baseUrl}","api":"openai-completions","apiKey":"none","models":[{"id":"m"}]}}}`,
		);

		const unset = { ...Bun.env, PI_CODING_AGENT_DIR: folder };
		const env = capture === "set" ? { ...unset, PI_PROMPTS_CAPTURE: target } : unset;

		const argv = [
			pi,
			"--no-session",
			"--model",
			"fake/m",
			"-e",
			`${import.meta.dirname}/capture.ts`,
			"-p",
			"--",
			prompt,
		];

		yield* Effect.promise(() => Bun.spawn(argv, { cwd: folder, env, stdout: "ignore", stderr: "ignore" }).exited);

		const saved = (yield* fs.exists(target)) ? yield* fs.readFileString(target) : "";

		return { saved, received };
	}).pipe(Effect.scoped);

test("with PI_PROMPTS_CAPTURE set, pi saves its first request there and sends nothing", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { saved, received } = yield* piRun("set");

			expect([Str.includes(prompt)(saved), received]).toEqual([true, []]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("with PI_PROMPTS_CAPTURE unset, pi sends its request", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { saved, received } = yield* piRun("unset");

			expect([saved, Arr.some(received, Str.includes(prompt))]).toEqual(["", true]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));
