// The settings panel, shown over the board the first time it opens and from the header's ⚙ after that
// (main.js over()): what happens when a task with an agent lands in Ready and which agent a new task
// starts with (view.view.start and .agent, kept by main.js setView), and which agents get told how to create and move tasks. view.setup is its state. Every write is
// install-skill.mjs's, and only after Apply: the panel itself writes nothing.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome } from "herdr";

const TARGETS = [
  { id: "claude", name: "Claude Code", where: "a skill in ~/.claude/skills/kanbaa-task" },
  { id: "codex", name: "Codex", where: "a marked section in ~/.codex/AGENTS.md" },
  { id: "hermes", name: "Hermes", where: "a skill in Hermes's skills, under productivity/kanbaa-task" },
];
const START = [
  ["ask", "Ask first"],
  ["auto", "Send the agent right away"],
  ["off", "Do nothing"],
];
const AFTER = [["off", "Never"], ["1h", "After 1 hour"], ["1d", "After 1 day"], ["7d", "After 7 days"]];
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
  const row = x => {
    const state = s.now[x.id], off = state === "unavailable";
    return h_flex().id(`setup-${x.id}`).gap(10).items_start().py(4).rounded(6)
      .when(!off, el => el.cursor_pointer().on_click((_e, cx) => { s.want[x.id] = !s.want[x.id]; cx.notify(); }))
      .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.input)
        .bg(s.want[x.id] ? t.solid : t.background).text_size(11).text_color(t.solid_foreground).child(s.want[x.id] ? "✓" : ""))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(12.8).text_color(off ? t.dim : t.foreground).child(x.name))
        .child(div().text_size(11).text_color(t.dim).child(x.where))
        .child(div().text_size(11).text_color(state === "installed" ? t.done : state === "outdated" ? t.working : t.dim).child(STATE[state] ?? state)));
  };
  // The board's own choices (view.view): one of several, saved by the click.
  const radio = (id, on, name, pick) => h_flex().id(id).gap(10).items_center().py(3).cursor_pointer().on_click(pick)
    .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(7).border_1().border_color(on ? t.accent : t.input).bg(t.background)
      .child(div().size(6).rounded(3).bg(on ? t.accent : t.background)))
    .child(div().text_size(12.8).text_color(on ? t.foreground : t.muted).child(name));
  const chosen = view.agents.some(a => a.installed && a.key === view.view.agent) ? view.view.agent : "";
  return v_flex().px(14).pt(12).pb(10).gap(10)
    .child(div().text_size(14).font_semibold().child("Settings"))
    .child(v_flex().gap(4)
      .child(div().text_size(12.8).font_medium().child("When a task with an agent lands in Ready"))
      .children(START.map(([key, name]) => radio(`start-${key}`, (view.view.start ?? "ask") === key, name, (_e, cx) => view.setView({ start: key }, cx))))
      .child(div().text_size(11).text_color(t.dim).child("Saved as you pick. For moves and assignments made on this board. The Start buttons always ask, and a file that turns Ready on disk starts nothing.")))
    .child(v_flex().gap(4)
      .child(div().pt(4).text_size(12.8).font_medium().child("Agent for a new task"))
      .children([{ key: "", name: "None" }, ...view.agents.filter(a => a.installed)].map(a =>
        radio(`agent-${a.key || "none"}`, chosen === a.key, a.name, (_e, cx) => view.setView({ agent: a.key }, cx))))
      .child(div().text_size(11).text_color(t.dim).child("Saved as you pick. Preselected when you make a new task; you can still change it there.")))
    .child(v_flex().gap(4)
      .child(div().pt(4).text_size(12.8).font_medium().child("Send done tasks to the archive"))
      .children(AFTER.map(([key, name]) => radio(`archive-${key}`, (view.view.archive ?? "off") === key, name, (_e, cx) => view.setView({ archive: key }, cx))))
      .child(div().text_size(11).text_color(t.dim).child("Saved as you pick. Counted from the last change to the task's file, and done while this board is open.")))
    .child(div().pt(4).text_size(12.8).font_medium().child("Let agents add tasks"))
    .child(div().text_size(12).text_color(t.muted).child("Kanbaa comes with a small script that creates a task with the right id. Tick the agents that should be told about it. A tick changes nothing by itself: an Apply button appears here once the ticks differ from what is installed, and unticking one takes it out again."))
    .when(Boolean(s.now), el => el.child(v_flex().gap(4).children(TARGETS.map(row))
      // Only for the agents above, and only while there is something to apply: the choice at the top saves itself.
      .when(dirty || s.busy, el => el.child(h_flex().pt(4).justify_end()
        .child(button("setup-apply", s.busy ? "Working…" : "Apply to agents", true).on_click((_e, cx) => { if (dirty) apply(view, cx); }))))))
    .when(!s.now || Boolean(s.error), el => el.child(div().text_size(12).text_color(s.error ? t.blocked : t.dim).child(s.error ?? "Checking what is installed…")))
    .child(h_flex().gap(8).items_center().justify_end()
      .child(button("setup-close", "Close").on_click(close)));
}
