import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PublicUrl } from "./guard.ts";
import type { Via } from "./sources.ts";

export type Body = Data.TaggedEnum<{
	Markdown: { readonly text: string };
	File: { readonly bytes: Uint8Array; readonly mime: string; readonly markdown: Option.Option<string> };
}>;

export const Body = Data.taggedEnum<Body>();

export interface Page {
	readonly url: PublicUrl;
	readonly finalUrl: string;
	readonly title: Option.Option<string>;
	readonly via: Via;
	readonly caveat: Option.Option<string>;
	readonly body: Body;
}

export class WebError extends Schema.TaggedError<WebError, { readonly brand: unique symbol }>()("WebError", {
	kind: Schema.Literals([
		"blocked",
		"gone",
		"needs-browser",
		"unreachable",
		"bad-answer",
		"too-large",
		"provider",
		"not-saved",
	]),
	message: Schema.String,
}) {}

export type Found = Omit<Page, "url" | "via">;

export interface Source<Name extends string = string, Needs = HttpClient.HttpClient> {
	readonly via: Name;
	readonly skipsVerdict: boolean;
	readonly claims: (url: URL) => boolean;
	readonly read: (url: URL) => Effect.Effect<Option.Option<Found>, WebError, Needs>;
}

interface Rendered {
	readonly finalUrl: string;
	readonly title: string;
	readonly text: string;
}

export const rendered = ({ finalUrl, title, text }: Rendered): Found => ({
	finalUrl,
	title: Option.some(title),
	caveat: Option.none(),
	body: Body.Markdown({ text }),
});

export const unlessGone = <Value, Needs>(
	read: Effect.Effect<Value, WebError, Needs>,
): Effect.Effect<Option.Option<Value>, WebError, Needs> =>
	read.pipe(
		Effect.asSome,
		Effect.catchIf(
			(error) => error.kind === "gone",
			() => Effect.succeedNone,
		),
	);
