import * as Arr from "effect/Array";
import * as Option from "effect/Option";

import { type Commit, offGitHub, rootModel } from "#tools/driver/align/observe.ts";
import { scenario } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import { before, type Timeline } from "./timeline.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "ledgerline 0.9",
		files: {
			"README.md": `# ledgerline

Shared household ledger. Amounts are whole cents and never negative.

    python -m ledgerline add rent 1200.00 --paid-by ana
    python -m ledgerline balance
`,
			"ledgerline/__init__.py": "",
			"ledgerline/money.py": `def cents(text: str) -> int:
    return int(float(text) * 100)


def split(total: int, people: list[str]) -> dict[str, int]:
    return {person: total // len(people) for person in people}
`,
			"ledgerline/store.py": `import sqlite3

db = sqlite3.connect("ledger.db")
db.execute("create table if not exists entries (label text, cents int, paid_by text)")


def add(label: str, cents: int, paid_by: str) -> None:
    db.execute(f"insert into entries values ('{label}', {cents}, '{paid_by}')")


def entries() -> list[tuple[str, int, str]]:
    return db.execute("select label, cents, paid_by from entries").fetchall()
`,
			"ledgerline/__main__.py": `import sys

from . import money, store

command, *rest = sys.argv[1:]
if command == "add":
    store.add(rest[0], money.cents(rest[1]), rest[3])
else:
    people = sorted({paid_by for _, _, paid_by in store.entries()})
    print(money.split(sum(cents for _, cents, _ in store.entries()), people))
`,
		},
	},
];

const request =
	"I'm tagging ledgerline 1.0 tomorrow. Before that I want four separate reviews, none of which depends on another: the money math in ledgerline/money.py, the SQLite storage in ledgerline/store.py, the command line handling in ledgerline/__main__.py, and the README against what the code really does. Don't change any code. Give me one list of findings, most serious first.";

const fanOut = ({ steps }: Timeline) => {
	const starts = Arr.filter(steps, (step) => step.by === "root" && step.delegatesStarted > 0);

	const startedIn = (turn: number) =>
		Arr.reduce(
			Arr.filter(starts, (step) => step.turn === turn),
			0,
			(sum, step) => sum + step.delegatesStarted,
		);

	return Option.map(
		Arr.findFirst(starts, (step) => startedIn(step.turn) >= 3),
		before,
	);
};

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		measure({ run, guides: ["skills/swarm/SKILL.md"], history, request, within: "20 minutes", event: fanOut }),
});
