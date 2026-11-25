/** A prompt or steering message as a scenario writes it, and as pi's RPC takes it. */
import type { ImageContent } from "@earendil-works/pi-ai";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";

export type Image = ImageContent;

/** What a prompt or a steering message carries: its text, or its text and images. */
export type Message = string | { readonly text: string; readonly images: ReadonlyArray<Image> };

export interface Sent {
	readonly message: string;
	readonly images?: ReadonlyArray<Image>;
}

export const sentOf = (message: Message): Sent => {
	if (Predicate.isString(message)) {
		return { message };
	}

	return Arr.isReadonlyArrayNonEmpty(message.images)
		? { message: message.text, images: message.images }
		: { message: message.text };
};

export const textOf = (message: Message) => sentOf(message).message;
