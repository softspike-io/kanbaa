// hc can paste into Codex without its Enter starting a turn. Watch while send
// is in flight instead of waiting for its several-second "started" timeout.
// Two matching composer reads and a resting agent guard the extra Enter.
export async function sendBackMessage(io, address, body) {
  const restingCodex = () => {
    const agent = io.agents().find(a => a.address === address);
    return agent?.app === "codex" && ["idle", "done"].includes(agent.status);
  };
  const going = io.hc(["send", "--json", address, body]);
  if (!restingCodex()) return going;
  let done = false, sent, error, submitted;
  const settled = going.then(r => { done = true; sent = r; }, e => { done = true; error = e; });
  const waitingForTurn = () => {
    if (!done) return true;
    try { return !error && sent.code === 0 && JSON.parse(sent.stdout).started === false; }
    catch { return false; }
  };
  const normalize = text => text.replace(/\s+/g, "");
  let last = null;
  try {
    let afterSend = 0;
    while (!done || afterSend < 2) {
      await io.sleep(100);
      if (done) afterSend++;
      if (!waitingForTurn()) break;
      if (!restingCodex()) break;
      const screen = await io.hc(["read", "--json", address, "--lines", "0"]);
      if (screen.code !== 0) break;
      // Only the last input mark counts, never earlier transcript copies.
      const composer = String(JSON.parse(screen.stdout).text).split(/(?:^|\n)\s*›\s?/).slice(1).pop();
      const box = composer ? normalize(composer) : null;
      // Let a concurrently arriving send acknowledgement settle before deciding
      // whether another Enter is still needed.
      await Promise.resolve();
      if (box?.startsWith(normalize(body)) && box === last && restingCodex() && waitingForTurn()) {
        submitted = await io.hc(["keys", "--json", address, "enter"]).catch(e => ({ code: 1, stderr: String(e) }));
        break;
      }
      last = box;
    }
  } catch {
    // A screen read is only a hint. A failed read must not abandon the send
    // already in flight or paste the message again.
  }
  await settled;
  if (error) throw error;
  return sent.code !== 0 ? sent : submitted ?? sent;
}

// Delivery must not leave a "stay" action on its agent's tab. If the person
// chose a third tab meanwhile, that navigation takes precedence.
export function restoreBoard(io, origin, target) {
  const now = io.focused();
  if (!origin?.tab || !now || (now.tab !== origin.tab && now.tab !== target.tab)) return;
  if (now.tab !== origin.tab) {
    if (origin.space) io.run("space.select", { id: origin.space });
    io.run("tab.select", { id: origin.tab });
  }
  io.run("layout.show", { id: "board" });
  io.focusBoard();
}
