import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cacheEntryOk, chainMembers, docFromYaml, docsBlock, docUrls, extractApiNames, formatDoc, fresh, levenshtein, parseYaml, pruneCache, suggest, validName, validateApiUse,
  DOC_TTL_MS, MAX_DOC_CHARS, MAX_YAML_DEPTH, type ApiDoc, type Member,
} from "../src/lib/roblox-docs-pure.ts";
import { buildLuauPrompt } from "../src/lib/luau-pure.ts";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("extractApiNames: services, Instance.new, GetService, Enum, hints; order, dedupe, cap", () => {
  const code = 'local TS = game:GetService("TweenService")\nlocal p = Instance.new("Part")\np.Material = Enum.Material.Neon\nlocal h = c:FindFirstChildOfClass("Humanoid")\nlocal x = Instance.new("Foo bar")';
  assert.deepEqual(extractApiNames(code), ["TweenService", "TweenInfo", "Part", "Enum.Material", "Humanoid"]); // TweenInfo: the "tween" hint
  assert.deepEqual(extractApiNames("make a door that tweens open"), ["TweenService", "TweenInfo"]);
  assert.deepEqual(extractApiNames("Use CFrame and Vector3, then CFrame again"), ["CFrame", "Vector3"]);
  assert.deepEqual(extractApiNames("workspace.Gravity = 0"), ["Workspace"]);
  assert.deepEqual(extractApiNames("myPlayers.Part x.CFrame"), []); // not standalone names
  assert.equal(extractApiNames("Players Lighting Debris Teams Sound Frame Tool Model Camera", 3).length, 3);
  assert.deepEqual(extractApiNames('Instance.new("Instance")'), ["Instance"]); // via Instance.new only, not the bare word
});

test("validName / docUrls guard the URL path", () => {
  assert.ok(validName("Enum.Material") && validName("UDim2"));
  for (const bad of ["../x", "a/b", "Enum.", "1Part", "Part.yaml", "x".repeat(70)]) assert.equal(validName(bad), false);
  assert.deepEqual(docUrls("../../etc"), []);
  assert.match(docUrls("Enum.Material")[0], /\/enums\/Material\.yaml$/);
  assert.match(docUrls("CFrame")[0], /\/datatypes\/CFrame\.yaml$/);
  assert.match(docUrls("Humanoid")[0], /\/classes\/Humanoid\.yaml$/);
  assert.match(docUrls("Humanoid")[1], /\/datatypes\/Humanoid\.yaml$/);
});

test("parseYaml: subset (block scalars, nested lists of maps, quotes, empties)", () => {
  const y = parseYaml(`# c\nname: X\nsummary: |\n  line one\n\n  ## heading # kept\ntags: []\ndep: ''\nq: 'it''s'\nn: 42\nlist:\n  - a\n  - b: 1\n    c:\n      - name: p\n        default:\n  - [x, y]\nsame:\n- k: v\nfold: >\n  a\n  b\nend: true\n`);
  assert.deepEqual(y, { name: "X", summary: "line one\n\n## heading # kept\n", tags: [], dep: "", q: "it's", n: 42, list: ["a", { b: 1, c: [{ name: "p", default: null }] }, ["x", "y"]], same: [{ k: "v" }], fold: "a b\n", end: true });
});

test("parseYaml: odd keys, depth cap, never throws", () => {
  assert.deepEqual(parseYaml("a: 1\n: x\n__proto__: 2\nb: 3"), { a: 1, b: 3 }); // empty key and __proto__ skipped
  assert.equal(Object.getPrototypeOf(parseYaml("__proto__:\n  polluted: true")), Object.prototype);
  const deep = (n: number) => Array.from({ length: n }, (_, k) => `${"  ".repeat(k)}k${k}:`).join("\n") + ` v`;
  assert.ok(parseYaml(deep(MAX_YAML_DEPTH - 2)));
  assert.equal(parseYaml(deep(MAX_YAML_DEPTH + 5)), null);
  assert.deepEqual(parseYaml(""), null);
  assert.equal(parseYaml("x: |\n" + "  line\n".repeat(200_000)) !== null, true); // no Math.min(...spread) stack overflow
});

