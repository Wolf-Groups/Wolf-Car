import type { StockInfo } from "@/lib/stock";
import type { VariantInfo } from "@/lib/variants";
import type { SiteDevice, SiteSource } from "@/shared/analytics";
import type { OrderStatusName, PermissionGroup, PermissionKey, RoleName } from "@/shared/permissions";
import type { OrderSourceName, PaymentStatusName } from "@/shared/shop";

export type { OrderSourceName, OrderStatusName, PaymentStatusName, PermissionKey, RoleName };

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  /** the cashier scans barcodes off the showroom screen (sent by the showroom catalogue only) */
  scanFromScreen?: boolean;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: RoleName;
  branch: BranchSummary | null;
  twoFactorEnabled: boolean;
  hasShowroomPassword: boolean;
  permissions: PermissionKey[];
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: Profile;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PersonRef {
  id: string;
  username: string;
  displayName: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  barcode: string | null;
  /** "125.50" (QAR) or null until Finance sets it */
  price: string | null;
  priceUpdatedAt: string | null;
  /** name, barcode, photo and price come from Odoo and are not edited here */
  fromOdoo?: boolean;
  /** units free to sell in Odoo at the last sync (can be negative); null when Odoo keeps no stock for it */
  stock?: number | null;
  /** also listed under the website's "Quick service" tab */
  quickService?: boolean;
  imageUrl: string;
  thumbUrl: string;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  /** position in the branch showroom order (when listed for a branch) */
  position?: number;
}

export interface PriceChange {
  id: string;
  oldPrice: string | null;
  newPrice: string;
  changedAt: string;
  changedBy: PersonRef & { role: RoleName };
}

export interface ShowroomProduct extends VariantInfo, StockInfo {
  id: string;
  name: string;
  description: string | null;
  barcode: string | null;
  categoryId: string | null;
  /** its own category plus, for a product common to a brand, each of that brand's models */
  categoryIds?: string[];
  price: string;
  imageUrl: string;
  thumbUrl: string;
}

/** A showroom tab: usually a car model, sometimes an accessory line. */
export interface ShowroomCategory {
  id: string;
  name: string;
  carModel: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  /** how many priced products this branch has in the category */
  count: number;
}

export type ServiceSection = "ppfParts" | "ppfPartial" | "ppfFull" | "glass" | "tint" | "care" | "blackEdition" | "paint";
export type ServiceBody = "sedan" | "suv";

/** One column of a service's price table: a PPF package, a tint film or a car model. */
export interface ServiceTier {
  id: string;
  /** "ppf", "tint" or "model" */
  set: string;
  nameAr: string;
  nameEn: string;
}

/** One price of a service. It is ordered by `productId`, exactly like a product. */
export interface ServicePrice {
  productId: string;
  tierId: string | null;
  body: ServiceBody | null;
  /** null in the dashboard while Finance has not set it; never null for customers */
  price: string | null;
}

/** A service or package kept in the dashboard, not in Odoo: PPF, tint, polish, paint. */
export interface Service {
  id: string;
  section: ServiceSection;
  nameAr: string;
  nameEn: string;
  noteAr: string | null;
  noteEn: string | null;
  /** the set of tiers it is priced by; null for a single price */
  tierSet: string | null;
  /** separate sedan and SUV prices */
  bodySplit: boolean;
  /** which of the shop's posters is shown with it (lib/packages.ts); null for none */
  poster?: string | null;
  isActive: boolean;
  thumbUrl: string | null;
  prices: ServicePrice[];
}

export interface ServiceCatalog {
  tiers: ServiceTier[];
  services: Service[];
}

/** One attempt to charge a card (the newest is shown on the order). */
export type PaymentAttemptStatus = "INITIATED" | "CAPTURED" | "FAILED";
/** Where a paid web order stands in the Odoo outbox. */
export type OdooOutboxStatus = "PENDING" | "DONE" | "FAILED";

