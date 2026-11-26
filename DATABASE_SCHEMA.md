# DATABASE_SCHEMA.md — Post-Milestone 2 Schema & Relationships

**Engine:** SQLite (`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`)  
**Total Tables:** `21` (migrated via `schema_migrations` versions `1` & `2`)

---

## 1. Core Platform & Tenant Tables
- **`restaurants`** (root tenant table, `39` columns): `id` (PK), `slug` (UNIQUE), `name`, `description`, `logo_url`, `cover_url`, ordering toggles, `table_config`, `qr_style`, `upi_id`, `gst_rate`, `service_charge_pct`, `require_table_pin`, `loyalty_config`, `spin_prizes`, `social_links`, `plan`, `plan_status`, `plan_expires_at`, `is_active`, `white_label`, `brand_bg`, `brand_accent`, `brand_secondary`, `custom_domain` (unique partial index `idx_restaurants_custom_domain`), `custom_domain_verified`, `opening_time`, `closing_time`, `takeaway_enabled`, `delivery_enabled`, `delivery_fee`, `free_delivery_min`, timestamps.
- **`platform_settings`**: Singleton (`id = 1`) holding platform name, agency branding, support email, default theme tokens, and HMAC secret.
- **`schema_migrations`**: Version registry (`version` PK, `name`, `applied_at`, `details_json`).
- **`platform_audit_logs`**: Super Admin action audit log (`actor_user_id -> users.id ON DELETE SET NULL`, `target_restaurant_id -> restaurants.id ON DELETE SET NULL`, `action`, `target_type`, `target_id`, `metadata_json`, `created_at`).

## 2. Access & Staff Tables
- **`users`**: `id` (PK), `email` (UNIQUE), `password_hash`, `name`, `role`, `restaurant_id -> restaurants.id ON DELETE SET NULL`, `created_at`.
- **`sessions`**: `token` (PK), `user_id -> users.id ON DELETE CASCADE`, `active_restaurant_id -> restaurants.id ON DELETE SET NULL`, `expires_at`.
- **`staff`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `name`, `role`, `pin`, `section`, `active`, `created_at`, `UNIQUE(restaurant_id, pin)`.

## 3. Catalog, Floor & Service Units
- **`categories`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `name`, `station`, `display_order`, `created_at`.
- **`menu_items`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `category_id -> categories.id ON DELETE SET NULL`, `name`, `description`, `price`, `image_url`, `is_veg`, flags, `prep_minutes`, `size_variants`, `addons`, `created_at`.
- **`service_units`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `code`, `label`, `unit_type` (`table | takeaway | delivery`), `section`, `is_active`, `created_at`, `updated_at`, `UNIQUE(restaurant_id, code)`.
- **`table_states`**: `(restaurant_id, table_number)` PK (`restaurant_id -> restaurants.id ON DELETE CASCADE`), `status`, `section`, `activated_by`, `updated_at`.
- **`table_seatings`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `table_number`, `status`, `table_pin`, `pin_tries`, `opened_by`, `merged_into`, `discount_json`, `spin_json`, `guest_phone`, `loyalty_awarded`, `close_note`, `opened_at`, `closed_at`.
- **`reservations`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `booking_code`, `customer_name`, `customer_phone`, `party_size`, `reservation_date`, `reservation_time`, `status`, `assigned_table`, `notes`, `admin_note`, timestamps.

## 4. Ordering, Normalized Line Items & Billing
- **`orders`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `order_number`, `seq_num`, `order_type`, `table_number`, `service_unit_id -> service_units.id ON DELETE SET NULL`, `pickup_token`, `customer_name`, `customer_phone`, `delivery_address`, `delivery_landmark`, `delivery_fee`, `delivery_status`, `created_by_staff_id`, `created_by_staff_name`, `client_session_id`, `seating_id -> table_seatings.id ON DELETE SET NULL`, `items` (legacy compat JSON), `note`, `total_amount`, `status`, `timeline`, `idempotency_key`, timestamps.
- **`order_items`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `order_id -> orders.id ON DELETE CASCADE`, `menu_item_id -> menu_items.id ON DELETE SET NULL`, `item_name_snapshot`, `base_unit_price`, `addons_unit_total`, `unit_price_snapshot`, `quantity`, `selected_variant`, `modifiers_json`, `discount_amount`, `tax_rate`, `tax_amount`, `line_total`, `station`, `note`, `image_url`, `created_at`.
- **`payments`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `seating_id -> table_seatings.id ON DELETE CASCADE`, `table_number`, `payer`, `amount`, `tip`, `mode`, `split_type`, `status`, `handled_by`, `created_at`, `settled_at`.
- **`coupons`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `code`, `kind`, `value`, `min_bill`, `active`, `created_at`, `UNIQUE(restaurant_id, code)`.
- **`loyalty_accounts`**: `(restaurant_id, phone)` PK (`restaurant_id -> restaurants.id ON DELETE CASCADE`), `points`, `total_spent`, `updated_at`.
- **`service_calls`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `table_number`, `call_type`, `status`, `acknowledged_by`, `acknowledged_at`, `completed_at`, `created_at`.
- **`activity_log`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `staff_name`, `action`, `details_json`, `created_at`.
- **`feedback`**: `id` (PK), `restaurant_id -> restaurants.id ON DELETE CASCADE`, `order_id -> orders.id ON DELETE CASCADE`, `seating_id -> table_seatings.id ON DELETE SET NULL`, `table_number`, `rating`, `comment`, `created_at`.
