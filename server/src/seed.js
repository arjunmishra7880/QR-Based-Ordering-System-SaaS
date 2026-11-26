import crypto from "node:crypto";
import { hashPassword } from "./auth.js";
import {
  db,
  DEFAULT_LOYALTY,
  DEFAULT_QR_STYLE,
  DEFAULT_RESTAURANT_ID,
  DEFAULT_RESTAURANT_SLUG,
  DEFAULT_SPIN_PRIZES,
} from "./db.js";

export const DEFAULT_OWNER_EMAIL = "owner@qserve.local";
export const DEFAULT_OWNER_PASSWORD = "QServe123!";
export const DEFAULT_SUPER_EMAIL = "super@qserve.local";
export const DEFAULT_SUPER_PASSWORD = "SuperQServe123!";
export const ADMINCAS_SUPER_ID = "admincas";
export const ADMINCAS_SUPER_PASSWORD = "ADMINCAS@BROTOCOL2026";

export function seedStarterCatalogForRestaurant(restaurantId, { sampleMenu = true } = {}) {
  const now = new Date().toISOString();

  if (!db.prepare("SELECT id FROM coupons WHERE restaurant_id = ? LIMIT 1").get(restaurantId)) {
    const insertCoupon = db.prepare(
      "INSERT INTO coupons (id, restaurant_id, code, kind, value, min_bill, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    );
    insertCoupon.run(crypto.randomUUID(), restaurantId, "FLAT10", "pct", 10, 0, now);
    insertCoupon.run(crypto.randomUUID(), restaurantId, "WELCOME50", "flat", 50, 300, now);
  }

  if (!db.prepare("SELECT id FROM staff WHERE restaurant_id = ? LIMIT 1").get(restaurantId)) {
    const insertStaff = db.prepare(
      "INSERT INTO staff (id, restaurant_id, name, role, pin, section, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    );
    insertStaff.run(crypto.randomUUID(), restaurantId, "Rahul Sharma", "waiter", "1111", "Main Hall", now);
    insertStaff.run(crypto.randomUUID(), restaurantId, "Priya Nair", "cashier", "2222", "Counter", now);
    insertStaff.run(crypto.randomUUID(), restaurantId, "Vikram Singh", "kitchen", "3333", "Tandoor", now);
  }

  if (
    sampleMenu &&
    !db.prepare("SELECT id FROM categories WHERE restaurant_id = ? LIMIT 1").get(restaurantId)
  ) {
    const prefix = restaurantId === DEFAULT_RESTAURANT_ID ? "" : `${restaurantId}_`;
    const categories = [
      { id: `${prefix}cat_starters`, name: "Starters", station: "Tandoor", display_order: 0 },
      { id: `${prefix}cat_main`, name: "Main Course", station: "Kitchen", display_order: 1 },
      { id: `${prefix}cat_breads`, name: "Breads & Rice", station: "Tandoor", display_order: 2 },
      { id: `${prefix}cat_drinks`, name: "Beverages & Desserts", station: "Bar", display_order: 3 },
    ];
    const insertCat = db.prepare(
      "INSERT INTO categories (id, restaurant_id, name, station, display_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const c of categories) {
      insertCat.run(c.id, restaurantId, c.name, c.station, c.display_order, now);
    }

    const items = [
      {
        id: `${prefix}item_paneer_tikka`,
        category_id: `${prefix}cat_starters`,
        name: "Paneer Tikka",
        description: "Char-grilled cottage cheese marinated in hung curd, Kashmiri chilli & ajwain.",
        price: 240,
        image_url: "/food/paneer-tikka.jpg",
        is_veg: 1,
        is_bestseller: 1,
        is_chef_special: 0,
        prep_minutes: 12,
        size_variants: [
          { name: "Half (4 pcs)", price: 240 },
          { name: "Full (8 pcs)", price: 390 },
        ],
        addons: [
          { name: "Extra Mint Chutney", price: 25 },
          { name: "Cheese Drizzle", price: 45 },
        ],
      },
      {
        id: `${prefix}item_samosa`,
        category_id: `${prefix}cat_starters`,
        name: "Samosa (2 pcs)",
        description: "Crisp hand-folded pastry stuffed with spiced potatoes, green peas & roasted coriander.",
        price: 60,
        image_url: "/food/samosa.jpg",
        is_veg: 1,
        is_bestseller: 0,
        is_chef_special: 0,
        prep_minutes: 6,
        size_variants: [],
        addons: [{ name: "Chole Topping", price: 40 }],
      },
      {
        id: `${prefix}item_chicken_tikka`,
        category_id: `${prefix}cat_starters`,
        name: "Chicken Tikka",
        description: "Smoky clay-oven chicken morsels glazed with butter, garlic & fresh coriander.",
        price: 290,
        image_url: "/food/chicken-tikka.jpg",
        is_veg: 0,
        is_bestseller: 1,
        is_chef_special: 1,
        prep_minutes: 15,
        size_variants: [
          { name: "Half (5 pcs)", price: 290 },
          { name: "Full (10 pcs)", price: 510 },
        ],
        addons: [
          { name: "Extra Mint Chutney", price: 25 },
          { name: "Garlic Dip", price: 35 },
        ],
      },
      {
        id: `${prefix}item_butter_chicken`,
        category_id: `${prefix}cat_main`,
        name: "Old Delhi Butter Chicken",
        description: "Tandoor-roasted chicken simmered in velvety tomato-fenugreek makhani gravy.",
        price: 340,
        image_url: "/food/butter-chicken.jpg",
        is_veg: 0,
        is_bestseller: 1,
        is_chef_special: 0,
        prep_minutes: 16,
        size_variants: [
          { name: "Half", price: 340 },
          { name: "Full", price: 560 },
        ],
        addons: [{ name: "Extra Butter", price: 30 }],
      },
      {
        id: `${prefix}item_dal_makhani`,
        category_id: `${prefix}cat_main`,
        name: "24-Hour Dal Makhani",
        description: "Slow-cooked black urad lentils finished with white butter, cream & ginger juliennes.",
        price: 280,
        image_url: "/food/dal-makhani.jpg",
        is_veg: 1,
        is_bestseller: 0,
        is_chef_special: 1,
        prep_minutes: 12,
        size_variants: [],
        addons: [{ name: "Extra Cream & Butter", price: 30 }],
      },
      {
        id: `${prefix}item_masala_dosa`,
        category_id: `${prefix}cat_main`,
        name: "Ghee Roast Masala Dosa",
        description: "Golden crisp crepe with spiced potato masala, coconut chutney & piping hot sambar.",
        price: 180,
        image_url: "/food/masala-dosa.jpg",
        is_veg: 1,
        is_bestseller: 1,
        is_chef_special: 0,
        prep_minutes: 10,
        size_variants: [],
        addons: [
          { name: "Extra Ghee", price: 25 },
          { name: "Molagapodi Podi", price: 20 },
        ],
      },
      {
        id: `${prefix}item_garlic_naan`,
        category_id: `${prefix}cat_breads`,
        name: "Roasted Garlic Butter Naan",
        description: "Fluffy tandoor flatbread brushed with cultured butter, roasted garlic & cilantro.",
        price: 75,
        image_url: "/food/garlic-naan.jpg",
        is_veg: 1,
        is_bestseller: 1,
        is_chef_special: 0,
        prep_minutes: 6,
        size_variants: [],
        addons: [{ name: "Cheese Stuffed", price: 45 }],
      },
      {
        id: `${prefix}item_veg_biryani`,
        category_id: `${prefix}cat_breads`,
        name: "Subz Dum Biryani",
        description: "Fragrant aged basmati rice layered with saffron, seasonal vegetables & caramelized onions.",
        price: 260,
        image_url: "/food/biryani.jpg",
        is_veg: 1,
        is_bestseller: 0,
        is_chef_special: 0,
        prep_minutes: 14,
        size_variants: [],
        addons: [{ name: "Burhani Raita", price: 40 }],
      },
      {
        id: `${prefix}item_masala_chai`,
        category_id: `${prefix}cat_drinks`,
        name: "Kulhad Masala Chai",
        description: "Assam CTC tea brewed with crushed green cardamom, fresh ginger & cinnamon.",
        price: 55,
        image_url: "/food/masala-chai.jpg",
        is_veg: 1,
        is_bestseller: 1,
        is_chef_special: 0,
        prep_minutes: 5,
        size_variants: [],
        addons: [{ name: "Bun Maska Pairing", price: 50 }],
      },
      {
        id: `${prefix}item_cold_coffee`,
        category_id: `${prefix}cat_drinks`,
        name: "Classic Cold Coffee",
        description: "Chilled espresso blended thick with milk, dark cocoa & vanilla ice cream.",
        price: 150,
        image_url: "/food/cold-coffee.jpg",
        is_veg: 1,
        is_bestseller: 0,
        is_chef_special: 0,
        prep_minutes: 5,
        size_variants: [
          { name: "Regular", price: 150 },
          { name: "Tall", price: 190 },
        ],
        addons: [{ name: "Extra Ice Cream Scoop", price: 45 }],
      },
    ];

    const insertItem = db.prepare(
      `INSERT INTO menu_items (
        id, restaurant_id, category_id, name, description, price, image_url,
        is_veg, is_bestseller, is_chef_special, is_available, prep_minutes,
        size_variants, addons, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    );

    for (const item of items) {
      insertItem.run(
        item.id,
        restaurantId,
        item.category_id,
        item.name,
        item.description,
        item.price,
        item.image_url,
        item.is_veg,
        item.is_bestseller,
        item.is_chef_special,
        item.prep_minutes,
        JSON.stringify(item.size_variants),
        JSON.stringify(item.addons),
        now
      );
    }
  }
}

export function seedIfEmpty() {
  const now = new Date().toISOString();

  // 1. Default Restaurant ("Tandoor House")
  const existingDefaultRest = db
    .prepare("SELECT id, cover_url FROM restaurants WHERE id = ?")
    .get(DEFAULT_RESTAURANT_ID);
  if (!existingDefaultRest) {
    db.prepare(
      `INSERT INTO restaurants (
        id, slug, name, description, logo_url, cover_url,
        orders_enabled, waiter_call_enabled, qr_mode, table_config, qr_style, menu_views,
        upi_id, gst_rate, service_charge_pct, require_table_pin, loyalty_config, spin_prizes,
        social_links, wifi_ssid, wifi_password, plan, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'per_table', ?, ?, 0, ?, 5, 0, 0, ?, ?, '{}', ?, ?, 'Pro', 1, ?, ?)`
    ).run(
      DEFAULT_RESTAURANT_ID,
      DEFAULT_RESTAURANT_SLUG,
      "Tandoor House",
      "North & South Indian kitchen — smoky tandoor grills, slow-simmered curries & crispy dosas.",
      "/food/brand-logo.svg",
      "/food/hero-cover.jpg",
      JSON.stringify({ total: 12, skip: [], disabled: [] }),
      JSON.stringify(DEFAULT_QR_STYLE),
      "tandoorhouse@okaxis",
      JSON.stringify(DEFAULT_LOYALTY),
      JSON.stringify(DEFAULT_SPIN_PRIZES),
      "TandoorHouse_Guest",
      "spice2026",
      now,
      now
    );
  } else if (!existingDefaultRest.cover_url || existingDefaultRest.cover_url === "/food/hero-cover.svg") {
    db.prepare("UPDATE restaurants SET cover_url = ?, updated_at = ? WHERE id = ?").run(
      "/food/hero-cover.jpg",
      now,
      DEFAULT_RESTAURANT_ID
    );
  }

  // Upgrade legacy SVG paths if present
  const imageUpgrades = [
    ["/food/paneer-tikka.svg", "/food/paneer-tikka.jpg"],
    ["/food/samosa.svg", "/food/samosa.jpg"],
    ["/food/chicken-tikka.svg", "/food/chicken-tikka.jpg"],
    ["/food/butter-chicken.svg", "/food/butter-chicken.jpg"],
    ["/food/dal-makhani.svg", "/food/dal-makhani.jpg"],
    ["/food/masala-dosa.svg", "/food/masala-dosa.jpg"],
    ["/food/garlic-naan.svg", "/food/garlic-naan.jpg"],
    ["/food/biryani.svg", "/food/biryani.jpg"],
    ["/food/masala-chai.svg", "/food/masala-chai.jpg"],
    ["/food/cold-coffee.svg", "/food/cold-coffee.jpg"],
  ];
  const upgradeItemImg = db.prepare("UPDATE menu_items SET image_url = ? WHERE image_url = ?");
  for (const [oldUrl, newUrl] of imageUpgrades) {
    upgradeItemImg.run(newUrl, oldUrl);
  }

  seedStarterCatalogForRestaurant(DEFAULT_RESTAURANT_ID, { sampleMenu: true });

  // 2. Users: Super Admin + Default Venue Admin
  const legacyUser = db.prepare("SELECT id FROM users WHERE email = ?").get("owner@quickmenu.local");
  const qserveUser = db.prepare("SELECT id FROM users WHERE email = ?").get(DEFAULT_OWNER_EMAIL);
  if (legacyUser && !qserveUser) {
    db.prepare(
      "UPDATE users SET email = ?, password_hash = ?, role = 'admin', restaurant_id = ? WHERE id = ?"
    ).run(DEFAULT_OWNER_EMAIL, hashPassword(DEFAULT_OWNER_PASSWORD), DEFAULT_RESTAURANT_ID, legacyUser.id);
  } else if (!qserveUser) {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, restaurant_id, created_at) VALUES (?, ?, ?, ?, 'admin', ?, ?)"
    ).run(
      crypto.randomUUID(),
      DEFAULT_OWNER_EMAIL,
      hashPassword(DEFAULT_OWNER_PASSWORD),
      "Owner (Tandoor House)",
      DEFAULT_RESTAURANT_ID,
      now
    );
  } else {
    db.prepare("UPDATE users SET role = 'admin', restaurant_id = ? WHERE id = ? AND restaurant_id IS NULL").run(
      DEFAULT_RESTAURANT_ID,
      qserveUser.id
    );
  }

  const superUser = db.prepare("SELECT id FROM users WHERE email = ?").get(DEFAULT_SUPER_EMAIL);
  if (!superUser) {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, restaurant_id, created_at) VALUES (?, ?, ?, ?, 'super_admin', NULL, ?)"
    ).run(
      crypto.randomUUID(),
      DEFAULT_SUPER_EMAIL,
      hashPassword(DEFAULT_SUPER_PASSWORD),
      "Platform Super Admin",
      now
    );
  }

  const admincasUser = db
    .prepare("SELECT id FROM users WHERE LOWER(email) = ?")
    .get(ADMINCAS_SUPER_ID);
  if (!admincasUser) {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, restaurant_id, created_at) VALUES (?, ?, ?, ?, 'super_admin', NULL, ?)"
    ).run(
      crypto.randomUUID(),
      ADMINCAS_SUPER_ID,
      hashPassword(ADMINCAS_SUPER_PASSWORD),
      "ADMINCAS Super Admin",
      now
    );
  }

  // 3. Second Demo Restaurant ("Saffron Courtyard") for multi-venue Super Admin experience
  const saffronRest = db.prepare("SELECT id FROM restaurants WHERE id = ?").get("rest_saffron");
  if (!saffronRest && db.prepare("SELECT COUNT(*) AS cnt FROM restaurants").get().cnt < 2) {
    db.prepare(
      `INSERT INTO restaurants (
        id, slug, name, description, logo_url, cover_url,
        orders_enabled, waiter_call_enabled, qr_mode, table_config, qr_style, menu_views,
        upi_id, gst_rate, service_charge_pct, require_table_pin, loyalty_config, spin_prizes,
        social_links, wifi_ssid, wifi_password, plan, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'per_table', ?, ?, 0, ?, 5, 5, 0, ?, ?, '{}', ?, ?, 'Enterprise', 1, ?, ?)`
    ).run(
      "rest_saffron",
      "saffron-courtyard",
      "Saffron Courtyard",
      "All-day heritage dining lounge — regional grills, artisanal chutneys & craft brews.",
      "/food/brand-logo.svg",
      "/food/hero-cover.jpg",
      JSON.stringify({ total: 8, skip: [], disabled: [] }),
      JSON.stringify({ ...DEFAULT_QR_STYLE, fgColor: "#49332A" }),
      "saffron@okaxis",
      JSON.stringify(DEFAULT_LOYALTY),
      JSON.stringify(DEFAULT_SPIN_PRIZES),
      "Saffron_Guest",
      "courtyard8",
      now,
      now
    );

    const insertCat = db.prepare(
      "INSERT INTO categories (id, restaurant_id, name, station, display_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insertCat.run("saffron_cat_smallplates", "rest_saffron", "Small Plates", "Tandoor", 0, now);
    insertCat.run("saffron_cat_mains", "rest_saffron", "Heritage Mains", "Kitchen", 1, now);
    insertCat.run("saffron_cat_sips", "rest_saffron", "Craft Sips", "Bar", 2, now);

    const insertItem = db.prepare(
      `INSERT INTO menu_items (
        id, restaurant_id, category_id, name, description, price, image_url,
        is_veg, is_bestseller, is_chef_special, is_available, prep_minutes,
        size_variants, addons, created_at
      ) VALUES (?, 'rest_saffron', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    );
    insertItem.run(
      "saffron_item_paneer",
      "saffron_cat_smallplates",
      "Charcoal Paneer Tikka",
      "Marinated malai cottage cheese with smoked bell peppers & mint emulsion.",
      280,
      "/food/paneer-tikka.jpg",
      1,
      1,
      1,
      12,
      "[]",
      JSON.stringify([{ name: "Truffle Ghee Brush", price: 45 }]),
      now
    );
    insertItem.run(
      "saffron_item_biryani",
      "saffron_cat_mains",
      "Awadhi Zafrani Biryani",
      "Saffron-infused basmati sealed under flaky purdah pastry with burhani raita.",
      360,
      "/food/biryani.jpg",
      1,
      1,
      0,
      16,
      "[]",
      JSON.stringify([{ name: "Extra Mirchi Ka Salan", price: 40 }]),
      now
    );
    insertItem.run(
      "saffron_item_coffee",
      "saffron_cat_sips",
      "Spiced Cold Brew",
      "18-hour single-origin cold brew finished with green cardamom foam.",
      180,
      "/food/cold-coffee.jpg",
      1,
      0,
      1,
      4,
      "[]",
      "[]",
      now
    );

    db.prepare(
      "INSERT INTO coupons (id, restaurant_id, code, kind, value, min_bill, active, created_at) VALUES (?, 'rest_saffron', 'COURTYARD15', 'pct', 15, 250, 1, ?)"
    ).run(crypto.randomUUID(), now);
    db.prepare(
      "INSERT INTO staff (id, restaurant_id, name, role, pin, section, active, created_at) VALUES (?, 'rest_saffron', 'Aarav Mehta', 'waiter', '1111', 'Courtyard', 1, ?)"
    ).run(crypto.randomUUID(), now);
    db.prepare(
      "INSERT INTO staff (id, restaurant_id, name, role, pin, section, active, created_at) VALUES (?, 'rest_saffron', 'Meera Joshi', 'cashier', '2222', 'Billing', 1, ?)"
    ).run(crypto.randomUUID(), now);

    if (!db.prepare("SELECT id FROM users WHERE email = ?").get("saffron@qserve.local")) {
      db.prepare(
        "INSERT INTO users (id, email, password_hash, name, role, restaurant_id, created_at) VALUES (?, ?, ?, ?, 'admin', 'rest_saffron', ?)"
      ).run(
        crypto.randomUUID(),
        "saffron@qserve.local",
        hashPassword(DEFAULT_OWNER_PASSWORD),
        "Aarav (Saffron Courtyard)",
        now
      );
    }
  }
}