export interface OrderSummary {
  id: string;
  code: string;
  number: number;
  status: OrderStatusName;
  /** SHOWROOM for the kiosk, WEB for the website's online checkout */
  source: OrderSourceName;
  /** NONE for showroom orders */
  paymentStatus: PaymentStatusName;
  paidAt: string | null;
  /** when the cashier handed a paid web order over */
  collectedAt: string | null;
  customerName: string;
  /** E.164, web orders only */
  customerPhone: string | null;
  total: string;
  currency: string;
  itemCount: number;
  branch: BranchSummary;
  createdBy: PersonRef;
  confirmedBy: PersonRef | null;
  confirmedAt: string | null;
  cancelledBy: PersonRef | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  barcode: string | null;
  thumbUrl: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderDetail extends OrderSummary {
  items: OrderItem[];
  customerEmail: string | null;
  collectedBy: PersonRef | null;
  /** the newest card attempt; null for showroom orders and before the first attempt */
  payment: {
    chargeId: string | null;
    status: PaymentAttemptStatus;
    failureCode: string | null;
    refundId: string | null;
    /** Tap's stored charge says live_mode false: a sandbox (or fake gateway) payment, no real money */
    testMode: boolean;
  } | null;
  /** null for showroom orders and unpaid web orders; when Odoo writing is off it is PENDING with lastError ODOO_WRITE_NOT_CONFIGURED */
  odoo: { status: OdooOutboxStatus; saleOrderId: number | null; attempts: number; lastError: string | null; nextAttemptAt: string | null } | null;
}

// ---- online checkout (the website's customer, not staff) ----

export interface CustomerProfile {
  /** E.164, "+97455123456" */
  phone: string;
  name: string | null;
  email: string | null;
}

export interface WebOrderItem {
  productId: string;
  productName: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  thumbUrl: string;
}

/** A car model the signed-in customer drives (the API's CustomerCarView); `id` is the catalogue's ?category=. */
export interface CustomerCar {
  id: string;
  name: string;
  nameEn: string | null;
  thumbUrl: string | null;
}

/** What the website is told about a customer's own order (the API's WebOrderView, dates as strings). */
export interface WebOrder {
  id: string;
  code: string;
  status: OrderStatusName;
  paymentStatus: PaymentStatusName;
  /** "619.50" */
  total: string;
  currency: string;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  /** when the branch handed the paid order over */
  collectedAt: string | null;
  branch: { code: string; name: string; nameAr: string };
  customer: { name: string | null; email: string | null; phone: string };
  items: WebOrderItem[];
  lastPayment: { status: PaymentAttemptStatus; failureCode: string | null } | null;
}

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: RoleName;
  branch: BranchSummary | null;
  isActive: boolean;
  twoFactorEnabled: boolean;
  hasShowroomPassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Plaintext credentials returned exactly once by the API. */
export interface IssuedCredentials {
  userId: string;
  username: string;
  displayName: string;
  role: RoleName;
  branchCode: string | null;
  password?: string;
  showroomPassword?: string;
}

export interface StaffRef {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  isActive: boolean;
}

export interface BranchView {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  isActive: boolean;
  createdAt: string;
  /** whether the showroom screen can sign in to this branch (the PIN itself is never sent) */
  showroomPinSet?: boolean;
  manager: StaffRef | null;
  cashier: StaffRef | null;
}

export interface PermissionInfo {
  key: PermissionKey;
  group: PermissionGroup;
  description: string;
}

export interface RoleMatrix {
  roles: Record<RoleName, PermissionKey[]>;
  locked: RoleName[];
}

export interface UserPermissions {
  userId: string;
  role: RoleName;
  locked: boolean;
  rolePermissions: PermissionKey[];
  overrides: { permission: PermissionKey; effect: "GRANT" | "REVOKE" }[];
  effective: PermissionKey[];
}

export interface ActivityEntry {
  id: string;
  occurredAt: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE";
  actor: { id: string | null; username: string | null; role: RoleName | null } | null;
  branch: BranchSummary | null;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface PublicProduct extends VariantInfo, StockInfo {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  /** "1800.00" (QAR), or null while the product has no price yet */
  price: string | null;
  imageUrl: string;
  thumbUrl: string;
}

/** A car-model category on the public site. */
export interface PublicCategory {
  id: string;
  /** Arabic name, as the branches use it */
  name: string;
  /** English name for /en; null means show `name` */
  nameEn: string | null;
  carModel: string | null;
  /** a car model a customer can add to "My cars"; false for parts, accessories and services */
  isCar: boolean;
  imageUrl: string | null;
  thumbUrl: string | null;
  /** how many products the category holds */
  count: number;
}

export interface BranchOption {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  isActive: boolean;
}
// ---- PPF bookings, general reservations, sales slots ----

export type PpfBookingType = "FULL" | "LIGHT";
export type BookingStatus = "BOOKED" | "CANCELLED";
export type DayState = "OPEN" | "FULL" | "CLOSED";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

/** One day of the PPF calendar. Days are "YYYY-MM-DD" (Qatar). */
export interface DayInfo {
  date: string;
  state: DayState;
  reason: string | null;
  /** full PPF cars on the day: 1 closes it, 2 means the exception is used too */
  fullCount: number;
  lightCount: number;
}

export interface PpfBooking {
  id: string;
  type: PpfBookingType;
  status: BookingStatus;
  car: string;
  ownerName: string | null;
  phone: string | null;
  service: string | null;
  receiveDate: string;
  deliveryDate: string | null;
  note: string | null;
  /** the salesperson whose approved request created this booking */
  requestedBy: string | null;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  cancelledAt: string | null;
}

export interface PpfCalendar {
  today: string;
  days: DayInfo[];
  bookings: PpfBooking[];
}

/** A salesperson's request for a booking: a full PPF or a light job. */
export interface LightJobRequest {
  id: string;
  date: string;
  type: PpfBookingType;
  salesName: string;
  car: string;
  ownerName: string;
  phone: string | null;
  note: string | null;
  status: RequestStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  bookingId: string | null;
  createdAt: string;
}

export interface SalesAccessStatus {
  pinSet: boolean;
  updatedAt: string | null;
}

export interface GeneralReservation {
  id: string;
  date: string;
  /** "HH:mm" or null */
  time: string | null;
  service: string;
  ownerName: string | null;
  phone: string | null;
  car: string | null;
  note: string | null;
  status: BookingStatus;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  cancelledAt: string | null;
}

export interface SalesBooking {
  id: string;
  type: PpfBookingType;
  car: string;
  ownerName: string | null;
  phone: string | null;
  receiveDate: string;
  deliveryDate: string | null;
}

export interface SalesRequest {
  id: string;
  date: string;
  type: PpfBookingType;
  salesName: string;
  car: string;
  status: RequestStatus;
  decisionNote: string | null;
  createdAt: string;
}

export interface SlotsView {
  today: string;
  days: DayInfo[];
  bookings: SalesBooking[];
  requests: SalesRequest[];
}

export interface AnalyticsTotals {
  /** people per day, added up over the range */
  visitors: number;
  visits: number;
  pageviews: number;
  whatsappOrder: number;
  whatsappBooking: number;
  whatsappChat: number;
  calls: number;
  addToCart: number;
  visitorsAdded: number;
  visitorsOrdered: number;
  visitorsContacted: number;
}

/** Visitor statistics of the public website between two Qatar days. */
export interface AnalyticsSummary {
  from: string;
  to: string;
  totals: AnalyticsTotals;
  /** the same number of days just before `from` */
  previous: AnalyticsTotals;
  daily: { day: string; visitors: number; pageviews: number; contacts: number }[];
  pages: { path: string; views: number; visitors: number }[];
  sources: { source: SiteSource; visits: number }[];
  devices: { device: SiteDevice; visitors: number }[];
  locales: { locale: string; visitors: number }[];
  products: { id: string | null; name: string; count: number }[];
  models: { name: string; count: number }[];
}
