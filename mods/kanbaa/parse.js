// Reading and rewriting to-do task files for the board. No Herdr imports: parse.test.js runs under node --test.

// word: what a move writes into the file.
export const COLUMNS = [
  { id: "backlog", label: "Backlog", word: "Draft" },
  { id: "ready", label: "Ready", word: "Ready" },
  { id: "progress", label: "In progress", word: "In progress" },
  { id: "review", label: "Review", word: "In review" },
  { id: "done", label: "Done", word: "Done" },
];
// Not a column: tasks put away. They stay files in the same folder, with this status, and show in the board's Archive.
export const ARCHIVE = { id: "archive", label: "Archive", word: "Archived" };
// What kind of work a task is: a **Type:** line under the Status line, written as the label.
export const TYPES = [{ key: "bug", label: "Bug" }, { key: "feature", label: "Feature" }, { key: "chore", label: "Chore" }, { key: "research", label: "Research" }, { key: "docs", label: "Docs" }];
// The type a written value names ("bug", "Bug", "Docs"), or "" for none or one the board does not know.
export const typeOf = value => TYPES.find(t => t.key === (value ?? "").trim().toLowerCase())?.key ?? "";
export const MAX_FILES = 200;
const HEAD = 30; // **Status:** and **Agent:** count only in the first lines

// The agents the board can start on a chosen model, and the flag each takes for it (from their own --help).
export const MODEL_FLAG = { claude: "--model", codex: "-m", hermes: "-m" };
// The models on offer per agent. Claude Code's are its aliases, which follow the latest version by
// themselves. Codex's come from its own cache (codexModels()); any other id can be typed.
export const MODELS = { claude: [{ key: "fable", label: "Fable" }, { key: "opus", label: "Opus" }, { key: "sonnet", label: "Sonnet" }, { key: "haiku", label: "Haiku" }] };
// A model id ends up as an argument of the agent's command, and a task file can come from anywhere:
// only what looks like an id counts, and never something that reads as a flag.
export const modelId = value => /^[a-z0-9][\w.:\/@\[\]-]{0,79}$/i.test((value ?? "").trim()) ? value.trim() : "";
// The models in ~/.codex/models_cache.json that Codex's own menu lists.
export function codexModels(text) {
  try { return (JSON.parse(text).models ?? []).filter(m => m.visibility !== "hide" && modelId(m.slug)).map(m => ({ key: m.slug, label: m.display_name || m.slug })); }
  catch { return []; }
}
// The agent's start command on that model: unchanged without one, or for an agent with no known flag.
export const withModel = (run, agent, model) => MODEL_FLAG[agent] && modelId(model) ? [...run, MODEL_FLAG[agent], modelId(model)] : run;

// Review is tested first: "Done — pending review" is not done.
export function column(status) {
  const s = (status ?? "").trim().toLowerCase();
  if (s.startsWith("archive")) return "archive";
  if (s.includes("review")) return "review";
  if (/^(done|completed)/.test(s)) return "done";
  if (/^(in[ -]progress|started)/.test(s)) return "progress";
  if (/^(ready|development-ready)/.test(s)) return "ready";
  return "backlog";
}

// The listed paths (relative to the to-do folder) that are cards. Past the cap, the ones changed last
// stay (times: path to last change, when known): a folder that has filled up with archived tasks loses
// its oldest from view, never its newest.
export function pick(paths, times = {}) {
  const all = paths.map(p => p.trim().replace(/\\/g, "/")).filter(p => {
    const parts = p.split("/");
    return /\.md$/i.test(p) && parts.length <= 2 && !/^readme\.md$/i.test(parts.at(-1)) && !parts.some(s => s.startsWith("_"));
  });
  const kept = all.length > MAX_FILES ? [...all].sort((a, b) => (times[b] ?? 0) - (times[a] ?? 0)).slice(0, MAX_FILES) : all;
  return { files: kept.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), capped: all.length > MAX_FILES }; // HER-2 before HER-10
}

