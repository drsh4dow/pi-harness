import { expect, test } from "bun:test";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { assistantReply } from "#src/primitives/assistant-reply.fixture.ts";
import { scratchFolder } from "#src/primitives/scratch.fixture.ts";
import { ChildReply, PiSessions, piSessionsLayer } from "./index.ts";

const piSessions = Layer.provideMerge(piSessionsLayer, NodeServices.layer);

const scratch = scratchFolder("pi-sessions-answer");

type Reply = { readonly text: string } & Pick<AssistantMessage, "stopReason" | "errorMessage">;

const sessionOf = (replies: ReadonlyArray<Reply>) => {
	const session = SessionManager.create(scratch, scratch);

	session.appendMessage({ role: "user", content: "Find the bug.", timestamp: 0 });

	for (const { text, ...ending } of replies) {
		session.appendMessage(assistantReply({ text, ...ending }));
	}

	return { id: session.getSessionId(), cwd: scratch, dir: scratch };
};

const readAnswer = (replies: ReadonlyArray<Reply>) =>
	Effect.flatMap(PiSessions, (sessions) => sessions.readAnswer(sessionOf(replies)));

test("an answer is the child's last non-empty text, written whole beside its session before it returns", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const session = sessionOf([
				{ text: "It may be the lexer.", stopReason: "stop" },
				{ text: "It is in the parser.", stopReason: "stop" },
				{ text: "", stopReason: "stop" },
			]);

			const reply = yield* Effect.flatMap(PiSessions, (sessions) => sessions.readAnswer(session));
			const file = `${scratch}/${session.id}.answer.md`;

			expect({ reply, written: yield* fs.readFileString(file) }).toEqual({
				reply: Option.some(ChildReply.Answered({ text: "It is in the parser.", file })),
				written: "It is in the parser.",
			});
		}).pipe(Effect.provide(piSessions)),
	));

test("an answer whose entry the child edited reads as edited, so the text it replaced never reaches the parent", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const session = SessionManager.create(scratch, scratch);

			session.appendMessage({ role: "user", content: "Summarize the record.", timestamp: 0 });

			const answer = session.appendMessage(
				assistantReply({ text: "Jane Roe, born 1950-01-02.", stopReason: "stop" }),
			);

			session.appendContextEdit(answer, { content: "[sealed h1] The answer still held patient identifiers." });

			const id = session.getSessionId();

			const reply = yield* Effect.flatMap(PiSessions, (sessions) =>
				sessions.readAnswer({ id, cwd: scratch, dir: scratch }),
			);

			expect(reply).toEqual(
				Option.some(
					ChildReply.Answered({
						text: "[sealed h1] The answer still held patient identifiers.",
						file: `${scratch}/${id}.answer.md`,
					}),
				),
			);
		}).pipe(Effect.provide(piSessions)),
	));

test("a child whose last call ended on a provider error answers with that error", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const reply = yield* readAnswer([
				{ text: "It is in the parser.", stopReason: "stop" },
				{ text: "", stopReason: "error", errorMessage: "overloaded" },
			]);

			expect(reply).toEqual(Option.some(ChildReply.Errored({ why: "overloaded" })));
		}).pipe(Effect.provide(piSessions)),
	));

test("a child with no text, an aborted last call, or a missing or unreadable session has no answer", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const stamp = '"timestamp":"2026-11-01T00:00:00.000Z"';

			yield* fs.writeFileString(
				`${scratch}/broken.jsonl`,
				`{"type":"session","version":3,"id":"broken",${stamp},"cwd":"${scratch}"}\n{"type":"message","id":"m1","parentId":null,${stamp},"message":null}\n`,
			);

			const silent = yield* readAnswer([{ text: "", stopReason: "stop" }]);

			const aborted = yield* readAnswer([
				{ text: "It is in the parser.", stopReason: "stop" },
				{ text: "", stopReason: "aborted" },
			]);

			const missing = yield* Effect.flatMap(PiSessions, (sessions) =>
				sessions.readAnswer({ id: "absent", cwd: scratch, dir: scratch }),
			);

			const unreadable = yield* Effect.flatMap(PiSessions, (sessions) =>
				sessions.readAnswer({ id: "broken", cwd: scratch, dir: scratch }),
			);

			expect({ silent, aborted, missing, unreadable }).toEqual({
				silent: Option.none(),
				aborted: Option.none(),
				missing: Option.none(),
				unreadable: Option.none(),
			});
		}).pipe(Effect.provide(piSessions)),
	));
