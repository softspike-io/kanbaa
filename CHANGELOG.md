# Changelog

## v0.1.1 (2026-11-12)

The first tagged release. It takes the board from the first version (11 November) to one you can work a day on: cards drag, tasks carry a model, the review loop goes back and forth with the agent, and the board can tell you when there is a newer version.

### New

- **Drag and drop.** Drag a card to another status, or to a new place in its own. A line shows where it will land; a drop in Ready with an agent asks first, as a move from the menu does, and a drop in Done marks the task done.
- **Models.** A task can name the model its agent starts on (`**Model:**` under `**Agent:**`), for Claude Code, Codex and Hermes. The settings take a default model per agent.
- **Reply.** A card whose agent is blocked, waiting on you or out of usage gets a Reply button that takes you to that agent's own tab, and the detail panel links to the agent's terminal.
- **Mark as done on the card.** Cards in Review have a Mark as done button, so you don't have to open them first.
- **Folded write-up in Review.** The result block shows a short summary, with the agent's full write-up folded under Details.
- **Update check.** Off until you turn it on in `⚙`. Once on, the board asks GitHub for the newest commit with `git ls-remote`, once a day and when `⚙` opens. When there is something newer, `⚙` gets a dot and **Update with …** opens a tab where your agent reads what changed and asks before replacing a file you changed. An install records its commit in `mods/kanbaa/version.json`.
- **Settings reworked.** One page per topic (Starting tasks, New tasks, Review, Archive, Updates, Agents). A choice saves as you pick it, and the panel keeps its height when you switch pages.
- **Stay on the board.** Separate settings decide whether you follow an agent to its tab after starting a task or after sending one back.

### Fixed

- Send back now sends the reply in Codex, instead of only typing it in, and Enter in the Send back box submits.
- Replying in an agent's terminal moves its task out of Review again.
- Resending a task no longer starts the agent from scratch and burns tokens on work it already did.
- The Start setting applies to a task created straight into Ready.
- Dropdowns scroll, fit eight options, open upward near the bottom of the window, close when you click away, and no longer make a card grow.
- Clicking beside a panel (New task, a card's details, Settings) closes it and no longer clicks the board underneath. The board under a panel also stops reacting to the pointer, and scrolling a panel no longer scrolls the board.
- Buttons in the detail panel wrap on narrow windows instead of overflowing.
- Opening the terminal of an agent that needs you goes to its tab, not an overlay.
- The New task panel has a new layout.

### Upgrading

If your agent installed Kanbaa from this repository, ask it to update from v0.1.1, or turn on Updates in `⚙` and use **Update with …**. The update check compares commits, not tags, so it sees every new commit on `main`, not only releases.

## v0.1.0 (2026-11-11)

The first version, untagged: the five-status board over a repo's `to-do` folder, task ids from the repo name, the detail panel, starting an agent from Ready, the result and review loop, search, the archive, and the task script and skill for Claude Code, Codex and Hermes.
