import { newId } from '@/lib/core/ids'
import { peekSingleton, setSingleton, singleton } from '@/lib/core/singleton'

/**
 * An in-process job queue.
 *
 * Fulfillment runs a sandbox after payment has already succeeded, so it cannot
 * be a synchronous request: it is slow, and it can fail transiently. This gives
 * it retries with backoff and a concurrency bound.
 *
 * It is deliberately in-process and non-durable, matching the in-memory store.
 * The seam for BullMQ is the `JobQueue` interface, not a rewrite of the
 * callers.
 */

export interface Job<P = unknown> {
  id: string
  kind: string
  payload: P
  attempts: number
  maxAttempts: number
  runAfter: number
  lastError?: string
}

export type JobHandler<P = unknown> = (payload: P, job: Job<P>) => Promise<void>

export interface EnqueueOptions {
  maxAttempts?: number
  delayMs?: number
}

export interface JobQueue {
  register<P>(kind: string, handler: JobHandler<P>): void
  enqueue<P>(kind: string, payload: P, options?: EnqueueOptions): Promise<Job<P>>
  /** Resolves when the queue is empty and nothing is in flight. */
  drain(): Promise<void>
  size(): number
  stop(): void
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_CONCURRENCY = 2
const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000

export function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS)
}

export class InProcessQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler<never>>()
  private readonly pending: Job<unknown>[] = []
  private inFlight = 0
  private stopped = false
  private timer: NodeJS.Timeout | null = null
  private readonly waiters: Array<() => void> = []

  constructor(
    private readonly concurrency = DEFAULT_CONCURRENCY,
    private readonly now: () => number = Date.now,
    /**
     * Injected so a test can assert retry *behaviour* without waiting real
     * seconds for retry *timing*. Freezing `now` instead would deadlock: a
     * delayed job whose due time never arrives is never due.
     */
    private readonly backoff: (attempt: number) => number = backoffMs,
  ) {}

  register<P>(kind: string, handler: JobHandler<P>): void {
    this.handlers.set(kind, handler as JobHandler<never>)
  }

  async enqueue<P>(kind: string, payload: P, options: EnqueueOptions = {}): Promise<Job<P>> {
    // A stopped queue accepting work it will never run is worse than a
    // failure: the caller believes the job is scheduled and nothing ever says
    // otherwise. On the fulfilment path that is a paid order nobody is
    // working on.
    if (this.stopped) {
      throw new Error(`Queue is stopped; refusing to accept "${kind}".`)
    }

    const job: Job<P> = {
      id: newId('run'),
      kind,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      runAfter: this.now() + (options.delayMs ?? 0),
    }
    this.pending.push(job as Job<unknown>)
    this.schedule()
    return job
  }

  size(): number {
    return this.pending.length + this.inFlight
  }

  /** Terminal. A stopped queue refuses new work and never restarts. */
  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.settleWaiters()
    while (this.waiters.length > 0) this.waiters.pop()?.()
  }

  get isStopped(): boolean {
    return this.stopped
  }

  private schedule(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.pump()
    }, 0)
  }

  private settleWaiters(): void {
    if (this.size() > 0) return
    while (this.waiters.length > 0) this.waiters.pop()?.()
  }

  private async pump(): Promise<void> {
    if (this.stopped) return

    while (this.inFlight < this.concurrency) {
      const index = this.pending.findIndex((job) => job.runAfter <= this.now())
      if (index === -1) break
      const [job] = this.pending.splice(index, 1)
      if (!job) break
      this.inFlight += 1
      void this.execute(job)
    }

    // Something is queued but not yet due: come back when it is.
    if (this.pending.length > 0 && this.inFlight < this.concurrency && !this.timer) {
      const soonest = Math.min(...this.pending.map((j) => j.runAfter))
      const delay = Math.max(0, soonest - this.now())
      this.timer = setTimeout(() => {
        this.timer = null
        void this.pump()
      }, delay)
    }

    this.settleWaiters()
  }

  private async execute(job: Job<unknown>): Promise<void> {
    const handler = this.handlers.get(job.kind)
    job.attempts += 1

    try {
      if (!handler) throw new Error(`No handler registered for job kind "${job.kind}".`)
      await handler(job.payload as never, job as Job<never>)
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : String(error)
      if (job.attempts < job.maxAttempts) {
        job.runAfter = this.now() + this.backoff(job.attempts)
        this.pending.push(job)
      }
      // Exhausted: the handler is responsible for recording the terminal
      // failure, because only it knows what the failure means for the order.
    } finally {
      this.inFlight -= 1
      this.schedule()
      this.settleWaiters()
    }
  }

  async drain(): Promise<void> {
    // A stopped queue will never make progress, so waiting on one is waiting
    // forever. Resolve instead of hanging — the caller can inspect `size()`.
    if (this.size() === 0 || this.stopped) return
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
      this.schedule()
    })
  }
}

const QUEUE_KEY = 'forge.queue'

export function getQueue(): JobQueue {
  return singleton<JobQueue>(QUEUE_KEY, () => new InProcessQueue())
}

export function setQueue(next: JobQueue | null): void {
  peekSingleton<JobQueue>(QUEUE_KEY)?.stop()
  setSingleton(QUEUE_KEY, next)
}
