---
when: Opening a PR, a pull request that puts a branch up for review, invoked at the end of every other playbook.
---

### Opening a PR

Rebase into small, ordered, landable commits. Run `playbooks/code-simplification.md` over the diff before commit and the **no-comments** skill before review. Run the **blast-radius** skill before you open a PR whose diff touches a migration, a schema, a wire format or an exported interface.

Title: `type(scope): subject`, naming a real symbol when one carries the change. Write, check, and publish the body with the **writing-good-prs** skill.

Stacks go through `gh stack`. A stack is a base-branch chain: the root PR targets trunk, and each child branch rebases onto its parent's exact tip and its PR targets the parent branch. Track the branches with `gh stack init --base <trunk> <branch>...` (bottom to top) or `gh stack add <branch>`, cascade a rebase with `gh stack rebase`, push with `gh stack push`, and link the PRs with `gh stack link <bottom-pr> ... <top-pr>`. As a parent merges, move its child onto trunk per `playbooks/shipping.md` step 4. Branch from trunk only for independent work. Open every PR ready with `gh pr create --base <base-branch>`, without `--draft`. Opening a PR does not start a babysit.
