import { err } from '@/lib/core/errors'
import type { User } from '@/lib/core/types'
import { getStore } from '@/lib/store'

/**
 * Reading the audit trail.
 *
 * Append-only by construction — there is no update or delete anywhere in the
 * repository interface. Entries never carry a flag, a solver body, or a secret;
 * that is enforced at the call sites and asserted in the end-to-end test.
 */

export interface AuditRow {
  id: string
  actor: string
  actorName: string
  action: string
  subjectType: string
  subjectId: string
  detail: Record<string, unknown>
  createdAt: string
}

export async function recentAudit(admin: User, limit = 100): Promise<AuditRow[]> {
  if (!admin.roles.includes('admin')) {
    throw err.forbidden('The audit trail is administrator-only.')
  }

  const store = getStore()
  const entries = await store.audit.list({ limit })
  const names = new Map<string, string>()

  return Promise.all(
    entries.map(async (entry) => {
      if (!names.has(entry.actor)) {
        const user = entry.actor === 'system' ? null : await store.users.get(entry.actor)
        names.set(entry.actor, user?.name ?? entry.actor)
      }
      return {
        id: entry.id,
        actor: entry.actor,
        actorName: names.get(entry.actor) ?? entry.actor,
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        detail: entry.detail,
        createdAt: entry.createdAt.toISOString(),
      }
    }),
  )
}
