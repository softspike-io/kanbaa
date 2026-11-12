// node --test mods/kanbaa/parse.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { column, parse, pick, setStatus, setAgent, setModel, modelId, withModel, codexModels, setManual, description, setDescription, setTitle, prefix, repoName, taskId, nextId, results, splitResult, setBody, addFeedback, setOrder, byOrder, dropOrder, matches, issue, issuedIn, counterPath, newTask, hitLimit, MAX_FILES } from "./parse.js";

test("the five status sources, in order", () => {
  assert.equal(parse("# T\n\n**Status:** Ready\n\n- [x] a\n", "completed/t.md").column, "ready");
  assert.equal(parse("---\nstatus: \"In progress\"\n---\n# T\n", "completed/t.md").column, "progress");
  assert.equal(parse("# T\n- [ ] a\n", "completed/t.md").column, "done");
  assert.equal(parse("# T\n- [ ] a\n- [ ] b\n", "t.md").column, "backlog");
  assert.equal(parse("# T\n- [x] a\n- [ ] b\n", "t.md").column, "progress");
  assert.equal(parse("# T\n- [x] a\n- [X] b\n", "t.md").column, "done");
  assert.equal(parse("# T\ntext\n", "t.md").column, "backlog");
  // An empty Status line and an unknown subfolder say nothing.
  assert.equal(parse("# T\n**Status:**\n- [x] a\n", "notes/t.md").column, "done");
  // Past the first 30 lines it is body text.
  assert.equal(parse("# T\n" + "x\n".repeat(30) + "**Status:** Done\n", "t.md").column, "backlog");
});

test("columns", () => {
  assert.equal(column("Done — pending the owner's review"), "review");
  assert.equal(column("completed"), "done");
  assert.equal(column("in-progress"), "progress");
  assert.equal(column("Started yesterday"), "progress");
  assert.equal(column("development-ready"), "ready");
  assert.equal(column("Draft"), "backlog");
  assert.equal(column("whatever"), "backlog");
  assert.equal(column("Archived"), "archive");
  assert.deepEqual([parse("# T\n\n**Status:** Archived\n", "t.md").column, parse("# T\n\n**Status:** Archived\n", "t.md").note], ["archive", ""]);
});

test("card contents", () => {
  const c = parse("---\nagent: codex\n---\n# comment-free title\n**Status:** Draft — not authorized\n- [x] a\n- [ ] b\n", "x.md");
  assert.deepEqual([c.title, c.note, c.agent, c.ticked, c.boxes, c.manual], ["comment-free title", "Draft — not authorized", "codex", 1, 2, false]);
  assert.equal(parse("**Status:** In review\n", "sub/my-task.md").title, "my-task");
  assert.equal(parse("**Status:** In review\n", "t.md").note, "");
  assert.equal(parse("**Agent:**\n", "t.md").agent, "");
  assert.equal(parse("Manual pickup only. This does not authorize coding agents.\n", "t.md").manual, true);
  assert.equal(parse("# T\n" + "x\n".repeat(30) + "Files saying Manual pickup only are gated.\n", "t.md").manual, false);
});

test("setStatus changes only the value, CRLF and trailing spaces kept", () => {
  const text = "# T\r\n\r\n**Status:** Draft — not yet  \r\n**Agent:** claude\r\n\r\nBody  \r\n- [ ] a";
  assert.equal(setStatus(text, "In progress"), text.replace("Draft — not yet", "In progress"));
  const front = "---\ntitle: x\nstatus: backlog\n---\n\n# T\nbody\n";
  assert.equal(setStatus(front, "Done"), front.replace("status: backlog", "status: Done"));
  assert.equal(setStatus("# T\n**Status:**\nb\n", "Ready"), "# T\n**Status:** Ready\nb\n");
});

test("setStatus inserts under the title when there is no status", () => {
  assert.equal(setStatus("# T\r\n\r\nBody\r\n", "Ready"), "# T\r\n\r\n**Status:** Ready\r\n\r\nBody\r\n");
  assert.equal(setStatus("# T\nBody", "Ready"), "# T\n\n**Status:** Ready\n\nBody");
  assert.equal(setStatus("# T", "Ready"), "# T\n\n**Status:** Ready\n");
  assert.equal(setStatus("just text\n", "Ready"), "**Status:** Ready\n\njust text\n");
  assert.equal(setStatus("---\ntitle: x\n---\nbody\n", "Ready"), "---\ntitle: x\n---\n\n**Status:** Ready\n\nbody\n");
  // The inserted line then wins over the folder and the checkboxes.
  assert.equal(parse(setStatus("# T\n- [x] a\n", "Ready"), "completed/t.md").column, "ready");
});