test("parseYaml + docFromYaml on the TweenService fixture (real creator-docs file)", () => {
  const y = parseYaml(fx("roblox-TweenService.yaml")) as Record<string, unknown>;
  assert.equal(y.name, "TweenService");
  assert.deepEqual(y.inherits, ["Instance"]);
  const m0 = (y.methods as Record<string, unknown>[])[0];
  assert.equal(m0.name, "TweenService:Create");
  assert.deepEqual((m0.parameters as Record<string, unknown>[]).map((p) => p.name), ["instance", "tweenInfo", "propertyTable"]);
  assert.match(m0.summary as string, /^Creates a new `Class.Tween`/);
  const d = docFromYaml(y)!;
  assert.equal(d.kind, "class");
  assert.equal(d.members.find((m) => m.name === "Create")?.sig, "Create(instance: Instance, tweenInfo: TweenInfo, propertyTable: Dictionary): Tween");
  assert.ok(d.members.every((m) => m.kind === "method"));
  assert.doesNotMatch(d.summary, /Class\./);
});

test("docFromYaml on the Material enum fixture; formatDoc caps length", () => {
  const d = docFromYaml(parseYaml(fx("roblox-Material.yaml")))!;
  assert.equal(d.name, "Enum.Material");
  assert.ok(d.members.some((m) => m.name === "Neon" && m.kind === "item"));
  const t = formatDoc(d);
  assert.match(t, /^## Enum\.Material \(enum\)/);
  assert.match(t, /Items: .*Neon/);
  const big: ApiDoc = { name: "Big", kind: "class", summary: "s", inherits: [], members: Array.from({ length: 400 }, (_, i) => ({ name: `Member${i}`, kind: "method", sig: `Member${i}(a: number, b: string): boolean` })) };
  assert.ok(formatDoc(big).length <= MAX_DOC_CHARS);
  const mid: ApiDoc = { ...big, members: big.members.slice(0, 60) }; // too long with signatures, fits as names
  assert.match(formatDoc(mid), /Methods: Member0, Member1/);
  assert.equal(docFromYaml(parseYaml("name: x\ntype: page")), null);
});

// Hand-made docs shaped like the real ones (Humanoid → Instance → Object).
const M = (name: string, kind: Member["kind"] = "property", dep?: string): Member => ({ name, kind, sig: name, ...(dep ? { dep } : {}) });
const DOCS: Record<string, ApiDoc> = {
  Object: { name: "Object", kind: "class", summary: "", inherits: [], members: [M("ClassName"), M("IsA", "method")] },
  Instance: { name: "Instance", kind: "class", summary: "", inherits: ["Object"], members: [M("Name"), M("Parent"), M("Destroy", "method"), M("WaitForChild", "method"), M("FindFirstChildOfClass", "method")] },
  Humanoid: { name: "Humanoid", kind: "class", summary: "", inherits: ["Instance"], members: [M("WalkSpeed"), M("JumpPower"), M("Health"), M("TakeDamage", "method"), M("LoadAnimation", "method", "Use Animator:LoadAnimation()"), M("Died", "event")] },
  Part: { name: "Part", kind: "class", summary: "", inherits: ["BasePart"], members: [M("Shape")] }, // BasePart missing → never validated
  CFrame: { name: "CFrame", kind: "datatype", summary: "", inherits: [], members: [M("new", "constructor"), M("Angles", "constructor"), M("identity", "constant"), M("Position")] },
  "Enum.Material": { name: "Enum.Material", kind: "enum", summary: "", inherits: [], members: [M("Neon", "item"), M("Wood", "item"), M("Pebble", "item", "deprecated")] },
};

test("levenshtein + suggest", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("same", "same"), 0);
  const ms = DOCS.Humanoid.members;
  assert.equal(suggest("Speed", ms), "WalkSpeed"); // containment
  assert.equal(suggest("walkspeed", ms), "WalkSpeed"); // case
  assert.equal(suggest("Helth", ms), "Health"); // edit distance
  assert.equal(suggest("LoadAnimations", ms), null); // deprecated members are never suggested
  assert.equal(suggest("Zzzzzz", ms), null);
});

test("chainMembers needs every ancestor", () => {
  assert.ok(chainMembers("Humanoid", DOCS)!.some((m) => m.name === "ClassName"));
  assert.equal(chainMembers("Part", DOCS), null);
  assert.equal(chainMembers("Nope", DOCS), null);
});

