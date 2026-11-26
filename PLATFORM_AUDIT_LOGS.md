# PLATFORM_AUDIT_LOGS.md — Super Admin Audit Logging Specification

## 1. Schema (`platform_audit_logs`)
```sql
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```
- Indexed by `created_at DESC`, `(target_restaurant_id, created_at DESC)`, and `(action, created_at DESC)`.
- Uses `ON DELETE SET NULL` on foreign keys so audit history remains intact even if a venue or user is later removed.

## 2. Recorded Super Admin Events
| Endpoint | Action(s) Logged | Safe Metadata |
|---|---|---|
| `POST /api/super/restaurants` | `restaurant.created` | `slug`, `plan`, `plan_status`, `custom_domain`, `custom_domain_verified` |
| `PATCH /api/super/restaurants/:id` | `restaurant.updated`, plus change-specific events: `restaurant.suspended` / `restaurant.reactivated`, `domain.updated`, `domain.verification_changed`, `subscription.updated` | `slug`, `name`, `is_active`, `plan`, `plan_status`, `plan_expires_at`, `previous_domain`, `custom_domain`, `verified` |
| `PATCH /api/super/platform` | `platform.config_updated` | `platform_name`, `agency_name` |
| `POST /api/super/admins` | `admin.created` | `admin_id`, `restaurant_id` |
| `PATCH /api/super/admins/:id` | `admin.updated` | `admin_id`, `restaurant_id`, `password_rotated` (boolean) |

## 3. Privacy & Security Redaction
- `logPlatformAudit()` sanitizes metadata through a denylist (`password`, `passwordHash`, `password_hash`, `token`, `pinToken`, `secret`, `email`, `phone`, `customer_phone`), guaranteeing credentials, session tokens, and personal contact fields are never written to `platform_audit_logs`.
- Retrieval via `GET /api/super/audit-logs` is restricted strictly by `requireAuth` + `requireSuperAdmin` (`403` for venue admins or unauthenticated callers).