test("setAgent", () => {
  assert.equal(setAgent("# T\n\n**Status:** Ready\n**Agent:**\n\nb\n", "claude"), "# T\n\n**Status:** Ready\n**Agent:** claude\n\nb\n");
  assert.equal(setAgent("# T\n**Agent:** claude\n", ""), "# T\n**Agent:**\n");
  assert.equal(setAgent("# T\r\n\r\n**Status:** Ready\r\n\r\nb", "codex"), "# T\r\n\r\n**Status:** Ready\r\n**Agent:** codex\r\n\r\nb");
  assert.equal(setAgent("---\nstatus: ready\n---\n# T\n", "codex"), "---\nstatus: ready\nagent: codex\n---\n# T\n");
  assert.equal(setAgent("# T\n\nb\n", "codex"), "# T\n\n**Agent:** codex\n\nb\n");
  assert.equal(setAgent("# T\n\nb\n", ""), "# T\n\nb\n");
});

test("pick", () => {
  const { files, capped } = pick(["b.md", "README.md", "_draft.md", "ready\\a.md", "_old/x.md", "a/b/c.md", "notes.txt"]);
  assert.deepEqual(files, ["b.md", "ready/a.md"]);
  assert.equal(capped, false);
  const many = pick(Array.from({ length: MAX_FILES + 1 }, (_, i) => `${i}.md`));
  assert.deepEqual([many.files.length, many.capped], [MAX_FILES, true]);
});

test("model", () => {
  assert.equal(parse("# T\n\n**Status:** Ready\n**Agent:** claude\n**Model:** opus\n", "a.md").model, "opus");
  assert.equal(parse("# T\n**Model:** --dangerously-skip-permissions\n", "a.md").model, ""); // never a flag
  assert.equal(modelId(" claude-opus-5-5[1m] "), "claude-opus-5-5[1m]");
  assert.equal(modelId("a b"), "");
  assert.equal(setModel("# T\n\n**Status:** Ready\n**Agent:** claude\n\nb\n", "opus"), "# T\n\n**Status:** Ready\n**Agent:** claude\n**Model:** opus\n\nb\n");
  assert.equal(setModel("# T\r\n**Agent:** claude\r\n**Model:** opus\r\n", "sonnet"), "# T\r\n**Agent:** claude\r\n**Model:** sonnet\r\n");
  assert.equal(setModel("# T\n**Agent:** claude\n**Model:** opus\n\nb\n", ""), "# T\n**Agent:** claude\n\nb\n");
  assert.equal(setModel("---\nstatus: ready\nagent: codex\n---\n# T\n", "gpt-6"), "---\nstatus: ready\nagent: codex\nmodel: gpt-6\n---\n# T\n");
  // Another agent: the model goes. The same agent again: it stays.
  assert.equal(setAgent("# T\n**Agent:** claude\n**Model:** opus\n", "codex"), "# T\n**Agent:** codex\n");
  assert.equal(setAgent("# T\n**Agent:** claude\n**Model:** opus\n", "claude"), "# T\n**Agent:** claude\n**Model:** opus\n");
  assert.deepEqual(withModel(["claude"], "claude", "opus"), ["claude", "--model", "opus"]);
  assert.deepEqual(withModel(["codex", "--no-daemon"], "codex", "gpt-6"), ["codex", "--no-daemon", "-m", "gpt-6"]);
  assert.deepEqual(withModel(["claude"], "claude", ""), ["claude"]);
  assert.deepEqual(withModel(["claude"], "claude", "-x"), ["claude"]);
  assert.deepEqual(withModel(["gemini"], "gemini", "pro"), ["gemini"]); // no known flag
  assert.deepEqual(codexModels('{"models":[{"slug":"gpt-6","display_name":"GPT-6","visibility":"list"},{"slug":"x","visibility":"hide"}]}'), [{ key: "gpt-6", label: "GPT-6" }]);
  assert.deepEqual(codexModels("not json"), []);
  const made = newTask({ title: "T", column: "ready", agent: "claude", model: "opus", date: "2026-11-12" });
  assert.equal(made.text, "# T\n\n**Status:** Ready\n**Agent:** claude\n**Model:** opus\n**Written:** 2026-11-12\n");
  assert.equal(parse(made.text, made.name).model, "opus");
  assert.ok(!newTask({ title: "T", column: "ready", agent: "", model: "opus", date: "2026-11-12" }).text.includes("Model")); // no agent, no model
});

