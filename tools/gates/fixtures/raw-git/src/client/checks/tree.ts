import * as ChildProcess from "effect/process/ChildProcess";

export const status = ChildProcess.make("git", ["status"]);
