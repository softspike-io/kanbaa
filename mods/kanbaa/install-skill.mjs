#!/usr/bin/env node
// Tells agents how to create Kanbaa tasks, by installing the instructions in skill/ where each agent
// reads them, with this folder's real path to task.mjs filled in (so a renamed mod or a moved
// Herdr home needs no hand edits). Kanbaa's setup panel runs this; so can a person or a recipe.
//
//   node install-skill.mjs [--claude] [--codex] [--hermes]     install or update (no target: --claude)
//   node install-skill.mjs --remove [--claude] [--codex] [--hermes]
//   node install-skill.mjs --status                  JSON: { claude, codex, hermes } each installed | outdated | missing | unavailable
//   node install-skill.mjs --print                   the AGENTS.md section, for any other agent
//
// Claude: its own folder, ~/.claude/skills/kanbaa-task. Hermes: the same skill, in its own folder under
// Hermes's skills (productivity/kanbaa-task). Codex: a block between two marker lines in
// ~/.codex/AGENTS.md; nothing outside the markers is ever touched.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Forward slashes: the same path works in bash, PowerShell and cmd.
const fill = name => readFileSync(join(here, "skill", name), "utf8").replace(/\r\n/g, "\n").replaceAll("{{SCRIPT}}", join(here, "task.mjs").replace(/\\/g, "/"));

const START = "<!-- kanbaa:start (written by Kanbaa's install-skill.mjs; edits inside are replaced) -->", END = "<!-- kanbaa:end -->";
const BLOCK = /<!-- kanbaa:start[^\n]*-->\r?\n[\s\S]*?<!-- kanbaa:end -->/;
const skillFile = join(homedir(), ".claude", "skills", "kanbaa-task", "SKILL.md");
const codexFile = join(homedir(), ".codex", "AGENTS.md");
// Hermes's home: $HERMES_HOME, else %LOCALAPPDATA%\hermes on Windows, else ~/.hermes.
const hermesHome = process.env.HERMES_HOME || (process.platform === "win32" && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "hermes") : join(homedir(), ".hermes"));
const hermesFile = join(hermesHome, "skills", "productivity", "kanbaa-task", "SKILL.md");
// A skill in a folder of its own: present and current, present and old, absent, or no such agent here.
const skillAt = (home, file) => ({
  status() {
    if (!existsSync(home)) return "unavailable";
    const now = read(file);
    return now === null ? "missing" : now.replace(/\r\n/g, "\n") === fill("SKILL.md") ? "installed" : "outdated";
  },
  install() { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, fill("SKILL.md")); },
  remove() { rmSync(dirname(file), { recursive: true, force: true }); },
});
const read = file => existsSync(file) ? readFileSync(file, "utf8") : null;
const block = () => `${START}\n${fill("AGENTS.md").trim()}\n${END}`;

const targets = {
  // Without ~/.claude there is no Claude Code to tell.
  claude: skillAt(join(homedir(), ".claude"), skillFile),
  hermes: skillAt(hermesHome, hermesFile),
  codex: {
    status() {
      if (!existsSync(dirname(codexFile))) return "unavailable";
      const found = BLOCK.exec(read(codexFile) ?? "");
      return !found ? "missing" : found[0].replace(/\r\n/g, "\n") === block() ? "installed" : "outdated";
    },
    // The block takes the file's line endings; the rest of the file keeps its bytes.
    install() {
      const now = read(codexFile) ?? "", eol = now.includes("\r\n") ? "\r\n" : "\n", mine = block().replace(/\n/g, eol);
      writeFileSync(codexFile, BLOCK.test(now) ? now.replace(BLOCK, () => mine) : now + (now && !now.endsWith("\n") ? eol : "") + (now ? eol : "") + mine + eol);
    },
    remove() {
      const now = read(codexFile);
      if (now !== null && BLOCK.test(now)) writeFileSync(codexFile, now.replace(new RegExp(`(\\r?\\n)?${BLOCK.source}(\\r?\\n)?`), ""));
    },
  },
};

const flags = process.argv.slice(2).map(a => a.replace(/^--/, ""));
const unknown = flags.find(f => !["claude", "codex", "hermes", "remove", "status", "print"].includes(f));
if (unknown) { console.error(`install-skill: unknown argument --${unknown}. Arguments: --claude, --codex, --hermes, --remove, --status, --print`); process.exit(1); }

if (flags.includes("print")) console.log(fill("AGENTS.md").trim());
else if (flags.includes("status")) console.log(JSON.stringify({ claude: targets.claude.status(), codex: targets.codex.status(), hermes: targets.hermes.status() }));
else {
  const chosen = ["claude", "codex", "hermes"].filter(t => flags.includes(t)), remove = flags.includes("remove");
  if (remove && !chosen.length) { console.error("install-skill: say what to remove: --claude, --codex, --hermes"); process.exit(1); }
  for (const name of chosen.length ? chosen : ["claude"]) {
    if (targets[name].status() === "unavailable") { console.error(`install-skill: ${name} was not found on this computer`); process.exitCode = 1; continue; }
    targets[name][remove ? "remove" : "install"]();
    console.log(`${name}: ${targets[name].status()}`);
  }
}
