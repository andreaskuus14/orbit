import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentCommand, BUILTIN_AGENT_NAMES, agentAck, agentReply } from "../src/lib/agent-command-pure.ts";

const AGENTS = [...BUILTIN_AGENT_NAMES, { slug: "scout-bot", name: "Scout Bot" }];
const p = (t: string) => parseAgentCommand(t, AGENTS);

test("agent commands", () => {
  const yes: [string, string, string][] = [
    ["Atlas, research CS2 trends", "atlas", "research CS2 trends"],
    ["hey Atlas research the best Roblox pet games", "atlas", "research the best Roblox pet games"],
    ["ask Atlas to research CS2 trends", "atlas", "research CS2 trends"],
    ["tell Echo to write a summary of my notes", "echo", "write a summary of my notes"],
    ["Nova: summarise my week", "nova", "summarise my week"],
    ["give Forge a task: draft a launch plan.", "forge", "draft a launch plan"],
    ["Hey Orbit, ask atlas to research CS2 trends please", "atlas", "research CS2 trends"],
    ["orbit tell ECHO to write a poem", "echo", "write a poem"],
    ["Can you ask Vector to analyse my usage", "vector", "analyse my usage"],
    ["Orbit QA, check the last research report", "qa", "check the last research report"],
    ["qa: verify the Atlas report", "qa", "verify the Atlas report"],
    ["Scout Bot, find new Roblox trends", "scout-bot", "find new Roblox trends"],
    ["Atlas — what's the CS2 meta right now?", "atlas", "what's the CS2 meta right now?"],
  ];
  for (const [text, agent, request] of yes) assert.deepEqual(p(text), { agent, request }, text);
});

test("not agent commands", () => {
  for (const t of [
    "what is Atlas doing?", "who is Echo", "is Atlas busy", "Atlas is busy right now", "open Atlas", "show agents",
    "Atlas, what are you doing?", "Atlas status", "ask Atlas", "Atlas, hi", "tell me about Atlas", "go to agents",
    "Zorro, research CS2 trends", "ask Bob to write a poem", "research CS2 trends", "", "Atlases are maps of the world",
  ]) assert.equal(p(t), null, t);
});

test("no punctuation after the name needs an imperative", () => {
  assert.deepEqual(p("Atlas research CS2 trends"), { agent: "atlas", request: "research CS2 trends" });
  assert.deepEqual(p("forge summarize my week please"), { agent: "forge", request: "summarize my week" });
  assert.deepEqual(p("hey Vector analyse my AI usage"), { agent: "vector", request: "analyse my AI usage" });
  for (const t of ["Echo chamber effects explained", "Pulse rate is high", "Atlas shrugged is a good book", "Nova researchers found water"])
    assert.equal(p(t), null, t);
  // With punctuation any request still works.
  assert.deepEqual(p("Echo, chamber music playlist ideas"), { agent: "echo", request: "chamber music playlist ideas" });
  assert.deepEqual(p("Pulse: AI news this morning"), { agent: "pulse", request: "AI news this morning" });
  assert.deepEqual(p("Nova - plan tomorrow for me"), { agent: "nova", request: "plan tomorrow for me" });
});

test("short requests and empty roster", () => {
  assert.equal(p("Atlas, go"), null);
  assert.equal(p("Atlas, summarise"), null); // 1 word, < 12 chars
  assert.deepEqual(p("Atlas, benchmarking!"), { agent: "atlas", request: "benchmarking" }); // 12 chars
});

test("acks", () => {
  assert.equal(agentAck("Atlas"), "Atlas is on it.");
  assert.equal(agentReply("Atlas", "Research CS2"), "Atlas started: Research CS2");
  assert.equal(parseAgentCommand("Atlas, research CS2 trends", []), null);
});
