import { expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Str from "effect/String";

import { answerOf } from "./answer.ts";

const file = "/s/delegates/child.answer.md";

const whole = [
	{ name: "a 500-character answer", text: Str.repeat(500)("a") },
	{ name: "an answer of exactly 20,000 characters", text: Str.repeat(20_000)("a") },
];

test.each(whole)("$name reaches the parent whole", ({ text }) => {
	expect(answerOf(file)(text)).toEqual({ text, cut: false, file });
});

test("a 60,000-character answer with no paragraph break is cut inside the bound, with the closing line", () => {
	const answer = answerOf(file)(Str.repeat(60_000)("a"));

	expect(answer.cut).toBe(true);
	expect(answer.text.length).toBeLessThanOrEqual(20_000);
	expect(answer.text).toStartWith(Str.repeat(19_000)("a"));
	expect(answer.text).toEndWith(`of 60,000 characters. Read the whole answer in ${file}]`);
});

const paragraphList = Arr.makeBy(60, (index) => `${String(index)}${Str.repeat(999)("a")}`);

const paragraphs = (blank: string) => Arr.join(paragraphList, blank);

test.each([
	["CRLF", "\r\n\r\n"],
	["a blank line holding spaces", "\n  \n"],
] as const)("an answer whose paragraphs part with %s is cut at a paragraph", (_name, blank) => {
	const { text } = answerOf(file)(paragraphs(blank));

	expect(text).toStartWith(`${Arr.join(Arr.take(paragraphList, 19), blank)}\n\n[The answer is cut at`);
});

test("a cut never splits a character outside the basic plane", () => {
	const { text } = answerOf(file)(Str.repeat(12_000)("😀"));

	expect(text.isWellFormed()).toBe(true);
});

test("a paragraph that ends exactly where the room ends is kept", () => {
	const closing = `[The answer is cut at 20,000 of 60,000 characters. Read the whole answer in ${file}]`;
	const room = 20_000 - 2 - closing.length;
	const kept = `a\n\n${Str.repeat(room - 3)("b")}`;
	const { text } = answerOf(file)(`${kept}\n\n${Str.repeat(60_000 - room - 2)("c")}`);

	expect(text).toBe(
		`${kept}\n\n[The answer is cut at ${room.toLocaleString("en-US")} of 60,000 characters. Read the whole answer in ${file}]`,
	);
});
