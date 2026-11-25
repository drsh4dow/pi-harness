import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";

const routerPackageCommand = "phi";

export const routerExtensionOf = (commands: ReadonlyArray<SlashCommandInfo>) =>
	Option.map(
		Arr.findFirst(commands, ({ name, source }) => name === routerPackageCommand && source === "extension"),
		({ sourceInfo }) => sourceInfo.path,
	);
