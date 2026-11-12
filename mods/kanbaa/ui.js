// What the New task dialog (form.js) and a task's edit mode (main.js) share: the selectors.
import { div } from "gpui-kit";
import { v_flex, h_flex, Popup } from "gpui-base";
import { COLUMNS, TYPES } from "./parse.js";

// The options per selector. agents: [{ key, name }].
export const choices = agents => ({
  status: COLUMNS.map(c => ({ key: c.id, label: c.label })),
  type: [{ key: "", label: "None" }, ...TYPES],
  agent: [{ key: "", label: "Unassigned" }, ...agents.map(a => ({ key: a.key, label: a.name }))],
  // Manual only: the notice on top of the file that keeps the board from offering Start.
  pickup: [{ key: "agents", label: "Agents may start" }, { key: "manual", label: "Manual only" }],
});
// The Model selector's options for one agent: its default (from ⚙, when there is one), the models on
// offer, and the one chosen now when it is not among them (typed, or written into the file by hand).
export const modelChoices = (list, current, dflt) => [{ key: "", label: dflt ? `Default: ${dflt}` : "Default" }, ...list,
  ...(current && !list.some(m => m.key === current) ? [{ key: current, label: current }] : [])];
export const SELECTORS = [["status", "Status"], ["type", "Type"], ["agent", "Agent"], ["pickup", "Pickup"]];
// The colour a type's chip takes, a theme key.
export const TYPE_TINT = { bug: "blocked", feature: "accent", chore: "muted", research: "working", docs: "done" };

// A list's height before it scrolls: eight options (28 px each, 4 px apart, 4 px padding), so the short ones never need to.
export const LIST_H = 8 * 28 + 7 * 4 + 8;
// Whether a list opened from the box pressed in `e` goes up: the box sits in the window's lower half, where a list
// hanging under it ran past the bottom with its last options out of reach (KAN-29).
export const opensUp = e => {
  let v = null;
  try { v = globalThis.window?.viewport_size?.(); } catch {}
  const mid = e.position.y - (e.local_position?.y ?? 0) + (e.bounds?.height ?? 0) / 2;
  return v?.height > 0 && mid > v.height / 2;
};

export const label = (t, text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);

// A dropdown over state[id], open while state.open === id. The options float in a Popup under the box,
// over what is below it, so opening one never makes its panel taller. pick: what a choice does, when it is more
// than keeping it in state. extra: an element on top of the open list (the Model dropdown's box for typing an id).
// Built as Herdr's own New space dialog builds its lists: a Popup owns no dismissal, so a press anywhere on the panel
// closes an open list (BoardView.over, main.js), and the box and the list keep their own presses from reaching it.
// The list itself is the Popup's content and its scroll area: one nested in plain wrappers did not scroll.
// It opens upward when the box sits in the lower half of the window (opensUp), so it never runs off the bottom (KAN-29).
export const dropdown = (t, state, id, name, options, pick, extra) => v_flex().flex_1().min_w(0)
  .child(label(t, name))
  .child(Popup.new(`pop-${id}`, h_flex().id(`pick-${id}`).h(34).px(10).gap(6).items_center().rounded(9).border_1().border_color(state.open === id ? t.accent : t.input).bg(t.background)
    .text_size(12.8).cursor_pointer().on_mouse_down("left", (e, cx) => { cx.stop_propagation(); state.open = state.open === id ? null : id; state.up = opensUp(e); cx.notify(); })
    .child(div().flex_1().min_w(0).truncate().child(options.find(o => o.key === state[id])?.label ?? state[id]))
    .child(div().flex_none().text_color(t.dim).child("▾")))
    .anchor(state.up ? "bottom_left" : "top_left")
    .when(state.open === id, el => el.content(v_flex().id(`options-${id}`).w(260).max_h(LIST_H).overflow_y_scrollbar().mt(state.up ? 0 : 4).mb(state.up ? 4 : 0).p(4).gap(4).rounded(9).border_1().border_color(t.border).bg(t.raised).shadow_lg().text_size(12.8)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(Boolean(extra), el => el.child(div().flex_none().child(extra)))
      .children(options.map(o => h_flex().id(`option-${id}-${o.key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { state[id] = o.key; state.open = null; if (pick) pick(o.key, cx); cx.notify(); })
        .child(div().w(12).flex_none().text_color(t.accent).child(o.key === state[id] ? "✓" : ""))
        .child(div().flex_1().min_w(0).truncate().child(o.label)))))));
