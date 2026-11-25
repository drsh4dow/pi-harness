import { expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Function from "effect/Function";
import * as Str from "effect/String";

import type { Block, Card } from "./card.ts";
import { cardComponent, liveCard } from "./view.ts";

const width = 80;

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	bg: (_color: string, text: string) => text,
};

const visible = (lines: ReadonlyArray<string>) => Arr.map(lines, Str.trim);

const reading = (account: string): Block => ({ account, via: "page", body: { kind: "reading" } });

const read = (account: string): Block => ({
	account,
	via: "page",
	body: { kind: "read", rows: [{ kind: "note", name: "spend", text: "$1.00", quiet: false }] },
});

test("a card paints every line on pi's background for extension output, with the title above the blocks", () => {
	const card: Card = { readAt: "Nov 10, 16:40", blocks: [read("openai")] };
	const tagging = { ...plain, bg: (color: string, text: string) => `<${color}>${text}` };
	const lines = cardComponent({ card, theme: tagging }).render(width);
	const unpainted = Arr.map(lines, Str.replace("<customMessageBg>", ""));

	expect(Arr.every(lines, Str.startsWith("<customMessageBg>"))).toBe(true);
	expect(visible(unpainted)).toEqual(["", "Usage  Nov 10, 16:40", "", "openai  page", "spend  $1.00", ""]);
});

test("a live card shows each account once it answers and counts the accounts read", () => {
	const live = liveCard([reading("a"), reading("b")]);
	const renders = { asked: 0 };

	const component = live.component(
		{
			requestRender: () => {
				renders.asked += 1;
			},
		},
		plain,
	);

	live.update(1, read("b"));

	expect({ asked: renders.asked, lines: visible(component.render(width)) }).toEqual({
		asked: 1,
		lines: ["", "⠋ Usage  1 of 2 accounts read", "", "a  page", "reading…", "", "b  page", "spend  $1.00", ""],
	});
});

test("each tick moves the title's spinner one frame", () => {
	const live = liveCard([reading("a")]);
	const component = live.component({ requestRender: Function.constVoid }, plain);
	const title = () => visible(component.render(width))[1];

	const first = title();
	live.tick();
	const second = title();
	live.tick();
	const third = title();

	expect([first, second, third]).toEqual([
		"⠋ Usage  0 of 1 accounts read",
		"⠙ Usage  0 of 1 accounts read",
		"⠹ Usage  0 of 1 accounts read",
	]);
});
