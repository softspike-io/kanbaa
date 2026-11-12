// A Kanban board of the to-do folder in the focused pane's repo: one Markdown file is one card.
// The files are the only state: a move or an assignment rewrites one line of the file (parse.js).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { spaces, panes, focused, agents, terminals, hc, exec, readTextFile, writeTextFile, watchFolder, knownAgents, home, theme, window, layout, run, setShared, notify, openOverlay, nextCommand } from "herdr";
import { COLUMNS, ARCHIVE, parse, pick, description, setDescription, setTitle, nextId, repoName, results, splitResult, setBody, addFeedback, backPrompt, setStatus, setAgent, setModel, withModel, codexModels, MODELS, MODEL_FLAG, setManual, startPrompt, setOrder, byOrder, dropOrder, matches, issue, issuedIn, counterPath, hitLimit } from "./parse.js";
import { openForm, closeForm, renderForm, today } from "./form.js";
import { choices, modelChoices, SELECTORS, label } from "./ui.js";
import { openSetup, renderSetup } from "./setup.js";
import { sendBackMessage, restoreBoard } from "./send-back.js";

// As the shipped files mod: the focused pane's folder and machine.
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}

// The first to-do folder under root and its *.md, one level of subfolders deep: { dir, paths } or null.
async function list(root, on) {
  const read = r => {
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list the to-do folder");
    // The folder, then per file "<last change, unix seconds> <path>".
    const [dir, ...lines] = r.stdout.split(/\r?\n/).filter(Boolean), times = {};
    const paths = lines.map(line => { const at = line.indexOf(" "), path = line.slice(at + 1); times[path.replace(/\\/g, "/")] = Number(line.slice(0, at)) * 1000 || 0; return path; });
    return dir ? { dir, paths, times } : null;
  };
  // Quoting and encoding as the shipped files mod's directory().
  const windows = async () => read(await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($r) foreach ($d in 'to-do','todo','docs/to-do','docs/todo') { $p = Join-Path $r $d; if (Test-Path -LiteralPath $p -PathType Container) { $d; $n = (Get-Item -LiteralPath $p).FullName.TrimEnd('\\').Length + 1; Get-ChildItem -LiteralPath $p -Filter *.md -File -Depth 1 -Force | Select-Object -First 1000 | ForEach-Object { '' + ([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeSeconds() + ' ' + $_.FullName.Substring($n) }; break } } } '" + root.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on }));
  if (!on && window()?.platform === "windows") return windows();
  const script = 'for d in to-do todo docs/to-do docs/todo; do [ -d "$1/$d" ] || continue; echo "$d"; cd "$1/$d" || exit 1; for f in *.md */*.md; do [ -f "$f" ] && echo "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0) $f"; done; exit 0; done';
  try { return read(await exec("sh", ["-c", script, "board", root], { on })); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windows();
    throw e;
  }
}

// mods have no rotated text: label-<id>.svg is each title outlined a quarter turn (Segoe UI Semibold, 130 wide, this long).
const LABEL = { backlog: 355, ready: 280, progress: 508, review: 322, done: 244 };
// A task and the agent sent after it are linked by a label on the agent's terminal: kanbaa.task = the
// task file's path, put there when the agent is started (follow()). The link lives and dies with the
// terminal: it survives a renamed tab, a retitled task and a restart of Herdr, and names one terminal only.
const TASK = "kanbaa.task";
const live = term => !term.state || term.state === "live";
// The name a started agent's tab gets. Only used to recognise that tab at its birth, to label its terminal.
const tabName = card => card.title.length > 40 ? `${card.title.slice(0, 39)}…` : card.title;
// Where the agent sent after this task is now, while its terminal is still there.
function tabOf(card) {
  const term = terminals().find(term => term.labels?.[TASK] === card.path && live(term));
  if (!term) return null;
  const agent = agents().find(a => a.address === term.address);
  if (agent) return { pane: agent.pane, tab: agent.tab, terminal: agent.address, working: agent.status === "working", resting: agent.status === "idle" || agent.status === "done", blocked: agent.status === "blocked" };
  // The agent has left and its shell stayed: still a tab to go to or to close, nothing to type into.
  return term.labels["herdr.tab"] ? { space: term.labels["herdr.space"], tab: term.labels["herdr.tab"] } : null;
}
// An agent that waits for the person: stopped on its own dialog (a permission, a question), or at rest while
// its task is still In progress (it stopped without finishing, most often to ask something).
// ponytail: a resting agent shows "waiting" for a moment right after a start or a Send back, until it takes its message.
// `limit`: that resting agent's screen says it ran into a usage limit (follow()), which is why it stopped.
const waits = (card, at, limit) => at?.blocked ? "needs you" : at?.resting && card.column === "progress" ? (limit ? "hit a limit" : "waiting") : null;
// Reply and terminal links focus the agent's existing tab, including when it needs an answer.
const goTo = at => { if (at.pane) run("pane.focus", { pane: at.pane }); else { run("space.select", { id: at.space }); run("tab.select", { id: at.tab }); } };
// What an opened task shows as its description and, apart from it, as the agent's result: once a task
// waits for review (or is done), its "## Result" section and its longer write-up ("## Details") are read
// on their own, and the description is shown and edited without them.
function parts(card) {
  const full = description(card.text), split = ["review", "done", "archive"].includes(card.column) ? splitResult(full) : null;
  return split?.found ? { body: split.body, answer: split.result, details: split.details, split: true } : { body: full, answer: "", details: "", split: false };
}
// How a status lists its cards. The working statuses go by the places people give them (parse.js
// byOrder); Done and the Archive are a record, so the one finished last is on top: by the file's last
// change, which for a done task is when it was done (or last touched since).
const PLACED = id => id !== "done" && id !== "archive";
const listed = id => PLACED(id) ? byOrder : (a, b) => b.changed - a.changed || byOrder(a, b);
const DOT = { backlog: "dim", ready: "accent", progress: "working", review: "blocked", done: "done" };

export default class Board extends View {
  init(_props, cx) {
    this.cards = []; this.agents = []; this.picks = [];
    this.models = MODELS; // per agent key: see refresh()
    this.started = []; this.linked = null; this.offers = []; this.released = new Set(); this.limits = new Map(); // follow()
    this.keys = cx.focus_handle(); // Esc: see escape()
    this.query = InputState.new({ placeholder: "Search tasks" });
    for (const event of ["change", "submit"]) this.query.on(event, (_e, cx) => cx.notify());
    // While the search field has the keyboard, what is in it is also looked at four times a second, so the
    // board follows the typing even where a change is not announced. Redraws only when the text differs.
    this.query.on("focus", () => { this.searching = true; });
    this.query.on("blur", () => { this.searching = false; });
    cx.timer.every(250, cx => { if (this.searching && this.query.value() !== this.searched) cx.notify(); });
    try { this.view = { rows: false, closed: [], start: "ask", open: "go", archive: "off", back: "stay", ...JSON.parse(localStorage.getItem("view") ?? "{}") }; }
    catch { this.view = { rows: false, closed: [], start: "ask", open: "go", archive: "off", back: "stay" }; }
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // A menu or confirm choice comes back as "pick-<n>": status-menu and confirm only run commands.
    // At most 5 s per wait, so a reload's old build ends at its next cx use (as the shipped mods).
    cx.spawn(async cx => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        if (c.startsWith("pick-")) this.picks[Number(c.slice(5))]?.(cx);
        else if (c.startsWith("done-")) this.accept(this.offers[Number(c.slice(5))], cx);
      }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  watch(dir, cx) {
    if (this.watched === dir) return;
    this.watched = dir;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context && this.watched === dir) { await watchFolder(dir); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context && this.watched === dir) this.watched = null; }
    });
  }

  refresh(cx) {
    // Hidden copies keep their timers: don't read 200 files for a closed column. render() catches up.
    if (find(layout(), "board")?.hidden) { this.stale = true; return; }
    this.stale = false;
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      this.context = { key: next, cwd, on };
      this.cards = []; this.shown = null; this.endEdit(); closeForm(this); this.closeBack(); this.question = null; this.root = null; this.dir = null; this.error = null; this.capped = false;
      this.loaded = false; this.loading = false; this.again = false; this.watched = null;
    }
    if (!cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const top = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, on }).catch(() => null);
        const [topLine, common] = top?.code === 0 ? top.stdout.trim().split(/\r?\n/).map(line => line.trim()) : [];
        const root = topLine || cwd;
        // The repo's own name, also in a linked worktree (its folder is named after the branch): task ids start with it.
        const repo = repoName(common, root);
        const found = await list(root, on);
        // The ids already handed out in this repo (parse.js counterPath()): local only, like every write.
        const counter = on ? null : { path: counterPath(common ?? "", `${root}/${found?.dir ?? "to-do"}`) };
        if (counter) counter.text = await readTextFile(counter.path).catch(() => null);
        const { files, capped } = pick(found?.paths ?? [], found?.times ?? {});
        const cards = (await Promise.all(files.map(async rel => {
          const path = `${root}/${found.dir}/${rel}`;
          const text = await readTextFile(path, { on }).catch(() => null);
          return text === null ? null : { rel, path, root, task: `${found.dir}/${rel}`, text, changed: found.times[rel] ?? 0, ...parse(text, rel) };
        }))).filter(Boolean);
        const agents = await knownAgents({ on }).catch(() => this.agents);
        // Codex's models, from its own cache on this machine. Read once: it changes with a Codex update, not while we look.
        if (!on && this.models === MODELS) this.models = { ...MODELS, codex: codexModels(await readTextFile(`${home()}/.codex/models_cache.json`).catch(() => null) ?? "") };
        if (!this.current(context)) return;
        this.root = root; this.repo = repo; this.names = found?.paths ?? []; this.dir = found?.dir ?? null; this.counter = counter; this.cards = cards; this.capped = capped; this.agents = agents;
        this.error = null; this.loaded = true;
        // A task the New panel has just written (form.js): if it was made Ready with an agent, it has landed there like a moved card.
        // Done and its file untouched for as long as ⚙ says: off to the archive, a few per refresh (each write brings the next refresh).
        const after = { "1h": 3600e3, "1d": 86400e3, "7d": 604800e3 }[this.view.archive];
        if (after && !on) for (const card of cards.filter(c => c.column === "done" && c.changed && Date.now() - c.changed > after).slice(0, 5)) this.write(card, setStatus(card.text, ARCHIVE.word), cx);
        const made = this.justMade && cards.find(c => c.rel === this.justMade);
        if (made) { this.justMade = null; this.landed(made, cx); }
        // Once, the first time the board has something to show: the setup panel (setup.js). Closing it is what ends "first".
        if (!this.setup && !localStorage.getItem("setup")) openSetup(this, cx);
        if (found && !on) this.watch(`${root}/${found.dir}`, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) { this.loading = false; if (this.again) { this.again = false; this.refresh(cx); } }
        cx.notify();
      }
    });
  }

  // Writes only if the file is still what the card was read from; `then` runs after a successful write.
  write(card, next, cx, then, failed) {
    cx.spawn(async cx => {
      try { await writeTextFile(card.path, next, card.text); }
      catch (e) {
        notify({ title: "Task not changed", body: `${card.title} changed on disk, reloaded (${String(e).split("\n")[0]})`, level: "warning" });
        this.refresh(cx);
        failed?.(cx);
        return;
      }
      Object.assign(card, { text: next }, parse(next, card.rel));
      cx.notify();
      then?.(cx);
    });
  }

  // A card has just landed in Ready, or got its agent there, through the board: ask, send the agent or
  // leave it, as chosen in ⚙ (view.start). Only for what the board itself did: a file that turns Ready
  // on disk (an agent's own task, a pull) never starts anything.
  landed(card, cx) {
    const agent = card.column === "ready" ? this.installed(card) : null;
    if (!agent || this.view.start === "off") return;
    // "Right away" still asks when another agent is at work in this checkout: see ask().
    if (this.view.start === "auto" && !this.busy(card).length) this.start(card, agent, cx); else this.ask(card, agent, cx);
  }

  // The agent a Start button would send: installed, no manual notice, and the task not started yet.
  startable(card) {
    return card.column === "backlog" || card.column === "ready" ? this.installed(card) : null;
  }

  installed(card) {
    return card.manual ? null : this.agents.find(a => a.key === card.agent && a.installed) ?? null;
  }

  // The status a card is shown under. It is the file's, with one exception: an agent writes "In review" as
  // its last action and then still prints its summary, so a card whose file says Review while its own agent
  // is still working stays under In progress until that agent comes to rest. Only the place on the board
  // differs; the file is untouched and says Review all along. The same holds for a reply typed in that
  // agent's terminal later: while it works on the answer the card is back under In progress, and it
  // returns to Review when the agent rests again.
  where(card) {
    return card.column === "review" && tabOf(card)?.working ? "progress" : card.column;
  }

  // The other tasks of this checkout whose agents are working right now. Every started agent works in
  // the repo's one working tree, so two at once can undo each other's edits.
  busy(card) {
    return this.cards.filter(c => c !== card && c.root === card.root && c.agent && tabOf(c)?.working).map(c => c.id || c.title);
  }

  // Always asked, never a side effect of a move. Cancel leaves the card where it is.
  ask(card, agent, cx) {
    const busy = this.busy(card);
    const model = this.modelFor(card, agent);
    this.question = { title: `Send ${agent.name}${model ? ` (${model})` : ""} after ${card.id || "this task"}?`, yes: "Send",
      detail: `${card.title}. It opens in a new tab and the card moves to In progress.${busy.length ? ` Mind: the agent on ${busy.join(", ")} is still working in this same checkout, and two agents editing one working tree can undo each other's changes.` : ""}`, run: cx => this.start(card, agent, cx) };
    this.keys.focus();
    cx.notify();
  }

  // The model a task's agent is started on: the task's own, else that agent's default from ⚙, else "" (the agent's own).
  modelFor(card, agent) {
    return MODEL_FLAG[agent.key] ? card.model || this.view.models?.[agent.key] || "" : "";
  }

  // The In progress write is the guard against double starts: if it is rejected, nothing starts.
  start(card, agent, cx, back = false) {
    this.write(card, setStatus(card.text, "In progress"), cx, () =>
      {
        // The agents already there, so the one that now appears under this tab name is known to be the new one.
        this.started.push({ name: tabName(card), path: card.path, known: new Set(agents().map(a => a.address)), at: Date.now() });
        const here = spaces().find(s => s.active)?.tabs?.find(tab => tab.active)?.id;
        run("tab.new", { name: tabName(card), folder: card.root, argv: withModel(agent.run, agent.key, this.modelFor(card, agent)), task: startPrompt(card.task, back) });
        // ⚙: go to the agent's new tab (the default, and what tab.new does) or stay on the board. tab.new cannot
        // open a tab behind this one, so staying is selecting the tab we were on again.
        if ((back ? this.view.back : this.view.open) === "stay" && here) run("tab.select", { id: here });
      });
  }

  // A card to another status, from the menu, the opened task or a drop (`text`: the card's text with what
  // else that move writes). Done is accepting it: the same as Mark as done, so its agent's tab closes too.
  move(card, c, cx, text = card.text) {
    if (c.id === "done") this.finish(card, cx, text); else this.write(card, setStatus(text, c.word), cx, cx => this.landed(card, cx));
  }

  // The card's menu: where to move it, and who is on it. Each under its own heading.
  menu(card) {
    const items = [], agent = this.installed(card);
    this.picks = [];
    const add = (label, pick, more) => items.push({ label, ...more, action: [`kanbaa.pick-${this.picks.push(pick) - 1}`, {}] });
    const head = label => items.push({ header: true, label });
    if (card.column === "ready" && agent) add(`Start ${agent.name}…`, cx => this.ask(card, agent, cx));
    head("Move to");
    for (const c of COLUMNS) if (c.id !== card.column) add(c.label, cx => this.move(card, c, cx));
    head("Agent");
    for (const a of this.agents.filter(a => a.installed)) add(a.name, cx => this.write(card, setAgent(card.text, a.key), cx, cx => this.landed(card, cx)), { current: a.key === card.agent });
    add("Unassigned", cx => this.write(card, setAgent(card.text, ""), cx), { current: !card.agent });
    // As tall as its rows (a heading is a little lower than an item), up to a height it scrolls past.
    const height = Math.min(items.reduce((sum, it) => sum + (it.header ? 24 : 28), 12), 420);
    openOverlay({ mod: "status-menu", kind: "popup", width: 240, height, props: { items } });
  }

  card(t, card, readonly) {
    const agent = card.agent ? this.agents.find(a => a.key === card.agent) : null;
    const go = this.startable(card), at = card.agent ? tabOf(card) : null;
    // Where it stands among the cards shown under the same status: the top one cannot go up, the bottom one not down.
    const same = this.cards.filter(c => this.where(c) === this.where(card)).sort(byOrder);
    const first = same[0]?.rel === card.rel, last = same.at(-1)?.rel === card.rel;
    // The file can say In review a moment before the agent's turn has really ended: the spinner is the terminal's word on it.
    const working = Boolean(at?.working), wait = waits(card, at, this.limits.get(card.path));
    // Dragging (this.drag, see drop()): the card being dragged dims, the one it would land beside shows a line on that side.
    const col = this.where(card), d = this.drag?.moved ? this.drag : null;
    return v_flex().id(`card-${card.rel}`).relative().flex_none().p(10).gap(5).rounded(8).bg(t.surface).border_1().border_color(t.border).cursor_pointer().hover(s => s.bg(t.hover))
      .when(d?.rel === card.rel, el => el.opacity(0.5))
      .when(d && d.over.rel === card.rel && d.rel !== card.rel, el => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent)
        .when(d.over.after, line => line.bottom(0)).when(!d.over.after, line => line.top(0))))
      // A press that no button on the card took starts a drag; it stays a click until the pointer has moved 4px.
      .when(!readonly && col !== "archive", el => el
        .on_mouse_down("left", e => {
          this.dragged = false;
          if (this.shown || this.form || this.setup || this.back || this.question) return; // under a panel: no drags
          this.drag = { rel: card.rel, at: e.position, moved: false, over: { col, rel: card.rel } };
          this.keys.focus(); // Esc cancels
        })
        // Done lists by last change: a drop there has no place, only the status.
        .on_mouse_move((e, cx) => this.dragOver(e, PLACED(col) ? { col, rel: card.rel, after: (e.local_position?.y ?? 0) >= (e.bounds?.height ?? 0) / 2 } : { col }, cx))
        .on_mouse_up("left", (_e, cx) => this.drop(cx)))
      .on_click((_e, cx) => { if (this.dragged) return; this.endEdit(); this.pick = null; this.peek = null; this.shown = card.rel; this.keys.focus(); cx.notify(); })
      .when(!readonly, el => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(card); }))
      .child(h_flex().gap(6).items_start()
        .child(v_flex().flex_1().min_w(0).when(Boolean(card.id), el => el.child(div().text_size(10.5).text_color(t.dim).child(card.id)))
          .child(div().font_medium().text_color(t.foreground).child(card.title)))
        // Its place in the status: one up, one down.
        .when(!readonly && PLACED(this.where(card)), el => el.children([["up", "▲", -1], ["down", "▼", 1]].map(([way, sign, delta]) => (delta < 0 ? first : last) ? div().w(16).flex_none() // no button, its room kept so the other one stays put
          : div().id(`${way}-${card.rel}`).w(16).h(20).flex_none().flex().items_center().justify_center().rounded(4).text_size(8).text_color(t.dim)
            .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip(`Move ${way}`).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.moveBy(card, delta, cx); }).child(sign))))
        .when(!readonly, el => el.child(div().id(`more-${card.rel}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .hover(s => s.bg(t.raised).text_color(t.foreground)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.menu(card); }).child("⋯"))))
      .when(Boolean(card.note), el => el.child(div().text_size(11).text_color(t.dim).child(card.note)))
      .when(Boolean(card.agent || card.boxes || card.manual || working || (!readonly && ["review", "done", "archive"].includes(card.column))), el => el.child(h_flex().gap(6).items_center().text_size(11).text_color(t.muted)
        .when(Boolean(agent?.icon), el => el.child(agent.tint ? svg(agent.icon).size(13).flex_none() : image(agent.icon).w(13).h(13).flex_none()))
        // The agent's name goes to its tab while that tab exists.
        .child(h_flex().flex_1().min_w(0).child(div().id(`agent-${card.rel}`).min_w(0).truncate().child(`${agent?.name ?? card.agent}${card.model && card.agent ? ` · ${card.model}` : ""}`)
          .when(Boolean(at), el => el.cursor_pointer().hover(s => s.text_color(t.accent)).tooltip("Go to its tab")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { cx.stop_propagation(); goTo(at); }))))
        .when(working, el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900).tooltip("Its agent is still working")))
        // Its file already says Review: the agent is writing its last words. Not once it has rested
        // (this.released, see follow()): working again then means it was replied to in its terminal.
        .when(working && card.column === "review" && !this.released.has(card.path), el => el.child(div().flex_none().text_color(t.dim).child("finishing")))
        .when(card.boxes > 0, el => el.child(div().flex_none().child(`${card.ticked}/${card.boxes}`)))
        .when(card.manual, el => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_color(t.blocked).child("manual")))
        // Its agent waits for the person: say so, and offer its terminal.
        .when(Boolean(wait), el => el.child(div().flex_none().text_color(wait === "waiting" ? t.dim : t.blocked).child(wait))
          .child(div().id(`reply-${card.rel}`).px(8).h(24).flex_none().flex().items_center().rounded(6).text_color(t.muted)
            .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip("Answer in its terminal").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); goTo(at); }).child("Reply")))
        // The sheepdog, bottom right: send the agent after this task. Asks first, like every Start button.
        .when(!readonly && Boolean(go), el => el.child(div().id(`go-${card.rel}`).w(28).h(28).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .hover(s => s.bg(t.raised).text_color(t.accent)).tooltip(`Send ${go.name} after this task`).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.ask(card, go, cx); }).child(svg("mods/kanbaa/dog.svg").size(19))))
        // In Review: accept it from the board, the same as the opened task's "Mark as done" (finish() asks first if its agent still works).
        .when(!readonly && card.column === "review", el => el.child(div().id(`done-${card.rel}`).w(28).h(28).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .hover(s => s.bg(t.raised).text_color(t.done)).tooltip("Mark as done").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.finish(card, cx); }).child(svg("mods/kanbaa/done.svg").size(16))))
        // Done: put it away. Archived: bring it back to Done.
        .when(!readonly && card.column === "done", el => el.child(div().id(`archive-${card.rel}`).w(28).h(28).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip("Send to archive").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.write(card, setStatus(card.text, ARCHIVE.word), cx); }).child(svg("mods/kanbaa/archive.svg").size(16))))
        .when(!readonly && card.column === "archive", el => el.child(div().id(`restore-${card.rel}`).px(8).h(24).flex_none().flex().items_center().rounded(6).text_color(t.muted)
          .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip("Back to Done").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.write(card, setStatus(card.text, "Done"), cx); }).child("Restore")))));
  }

  // The New task panel, opened with a status (the header's New: Backlog; a status's own +: that status)
  // and the agent chosen for new tasks in ⚙, when it is still installed.
  newTask(status, cx) {
    const installed = this.agents.filter(a => a.installed);
    openForm(this, { root: this.root, dir: this.dir, id: nextId(this.repo, this.names, issuedIn(this.counter?.text, this.repo)), status,
      agent: installed.find(a => a.key === this.view.agent)?.key ?? "", agents: installed.map(a => ({ key: a.key, name: a.name })), models: this.models, defaults: this.view.models ?? {} }, cx);
  }

  // One place up or down in its status. Places are numbers in the files (their Order lines): the status's
  // cards are numbered as they then stand, and each card whose number changes is rewritten. The first move
  // in a status therefore writes all of its cards once; later ones, the two that swap.
  moveBy(card, delta, cx) {
    const same = this.cards.filter(c => this.where(c) === this.where(card)).sort(byOrder), from = same.findIndex(c => c.rel === card.rel), to = from + delta;
    if (from < 0 || to < 0 || to >= same.length) return;
    same.splice(to, 0, same.splice(from, 1)[0]);
    same.forEach((c, place) => { if (c.order !== place) this.write(c, setOrder(c.text, place), cx); });
  }

  // Drag and drop, by hand: Herdr gives a press, moves over the element under the pointer (no button
  // state) and a release. this.drag: { rel, at, moved, over: { col, rel?, after? } }. A release outside
  // the board is never seen, so leaving the board, Esc or a press elsewhere cancels (render()).
  dragOver(e, over, cx) {
    const d = this.drag;
    if (!d || (!d.moved && Math.hypot(e.position.x - d.at.x, e.position.y - d.at.y) < 4)) return;
    if (d.moved && d.over.col === over.col && d.over.rel === over.rel && d.over.after === over.after) return;
    d.moved = true; d.over = over;
    cx.notify();
  }

  cancelDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
  }

  // The release. Onto another status: its Status line, as the menu writes it (and landed() after it).
  // Onto a card, or into another placed status: the Order lines too, as moveBy() numbers them. A card
  // that changes both gets one write, since each write names the text it was read from.
  drop(cx) {
    const d = this.drag;
    this.drag = null;
    if (!d?.moved) return; // a plain click: on_click opens the card
    this.dragged = true; // the click that follows a release on the card itself is not one
    cx.notify();
    const card = this.cards.find(c => c.rel === d.rel), to = COLUMNS.find(c => c.id === d.over.col);
    if (!card || !to || d.over.rel === card.rel) return; // let go on itself: nothing moves
    const moved = to.id !== this.where(card);
    if (!PLACED(to.id)) { if (moved) this.move(card, to, cx); return; }
    const same = this.cards.filter(c => this.where(c) === to.id).sort(byOrder), next = dropOrder(same, card, d.over.rel, d.over.after);
    if (!moved && next.every((c, place) => c === same[place])) return; // dropped where it was
    next.forEach((c, place) => {
      const text = c.order !== place ? setOrder(c.text, place) : c.text;
      if (c === card && moved) this.move(card, to, cx, text);
      else if (text !== c.text) this.write(c, text, cx);
    });
  }

  // Notes that this id has been handed out, so that it is not given again when its task is deleted.
  // A failed write costs nothing today: the id is still unique among the files that exist.
  issued(id, cx) {
    const counter = this.counter, next = counter && id ? issue(counter.text, id) : null;
    if (!next) return;
    cx.spawn(async () => { try { await writeTextFile(counter.path, next, counter.text); counter.text = next; } catch { /* another window got there: the next refresh reads it */ } });
  }

  // Esc closes the topmost thing that is open, one at a time. False when nothing was.
  escape(cx) {
    if (this.drag) this.drag = null;
    else if (this.question) this.question = null;
    else if (this.back) this.closeBack();
    else if (this.form) closeForm(this);
    else if (this.setup) { this.setup = null; localStorage.setItem("setup", "1"); }
    else if (this.edit) { this.queueSave(this.edit.rel, this.edit.field, this.edit.input.value(), cx); this.endEdit(); }
    else if (this.pick) this.pick = null;
    else if (this.peek) this.peek = null;
    else if (this.shown) this.shown = null;
    else if (this.query.value()) this.query.set_value("");
    else return false;
    cx.notify();
    return true;
  }

  archiveAll(cx) {
    const done = this.cards.filter(card => card.column === "done");
    this.question = { title: `Send ${done.length} done ${done.length === 1 ? "task" : "tasks"} to the archive?`, yes: "Archive",
      detail: "They leave the board and stay in its Archive, from where each can be restored.", run: cx => { for (const card of done) this.write(card, setStatus(card.text, ARCHIVE.word), cx); } };
    this.keys.focus();
    cx.notify();
  }

  // A yes-or-no question inside the board's outline (this.question: { title, detail, yes, run(cx) }),
  // for everything that starts an agent or deletes a file. Nothing runs until its button is pressed.
  asked(t) {
    const q = this.question, done = (_e, cx) => { this.question = null; cx.notify(); };
    const button = (id, text, primary) => div().id(id).px(12).h(28).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover(s => s.opacity(0.88)).child(text);
    return this.over(t, "board-question", done, v_flex().px(14).pt(12).pb(10).gap(8)
      .child(div().text_size(14).font_semibold().child(q.title))
      .child(div().text_size(12).text_color(t.muted).child(q.detail))
      .child(h_flex().pt(4).gap(8).justify_end()
        .child(button("question-no", "Cancel").on_click(done))
        .child(button("question-yes", q.yes, true).on_click((e, cx) => { done(e, cx); q.run(cx); }))));
  }

  // A panel over the board, inside its outline: the board dims and takes no clicks; one beside the panel runs `close`.
  over(t, id, close, panel, width = 420, tall = false) {
    // A tall panel takes the board's height and scrolls its own middle (task()): a panel taller than the board did not scroll here.
    if (tall) return div().id(`${id}-backdrop`).absolute().inset_0().bg("#00000099").on_click(close ?? (() => {}))
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().absolute().inset_0().items_center().p(14)
        .child(panel.id(id).flex_1().min_h(0).w_full().max_w(width).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
          .on_click((_e, cx) => cx.stop_propagation())));
    // The backdrop scrolls when the panel is taller than the board, so its buttons are always reachable;
    // the two springs keep a shorter panel in the middle and give a taller one its margin.
    return div().id(`${id}-backdrop`).absolute().inset_0().bg("#00000099").on_click(close ?? (() => {}))
      // Let the panel's scroll containers handle the wheel first, then keep it off the board.
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id(`${id}-scroll`).absolute().inset_0().items_center().px(14).overflow_y_scrollbar()
      .child(div().flex_1().min_h(14))
      .child(panel.id(id).flex_none().w_full().max_w(width).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
        .on_click((_e, cx) => cx.stop_propagation()))
      .child(div().flex_1().min_h(14)));
  }

  // Deletes the task's file, after asking. Git can bring back a committed file; nothing else can.
  remove(card, cx) {
    const run = cx => cx.spawn(async cx => {
      this.issued(card.id, cx); // a task from before the counter: its number is noted before it goes
      const r = await (window()?.platform === "windows"
        ? exec("powershell", ["-NoProfile", "-Command", "Remove-Item -LiteralPath '" + card.path.replace(/['‘’‚‛]/g, "$&$&") + "' -ErrorAction Stop"])
        : exec("rm", ["--", card.path])).catch(e => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) notify({ title: "Task not deleted", body: (r.stderr || "").trim().split("\n")[0], level: "error" });
      else if (this.shown === card.rel) { this.endEdit(); this.shown = null; }
      this.refresh(cx);
      cx.notify();
    });
    this.question = { title: `Delete ${card.id || "this task"}?`, yes: "Delete",
      detail: `This deletes ${card.task} from disk. If it was never committed, it cannot be brought back.`, run };
    this.keys.focus();
    cx.notify();
  }

  // Runs on render (agents and terminals are live data). Two jobs:
  // - a freshly started agent's terminal gets its task's label, once, when it first shows up;
  // - when a labelled terminal goes while its task waits in Review, one question: "mark it Done?".
  //   Asked, never assumed: a tab can close by accident. With the board hidden the question waits until
  //   it is shown, which is also when a click on the toast can reach this copy.
  follow(cx) {
    for (const s of this.started.splice(0)) {
      const a = agents().find(a => a.tab_name === s.name && !s.known.has(a.address));
      if (a) hc(["label", a.address, `${TASK}=${s.path}`]).catch(() => {});
      else if (Date.now() - s.at < 60000) this.started.push(s);
    }
    const all = terminals();
    if (!all.length) return; // nothing known yet (or the core is away): not "every agent has closed"
    // A task in Review whose agent has come to rest (or has none) has finished its round: from then on
    // its card no longer says "finishing" when that agent works again. Leaving Review arms it again.
    for (const card of this.cards) {
      if (card.column !== "review") this.released.delete(card.path);
      else if (!tabOf(card)?.working) this.released.add(card.path);
      // An agent at rest on a task still In progress: its screen is read once per rest, to tell a usage
      // limit from a plain stop. Forgotten when it works again or the card moves on.
      const at = card.column === "progress" ? tabOf(card) : null;
      if (!at?.resting) this.limits.delete(card.path);
      else if (!this.limits.has(card.path)) {
        this.limits.set(card.path, false);
        cx.spawn(async cx => {
          const r = await hc(["read", "--json", at.terminal, "--lines", "0"]).catch(() => null);
          try { if (r?.code !== 0 || !this.limits.has(card.path) || !hitLimit(String(JSON.parse(r.stdout).text))) return; } catch { return; }
          this.limits.set(card.path, true);
          cx.notify();
        });
      }
    }
    const now = new Map(all.filter(term => term.labels?.[TASK] && live(term)).map(term => [term.address, term.labels[TASK]]));
    for (const [address, path] of this.linked ?? []) {
      const card = now.has(address) ? null : this.cards.find(c => c.path === path);
      if (!card || card.column !== "review") continue;
      const s = { path: card.path, rel: card.rel, label: card.id || card.title };
      notify({ title: `${s.label}: its agent has closed`, body: "Click to mark the task Done", timeout: 20000, action: { name: `kanbaa.done-${this.offers.push(s) - 1}` } });
    }
    this.linked = now;
  }

  // The toast was clicked. Only if the task is still in Review: it may have been moved since.
  accept(s, cx) {
    if (!s) return;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(s.path);
        if (text !== null && parse(text, s.rel).column === "review") await writeTextFile(s.path, setStatus(text, "Done"), text);
      } catch (e) { notify({ title: "Task not changed", body: `${s.label} changed on disk (${String(e).split("\n")[0]})`, level: "warning" }); }
      this.refresh(cx);
    });
  }

  // A file from the task's Result, read into the opened task's viewport (this.peek): Markdown rendered,
  // anything else as plain text. Shown here and not handed to the system: the list is the agent's, and
  // opening whatever it names with its default program would run a script as readily as show a page.
  openResult(card, path, cx) {
    this.endEdit();
    const peek = this.peek = { rel: card.rel, path, text: null, error: null }, fence = "`".repeat(5);
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(/^([a-z]:[\\/]|\/)/i.test(path) ? path : `${card.root}/${path}`, { on: this.context?.on ?? undefined });
        if (text === null) peek.error = "This file is not there";
        else if (text.includes("\0")) peek.error = "Not a text file. Open it from Files.";
        else {
          const shown = text.length > 100000 ? `${text.slice(0, 100000)}\n… (file truncated)` : text;
          peek.text = /\.(md|markdown)$/i.test(path) ? shown || " " : `${fence}\n${shown}\n${fence}`;
        }
      } catch { peek.error = "Cannot show this file (not text, too large, or unreadable)"; }
      cx.notify();
    });
    cx.notify();
  }

  // Accepting a task in Review: Done in the file, then its agent's tab closes, since the work is taken.
  // An agent that is still working is asked about first.
  finish(card, cx, text = card.text) {
    const at = card.agent ? tabOf(card) : null;
    const done = cx => this.write(card, setStatus(text, "Done"), cx, cx => {
      if (at?.tab) run("tab.close", { id: at.tab });
      // Accepted: nothing left to look at.
      if (this.shown === card.rel) { this.endEdit(); this.pick = null; this.peek = null; this.details = null; this.shown = null; cx.notify(); }
    });
    if (!at?.working) return void done(cx);
    this.question = { title: `${card.id || "This task"}: its agent is still working`, detail: "Mark the task Done and close the agent's tab anyway?", yes: "Mark as done", run: done };
    cx.notify();
  }

  // Sending a task in Review back (this.back: { rel, input }): the other answer to "Mark as done".
  openBack(card, cx) {
    this.closeBack();
    const back = this.back = { rel: card.rel, input: TextareaState.new({ placeholder: "What should change? (optional)" }) };
    back.input.set_auto_grow(4, 10);
    // Enter sends, as the button does; Shift+Enter is left to the field. The note is one line in the file anyway (addFeedback()).
    back.input.on("submit", (ev, cx) => {
      const now = this.cards.find(c => c.rel === back.rel);
      if (ev.shift || this.back !== back || back.sent || !now) return;
      back.sent = true; // a held Enter sends once
      this.sendBack(now, cx);
    });
    back.input.focus();
    // Again once the panel is on screen: a field focused before it is drawn does not always keep the keyboard.
    cx.timer.after(150, () => { if (this.back === back) back.input.focus(); });
    cx.notify();
  }

  closeBack() {
    this.back?.input.release();
    this.back = null;
  }

  // The note goes into the file (a dated line under "## Feedback"), the card to In progress, and then
  // the agent hears of it: one that is still there and idle gets a line typed into its terminal
  // (hc send, only when the agent reports idle or done: nothing is typed into a working or blocked
  // program, and never into a plain shell, which is no agent here); one whose tab is gone is offered again, with the usual question.
  sendBack(card, cx) {
    const origin = focused(), stay = this.view.back !== "go";
    const note = this.back.input.value().trim(), at = card.agent ? tabOf(card) : null, label = card.id || card.title;
    const next = setStatus(note ? addFeedback(card.text, note, today()) : card.text, "In progress");
    const back = this.back;
    this.write(card, next, cx, cx => {
      this.closeBack();
      if (stay) this.keys.focus();
      if (this.shown === card.rel) { this.endEdit(); this.pick = null; this.peek = null; this.details = null; this.shown = null; }
      cx.notify();
      if (at?.terminal) {
        if (!stay) goTo(at);
        cx.spawn(async cx => {
          // Typed only to an agent at rest. Its status is read here and not left to hc's --if idle: an agent that
          // has finished reports "done", not "idle", and would be refused. hc itself still holds back from a blocked program.
          const r = at.resting ? await sendBackMessage({ hc, agents, sleep: ms => cx.sleep(ms) }, at.terminal, backPrompt(card.task)).catch(e => ({ code: 1, stderr: String(e) })) : { code: 1 };
          if (stay) restoreBoard({ focused, run, focusBoard: () => this.keys.focus() }, origin, at);
          if (r.code !== 0) notify({ title: `${label}: its agent was not told`, body: "It is busy or waiting for you. The note is in the task file: ask it to read the Feedback section.", level: "warning", timeout: 12000 });
        });
        return;
      }
      const agent = this.installed(card);
      if (agent) {
        this.question = { title: `Send ${agent.name} after ${label} again?`, yes: "Send",
          detail: "Its earlier tab is gone. A new one opens and starts with the feedback in the task file.", run: cx => this.start(card, agent, cx, true) };
      }
    }, () => { back.sent = false; }); // not written: Enter may try again
  }

  backPanel(t) {
    const b = this.back, card = this.cards.find(c => c.rel === b.rel);
    const button = (id, text, primary) => div().id(id).px(10).h(26).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover(s => s.opacity(0.88)).child(text);
    const cancel = (_e, cx) => { this.closeBack(); cx.notify(); };
    if (!card) return v_flex().p(14).child(button("back-cancel", "Close").on_click(cancel));
    const at = card.agent ? tabOf(card) : null;
    const then = at?.terminal ? (!at.resting ? "Its agent is busy, so nothing is typed to it; a toast will say so." : "Its agent is told to read it.") + (this.view.back === "go" ? " You are taken to its tab." : "")
      : this.installed(card) ? "Its agent's tab is gone: you are asked whether to send a new one." : "No agent is on it: it waits in In progress.";
    return v_flex().px(14).pt(12).pb(10).gap(8)
      .child(div().text_size(14).font_semibold().child(`Send ${card.id || "this task"} back`))
      // The whole box is the field: a click anywhere in it, also beside or under the text, puts the keyboard there.
      .child(v_flex().id("back-box").min_h(96).px(8).py(6).rounded(7).border_1().border_color(t.accent).bg(t.background).cursor_text()
        .on_click(() => { b.input.focus(); })
        .child(Textarea.new(b.input).w_full().text_size(12.8).text_color(t.foreground)))
      .child(div().text_size(11.5).text_color(t.dim).child(`Enter sends. The card goes back to In progress and the note is added to the task file under Feedback. ${then}`))
      .child(h_flex().pt(2).gap(8).justify_end()
        .child(button("back-cancel", "Cancel").on_click(cancel))
        .child(button("back-send", "Send back", true).on_click((_e, cx) => this.sendBack(card, cx))));
  }

  endEdit() {
    this.edit?.input.release();
    this.edit = null;
  }

  // A click on the opened task's title or description puts a field in its place (this.edit: { field,
  // input, was }). What is typed saves itself: a moment after the last key, on Enter in the title, and
  // when the field loses the keyboard, which also puts the text back.
  editField(card, field, cx) {
    this.endEdit();
    const was = field === "title" ? card.title : parts(card).body.replace(/\r\n/g, "\n");
    const input = field === "title" ? InputState.new({ value: was }) : TextareaState.new({ value: was });
    if (field === "text") input.set_auto_grow(3, 12); // as tall as what is typed, within the box's limits
    const e = this.edit = { field, input, rel: card.rel, gen: 0 };
    const save = cx => this.queueSave(e.rel, field, input.value(), cx);
    const leave = (_ev, cx) => { if (this.edit !== e) return; save(cx); this.endEdit(); cx.notify(); };
    input.on("change", (_ev, cx) => { const gen = ++e.gen; cx.timer.after(1500, cx => { if (this.edit === e && e.gen === gen) save(cx); }); });
    input.on("blur", leave);
    if (field === "title") input.on("submit", leave);
    input.focus();
    cx.notify();
  }

  // Typed text goes through one queue (this.queue: { rel, title?, text? }): a save in flight is
  // followed by the next, each written against the file as it then is.
  queueSave(rel, field, value, cx) {
    this.queue = { ...(this.queue?.rel === rel ? this.queue : {}), rel, [field]: value.replace(/\r\n/g, "\n").trim() };
    this.flush(cx);
  }

  flush(cx) {
    if (this.flushing || !this.queue) return;
    const q = this.queue, card = this.cards.find(c => c.rel === q.rel);
    this.queue = null;
    if (!card) return;
    let next = card.text;
    if (q.title && q.title !== card.title) next = setTitle(next, q.title); // an emptied title is not a title: the old one stays
    const shown = parts(card);
    if (q.text !== undefined && q.text !== shown.body.replace(/\r\n/g, "\n")) next = shown.split ? setBody(next, q.text) : setDescription(next, q.text);
    if (next === card.text) return;
    this.flushing = true;
    this.write(card, next, cx, cx => { this.flushing = false; this.flush(cx); }, () => { this.flushing = false; });
  }

  // An opened card: a small panel over the board. Everything on it edits in place and saves itself:
  // the title and the description by a click (editField), status, agent and pickup by picking from the
  // list their fact opens. The id (the file name) and the file's other header lines are fixed.
  task(t, card, readonly) {
    const e = this.edit?.rel === card.rel ? this.edit : null, options = choices(this.agents.filter(a => a.installed || a.key === card.agent));
    if (card.column === "archive") options.status = [...options.status, { key: ARCHIVE.id, label: ARCHIVE.word }];
    // Model: only under an agent the board can start on one.
    const facts = MODEL_FLAG[card.agent] ? [...SELECTORS, ["model", "Model"]] : SELECTORS;
    options.model = modelChoices(this.models[card.agent] ?? [], card.model, this.view.models?.[card.agent]);
    const now = { status: card.column, agent: card.agent, pickup: card.manual ? "manual" : "agents", model: card.model };
    const close = (_e, cx) => { if (this.edit) this.queueSave(this.edit.rel, this.edit.field, this.edit.input.value(), cx); this.endEdit(); this.pick = null; this.peek = null; this.details = null; this.shown = null; cx.notify(); };
    const starter = this.startable(card), files = results(card.text).filter(path => path !== card.task), peek = this.peek?.rel === card.rel ? this.peek : null;
    const { body, answer, details } = parts(card), open = this.details === card.rel, at = card.agent ? tabOf(card) : null;
    const button = (id, text, primary) => div().id(id).px(10).h(26).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover(s => s.opacity(0.88)).child(text);
    // A text box is as tall as its text, from a minimum up. A scrolling element has no height of its own
    // here (it takes its minimum and lets the text spill), so only a long text gets the fixed, scrolling box.
    // ponytail: "long" is guessed from the text, not measured; measure with on_size_change if the guess shows.
    const long = text => text.length > 900 || text.split(/\n/).length > 14;
    const sized = (el, text, min) => long(text) ? el.h(260).overflow_y_scrollbar() : el.min_h(min);
    const field = el => el.px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_color(t.foreground);
    // A pick writes at once, as the card's menu does. Landing in Ready with an agent follows the ⚙ setting.
    const set = { status: key => setStatus(card.text, COLUMNS.find(c => c.id === key).word), agent: key => setAgent(card.text, key), pickup: key => setManual(card.text, key === "manual"), model: key => setModel(card.text, key) };
    const choose = (id, key) => (_e, cx) => {
      this.pick = null;
      if (key === now[id]) { /* as it was */ }
      else if (id === "status" && key !== ARCHIVE.id) this.move(card, COLUMNS.find(c => c.id === key), cx);
      else this.write(card, set[id](key), cx, id === "pickup" || id === "model" ? undefined : cx => this.landed(card, cx));
      cx.notify();
    };
    const fact = ([id, name]) => v_flex().id(`fact-${id}`).flex_1().min_w(0).rounded(6)
      .when(!readonly, el => el.cursor_pointer().on_click((_e, cx) => { this.pick = this.pick === id ? null : id; cx.notify(); }))
      .child(label(t, name))
      .child(h_flex().gap(4).items_center().text_size(12.8).text_color(this.pick === id ? t.accent : t.foreground)
        .child(div().min_w(0).truncate().child(options[id].find(o => o.key === now[id])?.label ?? now[id]))
        .when(!readonly, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child("▾"))));
    // The description, in a box like the Result's.
    const about = el => el
      .child(div().flex_none().px(14).pt(10).pb(3).text_size(11.5).text_color(t.dim).child("Description"))
      .child(div().flex_none().px(14).child(e?.field === "text"
          ? v_flex().id("task-body").min_h(84).px(6).py(6).cursor_text().on_click(() => { e.input.focus(); }).rounded(7).border_1().overflow_hidden().border_color(t.accent).bg(t.background)
            .child(Textarea.new(e.input).w_full().px(8).text_size(13).text_color(t.foreground))
          : sized(v_flex().id("task-body").flex_none(), body, 84).px(14).py(8).rounded(7).border_1().overflow_hidden().border_color(t.border).bg(t.background)
            .when(!readonly, el => el.cursor_text().on_click((_e, cx) => this.editField(card, "text", cx)))
            .child(body ? TextView.markdown("task-text", body)
              : div().text_color(t.dim).child(readonly ? "No description" : "Click to add a description"))));
    // What the agent says it made (parse.js results()). A click on a file shows it in the viewport, in the result text's place.
    const made = el => el
      .when(files.length > 0 || Boolean(answer) || Boolean(details), el => el.child(v_flex().flex_none().px(14).pt(10).gap(4)
          .child(div().text_size(11.5).text_color(t.dim).child("Result"))
          // A clicked file takes the result text's place until "← Result"; the description stays as it is.
          .when(Boolean(peek), el => el.child(v_flex().id("task-peek").h(260).rounded(7).border_1().overflow_hidden().border_color(t.border).bg(t.background)
            .child(h_flex().px(14).h(28).flex_none().gap(8).items_center().text_size(11)
              .child(div().id("peek-back").flex_none().cursor_pointer().text_color(t.accent).on_click((_e, cx) => { this.peek = null; cx.notify(); }).child("← Result"))
              .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).child(peek.path)))
            .child(v_flex().id("peek-body").flex_1().min_h(0).px(14).pb(8).overflow_y_scrollbar()
              .child(peek.text === null ? div().text_size(12).text_color(t.dim).child(peek.error ?? "Loading…") : TextView.markdown("peek-text", peek.text).selectable(true)))))
          // As tall as its text: the panel scrolls, the answer does not.
          .when(Boolean(answer) && !peek, el => el.child(v_flex().id("task-answer").flex_none().min_h(40).px(14).py(8).rounded(7).border_1().border_color(t.border).bg(t.background)
            .child(TextView.markdown("task-answer-text", answer).selectable(true))))
          .child(v_flex().id("task-results").flex_none().gap(3).children(files.slice(0, 8).map((path, i) =>
            div().id(`result-${i}`).flex_none().truncate().text_size(12).text_color(peek?.path === path ? t.foreground : t.accent).cursor_pointer()
              .hover(s => s.text_color(t.foreground)).on_click((_e, cx) => this.openResult(card, path, cx)).child(path))))
          // The agent's longer write-up, folded until asked for.
          .when(Boolean(details), el => el
            .child(div().id("task-details").flex_none().pt(4).text_size(12).text_color(t.accent).cursor_pointer().hover(s => s.text_color(t.foreground))
              .on_click((_e, cx) => { this.details = open ? null : card.rel; cx.notify(); }).child(open ? "▾ Details" : "▸ Details"))
            .when(open, el => el.child(v_flex().id("task-details-body").flex_none().px(14).py(8).rounded(7).border_1().border_color(t.border).bg(t.background)
              .child(TextView.markdown("task-details-text", details).selectable(true)))))));
    // Wider than the other panels: it carries a description and a result. The backdrop's padding keeps it off the board's edges.
    // ponytail: "taller than the board" is guessed (Details open, or a long answer), not measured; measure with on_size_change if it shows.
    const tall = open || long(answer);
    return this.over(t, "task", close, v_flex()
        .child(h_flex().flex_none().px(14).pt(12).gap(8).items_start()
          .child(v_flex().flex_1().min_w(0).gap(2)
            .when(Boolean(card.id), el => el.child(div().text_size(11).text_color(t.dim).child(card.id)))
            .child(e?.field === "title" ? field(Input.new(e.input).h(30).text_size(14))
              : div().id("task-title").text_size(14).font_semibold().child(card.title)
                .when(!readonly, el => el.cursor_text().on_click((_e, cx) => this.editField(card, "title", cx)))))
          .child(div().id("task-close").w(22).h(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_size(12).text_color(t.muted)
            .hover(s => s.bg(t.hover)).on_click(close).child("✕")))
      // Everything between the title and the actions: in a tall panel this is what scrolls.
      .child((tall ? v_flex().id("task-scroll").flex_1().min_h(0).pb(4).overflow_y_scrollbar() : v_flex().flex_none())
        .child(h_flex().flex_none().px(14).gap(10).items_start().children(facts.map(fact)))
        // The open fact's choices, across the panel's width: in a narrow board there is no room under one fact.
        .when(Boolean(this.pick) && !readonly, el => el.child(div().flex_none().px(14).pt(6).child(v_flex().id("task-options").p(4).max_h(150).overflow_y_scrollbar().rounded(9).border_1().border_color(t.border).bg(t.raised).text_size(12.8)
          .children(options[this.pick].map(o => h_flex().id(`option-${o.key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click(choose(this.pick, o.key))
            .child(div().w(12).flex_none().text_color(t.accent).child(o.key === now[this.pick] ? "✓" : ""))
            .child(div().flex_1().min_w(0).truncate().child(o.label)))))))
        // The file's other header lines (Written, Repo, …): fixed.
        .when(card.meta.length > 0, el => el.child(v_flex().flex_none().px(14).pt(10).gap(2).text_size(11).text_color(t.dim)
          .children(card.meta.map(m => div().truncate().child(`${m.key}: ${m.value}`)))))
        .when(true, about).when(true, made))
      // Keep the path separate so every action can wrap within a narrow detail pane.
      .child(v_flex().px(14).py(10).gap(8).flex_none()
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(card.task))
        .child(h_flex().flex_wrap().gap(8).items_center().justify_end()
          .when(!readonly, el => el.child(button("task-delete", "Delete").text_color(t.blocked).on_click((_e, cx) => this.remove(card, cx))))
          // Only in a layout that has a Preview column (a node with id "preview" showing the preview mod).
          .when(Boolean(find(layout(), "preview")), el => el.child(button("task-preview", "Open in Preview").on_click((ev, cx) => {
            setShared("preview.file", { path: card.path, on: this.context?.on ?? null }); run("layout.show", { id: "preview" }); close(ev, cx);
          })))
          // Not yet started, with an installed agent and no manual notice: the same confirmed start as a move to Ready.
          .when(!readonly && Boolean(starter), el => el.child(button("task-start", h_flex().gap(5).items_center().child(svg("mods/kanbaa/dog.svg").size(13)).child("Start"), true)
            .on_click((_e, cx) => this.ask(card, starter, cx))))
          .when(!readonly && card.column === "review", el => el.child(button("task-back", "Send back").on_click((_e, cx) => this.openBack(card, cx))))
          // While its agent's terminal is there: the way to its tab, to read along, answer or ask. Says why when the agent waits.
          .when(Boolean(at), el => el.child(button("task-reply", `Reply in terminal${at.blocked ? ": needs you" : at.resting && this.limits.get(card.path) ? ": hit a limit" : ""}`).tooltip("Go to its tab").on_click(() => goTo(at))))
        .when(!readonly && card.column === "review", el => el.child(button("task-done", "Mark as done", true).on_click((_e, cx) => this.finish(card, cx)))))), 760, tall);
  }

  // How this copy lays the statuses out, kept across restarts: { rows, closed: [column ids] }.
  setView(change, cx) {
    Object.assign(this.view, change);
    localStorage.setItem("view", JSON.stringify(this.view));
    cx.notify();
  }

  render(cx) {
    if (this.stale || key() !== this.context?.key) this.refresh(cx);
    this.follow(cx);
    const t = theme(), readonly = Boolean(this.context?.on), { rows, closed } = this.view;
    const shown = this.shown ? this.cards.find(card => card.rel === this.shown) : null;
    const closeSetup = (_e, cx) => { this.setup = null; localStorage.setItem("setup", "1"); cx.notify(); };
    const empty = this.error || (!this.loaded ? "Loading tasks…" : !this.dir ? "No to-do folder in this repo" : !this.cards.length ? "No tasks" : null);
    const button = (id, label) => div().id(id).px(8).h(24).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12).text_color(t.muted)
      .hover(s => s.bg(t.hover)).child(label);
    const creates = !readonly && this.loaded && Boolean(this.root);
    this.searched = this.query.value();
    const query = this.searched.trim(), visible = query ? this.cards.filter(card => matches(card, query)) : this.cards;
    const archived = visible.filter(card => card.column === "archive").sort(listed("archive")), tab = this.tab ?? "board";
    const column = c => {
      const cards = visible.filter(card => this.where(card) === c.id).sort(listed(c.id)).map(card => this.card(t, card, readonly)), shut = closed.includes(c.id);
      const toggle = (_e, cx) => this.setView({ closed: shut ? closed.filter(id => id !== c.id) : [...closed, c.id] }, cx);
      // A status takes a dragged card: at its end, unless the pointer came by one of its cards (that card's side stays the place).
      const takes = el => readonly ? el : el.on_mouse_move((e, cx) => { if (this.drag && this.drag.over.col !== c.id) this.dragOver(e, { col: c.id }, cx); })
        .on_mouse_up("left", (_e, cx) => this.drop(cx))
        .when(this.drag?.moved && this.drag.over.col === c.id && !this.drag.over.rel, el => el.bg(t.hover));
      const dot = div().size(8).flex_none().rounded(4).bg(t[DOT[c.id]]), count = div().text_size(11).text_color(t.dim).child(String(cards.length));
      // Side by side, a collapsed status is a strip with its title turned a quarter.
      if (shut && !rows) return takes(v_flex().id(`col-${c.id}`).w(34).flex_none().h_full().pt(16).gap(7).items_center().rounded(10).bg(t.chrome).cursor_pointer()
        .hover(s => s.bg(t.hover)).on_click(toggle)).child(dot)
        .child(svg(`mods/kanbaa/label-${c.id}.svg`).w(16.9).h(LABEL[c.id] * 0.13).flex_none().text_color(t.foreground)).child(count);
      const box = takes(v_flex().id(`col-${c.id}`).gap(8).p(8).rounded(10).bg(t.chrome));
      return (rows ? box.flex_none() : box.flex_1().min_w(110).h_full().min_h(0))
        .child(h_flex().id(`head-${c.id}`).px(4).h(24).flex_none().gap(6).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover)).on_click(toggle)
          .child(dot).child(div().font_medium().child(c.label)).child(count)
          // Every done task to the archive at once. Asked first.
          .when(!readonly && c.id === "done" && cards.length > 0, el => el.child(div().flex_1()).child(div().id("archive-all").w(22).h(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
            .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip("Send all done tasks to the archive").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.archiveAll(cx); }).child(svg("mods/kanbaa/archive.svg").size(14))))
          // A new task straight into this status. Only where a task starts its life.
          .when(creates && (c.id === "backlog" || c.id === "ready"), el => el.child(div().flex_1()).child(div().id(`add-${c.id}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
            .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip(`New task in ${c.label}`).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.newTask(c.id, cx); }).child("+"))))
        .when(!shut && !cards.length && c.id === "backlog", el => el.child(div().px(4).text_size(11).text_color(t.dim).child("Nothing in the baacklog")))
        .when(!shut && (!rows || cards.length > 0), el => el.child(rows ? v_flex().gap(8).children(cards)
          : v_flex().id(`cards-${c.id}`).flex_1().min_h(0).gap(8).overflow_y_scrollbar().children(cards)));
    };
    return v_flex().id("board").track_focus(this.keys).on_key_down((e, cx) => { if (e.key === "escape" && this.escape(cx)) cx.stop_propagation(); })
      // A drag ends without a drop when the pointer leaves the board, presses outside it, or lets go where nothing takes a card.
      .on_hover((inside, cx) => { if (!inside) this.cancelDrag(cx); }).on_mouse_down_out((_e, cx) => this.cancelDrag(cx)).on_mouse_up("left", (_e, cx) => this.cancelDrag(cx))
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Kanbaa"))
        .child(h_flex().flex_none().gap(2).children([["board", "Board"], ["archive", archived.length ? `Archive ${archived.length}` : "Archive"]].map(([id, name]) =>
          div().id(`view-${id}`).px(8).h(24).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12)
            .bg(tab === id ? t.selected : t.background).text_color(tab === id ? t.foreground : t.muted).hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { this.tab = id; cx.notify(); }).child(name))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child([this.root?.split(/[\\/]/).pop(), readonly && `read-only on ${this.context.on}`, this.capped && "showing the 200 files changed last"].filter(Boolean).join(" · ")))
        .when(!readonly && this.loaded && Boolean(this.root), el => el.child(button("board-new", "+ New").tooltip(`New task in ${this.dir ?? "a new to-do folder"}`)
          .on_click((_e, cx) => this.newTask("backlog", cx))))
        .child(button("board-setup", "⚙").tooltip("Settings").on_click((_e, cx) => { this.keys.focus(); openSetup(this, cx); }))
        .child(button("board-view", rows ? "Columns" : "Rows").tooltip(rows ? "Statuses side by side" : "Statuses top to bottom").on_click((_e, cx) => this.setView({ rows: !rows }, cx)))
        .child(button("board-close", "✕").on_click(() => { run("layout.hide", { id: "board" }); })))
      // Search: every word typed must be in a task's id, title, agent or text. Board and Archive follow as you type.
      .when(this.cards.length > 0, el => el.child(h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().id("board-search").flex_1().min_w(0).cursor_text().on_mouse_down("left", () => { this.query.focus(); })
          .child(Input.new(this.query).w_full().h(26).px(8).rounded(6).border_1().border_color(query ? t.accent : t.border).bg(t.background).text_size(12.5).text_color(t.foreground)))
        .when(Boolean(query), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${visible.length} of ${this.cards.length}`))
          .child(button("board-search-clear", "Clear").on_click((_e, cx) => { this.query.set_value(""); cx.notify(); })))))
      .child(v_flex().id("board-body").relative().flex_1().min_h(0)
        // Where the pointer is while a card is dragged, for the copy of it that follows (below).
        .on_mouse_move((e, cx) => { const d = this.drag; if (d?.moved && e.local_position) { d.x = e.local_position.x; d.y = e.local_position.y; cx.notify(); } })
        .child(empty ? div().p(14).text_size(12).text_color(t.dim).child(empty)
          : tab === "archive" ? v_flex().id("board-archive").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar()
            .children(archived.length ? archived.map(card => this.card(t, card, readonly)) : [div().p(4).text_size(12).text_color(t.dim).child("Nothing in the archive. Done tasks go here from their archive button, or by themselves if ⚙ says so.")])
          : rows ? v_flex().id("board-rows").flex_1().min_h(0).p(10).gap(8).overflow_y_scrollbar().children(COLUMNS.map(column))
          : h_flex().id("board-columns").flex_1().min_h(0).p(10).gap(8).overflow_x_scrollbar().children(COLUMNS.map(column)))
        // One panel at a time, the topmost: a panel drawn over another scrolling one can come out underneath it.
        .when(Boolean(shown) && !this.form && !this.setup && !this.back && !this.question, el => el.child(this.task(t, shown, readonly)))
        .when(Boolean(this.setup) && !this.form && !this.question, el => el.child(this.over(t, "board-setup-panel", closeSetup, renderSetup(this, t, closeSetup))))
        // No close on a click beside it: that would throw away what was typed.
        .when(Boolean(this.form) && !this.question, el => el.child(this.over(t, "board-new", null, renderForm(this, t))))
        .when(Boolean(this.back) && !this.question, el => el.child(this.over(t, "board-back", null, this.backPanel(t))))
        // A question takes the place of whatever it is about, and gives it back when answered.
        .when(Boolean(this.question), el => el.child(this.asked(t)))
        // The dragged card's copy: beside the pointer, never under it, so the cards below still get the moves.
        .when(this.drag?.moved && this.drag.x !== undefined, el => {
          const d = this.drag, card = this.cards.find(c => c.rel === d.rel);
          return !card ? el : el.child(v_flex().absolute().left(d.x + 12).top(d.y + 12).w(220).p(10).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.accent).shadow_lg().opacity(0.92)
            .when(Boolean(card.id), g => g.child(div().text_size(10.5).text_color(t.dim).child(card.id)))
            .child(div().font_medium().truncate().child(card.title)));
        }));
  }
}