// Lines at even indexes, their endings at odd ones: join("") gives the same bytes back.
const split = text => text.split(/(\r?\n)/);
const bold = name => new RegExp(`^(\\*\\*${name}:\\*\\*|\\*\\*${name}\\*\\*:)[ \\t]*(.*?)([ \\t]*)$`, "i");
const yaml = name => new RegExp(`^(${name}:)[ \\t]*(.*?)([ \\t]*)$`, "i");

// The closing --- of the frontmatter, or -1.
function frontEnd(parts) {
  if (parts[0] !== "---") return -1;
  for (let i = 2; i < parts.length; i += 2) if (parts[i] === "---") return i;
  return -1;
}

// Where a field is written: the bold line wins over the frontmatter.
function field(parts, name) {
  for (let i = 0; i < parts.length && i < HEAD * 2; i += 2) {
    const m = bold(name).exec(parts[i]);
    if (m) return { i, value: m[2], front: false };
  }
  const end = frontEnd(parts);
  for (let i = 2; i < end; i += 2) {
    const m = yaml(name).exec(parts[i]);
    if (m) return { i, value: m[2].replace(/^(["'])(.*)\1$/, "$2"), front: true };
  }
  return null;
}

const heading = parts => { const end = frontEnd(parts); for (let i = end < 0 ? 0 : end + 2; i < parts.length; i += 2) if (parts[i].startsWith("# ")) return i; return -1; };

export function parse(text, rel) {
  const parts = split(text), status = field(parts, "Status"), agent = field(parts, "Agent"), type = typeOf(field(parts, "Type")?.value), h = heading(parts);
  const boxes = text.match(/^[ \t]*[-*+] \[[ xX]\]/gm) ?? [], ticked = boxes.filter(b => !b.endsWith("[ ]")).length;
  const folder = rel.includes("/") && /^(backlog|ready|in-progress|completed)$/i.test(rel.split("/")[0]) ? rel.split("/")[0] : "";
  const raw = status?.value || folder || (!boxes.length || !ticked ? "Backlog" : ticked < boxes.length ? "In progress" : "Done");
  const col = [...COLUMNS, ARCHIVE].find(c => c.id === column(raw)), said = status?.value ?? "";
  return {
    title: (h >= 0 && parts[h].slice(2).trim()) || rel.split("/").pop().replace(/\.md$/i, ""),
    id: taskId(rel),
    // Where the card sits in its status: lower first, and cards without the line after those, by id.
    order: (o => o && o.value !== "" && Number.isFinite(Number(o.value)) ? Number(o.value) : null)(field(parts, "Order")),
    // The header's other **Key:** lines (Written, Repo, …), for show: the board never rewrites them. A Type it does not know stays here.
    meta: parts.slice(0, descriptionAt(parts)).map((line, i) => i % 2 ? null : /^\*\*([^*]+?):?\*\*:?[ \t]*(.*?)[ \t]*$/.exec(line))
      .filter(m => m && m[2] && !/^(status|agent|order|model)$/i.test(m[1]) && !(type && /^type$/i.test(m[1]))).map(m => ({ key: m[1], value: m[2].replace(/`/g, "") })),
    column: col.id,
    // The status as written, when it says more than the column does.
    note: said && ![col.label, col.word].some(w => w.toLowerCase() === said.toLowerCase()) ? said : "",
    agent: agent?.value ?? "",
    type,
    // The model its agent is started on; "": the default from ⚙, else the agent's own.
    model: modelId(field(parts, "Model")?.value),
    ticked, boxes: boxes.length,
    // Only as a notice at the top: a file that merely mentions the phrase further down is not gated.
    manual: noticeAt(parts) >= 0,
  };
}

const NOTICE = "> Manual pickup only. This file does not authorize coding agents to start on it.";
// The line near the top that gates the file, or -1.
const noticeAt = parts => parts.findIndex((line, i) => i % 2 === 0 && i < HEAD * 2 && line.includes("Manual pickup only"));

// A task's id is in its file name and nowhere else: the repo's first three letters and a number
// (HER-12-fix-login.md). Never rewritten: renaming the title leaves the file and its id alone.
// The repo's own name from git's common dir (…/repo/.git), also in a linked worktree (whose folder is
// named after its branch); outside git, the folder's.
export const repoName = (common, root) => (common || root).split(/[\\/]/).filter(Boolean).filter((part, i, all) => !(i === all.length - 1 && part === ".git")).pop() ?? "";
export const prefix = repo => repo.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TSK";
const base = path => path.replace(/\\/g, "/").split("/").pop();
export const taskId = path => /^([a-z0-9]{1,3}-\d+)(?=[-.])/i.exec(base(path))?.[1].toUpperCase() ?? "";
// names: every file in the to-do folder. issued: the highest number already handed out (issuedIn()), so
// that a deleted task's id is not given to the next one. One past the higher of the two.
export function nextId(repo, names, issued = 0) {
  const p = prefix(repo), numbers = names.map(taskId).filter(id => id.startsWith(`${p}-`)).map(id => Number(id.slice(p.length + 1)));
  return `${p}-${Math.max(0, issued, ...numbers) + 1}`;
}

// The counter file (JSON, { "HER": 12 }): one per repo, kept in git's own folder so every worktree of
// the repo shares it and it never shows up as a change; next to the tasks outside git.
export const counterPath = (common, folder) => common ? `${common.replace(/[\\/]+$/, "")}/kanbaa-ids.json` : `${folder}/.kanbaa-ids.json`;
const counts = text => { try { const all = JSON.parse(text ?? ""); return all && typeof all === "object" && !Array.isArray(all) ? all : {}; } catch { return {}; } };
export const issuedIn = (text, repo) => Number(counts(text)[prefix(repo)]) || 0;
// The file's text once this id has been handed out, or null when it already says as much.
export function issue(text, id) {
  const all = counts(text), [p, n] = [id.slice(0, id.lastIndexOf("-")), Number(id.slice(id.lastIndexOf("-") + 1))];
  if (!p || !(n > (Number(all[p]) || 0))) return null;
  return JSON.stringify({ ...all, [p]: n }, null, 2) + "\n";
}

// Where the description starts: under the title and the lines below it that the board owns
// (blank lines, the manual notice, **Key:** lines).
// ponytail: a description that itself opens with a **Key:** line reads as part of that header.
function descriptionAt(parts) {
  const h = heading(parts), end = frontEnd(parts);
  let i = h >= 0 ? h + 2 : end >= 0 ? end + 2 : 0;
  while (i < parts.length && (!parts[i].trim() || /^(\*\*[^*]+:\*\*|\*\*[^*]+\*\*:)/.test(parts[i]) || (parts[i].startsWith(">") && parts[i].includes("Manual pickup only")))) i += 2;
  return Math.min(i, parts.length);
}
export const description = text => { const parts = split(text); return parts.slice(descriptionAt(parts)).join("").trim(); };

// Replaces everything under the header lines. The header keeps its bytes; the new text gets the file's line endings.
export function setDescription(text, next) {
  const parts = split(text), e = eol(parts), head = parts.slice(0, descriptionAt(parts)).join("").replace(/(\r?\n)+$/, "");
  const body = next.trim().replace(/\r?\n/g, e);
  return (head ? head + e : "") + (body ? (head ? e : "") + body + e : "");
}

export function setTitle(text, title) {
  const parts = split(text), h = heading(parts), line = `# ${title.trim().replace(/\s+/g, " ")}`;
  if (h >= 0) parts[h] = line; else block(parts, line);
  return parts.join("");
}

const put = (parts, f, name, value) => {
  parts[f.i] = parts[f.i].replace(f.front ? yaml(name) : bold(name), (_m, key, _old, trail) => (value ? `${key} ${value}` : key) + trail);
};
const eol = parts => parts[1] ?? "\n";
// A new line directly under line i.
function under(parts, i, line) {
  if (parts[i + 1] === undefined) parts.push(eol(parts));
  parts.splice(i + 2, 0, line, eol(parts));
}
// A new line as its own paragraph under the title (within HEAD), else under the frontmatter, else on top.
function block(parts, line) {
  const h = heading(parts), at = h >= 0 && h < (HEAD - 2) * 2 ? h : frontEnd(parts), e = eol(parts);
  if (at < 0) return void parts.unshift(line, e, ...(parts[0] ? ["", e] : []));
  if (parts[at + 1] === undefined) parts.push(e);
  parts.splice(at + 2, 0, "", e, line, e, ...(parts[at + 2] ? ["", e] : []));
}

// Both rewrites change one line (or add one) and leave every other byte alone.
export function setStatus(text, word) {
  const parts = split(text), f = field(parts, "Status");
  if (f) put(parts, f, "Status", word); else block(parts, `**Status:** ${word}`);
  return parts.join("");
}

// The model the task's agent is started on: a **Model:** line under the Agent line, or none ("": the default).
export function setModel(text, id) {
  const parts = split(text), f = field(parts, "Model"), a = field(parts, "Agent") ?? field(parts, "Status");
  if (!id) { if (f) parts.splice(f.i, 2); return parts.join(""); }
  if (f) put(parts, f, "Model", id);
  else if (a) under(parts, a.i, a.front ? `model: ${id}` : `**Model:** ${id}`);
  else block(parts, `**Model:** ${id}`);
  return parts.join("");
}

// key "": unassigned. A model belongs to its agent: another agent takes the Model line away.
export function setAgent(text, key) {
  const parts = split(text), f = field(parts, "Agent"), s = field(parts, "Status");
  if (f) put(parts, f, "Agent", key);
  else if (!key) return text;
  else if (s) under(parts, s.i, s.front ? `agent: ${key}` : `**Agent:** ${key}`);
  else block(parts, `**Agent:** ${key}`);
  return (f?.value ?? "") === key ? parts.join("") : setModel(parts.join(""), "");
}

// key "": no type, the line goes.
export function setType(text, key) {
  const parts = split(text), f = field(parts, "Type"), s = field(parts, "Status"), word = TYPES.find(t => t.key === key)?.label;
  if (!word) { if (f) parts.splice(f.i, 2); return parts.join(""); }
  if (f) put(parts, f, "Type", word);
  else if (s) under(parts, s.i, s.front ? `type: ${word}` : `**Type:** ${word}`);
  else block(parts, `**Type:** ${word}`);
  return parts.join("");
}

// The card's place in its status: an **Order:** line under the Status line (or the title), or none (null).
export function setOrder(text, order) {
  const parts = split(text), f = field(parts, "Order"), s = field(parts, "Status");
  if (order === null) { if (f) parts.splice(f.i, 2); return parts.join(""); }
  if (f) put(parts, f, "Order", String(order));
  else if (s) under(parts, s.i, s.front ? `order: ${order}` : `**Order:** ${order}`);
  else block(parts, `**Order:** ${order}`);
  return parts.join("");
}
// How a status lists its cards: placed ones first, lowest on top, then the rest by name.
export const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.rel.localeCompare(b.rel, undefined, { numeric: true });
// A status's cards (`same`, in order) as they stand once `card` is dropped there: before or after the
// card `on` (its rel), or at the end when dropped on the status itself or on a card no longer there.
export function dropOrder(same, card, on, after) {
  const list = same.filter(c => c.rel !== card.rel), at = on ? list.findIndex(c => c.rel === on) : -1;
  list.splice(at < 0 ? list.length : at + (after ? 1 : 0), 0, card);
  return list;
}

// Adds the notice under the title, or removes the line that carries it (and the blank line after it).
export function setManual(text, on) {
  const parts = split(text), i = noticeAt(parts);
  if (on === (i >= 0)) return text;
  if (on) block(parts, NOTICE); else parts.splice(i, parts[i + 2] === "" ? 4 : 2);
  return parts.join("");
}

// The "## Result" section an agent ends its work with: up to the next heading of that level, or the end.
const RESULT = /^##[ \t]+Results?[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im;
// The longer write-up an agent keeps out of its Result. "Research" and "Review" are what agents called it before "Details".
// ponytail: only the first such section is taken; a second one stays in the description.
const DETAILS = /^##[ \t]+(?:Details|Research|Review)[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im;

// A description split at the agent's sections: the text without them, the Details text, and the Result's
// own text without the bullets that only name a file (the board lists those as links, see results()).
export function splitResult(text) {
  const cut = re => { const m = re.exec(text); if (m) text = text.slice(0, m.index) + text.slice(m.index + m[0].length); return m; };
  const d = cut(DETAILS), r = cut(RESULT);
  if (!d && !r) return { body: text, result: "", details: "", found: false };
  const result = (r?.[1] ?? "").split(/\r?\n/).filter(line => !/^\s*[-*+]\s+(`[^`\n]+`|\[[^\]]*\]\([^)]+\))\s*$/.test(line)).join("\n").trim();
  return { body: text.trim(), result, details: d?.[1].trim() ?? "", found: true };
}

// Replaces the description around the agent's sections and keeps those, at the end and in their order, as
// the agent wrote them: what a person edits in a task under review is the description, not the agent's text.
export function setBody(text, body) {
  const full = description(text), kept = [DETAILS, RESULT].map(re => re.exec(full)).filter(Boolean).sort((a, b) => a.index - b.index).map(m => m[0].trim());
  return setDescription(text, kept.length ? [body.trim(), ...kept].join("\n\n") : body);
}

// The files an agent lists under "## Result" when it finishes: every `quoted` or [linked](path) entry in
// that section that looks like a file inside the repo. For show: the board reads them, never writes them.
export function results(text) {
  const section = RESULT.exec(text);
  if (!section) return [];
  const found = [...section[1].matchAll(/`([^`\n]+)`|\]\(([^)\s]+)\)/g)].map(m => (m[1] ?? m[2]).trim().replace(/\\/g, "/"))
    .filter(p => /^[\w.@~\-\/:()]+$/.test(p) && /\.\w+$/.test(p) && !/^[a-z]+:\/\//i.test(p) && !p.split("/").includes(".."));
  return [...new Set(found)].slice(0, 20);
}

// A typed filter: every word must be somewhere in the id, title, agent, type or text.
export function matches(card, query) {
  const hay = `${card.id} ${card.title} ${card.agent} ${card.type} ${card.text}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
}

// path: relative to the repo root.
export const startPrompt = (path, back = false) => `Work on the task described in \`${path}\`. Follow the constraints written in that file. Do not commit, push or merge unless the file says you may. When the work is finished, add a \`## Result\` section at the end of that file: two or three lines on what you did, then one bullet per file you created or changed, its path relative to the repo root in backticks. Keep the Result short: a longer write-up (research, options, reasoning) goes in a \`## Details\` section just above it. Then, after your written summary and as your very last action, set the file's Status line to \`In review\` and stop: the card reaching Review means you are done. If the person asks for more on this task afterwards, here in the terminal, bring the Result section up to date with what changed before you stop, every time.${back ? " This task was sent back to you: start with the newest line under the file's Feedback section, and replace the old Result section when you finish." : ""}`;

// A new task file in the format the board reads. The name is the title as a slug.
export function newTask({ title, description, column: id, type, agent, model, date, manual, id: uid }) {
  const clean = title.trim().replace(/\s+/g, " "), body = (description ?? "").trim();
  let slug = clean.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "task";
  if (slug === "readme") slug = "readme-task"; // README.md is never a card
  return { name: `${uid ? `${uid}-` : ""}${slug}.md`, text: `# ${clean}\n\n${manual ? `${NOTICE}\n\n` : ""}**Status:** ${COLUMNS.find(c => c.id === id).word}\n${typeOf(type) ? `**Type:** ${TYPES.find(t => t.key === typeOf(type)).label}\n` : ""}**Agent:**${agent ? ` ${agent}` : ""}\n${agent && modelId(model) ? `**Model:** ${modelId(model)}\n` : ""}**Written:** ${date}\n${body ? `\n${body}\n` : ""}` };
}

// What a task sent back says to the agent that is still there, typed into its terminal: one line, since it is pasted.
export const backPrompt = path => `The task in \`${path}\` was sent back to you and is In progress again. Read the newest line under its Feedback section and continue the work. When you have finished, replace the file's Result section and, after your written summary and as your very last action, set its Status line to \`In review\` and stop.`;

// A note for the agent when a task is sent back: a dated line under "## Feedback", a section added at
// the end of the file when it is not there. Everything else keeps its bytes.
export function addFeedback(text, note, date) {
  const e = text.includes("\r\n") ? "\r\n" : "\n", line = `- ${date}: ${note.trim().replace(/\s*\r?\n\s*/g, " ")}`;
  const section = /^##[ \t]+Feedback[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im.exec(text);
  if (!section) return `${text.replace(/\s+$/, "")}${text.trim() ? e + e : ""}## Feedback${e}${e}${line}${e}`;
  const end = section.index + section[0].replace(/\s+$/, "").length;
  return text.slice(0, end) + e + line + (text.slice(end) || e);
}

// Whether an agent's screen says it stopped on a usage limit (Claude Code: "5-hour limit reached",
// "You've hit your limit"; Codex: "You've hit your usage limit"). Only its last lines count: what it stopped on.
// ponytail: wording match on the screen, as the programs report nothing else; add a phrase here when one changes its message.
export const hitLimit = screen => /limit reached|hit (your|the) (\w+ )?limit|limit (will )?resets?\b|out of (credits|tokens)|quota exceeded/i
  .test(screen.split(/\r?\n/).filter(line => line.trim()).slice(-12).join(" ").replace(/\s+/g, " ")); // one line: a narrow pane wraps the message

// Updates (setup.js): the repo an install comes from, and the commit it was copied at, kept in
// mods/kanbaa/version.json ({ "commit": "<sha>" }) by whoever installs or updates it. The repo itself has none.
export const REPO = "https://github.com/softspike-io/kanbaa";
const SHA = /^[0-9a-f]{40}$/;
// The commit in `git ls-remote <repo> HEAD`'s output, or null.
export const headOf = out => String(out).match(/^([0-9a-f]{40})\s+HEAD$/m)?.[1] ?? null;
export function stampOf(text) {
  try { const c = JSON.parse(text ?? "")?.commit; return SHA.test(c) ? c : null; } catch { return null; }
}
// "current", "available", or "unknown" when the install records no commit.
export const updateState = (installed, latest) => !installed ? "unknown" : installed === latest ? "current" : "available";
// What the agent sent to update an install is told. home: the Herdr app folder it works in.
export const updatePrompt = (home, installed, latest) => `Update Kanbaa, the Herdr layout installed in this folder (${home}), from ${REPO}. ${installed
  ? `The installed copy is commit ${installed}; the newest is ${latest}.`
  : `The installed copy does not record its version; the newest is commit ${latest}.`} Clone the repo into a temporary folder and read its RECIPE.md${installed ? `, and what changed with \`git log ${installed}..${latest}\` and \`git diff ${installed} ${latest}\`` : ""}. Bring the installed copies of layouts/kanbaa.json, mods/kanbaa, mods/kanbaa-tabs and mods/status-menu up to date, by "Layouts and mods other people made" in AGENTS.md here: an installed one may be renamed, missing or changed by the person, so fit the update to what is there. Before writing anything, tell the person what will change, and ask before replacing a file that differs from ${installed ? "its version at the installed commit" : "the repo's"}. Leave RECIPE.md, README.md, preview.png, the tests and the to-do folder out. Then write mods/kanbaa/version.json as {"commit": "${latest}"}, run \`herdr-app check\` on each mod you changed, and if anything under mods/kanbaa/skill changed, tell the person to press Apply under Agents in Kanbaa's ⚙. Delete the temporary clone when you are done.`;
