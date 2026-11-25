import type { Api, Model } from "@earendil-works/pi-ai";
import * as Arr from "effect/Array";

import { accounts } from "#src/features/claude-accounts/index.ts";

/** The provider phi-router's pi package registers. Each of its models routes by content, `sealed` pins. */
export const phiProvider = "phi";

/** The `phi` model whose requests phi-router sends to a BAA account. */
export const sealedId = "sealed";

type Selection = Pick<Model<Api>, "provider" | "id">;

export const baaProviders: ReadonlyArray<string> = [
	...Arr.flatMap(accounts, (account) => (account.baa ? [account.id] : [])),
	"openai",
];

export const isPhi = (model: Selection | undefined) => model !== undefined && model.provider === phiProvider;

export const isBaa = (provider: string) => Arr.contains(baaProviders, provider);

export const isProtected = (model: Selection | undefined) =>
	isPhi(model) || (model !== undefined && isBaa(model.provider));
