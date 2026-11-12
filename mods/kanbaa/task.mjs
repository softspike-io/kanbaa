#!/usr/bin/env node
// Kanbaa tasks from a shell, for agents: the same files, ids and status lines the board writes
// (parse.js). Not part of the mod: Herdr never loads it.
//
//   node task.mjs new --title "Fix the login bug" [--description "…" | --description -]
//                     [--status backlog|ready|progress|review|done] [--agent claude] [--model opus] [--manual] [--repo <folder>]
//   node task.mjs move <ID | file.md> <backlog|ready|progress|review|done> [--repo <folder>]
//
// Run inside the repo (or pass --repo). --description - reads it from stdin. Prints the id and the path.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { COLUMNS, column, counterPath, issue, issuedIn, modelId, newTask, nextId, repoName, setStatus, taskId } from "./parse.js";

const DIRS = ["to-do", "todo", "docs/to-do", "docs/todo"]; // as main.js list()
const USAGE = "Usage: task.mjs new --title <title> [--description <text|->] [--status <status>] [--agent <key>] [--model <id>] [--manual] [--repo <folder>]\n       task.mjs move <ID | file.md> <status> [--repo <folder>]";

function fail(message) {
  console.error(`task: ${message}`);
  process.exit(1);
}

// Flags by name, everything else in order.
function read(argv, flags) {
  const args = { manual: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].startsWith("--") ? argv[i].slice(2) : null;
    if (flag === "manual") args.manual = true;
    else if (flag && flags.includes(flag) && argv[i + 1] !== undefined) args[flag] = argv[++i];
    else if (flag) fail(`unknown or incomplete argument ${argv[i]}\n${USAGE}`);
    else args.rest.push(argv[i]);
  }
  return args;
}

// A column id ("progress") or any status wording the board reads ("In progress", "Ready").
function status(word, otherwise) {
  if (!word) return otherwise ?? fail(`a status is required: backlog, ready, progress, review or done`);
  const id = COLUMNS.find(c => c.id === word.trim().toLowerCase())?.id ?? column(word);
  if (id === "archive") fail("tasks are archived on the board, not by this script. Use backlog, ready, progress, review or done");
  if (id === "backlog" && !/^(backlog|draft)$/i.test(word.trim())) fail(`unknown status "${word}". Use backlog, ready, progress, review or done`);
  return id;
}

// The repo's root, its name and its to-do folder (the first that exists, else to-do).
function place(repo) {
  const cwd = resolve(repo ?? process.cwd());
  if (!existsSync(cwd)) fail(`no such folder: ${cwd}`);
  let top = "", common = "";
  try {
    [top, common] = execFileSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim().split(/\r?\n/).map(line => line.trim());
  } catch { /* not a git repo: the folder itself */ }
  const root = top || cwd, dir = DIRS.find(d => existsSync(join(root, d)) && statSync(join(root, d)).isDirectory()) ?? DIRS[0];
  return { cwd, root, dir, folder: join(root, dir), name: repoName(common, root), counter: counterPath(common, join(root, dir)) };
}
// Every file there and one folder down, as on the board: paths relative to the to-do folder.
const files = folder => !existsSync(folder) ? [] : readdirSync(folder, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? readdirSync(join(folder, e.name)).map(name => `${e.name}/${name}`) : [e.name]);

const [command, ...argv] = process.argv.slice(2);

if (command === "new") {
  const args = read(argv, ["title", "description", "status", "agent", "model", "repo"]);
  if (args.model && (!args.agent || !modelId(args.model))) fail(args.agent ? `"${args.model}" does not look like a model id` : "--model needs --agent: a model belongs to an agent");
  if (!args.title?.trim() || args.rest.length) fail(`new needs --title\n${USAGE}`);
  const at = place(args.repo), col = status(args.status, "backlog");
  mkdirSync(at.folder, { recursive: true });
  const description = args.description === "-" ? readFileSync(0, "utf8") : args.description ?? "";
  // The counter of ids handed out, shared with the board: a deleted task's number is not used again.
  const counted = existsSync(at.counter) ? readFileSync(at.counter, "utf8") : null;
  const date = new Date(), two = n => String(n).padStart(2, "0"), id = nextId(at.name, files(at.folder), issuedIn(counted, at.name));
  const { name, text } = newTask({ title: args.title, description, column: col, agent: args.agent ?? "", model: args.model ?? "", manual: args.manual, id,
    date: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}` });
  try { writeFileSync(join(at.folder, name), text, { flag: "wx" }); } // wx: never over an existing task
  catch (e) { fail(`could not create ${at.dir}/${name}: ${e.message}`); }
  const count = issue(counted, id);
  if (count) try { writeFileSync(at.counter, count); } catch { /* the id is still unique among the files that exist */ }
  console.log(`${id} ${at.dir}/${name}`);
} else if (command === "move") {
  const args = read(argv, ["repo"]), [which, word] = args.rest;
  if (!which || args.rest.length !== 2) fail(`move needs a task and a status\n${USAGE}`);
  const at = place(args.repo), col = COLUMNS.find(c => c.id === status(word));
  // A file path for tasks without an id; else the one file whose name starts with the id.
  let file;
  if (/\.md$/i.test(which) && existsSync(resolve(at.cwd, which))) file = resolve(at.cwd, which);
  else {
    const found = files(at.folder).filter(rel => taskId(rel) === which.toUpperCase());
    if (found.length !== 1) fail(found.length ? `${which} names ${found.length} files in ${at.dir}: ${found.join(", ")}` : `no task ${which} in ${at.dir}`);
    file = join(at.folder, found[0]);
  }
  const text = readFileSync(file, "utf8"), next = setStatus(text, col.word);
  if (next !== text) writeFileSync(file, next);
  console.log(`${taskId(file) || "task"} ${relative(at.root, file).replace(/\\/g, "/")}: ${col.label}`);
} else fail(USAGE);