test("newTask writes a file the board reads back", () => {
  const { name, text } = newTask({ title: "  Fix the Login: bug!  ", description: "Short\nnote\n", column: "ready", agent: "claude", date: "2026-11-11" });
  assert.equal(name, "fix-the-login-bug.md");
  assert.equal(text, "# Fix the Login: bug!\n\n**Status:** Ready\n**Agent:** claude\n**Written:** 2026-11-11\n\nShort\nnote\n");
  const c = parse(text, name);
  assert.deepEqual([c.title, c.column, c.agent], ["Fix the Login: bug!", "ready", "claude"]);
  const bare = newTask({ title: "README", description: "", column: "backlog", agent: "", date: "2026-11-11" });
  assert.deepEqual([bare.name, bare.text], ["readme-task.md", "# README\n\n**Status:** Draft\n**Agent:**\n**Written:** 2026-11-11\n"]);
  assert.equal(newTask({ title: "???", description: "", column: "done", agent: "", date: "d" }).name, "task.md");
  assert.equal(pick([name, bare.name]).files.length, 2);
  assert.equal(c.manual, false);
  const gated = parse(newTask({ title: "T", description: "", column: "ready", agent: "claude", date: "d", manual: true }).text, "t.md");
  assert.deepEqual([gated.title, gated.column, gated.agent, gated.manual], ["T", "ready", "claude", true]);
});

test("setManual", () => {
  const text = "# T\r\n\r\n**Status:** Ready\r\n\r\nBody\r\n";
  const gated = setManual(text, true);
  assert.equal(gated, "# T\r\n\r\n> Manual pickup only. This file does not authorize coding agents to start on it.\r\n\r\n**Status:** Ready\r\n\r\nBody\r\n");
  assert.equal(parse(gated, "t.md").manual, true);
  assert.equal(setManual(gated, true), gated);
  assert.equal(setManual(gated, false), text);
  assert.equal(setManual(text, false), text);
  assert.equal(setManual("Manual pickup only, see the owner.\n# T\n", false), "# T\n");
});

test("ids come from the repo name and live in the file name", () => {
  assert.deepEqual([prefix("herdr-preview"), prefix("3d_engine"), prefix("x"), prefix("--")], ["HER", "3DE", "X", "TSK"]);
  assert.deepEqual([taskId("HER-12-fix-login.md"), taskId("ready/her-3.md"), taskId("to-do-board.md"), taskId("notes-2024.md")], ["HER-12", "HER-3", "", ""]);
  assert.equal(repoName("C:/Users/x/GitHub/herdr-preview/.git", "C:/Users/x/.herdr/worktrees/herdr-preview/pm"), "herdr-preview");
  assert.equal(repoName("", "C:\\work\\notes"), "notes");
  assert.equal(nextId("herdr-preview", []), "HER-1");
  assert.equal(nextId("herdr-preview", ["to-do-board.md", "HER-2-a.md", "done\\her-10-b.md", "SOF-40-c.md"]), "HER-11");
  const { name, text } = newTask({ title: "Fix login", description: "", column: "ready", agent: "", date: "d", id: "HER-11" });
  assert.equal(name, "HER-11-fix-login.md");
  assert.deepEqual([parse(text, name).id, parse(text, name).title], ["HER-11", "Fix login"]);
  assert.deepEqual(pick(["HER-10-b.md", "HER-2-a.md"]).files, ["HER-2-a.md", "HER-10-b.md"]);
});

test("title and description edits leave the header lines alone", () => {
  const text = "# T\r\n\r\n> Manual pickup only. Ask first.\r\n\r\n**Status:** Ready  \r\n**Agent:** claude\r\n\r\nOld body\r\n\r\n- [ ] a\r\n";
  assert.equal(description(text), "Old body\r\n\r\n- [ ] a");
  assert.equal(setDescription(text, "New\nbody\n"), "# T\r\n\r\n> Manual pickup only. Ask first.\r\n\r\n**Status:** Ready  \r\n**Agent:** claude\r\n\r\nNew\r\nbody\r\n");
  assert.equal(setDescription(text, "  "), "# T\r\n\r\n> Manual pickup only. Ask first.\r\n\r\n**Status:** Ready  \r\n**Agent:** claude\r\n");
  assert.equal(setDescription("# T\n", "Body"), "# T\n\nBody\n");
  assert.equal(setDescription("just text\n", "other"), "other\n");
  assert.equal(description(setDescription(text, "x")), "x");
  assert.equal(setTitle(text, "  New   title "), text.replace("# T", "# New title"));
  assert.equal(setTitle("**Status:** Ready\n\nBody\n", "T"), "# T\n\n**Status:** Ready\n\nBody\n");
  assert.equal(description("---\nstatus: x\n---\n# T\n\nBody\n"), "Body");
  assert.deepEqual(parse("# T\n\n**Status:** Ready\n**Agent:**\n**Written:** 2026-11-11\n**Repo:** `C:/x/y`\n\nBody with **bold:** text\n", "t.md").meta,
    [{ key: "Written", value: "2026-11-11" }, { key: "Repo", value: "C:/x/y" }]);
});

