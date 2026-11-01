import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { allInvoices } from "./invoices";
import { localDay } from "./morning-pure";
import { meterCalls } from "./usage-meter";
import {
  RECEIPT_TYPES, deadlines, emptyStore, foldApi, moneyLine, moneySplit, type Client, parseExpense, patchSettings, pnl, receiptName, setVatPaid, toCsv, type Inputs, type Store,
} from "./money-pure";

// Money view store and IO (rules: money-pure.ts): <ORBIT data dir>/money.json (settings, expenses, VAT he paid, ORBIT's API spend
// by day) and receipts kept locally in <ORBIT data dir>/receipts/. Nothing here leaves the PC; nothing is filed or paid.

const FILE = () => path.join(orbitDataDir(), "money.json");
const RECEIPTS = () => path.join(orbitDataDir(), "receipts");
const g = globalThis as unknown as { __orbitMoney?: { write: Promise<unknown> } };
const S = (g.__orbitMoney ??= { write: Promise.resolve() });

async function load(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(FILE(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw e;
  }
  const s = JSON.parse(raw) as Store; // a broken file throws instead of wiping his books
  if (!s || !Array.isArray(s.expenses)) throw new Error("money.json is unreadable");
  return { ...emptyStore(), ...s, settings: { ...emptyStore().settings, ...s.settings } };
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = S.write.catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s, null, 1));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  S.write = p;
  return p;
}

/** Everything the P&L needs; folds the usage meter's last 7 days into the kept API spend first. */
async function inputs(): Promise<Inputs> {
  const store = await update((s) => { s.apiUsd = foldApi(s.apiUsd, meterCalls(), Date.now()); return s; });
  const { listStories } = await import("./clips/story");
  const credits = await listStories().then((js) => js.flatMap((j) => j.approved ?? []), () => []);
  return { invoices: await allInvoices(), store, credits };
}

export async function moneyView(period: string) {
  const x = await inputs(), p = pnl(x, period), today = localDay(new Date());
  if (typeof p === "string") return p;
  return { pnl: p, settings: x.store.settings, expenses: [...x.store.expenses].sort((a, b) => b.day.localeCompare(a.day)), deadlines: deadlines(x.store.settings, today), today };
}

/** Clients with a fee (BUSINESS prospects, RLS-scoped); [] when the table can't be read, so money still shows. */
async function clients(sb: SupabaseClient): Promise<Client[]> {
  const { data, error } = await sb.from("prospects").select("id,name,stage,fee").in("stage", ["replied", "pilot", "paying"]).limit(500);
  return error ? [] : (data ?? []).map((c) => ({ ...c, fee: Number(c.fee) || 0 }));
}
async function split(sb: SupabaseClient, now: number) {
  const today = localDay(new Date(now));
  const [invoices, store, cs] = await Promise.all([allInvoices(), load().catch(() => emptyStore()), clients(sb)]);
  return { s: moneySplit({ invoices, expenses: store.expenses, clients: cs }, today), invoices, today };
}
/** BUS06: expected, pipeline, invoiced, paid, refunds and expenses, each with the records behind it. */
export const splitView = (sb: SupabaseClient, now = Date.now()) => split(sb, now).then((r) => r.s);
/** The morning card's and night report's money line; same definitions as splitView. Never throws. */
export const digestMoney = (sb: SupabaseClient, now = Date.now()) =>
  Promise.all([split(sb, now), import("./invoices-pure")]).then(([r, ip]) => moneyLine(r.s, ip.overdueLine(r.invoices, r.today)), () => "");

export async function moneyCsv(period: string): Promise<string> {
  const x = await inputs(), p = pnl(x, period);
  return typeof p === "string" ? p : "﻿" + toCsv(x, p); // BOM so Excel reads € and õ/ä/ö/ü right
}

/** His money settings (the BUSINESS overview reads the monthly target); throws when money.json is unreadable. */
export const moneySettings = () => load().then((s) => s.settings);
export const saveSettings = (b: Record<string, unknown>) => update((s) => { const r = patchSettings(b, s.settings); if (typeof r === "string") return r; s.settings = r; return ""; });
export const saveVatPaid = (b: Record<string, unknown>) => update((s) => setVatPaid(s, b.month, b.amount));

/** A new expense; its receipt file (optional) is kept under receipts/ and named after the expense. */
export async function addExpense(b: Record<string, unknown>, file: File | null) {
  const id = randomUUID(), e = parseExpense(b, id, Date.now());
  if (typeof e === "string") return e;
  if (file && file.size) {
    const name = receiptName(id, file.name, file.size);
    if (typeof name !== "string") return name.error;
    await mkdir(RECEIPTS(), { recursive: true });
    await writeFile(path.join(RECEIPTS(), name), Buffer.from(await file.arrayBuffer()));
    e.receipt = name;
  }
  return update((s) => { s.expenses.push(e); return e; });
}

export async function deleteExpense(id: unknown) {
  const e = await update((s) => {
    const x = s.expenses.find((v) => v.id === id);
    s.expenses = s.expenses.filter((v) => v.id !== id);
    return x;
  });
  if (!e) return "Not found";
  if (e.receipt) await unlink(path.join(RECEIPTS(), e.receipt)).catch(() => {});
  return "";
}

/** The receipt file of an expense (only names this store made are ever opened). */
export async function receipt(id: string): Promise<{ file: Buffer; type: string; name: string } | null> {
  const e = (await load()).expenses.find((v) => v.id === id);
  if (!e?.receipt) return null;
  const file = await readFile(path.join(RECEIPTS(), e.receipt)).catch(() => null);
  return file && { file, type: RECEIPT_TYPES[e.receipt.split(".").pop()!] ?? "application/octet-stream", name: `receipt-${e.day}-${e.receipt}` };
}
