import { rawExecute } from "../server/domains/ai_os/routerContext";

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("context_provenance_schema_query_timeout")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const columns = await withTimeout(
    rawExecute("SHOW COLUMNS FROM emperor_context_source_provenance"),
    15_000,
  );
  console.log(JSON.stringify({
    table: "emperor_context_source_provenance",
    columns: (columns as any[]).map((column) => ({ Field: column.Field, Type: column.Type, Null: column.Null, Key: column.Key, Default: column.Default })),
  }));
}

main().then(() => process.exit(0)).catch((error: any) => {
  const cause = error?.cause;
  console.error(JSON.stringify({
    message: error instanceof Error ? error.message : "context_provenance_schema_diagnosis_failed",
    name: error?.name || null,
    causeName: cause?.name || null,
    causeCode: cause?.code || null,
    causeErrno: cause?.errno || null,
    causeSqlState: cause?.sqlState || null,
  }));
  process.exit(1);
});
