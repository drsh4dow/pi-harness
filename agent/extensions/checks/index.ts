import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { checks } from "#src/features/checks/index.ts";

export default function checksExtension(pi: ExtensionAPI) {
	checks(process.env)(pi);
}
