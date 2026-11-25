import type { Api, Model } from "@earendil-works/pi-ai";
import * as Arr from "effect/Array";

import { accounts } from "#src/features/claude-accounts/index.ts";

export const phiProvider = "phi";

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
