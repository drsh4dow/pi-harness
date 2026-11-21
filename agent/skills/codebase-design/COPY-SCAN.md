# Copy scan

The copy scan finds logic that lives in two modules, so each copy can get one home. The caller names the modules and the paths to scan, such as the whole source root or the files one wave changed. A hit is one of these, with a side in the scanned paths:

- a name declared at the top level in two or more modules, where the texts look alike;
- a clone of 30 tokens or more from `npx jscpd@5.4.3 --min-tokens 30 --reporters json --output <scratch folder> <source root>` whose two sides sit in two modules, leaving out clones of import lines.

A hit nominates. Read both sides, and give each real copy one home, with every caller pointed at it. Report each hit with its home, or with the reason it stays.
