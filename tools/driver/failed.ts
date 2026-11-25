import * as Schema from "effect/Schema";

export class ScenarioFailed extends Schema.TaggedError<ScenarioFailed, { readonly brand: unique symbol }>()(
	"ScenarioFailed",
	{ message: Schema.String },
) {}

export class SetupFailed extends Schema.TaggedError<SetupFailed, { readonly brand: unique symbol }>()("SetupFailed", {
	message: Schema.String,
}) {}
