// What the New task dialog (form.js) and a task's edit mode (main.js) share: the three selectors.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { COLUMNS } from "./parse.js";

// The options per selector. agents: [{ key, name }].
export const choices = agents => ({
  status: COLUMNS.map(c => ({ key: c.id, label: c.label })),
  agent: [{ key: "", label: "Unassigned" }, ...agents.map(a => ({ key: a.key, label: a.name }))],
  // Manual only: the notice on top of the file that keeps the board from offering Start.
  pickup: [{ key: "agents", label: "Agents may start" }, { key: "manual", label: "Manual only" }],
});
// The Model selector's options for one agent: its default (from ⚙, when there is one), the models on
// offer, and the one chosen now when it is not among them (typed, or written into the file by hand).
export const modelChoices = (list, current, dflt) => [{ key: "", label: dflt ? `Default: ${dflt}` : "Default" }, ...list,
  ...(current && !list.some(m => m.key === current) ? [{ key: current, label: current }] : [])];
export const SELECTORS = [["status", "Status"], ["agent", "Agent"], ["pickup", "Pickup"]];

export const label = (t, text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);

// A dropdown over state[id], open while state.open === id. It opens in place: its options push
// what is below it down instead of floating. pick: what a choice does, when it is more than keeping it in state.
export const dropdown = (t, state, id, name, options, pick) => v_flex().flex_1().min_w(0)
  .child(label(t, name))
  .child(h_flex().id(`pick-${id}`).h(34).px(10).gap(6).items_center().rounded(9).border_1().border_color(state.open === id ? t.accent : t.input).bg(t.background)
    .text_size(12.8).cursor_pointer().on_click((_e, cx) => { state.open = state.open === id ? null : id; cx.notify(); })
    .child(div().flex_1().min_w(0).truncate().child(options.find(o => o.key === state[id])?.label ?? state[id]))
    .child(div().flex_none().text_color(t.dim).child("▾")))
  .when(state.open === id, el => el.child(div().pt(4).child(v_flex().id(`options-${id}`).p(4).max_h(150).overflow_y_scrollbar().rounded(9).border_1().border_color(t.border).bg(t.raised).text_size(12.8)
    .children(options.map(o => h_flex().id(`option-${id}-${o.key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { state[id] = o.key; state.open = null; if (pick) pick(o.key, cx); cx.notify(); })
      .child(div().w(12).flex_none().text_color(t.accent).child(o.key === state[id] ? "✓" : ""))
      .child(div().flex_1().min_w(0).truncate().child(o.label)))))));
