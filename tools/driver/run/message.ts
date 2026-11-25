import type { ImageContent } from "@earendil-works/pi-ai";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";

export type Image = ImageContent;

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
