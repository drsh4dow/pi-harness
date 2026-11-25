import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { guardCodemode } from "./codemode/index.ts";
import { isPhi } from "./protection.ts";

export { baaProviders, isBaa, isPhi, isProtected, phiProvider, sealedId } from "./protection.ts";

export const phiSessionHeaders = ({
	model,
	session,
}: {
	readonly model: Model<Api>;
	readonly session: string;
}): ProviderHeaders => (isPhi(model) ? { "x-phi-session": session } : {});

export const guardProtectedCodemode = (pi: Pick<ExtensionAPI, "on">) => {
	pi.on("tool_call", (event, ctx) => guardCodemode({ event, ctx }));
};
