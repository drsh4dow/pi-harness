import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import type { Run } from "#tools/driver/index.ts";

const handBack = [
	/\b(?:before|until) i (?:build|start|write|code|change|touch)\b/iu,
	/\b(?:after|once|when) you(?:'ve)? (?:answer|reply|confirm|decide|choose|pick)\b/iu,
	/\b(?:after|once|when) (?:i (?:have|get) )?your (?:answers?|reply|decisions?|confirmation)\b/iu,
	/\bneed (?:\w+ ){0,3}(?:answers?|decisions?)\b/iu,
	/\b(?:is|are) your (?:call|decision)\b|\bonly you can (?:make|decide|answer)\b|\byour decisions?\b/iu,
	/\b(?:answer|reply|say) (?:with )?["“]?yes\b/iu,
	/\bwhat i need from you\b/iu,
	/\b(?:do|would) you (?:prefer|rather)\b|\bwhich (?:\w+ ){0,3}(?:do|would|should) you\b/iu,
];

/** The first wording in `text` that hands a decision to the human, if any. */
export const handsBack = (text: string): Option.Option<string> =>
	Arr.findFirst(handBack, (pattern) => Option.map(Str.match(pattern)(text), ([found]) => found));

/** The first wording in `text` that gives the agent's own pick for a call: a pick, a recommendation, or the arrow that marks one. */
export const pickIn = (text: string): Option.Option<string> =>
	Option.map(
		Str.match(
			/\bmy picks?\b|\b(?:i|i'd|i would) (?:recommend|suggest|propose|lean|go with|pick|choose)\b|\brecommend(?:ed|ation)?\b|➡/iu,
		)(text),
		([found]) => found,
	);

type Rule = readonly [held: boolean, claim: string];

/** Prints each rule as `held <claim>` or `broke <claim>`, then fails naming every rule that broke, not only the first. */
export const judge = ({ run, rules }: { readonly run: Run; readonly rules: ReadonlyArray<Rule> }) =>
	Effect.gen(function* () {
		const broke = Arr.flatMap(rules, ([held, claim]) => (held ? [] : [claim]));

		yield* Effect.forEach(rules, ([held, claim]) => run.say(`${held ? "held" : "broke"} ${claim}`));
		yield* run.check(!Arr.isReadonlyArrayNonEmpty(broke), Arr.join(broke, "; "));
	});
