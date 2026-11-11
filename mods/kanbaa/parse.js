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
export const MAX_FILES = 200;
const HEAD = 30; // **Status:** and **Agent:** count only in the first lines

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
  const parts = split(text), status = field(parts, "Status"), agent = field(parts, "Agent"), h = heading(parts);
  const boxes = text.match(/^[ \t]*[-*+] \[[ xX]\]/gm) ?? [], ticked = boxes.filter(b => !b.endsWith("[ ]")).length;
  const folder = rel.includes("/") && /^(backlog|ready|in-progress|completed)$/i.test(rel.split("/")[0]) ? rel.split("/")[0] : "";
  const raw = status?.value || folder || (!boxes.length || !ticked ? "Backlog" : ticked < boxes.length ? "In progress" : "Done");
  const col = [...COLUMNS, ARCHIVE].find(c => c.id === column(raw)), said = status?.value ?? "";
  return {
    title: (h >= 0 && parts[h].slice(2).trim()) || rel.split("/").pop().replace(/\.md$/i, ""),
    id: taskId(rel),
    // Where the card sits in its status: lower first, and cards without the line after those, by id.
    order: (o => o && o.value !== "" && Number.isFinite(Number(o.value)) ? Number(o.value) : null)(field(parts, "Order")),
    // The header's other **Key:** lines (Written, Repo, …), for show: the board never rewrites them.
    meta: parts.slice(0, descriptionAt(parts)).map((line, i) => i % 2 ? null : /^\*\*([^*]+?):?\*\*:?[ \t]*(.*?)[ \t]*$/.exec(line))
      .filter(m => m && m[2] && !/^(status|agent|order)$/i.test(m[1])).map(m => ({ key: m[1], value: m[2].replace(/`/g, "") })),
    column: col.id,
    // The status as written, when it says more than the column does.
    note: said && ![col.label, col.word].some(w => w.toLowerCase() === said.toLowerCase()) ? said : "",
    agent: agent?.value ?? "",
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

// key "": unassigned.
export function setAgent(text, key) {
  const parts = split(text), f = field(parts, "Agent"), s = field(parts, "Status");
  if (f) put(parts, f, "Agent", key);
  else if (!key) return text;
  else if (s) under(parts, s.i, s.front ? `agent: ${key}` : `**Agent:** ${key}`);
  else block(parts, `**Agent:** ${key}`);
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

// Adds the notice under the title, or removes the line that carries it (and the blank line after it).
export function setManual(text, on) {
  const parts = split(text), i = noticeAt(parts);
  if (on === (i >= 0)) return text;
  if (on) block(parts, NOTICE); else parts.splice(i, parts[i + 2] === "" ? 4 : 2);
  return parts.join("");
}

// The "## Result" section an agent ends its work with: up to the next heading of that level, or the end.
const RESULT = /^##[ \t]+Results?[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im;

// A description split at that section: the text without it, and the section's own text without the
// bullets that only name a file (the board lists those as links, see results()).
export function splitResult(text) {
  const section = RESULT.exec(text);
  if (!section) return { body: text, result: "", found: false };
  const result = section[1].split(/\r?\n/).filter(line => !/^\s*[-*+]\s+(`[^`\n]+`|\[[^\]]*\]\([^)]+\))\s*$/.test(line)).join("\n").trim();
  return { body: (text.slice(0, section.index) + text.slice(section.index + section[0].length)).trim(), result, found: true };
}

// Replaces the description around its "## Result" section and keeps that section, at the end, as the
// agent wrote it: what a person edits in a task under review is the description, not the agent's result.
export function setBody(text, body) {
  const section = RESULT.exec(description(text));
  return setDescription(text, section ? `${body.trim()}\n\n${section[0].trim()}` : body);
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

// A typed filter: every word must be somewhere in the id, title, agent or text.
export function matches(card, query) {
  const hay = `${card.id} ${card.title} ${card.agent} ${card.text}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
}

// path: relative to the repo root.
export const startPrompt = (path, back = false) => `Work on the task described in \`${path}\`. Follow the constraints written in that file. Do not commit, push or merge unless the file says you may. When the work is finished, add a \`## Result\` section at the end of that file: two or three lines on what you did, then one bullet per file you created or changed, its path relative to the repo root in backticks. Then, after your written summary and as your very last action, set the file's Status line to \`In review\` and stop: the card reaching Review means you are done.${back ? " This task was sent back to you: start with the newest line under the file's Feedback section, and replace the old Result section when you finish." : ""}`;

// A new task file in the format the board reads. The name is the title as a slug.
export function newTask({ title, description, column: id, agent, date, manual, id: uid }) {
  const clean = title.trim().replace(/\s+/g, " "), body = (description ?? "").trim();
  let slug = clean.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "task";
  if (slug === "readme") slug = "readme-task"; // README.md is never a card
  return { name: `${uid ? `${uid}-` : ""}${slug}.md`, text: `# ${clean}\n\n${manual ? `${NOTICE}\n\n` : ""}**Status:** ${COLUMNS.find(c => c.id === id).word}\n**Agent:**${agent ? ` ${agent}` : ""}\n**Written:** ${date}\n${body ? `\n${body}\n` : ""}` };
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
