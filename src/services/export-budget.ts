import type { Readable } from "node:stream";

export interface ExportReadLimits {
  csvBytes: number;
  totalBytes: number;
  entries: number;
  cells: number;
}

export const DEFAULT_EXPORT_LIMITS: Readonly<ExportReadLimits> = Object.freeze({
  csvBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  entries: 10_000,
  cells: 2_000_000
});

export class ExportBudgetError extends Error {
  constructor() {
    super("Samsung export resource limit exceeded. Split the export into smaller CSV files/date ranges and retry; no partial result was returned.");
    this.name = "ExportBudgetError";
  }
}

/** Per-operation accounting; limits cannot be increased through MCP arguments. */
export class ExportBudget {
  private entryCount = 0;
  private declaredBytes = 0;
  private actualBytes = 0;
  private cellCount = 0;
  readonly limits: Readonly<ExportReadLimits>;
  constructor(limits: ExportReadLimits = DEFAULT_EXPORT_LIMITS) {
    for (const key of ["csvBytes", "totalBytes", "entries", "cells"] as const) {
      const value = limits[key];
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid export resource limits.");
    }
    this.limits = { ...limits };
  }
  entry(): void { if (++this.entryCount > this.limits.entries) throw new ExportBudgetError(); }
  file(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.csvBytes || size > this.limits.totalBytes - this.declaredBytes) throw new ExportBudgetError();
    this.declaredBytes += size;
  }
  consume(size: number, fileBytes: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(fileBytes) || fileBytes < 0 || fileBytes > this.limits.csvBytes || size > this.limits.totalBytes - this.actualBytes) throw new ExportBudgetError();
    this.actualBytes += size;
  }
  cell(): void { if (++this.cellCount > this.limits.cells) throw new ExportBudgetError(); }
}

/** Check actual bytes, not just ZIP metadata/stat, before retaining each chunk. */
export function readBoundedText(stream: Readable, budget: ExportBudget): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("close", onClose);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      stream.destroy();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        budget.consume(buffer.length, bytes);
        chunks.push(buffer);
      } catch (error) { fail(error); }
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, bytes).toString("utf8"));
    };
    const onClose = () => fail(new Error("Samsung export stream closed before completion."));
    stream.on("error", fail);
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("close", onClose);
  });
}
