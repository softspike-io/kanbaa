// The New task panel, shown over the board inside its outline (main.js over()): view.form is its state,
// { root, dir, agents, id, status?, agent? } plus the fields. It writes one new Markdown file into the repo's to-do
// folder, named after the id and the title; the board reads it back from there.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, writeTextFile, window } from "herdr";
import { newTask, modelId, MODEL_FLAG } from "./parse.js";
import { choices, modelChoices, SELECTORS, label, dropdown } from "./ui.js";

export const today = () => { const d = new Date(), two = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
// f.model is the picked id, or the one typed in the Model dropdown. Only for an agent the board can start on a model.
const model = f => MODEL_FLAG[f.agent] ? f.model : "";
const task = f => newTask({ title: f.title.value(), description: f.text.value(), column: f.status, type: f.type, agent: f.agent, model: model(f), date: today(), manual: f.pickup === "manual", id: f.id });

// From a click: input states need a live host call.
export function openForm(view, create, cx) {
  const f = view.form = { status: "backlog", type: "", agent: "", ...create, model: "", pickup: "agents", open: null, error: null, busy: false };
  f.of = f.agent;
  f.custom = InputState.new({ placeholder: "Or type a model id" });
  f.typed = ""; // what the box holds, to tell typing from a clear we do ourselves
  f.custom.on("change", (_e, cx) => {
    const v = f.custom.value().trim();
    if (v !== f.typed) { f.typed = v; f.model = v; }
    f.error = null; cx.notify();
  });
  f.title = InputState.new({ placeholder: "What needs doing" });
  f.text = TextareaState.new({ placeholder: "A short description (optional)", rows: 5 });
  f.title.on("change", (_e, cx) => { f.error = null; cx.notify(); });
  f.title.on("submit", (_e, cx) => submit(view, cx));
  f.title.focus();
  // Again once the panel is on screen: a field focused before it is drawn does not always keep the keyboard.
  cx.timer.after(150, () => { if (view.form === f) f.title.focus(); });
  cx.notify();
}

function clearTyped(f) { f.typed = ""; if (f.custom.value()) f.custom.set_value(""); }

export function closeForm(view) {
  view.form?.title.release(); view.form?.text.release(); view.form?.custom.release();
  view.form = null;
}

function submit(view, cx) {
  const f = view.form;
  if (f.busy) return;
  if (!f.title.value().trim()) { f.error = "Give the task a title"; return void cx.notify(); }
  if (model(f) && !modelId(model(f))) { f.error = "That does not look like a model id"; return void cx.notify(); }
  const dir = f.dir ?? "to-do", { name, text } = task(f), folder = `${f.root}/${dir}`;
  f.busy = true;
  cx.spawn(async cx => {
    try {
      // A repo without a to-do folder gets one. If that fails, the write below reports it.
      if (!f.dir) await (window()?.platform === "windows" ? exec("cmd", ["/c", "mkdir", folder.replace(/\//g, "\\")]) : exec("mkdir", ["-p", folder])).catch(() => null);
      await writeTextFile(`${folder}/${name}`, text, null); // null: only ever a new file, never over an existing task
      view.issued(f.id, cx); // the counter of ids handed out: see main.js issued()
      if (view.form === f) closeForm(view);
      view.justMade = name; // the board picks it up on this refresh: see main.js refresh()
      view.refresh(cx);
    } catch (e) {
      f.busy = false; f.error = `Could not create ${dir}/${name}. Does it exist already? (${String(e).split("\n")[0]})`;
    }
    cx.notify();
  });
}

export function renderForm(view, t) {
  const f = view.form, options = choices(f.agents);
  // A model belongs to its agent: another agent starts at Default again.
  if (f.of !== f.agent) { f.of = f.agent; f.model = ""; clearTyped(f); }
  const field = el => el.px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
  const button = (id, text, primary) => div().id(id).px(10).h(26).flex_none().flex().items_center().rounded(6).cursor_pointer().text_size(12)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
    .hover(s => s.opacity(0.88)).child(text);
  return v_flex().px(14).pt(12).pb(10)
    .on_key_down((e, cx) => { if (e.key === "escape") { closeForm(view); cx.stop_propagation(); cx.notify(); } })
    .child(h_flex().items_center().gap(8).child(div().text_size(14).font_semibold().child("New task"))
      // The id is given, not chosen: it becomes the start of the file name.
      .child(div().flex_1().text_size(11).text_color(t.dim).child(f.id)))
    .child(label(t, "Title"))
    .child(field(Input.new(f.title).h(34)))
    .child(label(t, "Description"))
    .child(field(Textarea.new(f.text).w_full().py(8)))
    // Stacked, as in a task's edit mode, except Model: it sits beside Agent, which it belongs to. It only
    // shows under an agent the board can start on a model; an id can be picked or typed in its list.
    .children(SELECTORS.map(([id, name]) => id !== "agent" ? h_flex().child(dropdown(t, f, id, name, options[id])) : h_flex().gap(8)
      .child(dropdown(t, f, id, name, options[id]))
      .when(Boolean(MODEL_FLAG[f.agent]), el => el.child(dropdown(t, f, "model", "Model", modelChoices(f.models?.[f.agent] ?? [], f.model, f.defaults?.[f.agent]),
        (key) => { clearTyped(f); f.model = key; }, field(Input.new(f.custom).h(34)))))))
    .child(h_flex().pt(14).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(f.error ? t.blocked : t.dim)
        .child(f.error ?? `${f.dir ?? "to-do (new folder)"}/${f.title.value().trim() ? task(f).name : `${f.id}-….md`}`))
      .child(button("board-new-cancel", "Cancel").on_click((_e, cx) => { closeForm(view); cx.notify(); }))
      .child(button("board-new-create", f.busy ? "Creating…" : "Create", true).on_click((_e, cx) => submit(view, cx))));
}
