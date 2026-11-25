import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { guardCodemode } from "./codemode/index.ts";

export { baaProviders, isBaa, isPhi, isProtected, phiProvider, sealedId } from "./protection.ts";

/** What the harness adds beside phi-router's pi package: the codemode guard of a session that may hold PHI. */
export const phiGuard = (pi: Pick<ExtensionAPI, "on">) => {
	pi.on("tool_call", (event, ctx) => guardCodemode({ event, ctx }));
};
