import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text, type TUI } from "@earendil-works/pi-tui";
import * as Arr from "effect/Array";
import * as Function from "effect/Function";

import { type Block, blockLines, type Card } from "./card.ts";

type Paint = Pick<Theme, "fg" | "bold" | "bg">;

const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const framed = (theme: Paint, lines: ReadonlyArray<string>) => {
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	const text = new Text(Arr.join(lines, "\n"), 0, 0);

	box.addChild(text);

	return { box, text };
};

const titled = (theme: Paint, title: string, blocks: ReadonlyArray<Block>) => [
	title,
	"",
	...blockLines({ blocks, theme }),
];

export const cardComponent = ({ card, theme }: { readonly card: Card; readonly theme: Paint }): Component => {
	const title = `${theme.bold("Usage")}  ${theme.fg("dim", card.readAt)}`;

	return framed(theme, titled(theme, title, card.blocks)).box;
};

export interface LiveCard {
	readonly update: (index: number, block: Block) => void;
	readonly tick: () => void;
	readonly component: (tui: Pick<TUI, "requestRender">, theme: Paint) => Component;
}

export const liveCard = (initial: ReadonlyArray<Block>): LiveCard => {
	const blocks = [...initial];
	let frame = 0;
	let redraw: () => void = Function.constVoid;

	const title = (theme: Paint) => {
		const read = Arr.filter(blocks, ({ body }) => body.kind !== "reading").length;
		const glyph = theme.fg("accent", spinner[frame % spinner.length] ?? "");

		return `${glyph} ${theme.bold("Usage")}  ${theme.fg("dim", `${read} of ${blocks.length} accounts read`)}`;
	};

	return {
		update: (index, block) => {
			blocks[index] = block;
			redraw();
		},
		tick: () => {
			frame += 1;
			redraw();
		},
		component: (tui, theme) => {
			const { box, text } = framed(theme, titled(theme, title(theme), blocks));

			redraw = () => {
				const lines = titled(theme, title(theme), blocks);

				text.setText(Arr.join(lines, "\n"));
				tui.requestRender();
			};

			return box;
		},
	};
};
