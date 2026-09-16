import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { hashPassword, verifyPassword } from '../auth'
import { ALL_PERMS, SYSTEM_ROLES, type Perm } from '../permissions'
import { CoreError } from './accounts'
import { audit, type AuditCtx } from './audit'

export interface UserRow {
  id: string
  name: string
  username: string
  phone: string | null
  status: string
  created_at: number
  last_login_at: number | null
}

export function createUser(db: DB, ctx: AuditCtx, input: { name: string; username: string; password: string; phone?: string }) {
  if (!input.name?.trim()) throw new CoreError('NAME_REQUIRED', 'নাম দিন।')
  const username = input.username?.trim().toLowerCase()
  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new CoreError('BAD_USERNAME', 'ইউজারনেম ৩–৩২ অক্ষরের হবে (a-z, 0-9, . _ -)।')
  }
  if (!input.password || input.password.length < 6) throw new CoreError('WEAK_PASSWORD', 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।')
  const dup = db.prepare(`SELECT 1 FROM users WHERE username=?`).get(username)
  if (dup) throw new CoreError('DUP_USERNAME', 'এই ইউজারনেম আগে থেকেই আছে।')
  const id = newId()
  db.prepare(`INSERT INTO users (id, name, username, phone, password_hash, status, created_at) VALUES (?,?,?,?,?,'active',?)`)
    .run(id, input.name.trim(), username, input.phone ?? null, hashPassword(input.password), now())
  audit(db, ctx, 'user.create', 'user', id, null, { name: input.name, username })
  return getUser(db, id)
}

export function getUser(db: DB, id: string): UserRow {
  const u = db.prepare(`SELECT id, name, username, phone, status, created_at, last_login_at FROM users WHERE id=?`).get(id) as UserRow | undefined
  if (!u) throw new CoreError('USER_NOT_FOUND', 'ব্যবহারকারী পাওয়া যায়নি।')
  return u
}

export function listUsers(db: DB): UserRow[] {
  return db.prepare(`SELECT id, name, username, phone, status, created_at, last_login_at FROM users ORDER BY created_at`).all() as UserRow[]
}

export function updateUser(db: DB, ctx: AuditCtx, id: string, patch: { name?: string; phone?: string; status?: 'active' | 'disabled'; password?: string }) {
  const before = getUser(db, id)
  if (patch.password !== undefined) {
    if (patch.password.length < 6) throw new CoreError('WEAK_PASSWORD', 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।')
    db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hashPassword(patch.password), id)
  }
  db.prepare(`UPDATE users SET name=?, phone=?, status=? WHERE id=?`).run(
    patch.name?.trim() || before.name, patch.phone ?? before.phone, patch.status ?? before.status, id
  )
  audit(db, ctx, patch.password ? 'user.password_change' : 'user.update', 'user', id, { name: before.name, status: before.status }, { name: patch.name, status: patch.status })
  return getUser(db, id)
}

/** A user's effective permissions inside a business. Owners always have everything. */
export function effectivePermissions(db: DB, userId: string, businessId: string): Perm[] {
  const m = db.prepare(`SELECT * FROM memberships WHERE user_id=? AND business_id=? AND status='active'`).get(userId, businessId) as
    | { id: string; role_id: string | null; is_owner: number }
    | undefined
  if (!m) return []
  if (m.is_owner) return ALL_PERMS
  if (!m.role_id) return []
  const role = db.prepare(`SELECT permissions FROM roles WHERE id=? AND business_id=?`).get(m.role_id, businessId) as { permissions: string } | undefined
  if (!role) return []
  try {
    return JSON.parse(role.permissions) as Perm[]
  } catch {
    return []
  }
}

export function listRoles(db: DB, businessId: string) {
  return db.prepare(`SELECT id, name, note, permissions, is_system FROM roles WHERE business_id=? ORDER BY is_system DESC, name`).all(businessId)
}

export function createRole(db: DB, ctx: AuditCtx, businessId: string, input: { name: string; note?: string; permissions: string[] }) {
  if (!input.name?.trim()) throw new CoreError('NAME_REQUIRED', 'রোলের নাম দিন।')
  const dup = db.prepare(`SELECT 1 FROM roles WHERE business_id=? AND name=?`).get(businessId, input.name.trim())
  if (dup) throw new CoreError('DUP_NAME', 'এই নামে রোল আছে।')
  const id = newId()
  const perms = input.permissions.filter((p) => (ALL_PERMS as string[]).includes(p))
  db.prepare(`INSERT INTO roles (id, business_id, name, note, permissions, is_system, created_at) VALUES (?,?,?,?,?,0,?)`)
    .run(id, businessId, input.name.trim(), input.note ?? null, JSON.stringify(perms), now())
  audit(db, { ...ctx, businessId }, 'role.create', 'role', id, null, { name: input.name, permissions: perms })
  return id
}

