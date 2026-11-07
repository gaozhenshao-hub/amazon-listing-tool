import { sql } from "drizzle-orm";
import { requireDb } from "../../repositories/dbClient";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { researchRows } from "./researchLibrary";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const WEEK = 7 * 86400000;
let inFlight: Promise<SelectionFx | null> | undefined;
let retryAfter = 0;
export type SelectionFx = {
  rate: number;
  date: string;
  updatedAt: string;
  stale: boolean;
};

export async function readSelectionFx(): Promise<SelectionFx | null> {
  const db = await requireDb("selection exchange rate");
  const [row] = await researchRows(
    db,
    sql`SELECT rate,DATE_FORMAT(source_date,'%Y-%m-%d') source_date,fetched_at FROM product_selection_fx WHERE pair='USD/CNY'`
  );
  if (!row) return null;
  const fetched = new Date(row.fetched_at);
  return {
    rate: Number(row.rate),
    date: String(row.source_date),
    updatedAt: fetched.toISOString(),
    stale: Date.now() - fetched.getTime() >= WEEK,
  };
}

export function refreshSelectionFx(): Promise<SelectionFx | null> {
  inFlight ??= refresh().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function refresh() {
  const current = await readSelectionFx();
  if ((current && !current.stale) || Date.now() < retryAfter) return current;
  try {
    const response = await safeHttpRequest(ECB_URL, {
      allowedHosts: ["www.ecb.europa.eu"],
      maxResponseBytes: 65536,
      timeoutMs: 7000,
    });
    if (response.status !== 200)
      throw new Error("Unexpected exchange-rate response");
    const xml = response.text();
    const usd = Number(
      xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1]
    );
    const cny = Number(
      xml.match(/currency=['"]CNY['"]\s+rate=['"]([\d.]+)['"]/)?.[1]
    );
    const date = xml.match(/\btime=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
    if (
      !date ||
      !Number.isFinite(usd) ||
      !Number.isFinite(cny) ||
      usd <= 0 ||
      cny <= 0
    )
      throw new Error("Incomplete exchange-rate response");
    if (current && date < current.date)
      throw new Error("Older exchange-rate response");
    const db = await requireDb("save selection exchange rate");
    await db.execute(
      sql`INSERT INTO product_selection_fx(pair,rate,source_date) VALUES('USD/CNY',${cny / usd},${date}) ON DUPLICATE KEY UPDATE rate=IF(source_date<=VALUES(source_date),VALUES(rate),rate),fetched_at=IF(source_date<=VALUES(source_date),CURRENT_TIMESTAMP,fetched_at),source_date=GREATEST(source_date,VALUES(source_date))`
    );
    return readSelectionFx();
  } catch {
    retryAfter = Date.now() + 3600000;
    return current;
  }
}

export function startSelectionFxScheduler() {
  let pending: Promise<SelectionFx | null> | undefined;
  const tick = () => {
    pending ??= refreshSelectionFx()
      .catch(error => {
        console.warn(
          "[product-selection] Exchange rate refresh deferred:",
          error instanceof Error ? error.message : "unavailable"
        );
        return null;
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const startup = setTimeout(tick, 15000);
  const interval = setInterval(tick, 6 * 3600000);
  return async () => {
    clearTimeout(startup);
    clearInterval(interval);
    await pending;
  };
}
