type QueueJob<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  const status = (error as { status?: number })?.status;
  const message = String((error as Error)?.message || '').toLowerCase();
  return status === 429 || message.includes('429') || message.includes('rate limit');
}

export class GroqRequestQueue {
  private readonly queue: QueueJob<unknown>[] = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly maxPerMinute: number;
  private readonly startedAt: number[] = [];

  constructor(options?: { maxConcurrent?: number; maxPerMinute?: number }) {
    this.maxConcurrent = Math.max(1, Number(options?.maxConcurrent ?? process.env.GROQ_MAX_CONCURRENT ?? 6));
    this.maxPerMinute = Math.max(1, Number(options?.maxPerMinute ?? process.env.GROQ_MAX_RPM ?? 28));
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      void this.pump();
    });
  }

  getStats() {
    return {
      queued: this.queue.length,
      running: this.running,
      maxConcurrent: this.maxConcurrent,
      maxPerMinute: this.maxPerMinute,
    };
  }

  private async pump() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;

    const now = Date.now();
    this.startedAt.splice(0, this.startedAt.findIndex((stamp) => now - stamp < 60_000));
    if (this.startedAt.length >= this.maxPerMinute) {
      const oldest = this.startedAt[0] ?? now;
      const waitMs = Math.max(50, 60_000 - (now - oldest));
      setTimeout(() => void this.pump(), waitMs);
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    this.running += 1;
    this.startedAt.push(Date.now());

    try {
      const result = await this.executeWithRetry(job.task);
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    } finally {
      this.running -= 1;
      setTimeout(() => void this.pump(), Math.ceil(60_000 / this.maxPerMinute));
    }
  }

  private async executeWithRetry<T>(task: () => Promise<T>, attempts = 4): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error) || attempt === attempts - 1) throw error;
        await sleep(Math.min(12_000, 600 * 2 ** attempt));
      }
    }
    throw lastError;
  }
}

export const groqQueue = new GroqRequestQueue();
