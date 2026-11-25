import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { guardProtectedCodemode } from "#src/features/phi/index.ts";

export default function phiExtension(pi: ExtensionAPI) {
	guardProtectedCodemode(pi);
}
