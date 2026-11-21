# Shallow signals

Four signals from the import graph that nominate shallow modules and the groups a wide folder should split into. Assumes the vocabulary in [SKILL.md](SKILL.md). Read the graph from the repo's boundary tool, such as `depcruise src --output-type json`, or from the build tool.

| Signal                                                                                                 | What it nominates                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single importer.** A file that exactly one file imports, and that one is not the folder's edge file. | A private part of its importer. It moves in beside the importer, behind the importer's interface. An edge file as the only importer says nothing about the concept, so skip those. |
| **Name-stem sibling.** A file named `x-y` beside `x`.                                                  | A piece a line cap cut off `x`. Fold it back into `x`, or make `x` a folder with `x-y` inside.                                                                                     |
| **Hub.** A file that more than a third of its folder's files import.                                   | Shared vocabulary of the folder. It stays where every group can reach it, and no group forms around it.                                                                            |
| **Concept count.** A file together with its test, fixture and scenario siblings.                       | One concept. Count concepts, not files, when you judge a folder's width or draw its groups.                                                                                        |

The signals nominate. The deletion test in [SKILL.md](SKILL.md) and a reader of the code decide each group and each merge. Graph clustering, such as connected components, label propagation or modularity, is left out, since it agreed with a reader's grouping at about chance.