test("results lists the files under ## Result", () => {
  const text = "# T\n\n**Status:** In review\n\nDo it. See `src/before.js`.\n\n## Result\n\nAdded the limiter under `src/` and ran `npm test`.\n\n- `src/limit.js`\n- [the docs](docs/limits.md)\n- `src\\win.js` and `src/limit.js` again\n- `../outside.txt`, `https://example.com/x.html`\n\n## Notes\n\n`later.md`\n";
  assert.deepEqual(results(text), ["src/limit.js", "docs/limits.md", "src/win.js"]);
  assert.deepEqual(results("# T\n\nNo result yet, only `a.md`.\n"), []);
  assert.deepEqual(results("## Result\r\n- `README.md`"), ["README.md"]);
  assert.deepEqual(splitResult("Do it.\n\n## Result\n\nAdded the limiter.\nTests pass.\n\n- `src/limit.js`\n- [docs](docs/limits.md)\n- kept the old `flag` name\n\n## Notes\n\nLater."),
    { body: "Do it.\n\n## Notes\n\nLater.", result: "Added the limiter.\nTests pass.\n\n- kept the old `flag` name", details: "", found: true });
  assert.deepEqual(splitResult("Nothing yet."), { body: "Nothing yet.", result: "", details: "", found: false });
  // The long write-up (## Details, or the older ## Research / ## Review) leaves the description too, and an edit keeps it.
  const long = "# T\n\n**Status:** In review\n\nAsk.\n\n## Research\n\n### Options\n\nA or B.\n\n## Result\n\nB.\n\n- `a.md`\n\n## Feedback\n\n- d1: why\n";
  assert.deepEqual(splitResult(description(long)), { body: "Ask.\n\n## Feedback\n\n- d1: why", result: "B.", details: "### Options\n\nA or B.", found: true });
  assert.deepEqual(splitResult("Ask.\n\n## Details\n\nOnly this."), { body: "Ask.", result: "", details: "Only this.", found: true });
  assert.equal(setBody(long, "New ask."), "# T\n\n**Status:** In review\n\nNew ask.\n\n## Research\n\n### Options\n\nA or B.\n\n## Result\n\nB.\n\n- `a.md`\n");
  const task = "# T\r\n\r\n**Status:** In review\r\n\r\nOld ask.\r\n\r\n## Result\r\n\r\nDid it.\r\n\r\n- `a.md`\r\n";
  assert.equal(setBody(task, "New ask.\nSecond line."), "# T\r\n\r\n**Status:** In review\r\n\r\nNew ask.\r\nSecond line.\r\n\r\n## Result\r\n\r\nDid it.\r\n\r\n- `a.md`\r\n");
  assert.equal(setBody(task, "Old ask."), task);
  assert.equal(setBody("# T\n\nOld.\n", "New."), "# T\n\nNew.\n");
});

test("addFeedback appends a dated line, making the section when needed", () => {
  const task = "# T\r\n\r\n**Status:** In review\r\n\r\nAsk.\r\n\r\n## Result\r\n\r\nDid it.\r\n";
  const once = addFeedback(task, "Make it\nshorter. ", "2026-11-11");
  assert.equal(once, task + "\r\n## Feedback\r\n\r\n- 2026-11-11: Make it shorter.\r\n");
  assert.equal(addFeedback(once, "And rhyme.", "2026-11-12"), task + "\r\n## Feedback\r\n\r\n- 2026-11-11: Make it shorter.\r\n- 2026-11-12: And rhyme.\r\n");
  assert.equal(addFeedback("# T\n\n## Feedback\n\n- d1: a\n\n## Result\n\nx\n", "b", "d2"), "# T\n\n## Feedback\n\n- d1: a\n- d2: b\n\n## Result\n\nx\n");
  assert.equal(addFeedback("", "a", "d"), "## Feedback\n\n- d: a\n");
});

