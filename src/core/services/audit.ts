import type { DB } from '../db/connection'
import { newId, now } from '../ids'

export interface AuditCtx {
  userId?: string
  userName?: string
  businessId?: string
}

export function audit(
  db: DB,
  ctx: AuditCtx,
  action: string,
  entityType: string,
  entityId?: string,
  before?: unknown,
  after?: unknown,
  note?: string
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, business_id, user_id, user_name, action, entity_type, entity_id, before_json, after_json, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    newId(),
    ctx.businessId ?? null,
    ctx.userId ?? null,
    ctx.userName ?? null,
    action,
    entityType,
    entityId ?? null,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    note ?? null,
    now()
  )
}
