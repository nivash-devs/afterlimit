#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const NOTE = "HANDOFF.md";

const SECTIONS = [
  ["Goal", "What we're building and what done looks like."],
  ["Current state", "What works right now and what's broken."],
  ["Done so far", "Finished steps. Name the files and functions."],
  ["Tried and failed", "Approaches that didn't work, and why. The next agent must not retry these."],
  ["Decisions", "Choices we made and the reason for each."],
  ["Open questions", "Anything unresolved, or that I still need to decide."],
  ["Next step", "The single next thing to do."],
  ["Files", "Every file you created or changed, one per line, with a short note."],
  ["Commands", "How to install, run, build and test the project."],
];

const AGENTS = {
  claude: { name: "Claude Code", bin: "claude", file: "CLAUDE.md" },
  codex: { name: "Codex", bin: "codex", file: "AGENTS.md" },
};

const MARK_START = "<!-- afterlimit:start -->";
const MARK_END = "<!-- afterlimit:end -->";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c(32), yellow = c(33), dim = c(2), bold = c(1);

function template() {
  return "# Handoff\n\n" + SECTIONS.map(([k, h]) => `## ${k}\n<!-- ${h} -->\n`).join("\n");
}

function agentInstructions() {
  return [
    MARK_START,
    "## Handoff note (afterlimit)",
    "",
    `This project may be worked on by more than one AI agent. ${NOTE} is the shared handoff note.`,
    "",
    `- Read ${NOTE} before starting any task.`,
    `- After each meaningful step, update ${NOTE} so another agent could take over with no other context. Keep every heading: ${SECTIONS.map(([k]) => k).join(", ")}.`,
    "- Record failed approaches under \"Tried and failed\" and the reasons behind choices under \"Decisions\".",
    "- Keep it short. Replace stale lines instead of appending forever.",
    MARK_END,
    "",
  ].join("\n");
}

function requestPrompt() {
  return [
    `I'm about to switch to another AI agent to continue this work. Update ${NOTE} in the project root as a handoff note for it.`,
    "",
    "Use exactly these Markdown headings, in this order, and fill every one:",
    "",
    ...SECTIONS.flatMap(([k, h]) => [`## ${k}`, h]),
    "",
    "Write it for an agent that has never seen this conversation. Don't skip anything because it seems obvious. If a section has nothing in it, write \"None\".",
  ].join("\n");
}

