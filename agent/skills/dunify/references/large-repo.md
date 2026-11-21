# Large repos

The dunify reference for an existing repo that step 1 of [`../SKILL.md`](../SKILL.md) measures as too large for one agent. It changes steps 1, 2, 4 and 5.

A **slice** is one build module or package, the unit that moves on one branch. An **area** is a group of slices that one delegate can search, up to about 50,000 lines of source. A larger slice is an area of its own. Cut both along the build tool's own modules. Group slices into areas by name prefix, and keep a slice with the slices it imports most.

You keep the measure, the layout map and the one stop with the user. Delegates read the code and move it, and in step 5 the integration owner of `SKILL.md` writes the shared files.

## Step 1. Read by area

Start one leaf delegate per area, all in one group. Give each its area's paths and measured numbers, the list with paths from step 1 of `SKILL.md`, and three more items:

- each import that leaves the area and each module outside it that imports from it;
- for each slice, the narrowest build and test command that covers it, named and not run;
- each mistake that the area's history shows fixed twice.

Tell each to find its answers by search, to read only what a hit points to, and to answer under the list's own headings with one line and one path per finding. Build the repo's list from their answers. Open a file yourself only where two answers disagree.

Done when every area has answered, and the code that issues each durable value's writes is named.

## Step 2. Plan the slices

Draw the rows for each runtime directory and each contract edge in full. Give each slice one row. Its owner draws the slice's inner rows in step 5, by the folder rule and the split order. Source that the build leaves out gets a row with the user's choices, which are to delete it or to bring it into the build.

Under the map, add the **slice plan**. Each line names one slice, its lines of source, its commits of the last 90 days, the slices it imports, the slices that import it, and its build and test command. A move changes the import lines of every importer, so order the plan by fewest importers first.

Put the **pilot** first. The pilot is a slice of a few thousand lines with at most one importer and few recent commits. It writes a durable value, and it crosses a contract edge where the repo has one, so it meets every gate. Draw its inner rows in full.

Done when the user approves the map, the bans, the rules off and the slice plan.

## Step 4. Baseline the whole repo

The formatter has no baseline, so run its fix on the whole repo here, in one commit. Run no other auto-fix. Record the baseline for the whole repo, and leave each slice's other auto-fixes to its owner.

## Step 5. Run every slice

Each slice gets one owner, as step 5 of `SKILL.md` gives each module one. Add to its brief the slice's build and test command, run on the untouched slice first and after each move, and auto-fix on the slice. A slice owner draws the slice's inner rows, reports them in its answer, and may give each module in it an owner of its own. It names each noun of the project's own that it finds, with the row it gave it. The integration owner adds the inner rows to the layout map in `CODING_STANDARDS.md`, and adds each new noun's row to `USER_ACTION_ITEMS.md` as well.

Run the pilot alone first. Where it shows a row of the map wrong, have the integration owner change the row before another slice starts, and add the change to `USER_ACTION_ITEMS.md`. Then give the remaining slices owners in the plan's order, with the pilot's rows and commits as the pattern to copy.

Done when the done line of step 5 in `SKILL.md` holds on the tip that holds every slice.