test("ids are not handed out twice", () => {
  assert.equal(nextId("herdr-preview", ["HER-2-a.md"], 7), "HER-8");
  assert.equal(nextId("herdr-preview", ["HER-9-a.md"], 7), "HER-10");
  const one = issue(null, "HER-3");
  assert.deepEqual(JSON.parse(one), { HER: 3 });
  assert.equal(issuedIn(one, "herdr-preview"), 3);
  assert.equal(issue(one, "HER-2"), null);
  assert.deepEqual(JSON.parse(issue(one, "SOF-1")), { HER: 3, SOF: 1 });
  assert.equal(issuedIn("not json", "herdr-preview"), 0);
  assert.equal(counterPath("C:/r/.git", "C:/r/to-do"), "C:/r/.git/kanbaa-ids.json");
  assert.equal(counterPath("", "C:/notes/to-do"), "C:/notes/to-do/.kanbaa-ids.json");
});

test("order within a status", () => {
  const text = "# T\r\n\r\n**Status:** Ready\r\n**Agent:** claude\r\n\r\nBody\r\n";
  const placed = setOrder(text, -2);
  assert.equal(placed, "# T\r\n\r\n**Status:** Ready\r\n**Order:** -2\r\n**Agent:** claude\r\n\r\nBody\r\n");
  assert.deepEqual([parse(placed, "t.md").order, parse(text, "t.md").order, parse(placed, "t.md").meta], [-2, null, []]);
  assert.equal(setOrder(placed, 5), placed.replace("-2", "5"));
  assert.equal(setOrder(placed, null), text);
  assert.equal(setOrder(text, null), text);
  const cards = [{ rel: "HER-10.md", order: null }, { rel: "HER-2.md", order: null }, { rel: "HER-7.md", order: 0 }, { rel: "HER-9.md", order: -1 }];
  assert.deepEqual(cards.sort(byOrder).map(c => c.rel), ["HER-9.md", "HER-7.md", "HER-2.md", "HER-10.md"]);
});

test("filter and cap", () => {
  const card = { id: "HER-4", title: "Rate-limit the API", agent: "claude", text: "429 with Retry-After" };
  assert.deepEqual([matches(card, "rate api"), matches(card, "her-4 CLAUDE"), matches(card, "retry-after"), matches(card, "rate billing"), matches(card, "  ")], [true, true, true, false, true]);
  const names = Array.from({ length: MAX_FILES + 2 }, (_, i) => `HER-${i + 1}-x.md`), times = Object.fromEntries(names.map((n, i) => [n, i]));
  const kept = pick(names, times);
  assert.deepEqual([kept.capped, kept.files.length, kept.files.includes("HER-1-x.md"), kept.files.includes(`HER-${MAX_FILES + 2}-x.md`), kept.files[0]], [true, MAX_FILES, false, true, "HER-3-x.md"]);
});

test("where a dropped card lands", () => {
  const [a, b, c] = ["a.md", "b.md", "c.md"].map(rel => ({ rel })), x = { rel: "x.md" }, rels = list => list.map(card => card.rel).join(" ");
  assert.equal(rels(dropOrder([a, b, c], a, "c.md", true)), "b.md c.md a.md");
  assert.equal(rels(dropOrder([a, b, c], c, "a.md", false)), "c.md a.md b.md");
  assert.equal(rels(dropOrder([a, b, c], a, "b.md", false)), "a.md b.md c.md"); // just before its neighbour: where it was
  assert.equal(rels(dropOrder([a, b, c], x, "b.md", true)), "a.md b.md x.md c.md"); // from another status
  assert.equal(rels(dropOrder([a, b, c], x)), "a.md b.md c.md x.md"); // on the status itself: the end
  assert.equal(rels(dropOrder([a, b], x, "gone.md", false)), "a.md b.md x.md");
  assert.equal(rels(dropOrder([], x)), "x.md");
});

test("a screen that stopped on a usage limit", () => {
  for (const line of ["Claude usage limit reached. Your limit will reset at 3pm.", "5-hour limit reached ∙ resets 3pm", "You've hit your usage limit. Try again at 9:00.", "You've hit your limit · resets 4am"])
    assert.equal(hitLimit(`● Working on it\n\n${line}\n\n> \n`), true, line);
  assert.equal(hitLimit("● Added the rate limiter and its tests.\n\n> \n"), false);
  assert.equal(hitLimit("● You've hit your usage\n  limit. Try again at 9:00.\n\n> \n"), true); // wrapped in a narrow pane
  assert.equal(hitLimit(`Claude usage limit reached.\n${"● later line\n".repeat(12)}`), false); // scrolled away: an old one
});
