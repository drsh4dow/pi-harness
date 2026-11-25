import { expect, test } from "bun:test";

import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { assistantReply } from "#src/primitives/assistant-reply.fixture.ts";
import { scratchFolder } from "#src/primitives/scratch.fixture.ts";
import { PiSessions, piSessionsLayer } from "./index.ts";

const piSessions = Layer.provide(piSessionsLayer, NodeServices.layer);

const scratch = scratchFolder("pi-sessions-branch");

const saved = () => {
	const session = SessionManager.create(scratch, scratch);
	const asked = session.appendMessage({ role: "user", content: "Find the bug.", timestamp: 0 });

	const answered = session.appendMessage(assistantReply({ text: "It is in the parser." }));

	session.appendMessage({ role: "user", content: "Now fix it.", timestamp: 0 });

	return { file: session.getSessionFile() ?? "", asked, answered };
};

const branch = (request: Parameters<(typeof PiSessions)["Service"]["branch"]>[0]) =>
	Effect.flatMap(PiSessions, (sessions) => sessions.branch(request));

const shownAs = (entry: SessionEntry) => (entry.type === "custom_message" ? entry.content : entry.id);

test("a branch copies the path to its leaf, then the note, into a new file that names its source", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { file, asked, answered } = saved();
			const note = Option.some({ customType: "owned-work", content: "delegate-3 kept running in the source." });
			const copy = yield* branch({ source: file, dir: scratch, leaf: answered, note });
			const opened = SessionManager.open(copy, scratch);

			expect(opened.getHeader()?.parentSession).toBe(file);
			expect(Arr.map(opened.getBranch(), shownAs)).toEqual([
				asked,
				answered,
				"delegate-3 kept running in the source.",
			]);
		}).pipe(Effect.provide(piSessions)),
	));

test("a branch leaves its source as it was", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { file, answered } = saved();
			const before = yield* Effect.promise(() => Bun.file(file).text());

			yield* branch({ source: file, dir: scratch, leaf: answered, note: Option.none() });

			const after = yield* Effect.promise(() => Bun.file(file).text());

			expect(after).toBe(before);
		}).pipe(Effect.provide(piSessions)),
	));
