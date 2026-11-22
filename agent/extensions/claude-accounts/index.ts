import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { claudeAccounts } from "#src/features/claude-accounts/index.ts";

export default function claudeAccountsExtension(pi: ExtensionAPI) {
	claudeAccounts(pi);
}
