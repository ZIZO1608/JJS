import type { Currency } from "./format";

export interface Named {
  id: string;
  nameAr: string;
  nameEn: string;
}
export interface Category extends Named {
  sort: number;
  active: boolean;
}
export interface Option extends Named {
  groupId: string;
  priceDelta: number;
  currency: Currency;
  sort: number;
  active: boolean;
}
export interface OptionGroup extends Named {
  minSelect: number;
  maxSelect: number;
  sort: number;
  options: Option[];
}
export interface CatalogProduct extends Named {
  categoryId: string;
  code: string;
  price: number;
  currency: Currency;
  shelfLifeHours: number;
  allergens: string;
  photo: string;
  sort: number;
  active: boolean;
  groupIds: string[];
}
export interface Catalog {
  categories: Category[];
  products: CatalogProduct[];
  groups: OptionGroup[];
}
export interface ClientSummary {
  id: string;
  type: "business" | "individual";
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  tierId: string | null;
  tagId: string | null;
  receiptLanguage: "ar" | "en";
  creditLimitUsd: number;
  creditBlock: boolean;
  note: string;
  active: boolean;
  convertedAt: string | null;
  balanceUsd: number;
  loyalty: { count: number; progress: number; buyQty: number; available: number; enabled: boolean };
  subscription: { planNameAr: string; planNameEn: string; endDate: string; availableIncluded: number } | null;
  lastOrderDate: string | null;
  areaId: string | null;
  paymentTermsDays: number;
  priceListId: string | null;
  consignment: boolean;
  repId: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string;
  aging: { balanceUsd: number; oldestUnpaidDate: string | null; daysOutstanding: number; termsDays: number; overdueDays: number };
}
export interface PaymentMethod extends Named {
  kind: "box" | "credit" | "salary";
  boxId: string | null;
  systemKey: string | null;
  sort: number;
  active: boolean;
}
export interface CashBox extends Named {
  kind: "cash" | "wallet" | "rep" | "bank";
  currency: Currency;
  employeeId: string | null;
  systemKey: string | null;
  active: boolean;
  balance: number | null;
  hasOpening?: boolean;
}
export interface Employee {
  id: string;
  name: string;
  phone: string;
  jobTitle: string;
  userId: string | null;
  payModel: "fixed" | "commission" | "both";
  baseSalary: number;
  currency: Currency;
  commissionPerClientUsd: number;
  commissionPct: number;
  staffDiscountPct: number;
  isDeliveryRep: boolean;
  active: boolean;
  userName: string | null;
}
export interface Lookup extends Named {
  listType: string;
  sort: number;
  active: boolean;
}
export interface Location extends Named {
  warehouseId: string;
  active: boolean;
}
export interface Warehouse extends Named {
  kind: "store" | "fridge" | "freezer";
  sort: number;
  active: boolean;
}
export interface StockItem extends Named {
  kind: "ingredient" | "packaging" | "product";
  productId: string | null;
  unitCode: "kg" | "g" | "l" | "ml" | "pc" | "pack" | "carton";
  packUnit: string;
  packSize: number;
  supplierId: string | null;
  minLevel: number;
  avgCostUsd: number;
  active: boolean;
  qty: number;
  valueUsd: number;
  low: boolean;
}
export type BatchStatus = "expired" | "today" | "soon" | "fresh" | "none";
export interface Batch {
  id: string;
  itemId: string;
  locationId: string;
  batchCode: string;
  producedAt: string;
  expiresAt: string | null;
  qtyIn: number;
  qtyLeft: number;
  unitCostUsd: number;
  status: BatchStatus;
  item: { id: string; kind: StockItem["kind"]; nameAr: string; nameEn: string; unitCode: StockItem["unitCode"]; productId: string | null };
  location: { id: string; nameAr: string; nameEn: string };
  warehouse: { id: string; nameAr: string; nameEn: string; kind: Warehouse["kind"] };
  allergens: string;
  productCode: string | null;
}
/** /reports/range and dashboard "today" */
export interface PeriodReport {
  from: string;
  to: string;
  orders: number;
  items: number;
  freeItems: number;
  salesUsd: number;
  grossUsd: number;
  discountUsd: number;
  taxUsd: number;
  deliveryUsd: number;
  costUsd?: number;
  grossProfitUsd?: number;
  marginPct?: number;
  expensesUsd: number;
  wasteUsd: number;
  depreciationUsd?: number;
  salariesUsd?: number;
  netUsd?: number;
  hiddenCosts?: boolean;
  byStatus: { status: string; n: number; usd: number }[];
  byMethod: { methodId: string | null; nameAr: string | null; nameEn: string | null; n: number; usd: number }[];
  byType: { type: string; n: number; items: number }[];
  byProduct: { productId: string; nameAr: string; nameEn: string; qty: number; revenueUsd: number; costUsd?: number; marginPct?: number }[];
  byCategory: { categoryId: string; nameAr: string; nameEn: string; qty: number }[];
  byClient: { clientId: string; name: string; orders: number; items: number; salesUsd: number; balanceUsd: number }[];
  expenses: { categoryId: string | null; nameAr: string | null; nameEn: string | null; usd: number; n: number }[];
  waste: { itemId: string; nameAr: string; nameEn: string; qty: number; usd: number }[];
  depreciation: { id: string; nameAr: string; nameEn: string; usd: number }[];
  trials: { given: number; converted: number; rate: number };
  unpaid?: { id: string; name: string; balanceUsd: number; creditLimitUsd: number }[];
}
