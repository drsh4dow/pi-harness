import { expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Option from "effect/Option";

import { handsBack, pickIn } from "./judge.ts";

test("a reply that makes the build wait on the human's answer hands the call back, wherever its question mark sits", () => {
	const replies = [
		"❓ **Q1. Where should the reminder reach you?** So I need three answers before I build.",
		"Answer with “yes” to accept all three picks, or tell me which to change",
		"Which channel would you rather use: email or push",
		"Please confirm email delivery before implementation. My pick is email.",
	];

	expect(Arr.map(replies, (reply) => Option.isSome(handsBack(reply)))).toEqual([true, true, true, true]);
});

test("an offer to go further or a request to start is not a call handed back", () => {
	const replies = [
		"The worst finding is the SQL injection in invoices.py. Want me to fix it?",
		"Shall I start on the fix?",
		"Done. The tests pass on the branch.",
	];

	expect(Arr.map(replies, (reply) => Option.isSome(handsBack(reply)))).toEqual([false, false, false]);
});

test("a pick is the root's own, never one it waits to hear from the human", () => {
	const replies = [
		"Do you prefer email or push? I'll wait for your recommendation.",
		"Which channel do you recommend?",
		"My pick is email.",
		"Email (recommended), or push.",
	];

	expect(Arr.map(replies, (reply) => Option.isSome(pickIn(reply)))).toEqual([false, false, true, true]);
});
