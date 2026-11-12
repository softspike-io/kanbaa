// The settings panel, shown over the board the first time it opens and from the header's ⚙ after that
// (main.js over()). All sections but the last are the board's own choices (view.view, kept by main.js setView and
// saved by the click); the last is which agents get told how to create and move tasks. view.setup is
// that last section's state: every write there is install-skill.mjs's, and only after its Apply button.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome } from "herdr";
import { modelId } from "./parse.js";
import { dropdown } from "./ui.js";

const TARGETS = [
  { id: "claude", name: "Claude Code", where: "a skill in ~/.claude/skills/kanbaa-task" },
  { id: "codex", name: "Codex", where: "a marked section in ~/.codex/AGENTS.md" },
  { id: "hermes", name: "Hermes", where: "a skill in Hermes's skills, under productivity/kanbaa-task" },
];
const START = [["ask", "Ask first"], ["auto", "Send right away"], ["off", "Do nothing"]];
const BACK = [["stay", "Stay on the board"], ["go", "Go to the agent's tab"]];
const AFTER = [["off", "Never"], ["1h", "1 hour"], ["1d", "1 day"], ["7d", "7 days"]];
const STATE = { installed: "Installed", outdated: "Update available", missing: "Not installed", unavailable: "Not found on this computer" };
const installer = () => `${appHome()}/mods/kanbaa/install-skill.mjs`;
const failed = e => /program not found|cannot start/i.test(String(e)) ? "Node.js was not found. The task script and this setup need it." : String(e).split("\n")[0];

async function status() {
  const r = await exec("node", [installer(), "--status"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not check what is installed");
  return JSON.parse(r.stdout);
}

export function openSetup(view, cx) {
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
  return v_flex().px(14).pt(12).pb(10).gap(16)
    .child(h_flex().items_center()
      .child(div().flex_1().text_size(14).font_semibold().child("Settings"))
      .child(div().text_size(11).text_color(t.dim).child("Choices save as you pick")))
    .child(section("Starting tasks",
      choice("start", "When a task with an agent lands in Ready", START, view.view.start ?? "ask", set("start"),
        "For moves and assignments made on this board. The Start buttons always ask."),
      choice("open", "After sending an agent", BACK, view.view.open ?? "go", set("open"))))
    .child(section("New tasks",
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
      }))))
    .child(section("Review",
      choice("back", "After sending a task back", BACK, view.view.back ?? "stay", set("back"))))
    .child(section("Archive",
      choice("archive", "Archive done tasks after", AFTER, view.view.archive ?? "off", set("archive"),
        "Counted from the last change to a task's file, while this board is open.")))
    .child(section("Agents",
      div().text_size(12).text_color(t.muted).child("Tick the agents that should know how to create and move tasks. Nothing is written until you press Apply, which appears when a tick differs from what is installed."),
      !s.now ? div().text_size(12).text_color(s.error ? t.blocked : t.dim).child(s.error ?? "Checking what is installed…")
        : v_flex().gap(4).children(TARGETS.map(row))
          .when(Boolean(s.error), el => el.child(div().text_size(12).text_color(t.blocked).child(s.error)))
          // Only for the agents above, and only while there is something to apply.
          .when(dirty || s.busy, el => el.child(h_flex().pt(2).justify_end()
            .child(button("setup-apply", s.busy ? "Working…" : "Apply to agents", true).on_click((_e, cx) => { if (dirty) apply(view, cx); }))))))
    .child(h_flex().justify_end().child(button("setup-close", "Close").on_click(close)));
}
