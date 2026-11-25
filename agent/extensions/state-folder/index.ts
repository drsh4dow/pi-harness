import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { stateFolder } from "#src/features/state-folder/index.ts";

export default function stateFolderExtension(pi: ExtensionAPI) {
	const feature = stateFolder(process.env)(pi);

	pi.on("session_start", (_event, ctx) => feature.restore(ctx));
	pi.on("session_tree", (_event, ctx) => feature.restore(ctx));
	pi.on("tool_call", feature.toolCall);
	pi.on("tool_result", feature.toolResult);
	pi.on("tool_execution_end", feature.endWatch);
	pi.on("session_shutdown", feature.shutdown);
}
