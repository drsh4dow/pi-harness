import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { phiGuard } from "#src/features/phi/index.ts";

export default function phiExtension(pi: ExtensionAPI) {
	phiGuard(pi);
}
