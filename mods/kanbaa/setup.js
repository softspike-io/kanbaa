// The settings panel, shown over the board the first time it opens and from the header's ⚙ after that
// (main.js over()). All sections but the last are the board's own choices (view.view, kept by main.js setView and
// saved by the click); the last is which agents get told how to create and move tasks. view.setup is
// that last section's state: every write there is install-skill.mjs's, and only after its Apply button.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, readTextFile, run } from "herdr";
import { modelId, REPO, headOf, stampOf, updateState, updatePrompt } from "./parse.js";
import { dropdown } from "./ui.js";

const TARGETS = [
  { id: "claude", name: "Claude Code", where: "a skill in ~/.claude/skills/kanbaa-task" },
  { id: "codex", name: "Codex", where: "a marked section in ~/.codex/AGENTS.md" },
  { id: "hermes", name: "Hermes", where: "a skill in Hermes's skills, under productivity/kanbaa-task" },
];
const START = [["ask", "Ask first"], ["auto", "Send right away"], ["off", "Do nothing"]];
const PRESS = [["ask", "Always ask"], ["auto", "Ask when an agent is running"], ["never", "Never ask"]];
const BACK = [["stay", "Stay on the board"], ["go", "Go to the agent's tab"]];
const UPDATES = [["off", "Off"], ["on", "On"]];
const AFTER = [["off", "Never"], ["1h", "1 hour"], ["1d", "1 day"], ["7d", "7 days"]];
const STATE = { installed: "Installed", outdated: "Update available", missing: "Not installed", unavailable: "Not found on this computer" };
const installer = () => `${appHome()}/mods/kanbaa/install-skill.mjs`;
const failed = e => /program not found|cannot start/i.test(String(e)) ? "Node.js was not found. The task script and this setup need it." : String(e).split("\n")[0];

