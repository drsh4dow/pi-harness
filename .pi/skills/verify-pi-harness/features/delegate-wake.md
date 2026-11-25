# Delegate start and wake

A root starts a delegate with the `delegate` tool, ends its turn, and wakes with the delegate's answer as a new turn. In print mode the root waits for the answer before pi exits, so one `pi -p` run covers the whole round trip.

## Sub-features

- `wake-start` records a `delegate-started` entry with the handle, name and model the root chose.
- `wake-settle` records a `job-settled` entry with status `done` and the delegate's answer, and the root replies after it.
- `wake-files` writes each delegate's session file and `<id>.answer.md` under the root's `sessions/delegates/`.
- `wake-config` runs the delegate on the root's agent folder and pi.

## How to get to it (user POV)

- A human asks the root for work it hands to a delegate.
- A root on its own playbook starts an owner or a leaf for a slice.

## Driving it with headless-root.sh

Preconditions:

- `$repo`, `$skill` and `$run` are set, the pinned checkout exists, and `doctor.sh` exits 0, as `SKILL.md` Launch and Doctor show.

- **Ask for a delegate.** Write the request. Run `printf '%s\n' 'Start one leaf delegate that runs `echo hello` and answers with the word it printed. Wait for its answer, then reply with that word. Be fully autonomous and ask no questions.' >"$run/prompt.txt"`.
- **Run the root.** Run `"$skill/scripts/headless-root.sh" "$run/agent" "$run/project" "$run/prompt.txt" "$run" 900` with the `watch` tool. It prints `exit 0 after <s> s`, 15 s on 2026-11-21.
- **Read the record.** Run `jq -c 'select(.customType == "owned-work") | .data // empty | {type, handle, name, model, outcome}' "$run"/sessions/*.jsonl`. It shows `{"type":"delegate-started","handle":"delegate-1",...}` and then `{"type":"job-settled","handle":"delegate-1",...,"outcome":{"status":"done","text":"hello",...}}`.
- **Check the files.** Run `ls "$run/sessions/delegates"`. It holds one `<iso>_<id>.jsonl` and one `<id>.answer.md` with the same id.
- **Check the reply.** Run `cat "$run/reply.txt"`. It names `hello` after the settle, not before it.
- **Scenario entry.** Run `bun src/features/owned-work/wakes/leaf-wake.scenario.ts` for `wake-config`. It prints `pass leaf-wake` when the leaf settles `ok` and runs the worktree's extensions.

## Gotchas

- `leaf-wake.scenario.ts` and `tools/driver/smoke.scenario.ts` assert pi `1.5.2`. With pi `1.6.0` installed they fail on that check alone, so a `fail` there names the version first.
- The root picks each delegate's model by alias. The leaf runs `ultra-a/claude-opus-5-5` for `worker` whatever model the root runs.
- A root whose reply asks a question also exits 0. Require the `job-settled` entry, not only the exit line.
- A root killed at the deadline still keeps every session file written so far. `exit 124` is a timeout, not a failed wake.