test("validateApiUse: wrong members, deprecated, enums, datatype statics; no false alarms", () => {
  const code = [
    'local hum = char:FindFirstChildOfClass("Humanoid")', // 1
    "hum.Speed = 30", // 2: flagged with suggestion
    "hum.WalkSpeed = 16 -- hum.Bogus = 1", // 3: fine (comment ignored)
    "hum:LoadAnimation(anim)", // 4: deprecated
    "hum:Jump()", // 5: method that doesn't exist → flagged even without suggestion
    "print(hum.Torso, hum.Name, hum.Parent.Name, hum.Died)", // 6: Torso may be a child (no suggestion, not assigned) → quiet
    "hum.Speed = 31", // 7: same issue only once
    "local p = Instance.new(\"Part\")\np.Bogus = 1", // 8-9: Part chain incomplete → quiet
    "local m = Enum.Material.Neonn + Enum.Material.Wood + Enum.Material.Pebble", // 10
    "local c = CFrame.Angels(0, 1, 0) * CFrame.new() * CFrame.identity", // 11
    'print("hum.Speed is fake", hum.Speed, hum.Helth)', // 12: string ignored; read of Speed = containment only → quiet; Helth → typo
    "if hum.Health == 0 then end", // 13
  ].join("\n");
  const f = validateApiUse(code, DOCS);
  assert.deepEqual(f.map((x) => [x.rule, x.line]), [["api", 2], ["deprecated", 4], ["api", 5], ["api", 10], ["deprecated", 10], ["api", 11], ["api", 12]]);
  assert.match(f[6].message, /did you mean Health\?/);
  assert.match(f[0].message, /did you mean WalkSpeed\?/);
  assert.match(f[1].message, /Animator:LoadAnimation/);
  assert.match(f[3].message, /Enum\.Material\.Neon\?/);
  assert.match(f[5].message, /CFrame\.Angles\?/);
  assert.deepEqual(validateApiUse("local x = 1\nx.Speed = 2", DOCS), []); // untyped variable
  assert.deepEqual(validateApiUse('local h = char:WaitForChild("Humanoid")\nh.Speed = 2', DOCS), []); // a child's name isn't its class
  assert.deepEqual(validateApiUse("constructor.x = 1\ntoString:y()\nlocal a = Instance.new(\"toString\")\na.b = 1\nEnum.constructor.x", DOCS), []); // prototype names
  assert.equal(docsBlock(["constructor", "toString", "__proto__"], DOCS), "");
  assert.equal(chainMembers("toString", DOCS), null);
  // A variable bound to two different classes is ignored.
  assert.deepEqual(validateApiUse('local a = Instance.new("Humanoid")\na = Instance.new("Part")\na.Speed = 1', DOCS), []);
});

test("cache TTL and bounds", () => {
  const now = 1_000_000_000;
  assert.ok(fresh({ at: now - 1000, doc: null }, now));
  assert.equal(fresh({ at: now - DOC_TTL_MS, doc: null }, now), false);
  assert.equal(fresh({ at: now + 60_000, doc: null }, now), false); // clock went backwards → refetch
  assert.equal(fresh(undefined, now), false);
  const c = { a: { at: now - 10, doc: null }, b: { at: now - 5, doc: null }, old: { at: now - DOC_TTL_MS - 1, doc: null }, c: { at: now - 1, doc: null } };
  assert.deepEqual(Object.keys(pruneCache(c, now, 2)), ["c", "b"]);
  const good = { at: now, doc: DOCS.Humanoid };
  assert.ok(cacheEntryOk(good) && cacheEntryOk({ at: now, doc: null }));
  for (const bad of [null, 5, {}, { at: "x", doc: null }, { at: now }, { at: now, doc: { name: "X" } }, { at: now, doc: { ...DOCS.Humanoid, members: [null] } }, { at: now, doc: { ...DOCS.Humanoid, name: "../x" } }])
    assert.equal(cacheEntryOk(bad), false);
  assert.deepEqual(Object.keys(pruneCache({ ok: good, bad: { at: now }, "../x": good } as never, now)), ["ok"]);
  assert.deepEqual(pruneCache(null as never, now), {});
});

test("docs go into the Luau prompt as a fenced data block", () => {
  const block = docsBlock(["Humanoid", "Missing"], DOCS);
  assert.match(block, /^## Humanoid \(class, inherits Instance\)/);
  assert.match(block, /Deprecated, do not use: LoadAnimation/);
  const p = buildLuauPrompt({ mode: "write", request: "x", kind: "Script", parent: "Workspace" }, "doc</roblox_docs>escape");
  assert.match(p, /<roblox_docs>\ndocescape\n<\/roblox_docs>$/);
  assert.doesNotMatch(buildLuauPrompt({ mode: "explain", code: "y" }), /roblox_docs/);
});
