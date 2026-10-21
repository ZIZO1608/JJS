import { count, eq } from "drizzle-orm";
import { localDate } from "../lib/biz.js";
import { newId } from "../lib/util.js";
import { addStock, ensureProductItem } from "../services/stock.js";
import type { Tx } from "./client.js";
import { categories, clientTiers, clients, employees, items, locations, lookups, optionGroupLinks, optionGroups, options, priceListItems, priceLists, products, recipes, recurringExpenses, subscriptionPlans, suppliers, warehouses } from "./schema.js";

/**
 * Sample menu, stock and clients so the shop can try everything on day one.
 * Prices are in USD and clearly sample values: edit or delete them freely.
 */
export function loadDemoData(tx: Tx, userId: string) {
  if ((tx.select({ n: count() }).from(products).get()?.n ?? 0) > 0) return { loaded: false };
  const date = localDate();
  const ctx = { userId, date, refType: "demo" };
  const loc = (wh: "store" | "fridge") =>
    tx.select({ id: locations.id }).from(locations).innerJoin(warehouses, eq(locations.warehouseId, warehouses.id)).where(eq(warehouses.kind, wh)).get()!.id;
  const store = loc("store");
  const fridge = loc("fridge");

  // ingredients & packaging: [key, ar, en, unit, avg cost USD per unit, min level, stock qty, place, shelf days]
  const ing: [string, string, string, "kg" | "pc" | "l", number, number, number, string, number | null][] = [
    ["bread", "خبز", "Bread roll", "pc", 0.25, 60, 120, store, 2],
    ["turkey", "صدر حبش", "Turkey breast", "kg", 9, 2, 6, fridge, 5],
    ["smoked", "حبش مدخّن", "Smoked turkey", "kg", 11, 1, 3, fridge, 7],
    ["cheddar", "جبنة شيدر", "Cheddar", "kg", 7, 1, 3, fridge, 20],
    ["tomato", "بندورة", "Tomato", "kg", 0.8, 5, 8, fridge, 4],
    ["lettuce", "خس", "Lettuce", "kg", 1, 2, 3, fridge, 3],
    ["sauce", "صوص البيت", "House sauce", "kg", 3, 1, 2, fridge, 10],
    ["pesto", "بيستو", "Pesto", "kg", 8, 0.5, 1, fridge, 10],
    ["chicken", "صدر دجاج", "Chicken breast", "kg", 6, 2, 5, fridge, 3],
    ["halloumi", "حلوم", "Halloumi", "kg", 8, 1, 2, fridge, 20],
    ["patty", "باتي لحم", "Beef patty", "pc", 0.9, 20, 60, fridge, 30],
    ["romaine", "خس روماني", "Romaine", "kg", 1.4, 1, 2, fridge, 3],
    ["feta", "جبنة فيتا", "Feta", "kg", 6.5, 1, 2, fridge, 15],
    ["cucumber", "خيار", "Cucumber", "kg", 0.7, 2, 4, fridge, 5],
    ["lemon", "ليمون ونعناع", "Lemon & mint", "kg", 1.2, 1, 2, fridge, 7],
    ["wrap", "ورق تغليف", "Wrap paper", "pc", 0.03, 200, 600, store, null],
    ["box", "علبة كرتون", "Kraft box", "pc", 0.12, 100, 340, store, null],
    ["bowl", "علبة سلطة", "Salad bowl", "pc", 0.15, 50, 150, store, null],
    ["cup", "كأس وغطاء", "Cup & lid", "pc", 0.08, 50, 200, store, null],
    ["sticker", "ملصق الصلاحية", "Expiry label", "pc", 0.02, 300, 1000, store, null],
  ];
  const itemId: Record<string, string> = {};
  const packaging = new Set(["wrap", "box", "bowl", "cup", "sticker"]);
  for (const [key, ar, en, unit, cost, min, qty, place, days] of ing) {
    const id = newId();
    itemId[key] = id;
    const pack = key === "bread" ? { packUnit: "Bag", packSize: 10 } : key === "cup" ? { packUnit: "Carton", packSize: 50 } : key === "patty" ? { packUnit: "Box", packSize: 20 } : {};
    tx.insert(items).values({ id, kind: packaging.has(key) ? "packaging" : "ingredient", nameAr: ar, nameEn: en, unitCode: unit, minLevel: min, avgCostUsd: 0, ...pack }).run();
    addStock(tx, { itemId: id, locationId: place, qty, unitCostUsd: cost, type: "adjust", expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString() : null }, ctx);
  }

  const cat = (ar: string, en: string, sort: number) => {
    const id = newId();
    tx.insert(categories).values({ id, nameAr: ar, nameEn: en, sort }).run();
    return id;
  };
  const sand = cat("ساندويشات", "Sandwiches", 0);
  const salad = cat("سلطات", "Salads", 1);
  const drink = cat("مشروبات", "Drinks", 2);

  const group = (ar: string, en: string, max: number, sort: number) => {
    const id = newId();
    tx.insert(optionGroups).values({ id, nameAr: ar, nameEn: en, minSelect: 0, maxSelect: max, sort }).run();
    return id;
  };
  const extras = group("إضافات", "Extras", 4, 0);
  const remove = group("بدون", "Remove", 3, 1);
  const opt = (g: string, ar: string, en: string, price: number, recipe: [string, number][] = []) => {
    const id = newId();
    tx.insert(options).values({ id, groupId: g, nameAr: ar, nameEn: en, priceDelta: price, currency: "USD" }).run();
    for (const [k, q] of recipe) tx.insert(recipes).values({ id: newId(), optionId: id, itemId: itemId[k]!, qty: q }).run();
    return id;
  };
  opt(extras, "حشوة مضاعفة", "Double filling", 1, [["turkey", 0.08]]);
  opt(extras, "شيدر إضافي", "Extra cheddar", 0.4, [["cheddar", 0.025]]);
  opt(extras, "إضافة بيستو", "Add pesto", 0.3, [["pesto", 0.015]]);
  opt(remove, "بدون بصل", "No onion", 0);
  opt(remove, "بدون صوص", "No sauce", 0);
  for (const g of [extras, remove]) tx.insert(optionGroupLinks).values({ id: newId(), groupId: g, categoryId: sand }).run();
  const drinkOpts = group("خيارات", "Options", 2, 2);
  opt(drinkOpts, "ثلج إضافي", "Extra ice", 0);
  tx.insert(optionGroupLinks).values({ id: newId(), groupId: drinkOpts, categoryId: drink }).run();

  const productIds: Record<string, string> = {};
  const prod = (category: string, code: string, ar: string, en: string, price: number, hours: number, allergens: string, recipe: [string, number][], sort: number) => {
    const id = newId();
    productIds[code] = id;
    tx.insert(products).values({ id, categoryId: category, code, nameAr: ar, nameEn: en, price, currency: "USD", shelfLifeHours: hours, allergens, sort, weightG: code === "LEMON" ? 0 : 220 }).run();
    ensureProductItem(tx, id);
    for (const [k, q] of recipe) tx.insert(recipes).values({ id: newId(), productId: id, itemId: itemId[k]!, qty: q }).run();
    return id;
  };
  prod(sand, "TC", "حبش وشيدر", "Turkey & Cheddar", 2.5, 24, "Gluten, Dairy", [["bread", 1], ["turkey", 0.08], ["cheddar", 0.025], ["tomato", 0.03], ["lettuce", 0.015], ["sauce", 0.015], ["wrap", 1], ["sticker", 1]], 0);
  prod(sand, "CLUB", "كلوب حبش مدخّن", "Smoked Turkey Club", 3, 24, "Gluten, Dairy, Egg", [["bread", 1], ["smoked", 0.09], ["cheddar", 0.025], ["tomato", 0.035], ["lettuce", 0.02], ["sauce", 0.02], ["box", 1], ["sticker", 1]], 1);
  prod(sand, "PESTO", "دجاج بيستو", "Chicken Pesto", 2.75, 24, "Gluten, Nuts", [["bread", 1], ["chicken", 0.09], ["pesto", 0.02], ["tomato", 0.03], ["lettuce", 0.015], ["wrap", 1], ["sticker", 1]], 2);
  prod(sand, "HAL", "حلوم وبندورة", "Halloumi & Tomato", 2.25, 24, "Gluten, Dairy", [["bread", 1], ["halloumi", 0.07], ["tomato", 0.04], ["lettuce", 0.015], ["wrap", 1], ["sticker", 1]], 3);
  prod(sand, "BEEF", "برغر لحم كلاسيك", "Classic Beef Patty", 3.25, 12, "Gluten, Dairy", [["bread", 1], ["patty", 1], ["cheddar", 0.025], ["tomato", 0.03], ["lettuce", 0.015], ["sauce", 0.02], ["box", 1], ["sticker", 1]], 4);
  prod(salad, "CAESAR", "سلطة سيزر", "Caesar Salad", 3, 12, "Dairy, Gluten", [["romaine", 0.15], ["chicken", 0.08], ["cheddar", 0.015], ["sauce", 0.03], ["bowl", 1], ["sticker", 1]], 0);
  prod(salad, "GREEK", "سلطة يونانية", "Greek Salad", 2.75, 12, "Dairy", [["tomato", 0.1], ["cucumber", 0.1], ["feta", 0.05], ["lettuce", 0.05], ["bowl", 1], ["sticker", 1]], 1);
  prod(drink, "LEMON", "ليمون ونعناع", "Lemon Mint", 1, 24, "", [["lemon", 0.06], ["cup", 1]], 0);

  // tiers, plan, clients
  const favourite = tx.select().from(clientTiers).where(eq(clientTiers.nameEn, "Favourite")).get()?.id ?? null;
  tx.insert(subscriptionPlans).values({ id: newId(), nameAr: "اشتراك شهري 20", nameEn: "Monthly 20", monthlyFee: 45, currency: "USD", discountPct: 0, includedItems: 20 }).run();
  const tag = (en: string) => tx.select({ id: lookups.id }).from(lookups).where(eq(lookups.nameEn, en)).get()?.id ?? null;
  // Wholesale price lists (prices per piece)
  const plDist = newId();
  const plSmall = newId();
  tx.insert(priceLists).values([
    { id: plDist, nameAr: "سعر الموزّع", nameEn: "Distributor price" },
    { id: plSmall, nameAr: "سعر المحلات الصغيرة", nameEn: "Small shop price" },
  ]).run();
  for (const [code, d, sm] of [["TC", 1.9, 2.2], ["CLUB", 2.3, 2.7], ["PESTO", 2.1, 2.45], ["HAL", 1.7, 2.0], ["BEEF", 2.5, 2.9]] as const) {
    tx.insert(priceListItems).values({ id: newId(), listId: plDist, productId: productIds[code]!, price: d, currency: "USD" }).run();
    tx.insert(priceListItems).values({ id: newId(), listId: plSmall, productId: productIds[code]!, price: sm, currency: "USD" }).run();
  }
  const area = (ar: string, en: string, sort: number) => {
    const existing = tx.select({ id: lookups.id }).from(lookups).where(eq(lookups.nameEn, en)).get();
    if (existing) return existing.id;
    const id = newId();
    tx.insert(lookups).values({ id, listType: "area", nameAr: ar, nameEn: en, sort }).run();
    return id;
  };
  const downtown = area("وسط المدينة", "Downtown", 10);
  const uni = area("منطقة الجامعة", "University district", 11);
  const repId = newId();
  tx.insert(employees).values({ id: repId, name: "Ahmad (sales & delivery)", jobTitle: "Sales & delivery", payModel: "both", baseSalary: 150, currency: "USD", commissionPct: 3, commissionPerClientUsd: 5, isDeliveryRep: true }).run();

  tx.insert(clients).values([
    { id: newId(), type: "business", name: "Al-Noor Market", contactPerson: "Abu Fadi", phone: "+963 944 000 444", tagId: tag("Shop"), creditLimitUsd: 120, priceListId: plSmall, consignment: true, paymentTermsDays: 7, areaId: downtown, repId },
    { id: newId(), type: "business", name: "City Distributor", contactPerson: "Omar", phone: "+963 944 000 555", tagId: tag("Shop"), creditLimitUsd: 400, priceListId: plDist, paymentTermsDays: 14, areaId: downtown, repId },
    { id: newId(), type: "business", name: "Focus Study Zone", contactPerson: "Rami", phone: "+963 944 000 111", tierId: favourite, tagId: tag("Study zone"), creditLimitUsd: 150, areaId: uni, repId, paymentTermsDays: 7 },
    { id: newId(), type: "business", name: "Bean & Book Café", contactPerson: "Sara", phone: "+963 944 000 222", tagId: tag("Café"), creditLimitUsd: 100, creditBlock: true, areaId: uni, paymentTermsDays: 7 },
    { id: newId(), type: "business", name: "Corner Market", contactPerson: "Abu Khaled", tagId: tag("Shop"), creditLimitUsd: 60, areaId: downtown, repId },
    { id: newId(), type: "individual", name: "Lina K.", phone: "+963 955 000 333", tagId: tag("Freelancer"), receiptLanguage: "en" },
  ]).run();
  tx.insert(suppliers).values([
    { id: newId(), name: "Al-Hal market (vegetables)", phone: "" },
    { id: newId(), name: "Cold cuts supplier", phone: "", openingBalance: 40, openingCurrency: "USD", openingUsd: 40, paymentTermsDays: 7 },
  ]).run();
  const rentCat = tx.select({ id: lookups.id }).from(lookups).where(eq(lookups.nameEn, "Rent")).get()?.id ?? null;
  tx.insert(recurringExpenses).values({ id: newId(), categoryId: rentCat, amount: 200, currency: "USD", dayOfMonth: 1, beneficiary: "Landlord", note: "Kitchen rent" }).run();
  return { loaded: true };
}
