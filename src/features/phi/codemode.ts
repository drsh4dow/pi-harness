import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { isProtected } from "./protection.ts";

const unicodeEscape = /(?<escape>\\u\{[\dA-Fa-f]+\}|\\u[\dA-Fa-f]{4})/u;

const escapedPoint = /^\\u\{?(?<hex>[\dA-Fa-f]+)\}?$/u;

const unescapedPiece = (piece: string) => {
	const point = Number.parseInt(escapedPoint.exec(piece)?.groups?.["hex"] ?? "", 16);

	return Number.isNaN(point) || point > 1_114_111 ? piece : String.fromCodePoint(point);
};

const unescaped = (code: string) => Arr.join(Arr.map(Str.split(code, unicodeEscape), unescapedPiece), "");

const modelReach = /\b(?<name>models|globalThis|self|Reflect|eval|Function)\b|\b(?<dynamic>import)\s*\(/u;

/**
 * The name that makes a codemode script unsafe in a protected session, if any. It guards against a model that reaches
 * `models` by accident, not against an adversary.
 */
const unsafeReach = (code: string) =>
	Option.fromNullishOr(modelReach.exec(unescaped(code))?.groups).pipe(
		Option.map(({ name, dynamic }) => name ?? `${dynamic ?? "import"}(`),
	);

const CodemodeInput = Schema.Struct({ code: Schema.String });

const decodeCodemodeInput = Schema.decodeUnknownOption(CodemodeInput);

const reachOf = (input: ToolCallEvent["input"]) =>
	Option.match(decodeCodemodeInput(input), {
		onNone: () => Option.some("an input without code"),
		onSome: ({ code }) => unsafeReach(code),
	});

/**
 * Blocks a codemode script that can reach classifier or image models in a protected session. Those calls go to their
 * own provider with the session's credentials, so they never pass phi-router.
 */
export const guardCodemode = ({
	event,
	ctx,
}: {
	readonly event: ToolCallEvent;
	readonly ctx: Pick<ExtensionContext, "model">;
}) => {
	const reach = event.toolName === "codemode" && isProtected(ctx.model) ? reachOf(event.input) : Option.none();

	const blocked = Option.map(reach, (name) => ({
		block: true,
		reason: `This session may hold PHI, and a codemode script that names \`${name}\` can send it to a model outside phi-router. Call the tools directly instead.`,
	}));

	return Promise.resolve(Option.getOrUndefined(blocked));
};
