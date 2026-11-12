import { test } from "node:test";
import assert from "node:assert/strict";
import { sendBackMessage, restoreBoard } from "./send-back.js";

const body = "Read the newest Feedback line and continue the work.";
function fixture({ started = false, app = "codex", status = "done", screen = `› Read the newest Feedback line\n  and continue the work.\n\n  context left`, sendCode = 0, keyCode = 0, afterRead } = {}) {
  const calls = [];
  const agent = { address: "t7", app, status };
  const io = {
    sleep: async () => {},
    agents: () => [agent],
    hc: async args => {
      calls.push(args);
      if (args[0] === "send") return { code: sendCode, stdout: JSON.stringify({ started }) };
      if (args[0] === "read") { afterRead?.(agent); return { code: 0, stdout: JSON.stringify({ text: screen }) }; }
      return { code: keyCode };
    },
  };
  return { io, calls };
}

test("a Codex paste left in its composer gets one separate Enter, never another paste", async () => {
  const { io, calls } = fixture();
  assert.equal((await sendBackMessage(io, "t7", body)).code, 0);
  assert.deepEqual(calls, [["send", "--json", "t7", body], ["read", "--json", "t7", "--lines", "0"], ["read", "--json", "t7", "--lines", "0"], ["keys", "--json", "t7", "enter"]]);
});

test("a started turn, unknown receipt, other CLI, or non-resting agent gets no extra key", async () => {
  for (const options of [{ started: true }, { started: null }, { app: "claude-code" }, { status: "working" }, { status: "blocked" }, { sendCode: 1 }]) {
    const { io, calls } = fixture(options);
    await sendBackMessage(io, "t7", body);
    assert.equal(calls.length, 1, JSON.stringify(options));
  }
});

test("screen wrapping inside a word still recognizes the pasted message", async () => {
  const { io, calls } = fixture({ status: "idle", screen: `› ${body.replace("Feedback", "Feed\n  back")}` });
  await sendBackMessage(io, "t7", body);
  assert.equal(calls.at(-1)[0], "keys");
});

test("transcript text and a different composer do not trigger Enter", async () => {
  for (const screen of [body, `› ${body}\n\nAssistant answered.\n› another draft`, "› unrelated draft", ""]) {
    const { io, calls } = fixture({ screen });
    await sendBackMessage(io, "t7", body);
    assert.equal(calls.some(c => c[0] === "keys"), false);
  }
});

test("status is checked again after reading so a newly blocked or working agent gets no key", async () => {
  for (const status of ["working", "blocked"]) {
    const { io, calls } = fixture({ afterRead: agent => { agent.status = status; } });
    await sendBackMessage(io, "t7", body);
    assert.equal(calls.some(c => c[0] === "keys"), false);
  }
});

test("failure to submit is returned to the board for its warning toast", async () => {
  const { io } = fixture({ keyCode: 1 });
  assert.equal((await sendBackMessage(io, "t7", body)).code, 1);
});

test("Enter starts the turn while send is still awaiting its started acknowledgement", async () => {
  const { io, calls } = fixture();
  const hc = io.hc;
  let acknowledge, finished = false;
  io.hc = async args => {
    if (args[0] === "send") {
      calls.push(args);
      return new Promise(resolve => { acknowledge = resolve; });
    }
    if (args[0] === "keys") {
      assert.equal(finished, false);
      acknowledge({ code: 0, stdout: JSON.stringify({ started: true }) });
      finished = true;
    }
    return hc(args);
  };
  await sendBackMessage(io, "t7", body);
  assert.equal(finished, true);
  assert.equal(calls.filter(c => c[0] === "send").length, 1);
  assert.equal(calls.filter(c => c[0] === "keys").length, 1);
});

test("an agent becoming working between the two composer reads gets no extra Enter", async () => {
  const { io, calls } = fixture();
  const hc = io.hc;
  io.hc = async args => {
    const r = await hc(args);
    if (calls.filter(c => c[0] === "read").length === 2) io.agents = () => [{ address: "t7", app: "codex", status: "working" }];
    return r;
  };
  await sendBackMessage(io, "t7", body);
  assert.equal(calls.some(c => c[0] === "keys"), false);
});

test("the watcher keeps waiting when hc has not pasted during its initial quiet period", async () => {
  const { io, calls } = fixture();
  const hc = io.hc;
  let acknowledge, reads = 0;
  io.hc = async args => {
    if (args[0] === "send") return new Promise(resolve => { acknowledge = resolve; });
    if (args[0] === "read" && ++reads <= 25) return { code: 0, stdout: JSON.stringify({ text: "›" }) };
    if (args[0] === "keys") acknowledge({ code: 0, stdout: JSON.stringify({ started: true }) });
    return hc(args);
  };
  await sendBackMessage(io, "t7", body);
  assert.equal(reads, 27);
  assert.equal(calls.filter(c => c[0] === "keys").length, 1);
});

test("a started acknowledgement arriving during a screen read cancels the fallback", async () => {
  const { io, calls } = fixture();
  const hc = io.hc;
  let acknowledge, reads = 0;
  io.hc = async args => {
    if (args[0] === "send") return new Promise(resolve => { acknowledge = resolve; });
    const r = await hc(args);
    if (args[0] === "read" && ++reads === 2) acknowledge({ code: 0, stdout: JSON.stringify({ started: true }) });
    return r;
  };
  await sendBackMessage(io, "t7", body);
  assert.equal(calls.some(c => c[0] === "keys"), false);
});

test("stay restores the board from the target tab, but respects a different tab the person chose", () => {
  for (const tab of ["origin", "agent", "other"]) {
    const calls = [];
    restoreBoard({ focused: () => ({ tab }), run: (...args) => calls.push(args), focusBoard: () => calls.push(["focus-board"]) }, { tab: "origin", space: "space" }, { tab: "agent" });
    assert.deepEqual(calls, tab === "other" ? [] : [
      ...(tab === "agent" ? [["space.select", { id: "space" }], ["tab.select", { id: "origin" }]] : []),
      ["layout.show", { id: "board" }], ["focus-board"],
    ]);
  }
});