export function updateRole(db: DB, ctx: AuditCtx, businessId: string, roleId: string, patch: { name?: string; note?: string; permissions?: string[] }) {
  const before = db.prepare(`SELECT * FROM roles WHERE id=? AND business_id=?`).get(roleId, businessId) as { name: string; note: string; permissions: string; is_system: number } | undefined
  if (!before) throw new CoreError('ROLE_NOT_FOUND', 'রোল পাওয়া যায়নি।')
  if (before.is_system && patch.permissions) throw new CoreError('SYSTEM_ROLE', 'সিস্টেম রোলের অনুমতি পরিবর্তন করা যায় না।')
  const perms = patch.permissions ? JSON.stringify(patch.permissions.filter((p) => (ALL_PERMS as string[]).includes(p))) : before.permissions
  db.prepare(`UPDATE roles SET name=?, note=?, permissions=? WHERE id=?`).run(patch.name?.trim() || before.name, patch.note ?? before.note, perms, roleId)
  audit(db, { ...ctx, businessId }, 'role.update', 'role', roleId, before, { name: patch.name, permissions: patch.permissions })
}

export function deleteRole(db: DB, ctx: AuditCtx, businessId: string, roleId: string) {
  const role = db.prepare(`SELECT * FROM roles WHERE id=? AND business_id=?`).get(roleId, businessId) as { name: string; is_system: number } | undefined
  if (!role) throw new CoreError('ROLE_NOT_FOUND', 'রোল পাওয়া যায়নি।')
  if (role.is_system) throw new CoreError('SYSTEM_ROLE', 'সিস্টেম রোল মোছা যায় না।')
  const used = db.prepare(`SELECT 1 FROM memberships WHERE role_id=? LIMIT 1`).get(roleId)
  if (used) throw new CoreError('ROLE_IN_USE', 'এই রোলে সদস্য আছে — আগে তাদের রোল বদলান।')
  db.prepare(`DELETE FROM roles WHERE id=?`).run(roleId)
  audit(db, { ...ctx, businessId }, 'role.delete', 'role', roleId, role, null)
}

export interface MembershipRow {
  id: string
  user_id: string
  user_name: string
  username: string
  role_id: string | null
  role_name: string | null
  is_owner: number
  status: string
}

export function listMembers(db: DB, businessId: string): MembershipRow[] {
  return db
    .prepare(
      `SELECT m.id, m.user_id, u.name AS user_name, u.username, m.role_id, r.name AS role_name, m.is_owner, m.status
       FROM memberships m
       JOIN users u ON u.id=m.user_id
       LEFT JOIN roles r ON r.id=m.role_id
       WHERE m.business_id=? ORDER BY m.is_owner DESC, u.name`
    )
    .all(businessId) as MembershipRow[]
}

export function addMember(db: DB, ctx: AuditCtx, businessId: string, input: { user_id: string; role_id?: string | null }) {
  const u = db.prepare(`SELECT 1 FROM users WHERE id=?`).get(input.user_id)
  if (!u) throw new CoreError('USER_NOT_FOUND', 'ব্যবহারকারী নির্বাচন করুন।')
  const dup = db.prepare(`SELECT 1 FROM memberships WHERE user_id=? AND business_id=?`).get(input.user_id, businessId)
  if (dup) throw new CoreError('DUP_MEMBER', 'এই ব্যবহারকারী আগেই এই ব্যবসায় আছে।')
  db.prepare(`INSERT INTO memberships (id, user_id, business_id, role_id, is_owner, status, created_at) VALUES (?,?,?,?,0,'active',?)`)
    .run(newId(), input.user_id, businessId, input.role_id ?? null, now())
  audit(db, { ...ctx, businessId }, 'member.add', 'membership', input.user_id, null, { role: input.role_id })
}

export function updateMember(db: DB, ctx: AuditCtx, businessId: string, membershipId: string, patch: { role_id?: string | null; status?: 'active' | 'suspended' }) {
  const m = db.prepare(`SELECT * FROM memberships WHERE id=? AND business_id=?`).get(membershipId, businessId) as { is_owner: number; role_id: string | null; status: string } | undefined
  if (!m) throw new CoreError('MEMBER_NOT_FOUND', 'সদস্য পাওয়া যায়নি।')
  if (m.is_owner) throw new CoreError('OWNER_LOCKED', 'মালিকের অনুমতি পরিবর্তনযোগ্য নয়।')
  db.prepare(`UPDATE memberships SET role_id=?, status=? WHERE id=?`).run(patch.role_id !== undefined ? patch.role_id : m.role_id, patch.status ?? m.status, membershipId)
  audit(db, { ...ctx, businessId }, 'member.update', 'membership', membershipId, m, patch)
}

export function removeMember(db: DB, ctx: AuditCtx, businessId: string, membershipId: string) {
  const m = db.prepare(`SELECT * FROM memberships WHERE id=? AND business_id=?`).get(membershipId, businessId) as { is_owner: number; user_id: string } | undefined
  if (!m) throw new CoreError('MEMBER_NOT_FOUND', 'সদস্য পাওয়া যায়নি।')
  if (m.is_owner) throw new CoreError('OWNER_LOCKED', 'মালিককে সরানো যায় না।')
  db.prepare(`DELETE FROM memberships WHERE id=?`).run(membershipId)
  audit(db, { ...ctx, businessId }, 'member.remove', 'membership', membershipId, m, null)
}

export { SYSTEM_ROLES, verifyPassword }
