import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { navigation } from "#src/features/navigation/index.ts";

export default function navigationExtension(pi: ExtensionAPI) {
	navigation(process.cwd())(pi);
}
