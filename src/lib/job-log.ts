// Durable job step log, IO side (rules: job-log-pure.ts). One file per job in <ORBIT data dir>/jobs/ (so two processes writing
// different jobs never overwrite each other), atomic tmp + rename. Leases: <id>.lease created with O_EXCL; an expired one is taken
// over and re-read to confirm. Used by the night shift (night.ts) and plan-file jobs (plan-jobs.ts); not by CORE chat turns.
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { leaseFree, parseJobLog, parseLease, planStep, recordStep, type JobLog } from "./job-log-pure.ts";

const g = globalThis as unknown as { __orbitJobs?: { owner: string; chain: Map<string, Promise<unknown>> } };
const J = (g.__orbitJobs ??= { owner: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`, chain: new Map() });
/** This process's runner id (lease owner). */
export const runnerId = () => J.owner;

const dir = () => path.join(orbitDataDir(), "jobs");
const base = (job: string) => path.join(dir(), `${job.replace(/[^\w-]/g, "_").slice(0, 80)}-${createHash("sha1").update(job).digest("hex").slice(0, 8)}`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function load(job: string): Promise<JobLog> {
  const raw = await readFile(base(job) + ".json", "utf8").then((t) => JSON.parse(t), () => null);
  return parseJobLog(raw ? { [job]: raw } : null);
}
async function save(job: string, log: JobLog) {
  await mkdir(dir(), { recursive: true });
  const f = base(job) + ".json";
  await writeFile(f + ".tmp", JSON.stringify(log[job]));
  await rename(f + ".tmp", f);
}
/** Serialized per job inside this process (the lease covers other processes). */
function locked<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const p = (J.chain.get(job) ?? Promise.resolve()).catch(() => {}).then(fn);
  J.chain.set(job, p);
  return p;
}

async function run<T>(job: string, key: string, effect: boolean, fn: (idem: string) => Promise<T>): Promise<T> {
  const plan = await locked(job, async () => {
    const log = await load(job), p = planStep(log, job, key, effect);
    if (p.do === "run") { recordStep(log, job, key, { status: "started", tries: p.tries, ...(p.idem ? { idem: p.idem } : {}) }, Date.now()); await save(job, log); } // idem saved BEFORE the call
    return p;
  });
  if (plan.do === "replay") return plan.result as T;
  if (plan.do === "give-up") throw new Error(plan.error);
  try {
    const result = await fn(plan.idem ?? "");
    await locked(job, async () => { const log = await load(job); recordStep(log, job, key, { status: "done", tries: plan.tries, result, ...(plan.idem ? { idem: plan.idem } : {}) }, Date.now()); await save(job, log); });
    return result;
  } catch (e) {
    await locked(job, async () => { const log = await load(job); recordStep(log, job, key, { status: "failed", tries: plan.tries, error: errMsg(e), ...(plan.idem ? { idem: plan.idem } : {}) }, Date.now()); await save(job, log); }).catch(() => {});
    throw e;
  }
}

/** A step without outside effects: run once, then replayed from the log (result must be small JSON). */
export const jobStep = <T>(job: string, key: string, fn: () => Promise<T>) => run(job, key, false, () => fn());
/** A step with an outside effect (a row insert, a file write): `idem` is stored before the call and is the same on every retry. */
export const jobEffect = <T>(job: string, key: string, fn: (idem: string) => Promise<T>) => run(job, key, true, fn);
/** The job's log as stored (OPERATIONS, tests). */
export const readJob = async (job: string) => (await load(job))[job] ?? null;

/** Take or renew the lease on `job` for `ms`. false: another live runner holds it. */
export async function takeLease(job: string, ms: number, owner = J.owner, now = Date.now()): Promise<boolean> {
  await mkdir(dir(), { recursive: true });
  const f = base(job) + ".lease", body = JSON.stringify({ owner, until: now + ms });
  try { await writeFile(f, body, { flag: "wx" }); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const read = async () => parseLease(await readFile(f, "utf8").then((t) => JSON.parse(t), () => null));
  if (!leaseFree(await read(), owner, now)) return false;
  await writeFile(f + `.${process.pid}.tmp`, body);
  await rename(f + `.${process.pid}.tmp`, f);
  return (await read())?.owner === owner; // two runners taking over the same expired lease: the last rename wins, the other backs off
}

/** Give the lease back (only when it is still ours). */
export async function releaseLease(job: string, owner = J.owner) {
  const f = base(job) + ".lease";
  const cur = parseLease(await readFile(f, "utf8").then((t) => JSON.parse(t), () => null));
  if (cur?.owner === owner) await unlink(f).catch(() => {});
}