async function status() {
  const r = await exec("node", [installer(), "--status"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not check what is installed");
  return JSON.parse(r.stdout);
}

// Updates, only while ⚙ says On: the newest commit on GitHub (git ls-remote, no other request) against the
// install's mods/kanbaa/version.json. view.update: { busy, at, installed, latest, state, error }, in memory.
// Without force, at most once a day: the board calls it on each refresh, ⚙ with force.
export function checkUpdate(view, cx, force = false) {
  if (view.view.updates !== "on" || view.update?.busy || (!force && Date.now() - (view.update?.at ?? 0) < 864e5)) return;
  const u = view.update = { ...view.update, busy: true, error: null };
  cx.spawn(async cx => {
    try {
      // No credential helper: a public repo needs none, and a repo gone private must fail, not open a sign-in.
      const [r, stamp] = await Promise.all([exec("git", ["-c", "credential.helper=", "ls-remote", REPO, "HEAD"], { timeout: 15000 }),
        readTextFile(`${appHome()}/mods/kanbaa/version.json`).catch(() => null)]);
      const latest = r.code === 0 ? headOf(r.stdout) : null;
      if (!latest) throw new Error(r.stderr.trim().split("\n")[0] || "GitHub did not answer");
      Object.assign(u, { installed: stampOf(stamp), latest, state: updateState(stampOf(stamp), latest) });
    } catch (e) { u.error = /program not found|cannot start/i.test(String(e)) ? "git was not found." : `Could not check: ${String(e).split("\n")[0]}`; }
    u.busy = false; u.at = Date.now();
    cx.notify();
  });
  cx.notify();
}

// The update itself is an agent's: a tab in Herdr's own folder, told what to bring up to date and to ask first.
function update(view, agent) {
  const u = view.update;
  run("tab.new", { name: "Update Kanbaa", folder: appHome(), argv: agent.run, task: updatePrompt(appHome(), u.installed, u.latest) });
}

export function openSetup(view, cx) {
  checkUpdate(view, cx, true);
  const s = view.setup = { now: null, want: {}, busy: true, error: null };
  cx.spawn(async cx => {
    try {
      s.now = await status();
      // Ticked means "should be installed": it starts as what is there, so nothing changes unasked.
      for (const t of TARGETS) s.want[t.id] = s.now[t.id] === "installed" || s.now[t.id] === "outdated";
    } catch (e) { s.error = failed(e); }
    s.busy = false;
    cx.notify();
  });
  cx.notify();
}

// What Apply would do to a target: "install", "remove" or null.
const change = (s, id) => s.now[id] === "unavailable" ? null : s.want[id] ? (s.now[id] === "installed" ? null : "install") : (s.now[id] === "missing" ? null : "remove");

function apply(view, cx) {
  const s = view.setup;
  if (s.busy || !s.now) return;
  s.busy = true; s.error = null;
  cx.spawn(async cx => {
    try {
      for (const t of TARGETS) {
        const todo = change(s, t.id);
        if (!todo) continue;
        const r = await exec("node", [installer(), ...(todo === "remove" ? ["--remove"] : []), `--${t.id}`]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `${t.name}: could not ${todo}`);
      }
      s.now = await status();
    } catch (e) { s.error = failed(e); }
    s.busy = false;
    cx.notify();
  });
  cx.notify();
}

export function renderSetup(view, t, close) {
  const s = view.setup, dirty = Boolean(s.now) && TARGETS.some(x => change(s, x.id));
  const button = (id, text, primary) => div().id(id).px(10).h(26).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
    .hover(el => el.opacity(0.88)).child(text);
  // A section: a small heading over a line, then its settings.
  const section = (name, ...settings) => v_flex().gap(8)
    .child(div().pb(4).border_b(1).border_color(t.border).text_size(11).font_semibold().text_color(t.muted).child(name.toUpperCase()))
    .children(settings);
  // One of the board's own choices: what it is about, its options as pills (the chosen one filled), and
  // a line of small print where the choice needs one. A click on a pill is the save.
  const choice = (id, name, options, chosen, pick, note) => v_flex().gap(5)
    .child(div().text_size(12.8).child(name))
    .child(h_flex().flex_wrap().gap(6).children(options.map(([key, text]) => div().id(`${id}-${key || "none"}`).px(9).h(24).flex_none().flex().items_center().rounded(12).cursor_pointer().text_size(12)
      .border_1().border_color(chosen === key ? t.accent : t.input).bg(chosen === key ? t.selected : t.background).text_color(chosen === key ? t.foreground : t.muted)
      .hover(el => el.bg(t.hover)).on_click((_e, cx) => pick(key, cx)).child(text))))
    .when(Boolean(note), el => el.child(div().text_size(11).text_color(t.dim).child(note)));
  const row = x => {
    const state = s.now[x.id], off = state === "unavailable";
    return h_flex().id(`setup-${x.id}`).gap(10).items_start().py(3).rounded(6)
      .when(!off, el => el.cursor_pointer().on_click((_e, cx) => { s.want[x.id] = !s.want[x.id]; cx.notify(); }))
      .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.input)
        .bg(s.want[x.id] ? t.solid : t.background).text_size(11).text_color(t.solid_foreground).child(s.want[x.id] ? "✓" : ""))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(12.8).text_color(off ? t.dim : t.foreground).child(x.name))
          .child(div().text_size(11).text_color(state === "installed" ? t.done : state === "outdated" ? t.working : t.dim).child(STATE[state] ?? state)))
        .child(div().text_size(11).text_color(t.dim).child(x.where)));
  };
  const agents = [["", "None"], ...view.agents.filter(a => a.installed).map(a => [a.key, a.name])];
  const agent = agents.some(([key]) => key === view.view.agent) ? view.view.agent : "";
  const models = view.agents.filter(a => a.installed && view.models[a.key]?.length);
  const set = name => (key, cx) => view.setView({ [name]: key }, cx);
  // The pages, one per item in the left column; the right shows the chosen one (s.page, reset on each open).
  // A dot on an item: an update waits there, or ticks wait for Apply.
  const pages = [
    ["start", "Starting tasks", () => section("Starting tasks",
      choice("start", "When a task with an agent lands in Ready", START, view.view.start ?? "ask", set("start"),
        "For moves, assignments and new tasks made on this board."),
      choice("press", "When you press Start", PRESS, view.view.press ?? "ask", set("press"),
        "Two agents in one checkout can undo each other's edits."),
      choice("open", "After sending an agent", BACK, view.view.open ?? "go", set("open")))],
    ["new", "New tasks", () => v_flex().gap(16).child(section("New tasks",
      choice("agent", "Agent for a new task", agents, agent, set("agent"))))
    // Only while an installed agent has models to offer: one row per such agent, named after it.
    .when(models.length > 0, el => el.child(section("Default models",
      div().text_size(12).text_color(t.muted).child("The model each agent starts on when a task names none. Default leaves the choice to the agent."),
      ...models.map(a => {
        const now = modelId(view.view.models?.[a.key]), list = view.models[a.key];
        // A dropdown, not pills: Codex alone lists more models than fit a row. s.open says which one is open.
        s[`model-${a.key}`] = now;
        return h_flex().child(dropdown(t, s, `model-${a.key}`, `Default model for ${a.name}`, [{ key: "", label: "Default" }, ...list, ...(now && !list.some(m => m.key === now) ? [{ key: now, label: now }] : [])],
          (key, cx) => view.setView({ models: { ...view.view.models, [a.key]: key } }, cx)));
      }))))],
    ["review", "Review", () => section("Review",
      choice("back", "After sending a task back", BACK, view.view.back ?? "stay", set("back")))],
    ["archive", "Archive", () => section("Archive",
      choice("archive", "Archive done tasks after", AFTER, view.view.archive ?? "off", set("archive"),
        "Counted from the last change to a task's file, while this board is open."))],
    ["updates", "Updates", () => section("Updates", ...updates(view, t, choice, button)), view.update?.state === "available"],
    ["agents", "Agents", () => section("Agents",
      div().text_size(12).text_color(t.muted).child("Tick the agents that should know how to create and move tasks. Nothing is written until you press Apply, which appears when a tick differs from what is installed."),
      !s.now ? div().text_size(12).text_color(s.error ? t.blocked : t.dim).child(s.error ?? "Checking what is installed…")
        : v_flex().gap(4).children(TARGETS.map(row))
          .when(Boolean(s.error), el => el.child(div().text_size(12).text_color(t.blocked).child(s.error)))
          // Only for the agents above, and only while there is something to apply.
          .when(dirty || s.busy, el => el.child(h_flex().pt(2).justify_end()
            .child(button("setup-apply", s.busy ? "Working…" : "Apply to agents", true).on_click((_e, cx) => { if (dirty) apply(view, cx); }))))), dirty],
  ];
  const page = pages.find(p => p[0] === s.page) ?? pages[0];
  // Tall (main.js over()): the panel keeps the board's height, so switching pages never makes it jump; the page scrolls.
  return v_flex()
    .child(h_flex().flex_none().px(14).pt(12).pb(10).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(14).font_semibold().child("Settings"))
      .child(div().text_size(11).text_color(t.dim).child("Choices save as you pick")))
    .child(h_flex().flex_1().min_h(0).items_start()
      .child(v_flex().id("setup-nav").w(140).flex_none().h_full().p(8).gap(2).border_r(1).border_color(t.border).overflow_y_scrollbar()
        .children(pages.map(([id, name, , dot]) => h_flex().id(`setup-nav-${id}`).h(28).flex_none().px(8).gap(6).items_center().rounded(6).cursor_pointer().text_size(12.8)
          .bg(id === page[0] ? t.selected : t.popover).text_color(id === page[0] ? t.foreground : t.muted).hover(el => el.bg(t.hover))
          .on_click((_e, cx) => { s.page = id; s.open = null; cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().child(name))
          .when(Boolean(dot), el => el.child(div().size(6).flex_none().rounded(3).bg(t.working))))))
      .child(v_flex().id("setup-page").flex_1().min_w(0).h_full().px(14).py(12).overflow_y_scrollbar().child(page[2]())))
    .child(h_flex().flex_none().px(14).py(10).justify_end().border_t(1).border_color(t.border).child(button("setup-close", "Close").on_click(close)));
}