function parse(text) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "");
  const heads = [];
  const re = /^#{1,4}\s*(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(clean)) !== null) {
    heads.push({ title: m[1].toLowerCase().replace(/[*:_`]/g, "").trim(), start: m.index, bodyStart: re.lastIndex });
  }
  const status = {};
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].start : clean.length;
    const body = clean.slice(h.bodyStart, end).trim();
    for (const [k] of SECTIONS) {
      if (h.title.startsWith(k.toLowerCase())) status[k] = body.length > 0 ? "filled" : "empty";
    }
  });
  return SECTIONS.map(([k]) => ({ key: k, state: status[k] || "missing" }));
}

function readNote(cwd) {
  const p = join(cwd, NOTE);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function report(results) {
  const filled = results.filter((r) => r.state === "filled").length;
  for (const r of results) {
    const mark = r.state === "filled" ? green("✓") : yellow("✗");
    const note = r.state === "filled" ? "" : dim(` (${r.state})`);
    console.log(`  ${mark} ${r.key}${note}`);
  }
  const gaps = results.length - filled;
  console.log("");
  console.log(
    gaps === 0
      ? green(`${filled}/${results.length} sections filled. Nothing to re-explain.`)
      : yellow(`${filled}/${results.length} sections filled. ${gaps} gap${gaps === 1 ? "" : "s"} you'd have to explain by hand.`)
  );
  return gaps;
}

function pickupPrompt(note, fromName) {
  return [
    `You're taking over a coding task from another AI agent${fromName ? ` (${fromName})` : ""} that ran out of usage. Its handoff note is in ${NOTE} and copied below.`,
    "",
    "Before you change anything:",
    "1. Read every file listed under Files.",
    "2. Reply with the goal and the next step in your own words, plus anything in the note that's unclear.",
    "3. Wait for me to confirm.",
    "",
    "Rules: don't redo anything under Done so far. Don't retry anything under Tried and failed. Keep everything under Decisions unless I say otherwise.",
    `Keep ${NOTE} updated as you work, so the next switch is just as clean.`,
    "",
    "--- HANDOFF NOTE ---",
    note.replace(/<!--[\s\S]*?-->/g, "").trim(),
    "--- END ---",
  ].join("\n");
}

function cmdInit(cwd) {
  const notePath = join(cwd, NOTE);
  if (existsSync(notePath)) {
    console.log(dim(`${NOTE} already exists, left as is.`));
  } else {
    writeFileSync(notePath, template());
    console.log(green(`Created ${NOTE}`));
  }
  for (const a of Object.values(AGENTS)) {
    const p = join(cwd, a.file);
    const current = existsSync(p) ? readFileSync(p, "utf8") : "";
    if (current.includes(MARK_START)) {
      console.log(dim(`${a.file} already has afterlimit instructions.`));
      continue;
    }
    appendFileSync(p, (current && !current.endsWith("\n") ? "\n\n" : current ? "\n" : "") + agentInstructions());
    console.log(green(`${current ? "Updated" : "Created"} ${a.file}`) + dim(` (read by ${a.name})`));
  }
  console.log("");
  console.log(`Agents will now keep ${NOTE} current as they work. When one hits its limit, run:`);
  console.log(bold("  npx afterlimit to codex") + dim("   or   ") + bold("npx afterlimit to claude"));
}

function cmdCheck(cwd) {
  const note = readNote(cwd);
  if (note === null) {
    console.log(yellow(`No ${NOTE} here. Run "npx afterlimit init" first.`));
    return 1;
  }
  console.log(bold(`${NOTE}`));
  return report(parse(note)) === 0 ? 0 : 1;
}

function cmdTo(cwd, target, flags) {
  const agent = AGENTS[target];
  if (!agent) {
    console.error(`Unknown agent "${target || ""}". Use one of: ${Object.keys(AGENTS).join(", ")}`);
    return 2;
  }
  const note = readNote(cwd);
  if (note === null) {
    console.error(yellow(`No ${NOTE} here. Run "npx afterlimit init", or "npx afterlimit request" to get one written.`));
    return 1;
  }
  const from = Object.values(AGENTS).find((a) => a !== agent);
  const prompt = pickupPrompt(note, from && from.name);

  if (!flags.print) {
    console.log(bold(`${NOTE}`));
    const gaps = report(parse(note));
    if (gaps > 0 && flags.strict) return 1;
    if (gaps > 0) console.log(dim(`Handing over anyway. Use --strict to stop when sections are missing.`));
  }

  if (flags.print) {
    process.stdout.write(prompt + "\n");
    return 0;
  }

  console.log("");
  console.log(`Starting ${agent.name} with the handoff...`);
  const child = spawn(agent.bin, [prompt], { stdio: "inherit", cwd, shell: process.platform === "win32" });
  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      console.error(yellow(`Couldn't find "${agent.bin}". Install ${agent.name} first, or run with --print and paste the prompt yourself.`));
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return null;
}

function help() {
  console.log(`${bold("afterlimit")} ${dim("v0.1.0")}
Switch between Claude Code and Codex when one hits its usage limit, without re-explaining your project.

${bold("Usage")}
  npx afterlimit init            Create ${NOTE} and tell both agents to keep it updated
  npx afterlimit request         Print a prompt that makes the current agent write the note
  npx afterlimit check           Show which sections of ${NOTE} are filled
  npx afterlimit to <agent>      Start the other agent with the handoff (agent: codex, claude)

${bold("Options for 'to'")}
  --print     Print the pickup prompt instead of starting the agent
  --strict    Stop if any section is missing
`);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => [a.slice(2), true]));
const args = rest.filter((a) => !a.startsWith("--"));
const cwd = process.cwd();

let code = 0;
switch (cmd) {
  case "init": cmdInit(cwd); break;
  case "request": console.log(requestPrompt()); break;
  case "check": code = cmdCheck(cwd); break;
  case "to": code = cmdTo(cwd, args[0], flags); break;
  case undefined: case "help": case "--help": case "-h": help(); break;
  default:
    console.error(`Unknown command "${cmd}".\n`);
    help();
    code = 2;
}
if (code !== null) process.exitCode = code;
