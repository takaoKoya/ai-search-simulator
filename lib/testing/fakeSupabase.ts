import { randomUUID } from "crypto";

/**
 * Minimal in-memory stand-in for the subset of the supabase-js query builder
 * used by our server code (`.from().select/insert/update/upsert/delete()
 * .eq/lt/order/limit().single()/.maybeSingle()`, and plain `await query`).
 * Used in unit/integration tests that need to exercise real read/write logic
 * (the LangGraph checkpointer, graph nodes) without a live Postgres/Supabase
 * instance. Not a general-purpose mock — extend the method surface here only
 * as tests need it.
 */
type Row = Record<string, unknown>;
type UpsertOptions = { onConflict?: string; ignoreDuplicates?: boolean };
type Mode = "select" | "upsert" | "delete" | "insert" | "update";

class FakeTable {
  rows: Row[] = [];
}

class FakeQueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private orderSpec?: { col: string; ascending: boolean };
  private limitN?: number;

  constructor(
    private readonly table: FakeTable,
    private readonly mode: Mode,
    private readonly payload?: Row | Row[],
    private readonly opts?: UpsertOptions
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  neq(col: string, val: unknown): this {
    this.filters.push((row) => row[col] !== val);
    return this;
  }

  lt(col: string, val: unknown): this {
    this.filters.push((row) => (row[col] as string) < (val as string));
    return this;
  }

  order(col: string, { ascending }: { ascending: boolean }): this {
    this.orderSpec = { col, ascending };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  select(_cols?: string): this {
    return this;
  }

  private runSelect(): Row[] {
    let result = this.table.rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.orderSpec) {
      const { col, ascending } = this.orderSpec;
      result = [...result].sort((a, b) => {
        const av = String(a[col]);
        const bv = String(b[col]);
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== undefined) result = result.slice(0, this.limitN);
    return result;
  }

  private async execute(): Promise<Row[]> {
    if (this.mode === "select") return this.runSelect();

    if (this.mode === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
      const inserted = rows.map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
      this.table.rows.push(...inserted);
      return inserted;
    }

    if (this.mode === "update") {
      const matched = this.table.rows.filter((row) => this.filters.every((f) => f(row)));
      for (const row of matched) Object.assign(row, this.payload);
      return matched;
    }

    if (this.mode === "delete") {
      const toDelete = this.table.rows.filter((row) => this.filters.every((f) => f(row)));
      this.table.rows = this.table.rows.filter((row) => !toDelete.includes(row));
      return [];
    }

    // upsert
    const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
    const conflictCols = this.opts?.onConflict?.split(",") ?? [];
    const affected: Row[] = [];
    for (const row of rows) {
      const existingIdx = this.table.rows.findIndex((r) => conflictCols.every((c) => r[c] === row[c]));
      if (existingIdx >= 0) {
        if (this.opts?.ignoreDuplicates) continue;
        this.table.rows[existingIdx] = { ...this.table.rows[existingIdx], ...row };
        affected.push(this.table.rows[existingIdx]);
      } else {
        const inserted = { id: randomUUID(), ...row };
        this.table.rows.push(inserted);
        affected.push(inserted);
      }
    }
    return affected;
  }

  single(): Promise<{ data: Row | null; error: Error | null }> {
    return this.execute().then((rows) => ({
      data: rows[0] ?? null,
      error: rows.length === 0 ? new Error("No rows returned") : null,
    }));
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return this.execute().then((rows) => ({ data: rows[0] ?? null, error: null }));
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute()
      .then((rows) => ({ data: this.mode === "delete" ? null : rows, error: null }))
      .then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export class FakeSupabase {
  private readonly tables = new Map<string, FakeTable>();

  private getTable(name: string): FakeTable {
    if (!this.tables.has(name)) this.tables.set(name, new FakeTable());
    return this.tables.get(name)!;
  }

  /** Test helper: seed or inspect a table's rows directly. */
  table(name: string): Row[] {
    return this.getTable(name).rows;
  }

  from(name: string) {
    const table = this.getTable(name);
    return {
      select: (_cols?: string) => new FakeQueryBuilder(table, "select"),
      insert: (payload: Row | Row[]) => new FakeQueryBuilder(table, "insert", payload),
      update: (payload: Row) => new FakeQueryBuilder(table, "update", payload),
      upsert: (payload: Row | Row[], opts?: UpsertOptions) => new FakeQueryBuilder(table, "upsert", payload, opts),
      delete: () => new FakeQueryBuilder(table, "delete"),
    };
  }
}
