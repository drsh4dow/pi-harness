import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { guardCodemode } from "./codemode/index.ts";

export { baaProviders, isBaa, isPhi, isProtected, phiProvider, sealedId } from "./protection.ts";

export const guardProtectedCodemode = (pi: Pick<ExtensionAPI, "on">) => {
	pi.on("tool_call", (event, ctx) => guardCodemode({ event, ctx }));
};
