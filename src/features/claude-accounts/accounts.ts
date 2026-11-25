import type { Model, ProviderStreams, StreamOptions } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import { createProvider, hasApi, type Provider } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { piHost } from "#src/client/pi/index.ts";
import { backAt } from "#src/client/providers/index.ts";

type ApiKeyAuth = NonNullable<Provider["auth"]["apiKey"]>;

type OAuthAuth = NonNullable<Provider["auth"]["oauth"]>;

/** How an account logs in: Anthropic's OAuth flow, or a token from `claude setup-token`, which has no refresh token. */
export type Login = "oauth" | "setup-token";

export const accounts = [
	{ id: "ultra-a", name: "Claude Ultra A", login: "oauth", baa: false, lacks: [] },
	{ id: "ultra-b", name: "Claude Ultra B", login: "setup-token", baa: false, lacks: [] },
	{ id: "ent", name: "Claude Enterprise", login: "oauth", baa: true, lacks: ["claude-fable-5-2"] },
] as const satisfies ReadonlyArray<{
	readonly id: string;
	readonly name: string;
	readonly login: Login;
	readonly baa: boolean;
	readonly lacks: ReadonlyArray<string>;
}>;

export type Account = (typeof accounts)[number];

export type AccountId = Account["id"];

const offers = (account: Account, id: string) => !Arr.some(account.lacks, (lacked) => lacked === id);

export const accountOf = (id: string) => Arr.findFirst(accounts, (account) => account.id === id);

const isBaaAccount = (id: string) => Option.exists(accountOf(id), ({ baa }) => baa);

export const fallbackChain = (from: AccountId): ReadonlyArray<Account> => {
	if (isBaaAccount(from)) {
		return [];
	}

	const others = Arr.filter(accounts, ({ id }) => id !== from);

	return [...Arr.filter(others, ({ baa }) => !baa), ...Arr.filter(others, ({ baa }) => baa)];
};

export const accountsHost = piHost(Layer.empty);

class NotASetupToken extends Schema.TaggedError<NotASetupToken, { readonly brand: unique symbol }>()("NotASetupToken", {
	message: Schema.String,
}) {}

const subscriptionTokenPrefix = "sk-ant-oat";

const setupTokenOf = (pasted: string) => {
	const key = Str.trim(pasted);

	if (!Str.startsWith(subscriptionTokenPrefix)(key)) {
		return Effect.fail(
			NotASetupToken.make({
				message: `A setup-token starts with ${subscriptionTokenPrefix}. Any other key bills the API, not the subscription.`,
			}),
		);
	}

	return Effect.succeed({ type: "api_key" as const, key });
};

const setupTokenAuth: ApiKeyAuth = {
	name: "Claude setup-token",
	login: (interaction) =>
		accountsHost.run(
			Effect.flatMap(
				Effect.promise(() =>
					interaction.prompt({ type: "secret", message: "Paste the token `claude setup-token` printed" }),
				),
				setupTokenOf,
			),
		),
	resolve: ({ credential }) => {
		const stored = Option.map(Option.fromUndefinedOr(credential?.key), (apiKey) => ({
			auth: { apiKey },
			source: "stored setup-token",
		}));

		return Promise.resolve(Option.getOrUndefined(stored));
	},
};

export interface Anthropic {
	readonly models: ReadonlyArray<Model<"anthropic-messages">>;
	readonly oauth: OAuthAuth;
}

export const anthropicOf = (): Anthropic => {
	const anthropic = Arr.findFirst(builtinProviders(), ({ id }) => id === "anthropic");

	if (Option.isNone(anthropic)) {
		throw new Error("claude-accounts: pi has no built-in anthropic provider to copy");
	}

	const { oauth } = anthropic.value.auth;

	if (oauth === undefined) {
		throw new Error("claude-accounts: pi's anthropic provider no longer offers an OAuth login");
	}

	const models = Arr.filter(anthropic.value.getModels(), (model) => hasApi(model, "anthropic-messages"));

	return { models, oauth };
};

const authOf = (login: Login, { oauth }: Anthropic) => {
	switch (login) {
		case "oauth": {
			return { oauth };
		}

		case "setup-token": {
			return { apiKey: setupTokenAuth };
		}

		default: {
			const unhandled: never = login;

			return unhandled;
		}
	}
};

const tooManyRequests = 429;

const limitWatched = (api: ProviderStreams, limited: (back: DateTime.Utc) => void): ProviderStreams => {
	const watching =
		(fetch: typeof globalThis.fetch) =>
		(...request: Parameters<typeof fetch>) =>
			accountsHost.run(
				Effect.gen(function* () {
					const response = yield* Effect.promise(() => fetch(...request));
					const now = yield* DateTime.now;

					if (response.status === tooManyRequests) {
						limited(backAt({ headers: response.headers, now }));
					}

					return response;
				}),
			);

	const watched = (options?: StreamOptions) => {
		const fetch = options?.fetch ?? globalThis.fetch;

		return { ...options, fetch: Object.assign(watching(fetch), { preconnect: fetch.preconnect }) };
	};

	return {
		...api,
		stream: (model, context, options) => api.stream(model, context, watched(options)),
		streamSimple: (model, context, options) => api.streamSimple(model, context, watched(options)),
	};
};

export const accountProvider = ({
	anthropic,
	account,
	limited,
}: {
	anthropic: Anthropic;
	account: Account;
	limited: (back: DateTime.Utc) => void;
}): Provider => {
	const api = limitWatched(anthropicMessagesApi(), limited);

	return createProvider({
		id: account.id,
		name: account.name,
		auth: authOf(account.login, anthropic),
		models: Arr.map(
			Arr.filter(anthropic.models, ({ id }) => offers(account, id)),
			(model) => ({
				...model,
				provider: account.id,
				compat: { ...model.compat, supportsMessageThreads: !account.baa },
			}),
		),
		api,
	});
};