// The Updates section: the On/Off choice, then while On what the check found and, when there is something
// newer (or the install records no version), a button that hands the update to an agent.
function updates(view, t, choice, button) {
  const on = view.view.updates === "on", u = view.update, short = c => c?.slice(0, 7);
  const installed = view.agents.filter(a => a.installed);
  const agent = installed.find(a => a.key === view.view.agent) ?? installed[0];
  const line = !u || u.busy ? ["Checking…", t.dim] : u.error ? [u.error, t.blocked]
    : u.state === "current" ? [`Up to date (${short(u.latest)})`, t.done]
    : u.state === "available" ? [`Update available: ${short(u.installed)} → ${short(u.latest)}`, t.working]
    : [`Newest is ${short(u.latest)}. This install does not record its version.`, t.working];
  const offer = on && u && !u.busy && !u.error && u.state !== "current";
  return [
    choice("updates", "Check for new versions of Kanbaa", UPDATES, on ? "on" : "off", (key, cx) => { view.setView({ updates: key }, cx); checkUpdate(view, cx, true); },
      `When on, the board asks GitHub for the newest commit of ${REPO.replace("https://", "")} with git ls-remote, once a day and when you open ⚙. Nothing else is sent.`),
    ...(on ? [h_flex().gap(10).items_center()
      .child(div().flex_1().min_w(0).text_size(12).text_color(line[1]).child(line[0]))
      .when(offer && Boolean(agent), el => el.child(button("update-start", `Update with ${agent?.name}`, true).on_click(() => update(view, agent))))] : []),
    ...(offer && !agent ? [div().text_size(11).text_color(t.dim).child(`An agent does the update. Install one, or copy the files from ${REPO} by hand.`)] : []),
    ...(offer && agent ? [div().text_size(11).text_color(t.dim).child(`Opens a tab where ${agent.name} reads what changed, tells you, and asks before replacing a file you changed.`)] : []),
  ];
}
