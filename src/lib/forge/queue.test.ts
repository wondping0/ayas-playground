import { describe, expect, it } from 'vitest'
import { InProcessQueue, backoffMs } from './queue'

describe('backoffMs', () => {
  it('grows exponentially and then flattens', () => {
    expect(backoffMs(1)).toBe(1_000)
    expect(backoffMs(2)).toBe(2_000)
    expect(backoffMs(3)).toBe(4_000)
    expect(backoffMs(99)).toBe(60_000)
  })

  it('does not go below the base for a zeroth attempt', () => {
    expect(backoffMs(0)).toBe(1_000)
  })
})

describe('InProcessQueue', () => {
  it('runs a registered handler', async () => {
    const queue = new InProcessQueue(2)
    const seen: number[] = []
    queue.register<number>('add', async (n) => {
      seen.push(n)
    })

    await queue.enqueue('add', 1)
    await queue.enqueue('add', 2)
    await queue.drain()

    expect(seen.sort()).toEqual([1, 2])
  })

  it('respects the concurrency bound', async () => {
    const queue = new InProcessQueue(2)
    let running = 0
    let peak = 0

    queue.register<number>('slow', async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 10))
      running -= 1
    })

    for (let i = 0; i < 8; i++) await queue.enqueue('slow', i)
    await queue.drain()

    expect(peak).toBeLessThanOrEqual(2)
  })

  it('retries a failing job up to maxAttempts', async () => {
    const queue = new InProcessQueue(1, Date.now, () => 0)
    let attempts = 0
    queue.register('flaky', async () => {
      attempts += 1
      throw new Error('nope')
    })

    await queue.enqueue('flaky', {}, { maxAttempts: 3 })
    await queue.drain()

    expect(attempts).toBe(3)
  })

  it('stops retrying once it succeeds', async () => {
    const queue = new InProcessQueue(1, Date.now, () => 0)
    let attempts = 0
    queue.register('eventually', async () => {
      attempts += 1
      if (attempts < 2) throw new Error('not yet')
    })

    await queue.enqueue('eventually', {}, { maxAttempts: 5 })
    await queue.drain()

    expect(attempts).toBe(2)
  })

  it('treats an unregistered kind as a failing job rather than a crash', async () => {
    const queue = new InProcessQueue(1, Date.now, () => 0)
    await queue.enqueue('nobody-handles-this', {}, { maxAttempts: 1 })
    await expect(queue.drain()).resolves.toBeUndefined()
    expect(queue.size()).toBe(0)
  })

  it('refuses work once stopped', async () => {
    // Accepting a job it will never run is how a paid order ends up with
    // nobody working on it.
    const queue = new InProcessQueue(1)
    queue.stop()
    await expect(queue.enqueue('anything', {})).rejects.toThrow(/stopped/)
  })

  it('does not hang when draining a stopped queue', async () => {
    const queue = new InProcessQueue(1)
    queue.register('slow', async () => new Promise((r) => setTimeout(r, 50_000)))
    await queue.enqueue('slow', {})
    queue.stop()
    await expect(queue.drain()).resolves.toBeUndefined()
  })

  it('reports whether it is stopped', () => {
    const queue = new InProcessQueue(1)
    expect(queue.isStopped).toBe(false)
    queue.stop()
    expect(queue.isStopped).toBe(true)
  })
})
