# GPU job queue (step 1 of "brain + muscle")

Goal later: an always-on cloud "brain" runs ORBIT; the laptop (RTX 5060, 8 GB) is the GPU "muscle"; Kaggle or a
pay-per-second GPU can be extra workers. Step 1 (this) only adds a durable queue. Off by default.

## Turn it on

1. One time, run the migration in the Supabase SQL editor (or `supabase db push`):
   `supabase/migrations/0029_gpu_jobs.sql`
2. In `.env.local`: `ORBIT_GPU_QUEUE=1`, then restart ORBIT.

Without the flag nothing changes: CORE's local tools call the runners directly, as before. With the flag but without
the migration, ORBIT logs it and also runs directly.

## How it works

- `gpu_jobs` table (RLS by `user_id`): `kind`, `payload` (tool name + its input only), `status`
  queued → claimed → running → done / failed / cancelled, `worker`, `progress`, `result`, `error`, `attempts`,
  `max_attempts`, `run_after` (retry backoff), `lease_until`, timestamps.
- Enqueue: CORE's LOCALAI tools (`local_image`, `local_image_edit`, `local_video`, `local_music`, `local_3d`,
  `local_tts`) become jobs (`src/lib/gpu-queue.ts` `runLocalAiTool`). CORE waits a while for the result; if the job is
  still waiting (GPU busy, worker off) it says so and the job runs later, also after a restart.
- Payload check (`validatePayload` in `gpu-queue-pure.ts`): no journal / LIFE data in any shape (private keys, a
  private kind/tags marker from `private-pure.ts`, journal-looking text), size and depth limits.
- Claim: RPC `claim_gpu_job(worker, kinds, lease_seconds)` takes the oldest due job with `for update skip locked`, so
  two workers never get the same job. A job whose lease ran out (worker died) is taken over; when it has used all its
  attempts it is failed instead.
- The worker heartbeats every 30 s (lease 3 min, progress line). A cancelled job or one taken over by another worker
  stops being written to.
- Failure: retried after 30 s, 2 min, 8 min … (max 30 min) up to `max_attempts` (3). Errors a retry can't fix
  (not installed, bad input) fail at once.
- Stop-all: no new claims; the running job's signal aborts. The current runners can't be interrupted mid-job yet, so
  a result that still finishes is kept and a failure goes back to the queue without using an attempt. Turning Stop-all
  off starts claiming again.
- Progress: OPERATIONS → Local AI shows each job on the shared ProgressCard (`/api/gpu-jobs`), with Cancel.
- `ORBIT_GPU_WORKER=0`: this server only enqueues. `ORBIT_ROLE=cloud` (docs/CLOUD.md) turns the queue on and the worker off by itself.

## Adding a worker later (not built)

A worker implements `GpuWorker` from `gpu-queue.ts`:

```ts
interface GpuWorker { id: string; kinds: GpuJobKind[]; run(job: GpuJob, ctx: { signal: AbortSignal; progress(frac: number, line?: string): void }): Promise<{ text: string }> }
```

and keeps the same contract as the laptop loop: claim through `claim_gpu_job` with only the kinds it can run,
heartbeat `lease_until` while working, write `done`/`failed`/back to `queued` only while it still owns the row
(`worker = its id` and status claimed/running). `claimNext` in `gpu-queue-pure.ts` is the reference for the rules.

- Kaggle: a notebook can't hold the Supabase service key safely. Plan: a small Supabase Edge Function with a
  per-worker token that only claims / heartbeats / finishes jobs of its kinds; results as files in Storage. Every
  upload still needs the owner's click (the existing Kaggle offer flow), so a Kaggle worker only takes jobs he sent there.
- Pay-per-second GPU: same Edge Function contract; spending is never automatic, so each run needs his approval first.
- `upscale` and `blender_render` are valid kinds already, but no worker claims them yet.

## Not tested

Real Supabase (the RPC), Windows, the GPU runners through the queue, a second worker.
