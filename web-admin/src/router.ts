// web-admin back-office router (03-03; extended + re-frozen in 04-02). EVERY route
// is registered here up front and frozen — later slice plans (Wave 2/3) only
// create/replace the view SFCs, never edit this file (prevents router.ts merge
// conflicts between parallel slices). The frozen list now ALSO includes the five
// Phase-4 routes added in 04-02: /coupons, /loyalty, /broadcasts (การตลาด),
// /tracking (จัดส่ง), /product-images (สินค้า). Views are lazily imported so each
// screen ships as its own chunk.
//
// RBAC (D-19): each route carries `meta.roles` (the staff roles that may SEE it)
// plus nav metadata (title/icon/group) the AppShell reads to build the sidebar.
// The `beforeEach` guard is a COSMETIC nav-gate only: an unauthenticated user is
// bounced to /login, and an out-of-role direct-URL hit is redirected to the first
// screen the role can reach. The server `requireRole` guard is the real authority
// (a hidden/redirected page still 403s server-side if its endpoint is called).
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { type StaffRole, useSession } from "./stores/session";

/** Extra typing for the route meta this app relies on. */
export interface AdminRouteMeta {
  /** Staff roles allowed to see + reach this route. Absent = public. */
  roles?: StaffRole[];
  /** Sidebar/breadcrumb label (Thai). */
  title?: string;
  /** lucide-vue-next icon name the AppShell maps to a component. */
  icon?: string;
  /** Sidebar section this item groups under. */
  group?: string;
  /** Public (no session required), e.g. the login screen. */
  public?: boolean;
}

const ALL_STAFF: StaffRole[] = ["owner", "admin", "grower", "packer"];
const OWNER_ADMIN: StaffRole[] = ["owner", "admin"];
const CROP: StaffRole[] = ["owner", "admin", "grower"];
const PACK: StaffRole[] = ["owner", "admin", "packer"];

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "login",
    component: () => import("./views/Login.vue"),
    meta: { public: true } satisfies AdminRouteMeta,
  },
  {
    path: "/",
    name: "dashboard",
    component: () => import("./views/Dashboard.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "แดชบอร์ด",
      icon: "LayoutDashboard",
      group: "ภาพรวม",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/variety-params",
    name: "variety-params",
    component: () => import("./views/VarietyParams.vue"),
    meta: {
      roles: CROP,
      title: "ค่าพันธุ์ผัก",
      icon: "Sprout",
      group: "วางแผนการปลูก",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/planting-mix",
    name: "planting-mix",
    component: () => import("./views/PlantingMix.vue"),
    meta: {
      roles: CROP,
      title: "สูตรปลูก",
      icon: "FlaskConical",
      group: "วางแผนการปลูก",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/planting-batches",
    name: "planting-batches",
    component: () => import("./views/PlantingBatches.vue"),
    meta: {
      roles: CROP,
      title: "แบตช์การปลูก",
      icon: "Boxes",
      group: "วางแผนการปลูก",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/harvest-calendar",
    name: "harvest-calendar",
    component: () => import("./views/HarvestCalendar.vue"),
    meta: {
      roles: CROP,
      title: "ปฏิทินเก็บเกี่ยว",
      icon: "CalendarDays",
      group: "วางแผนการปลูก",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/harvest-log",
    name: "harvest-log",
    component: () => import("./views/HarvestLog.vue"),
    meta: {
      roles: CROP,
      title: "บันทึกการเก็บเกี่ยว",
      icon: "ClipboardCheck",
      group: "วางแผนการปลูก",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/b2b-approvals",
    name: "b2b-approvals",
    component: () => import("./views/B2BApprovals.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "อนุมัติบัญชี B2B",
      icon: "UserCheck",
      group: "ขาย & B2B",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/standing-orders",
    name: "standing-orders",
    component: () => import("./views/StandingOrders.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "ออเดอร์ประจำ",
      icon: "Repeat",
      group: "ขาย & B2B",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/subscriptions",
    name: "subscriptions",
    component: () => import("./views/Subscriptions.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "สมาชิกกล่องผัก",
      icon: "BoxSelect",
      group: "ขาย & B2B",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/packing",
    name: "packing",
    component: () => import("./views/Packing.vue"),
    meta: {
      roles: PACK,
      title: "คิวแพ็ค",
      icon: "PackageCheck",
      group: "คลัง/แพ็ค",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/reports",
    name: "reports",
    component: () => import("./views/Reports.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "รายงาน",
      icon: "BarChart3",
      group: "รายงาน",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("./views/Settings.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "ตั้งค่าระบบ",
      icon: "Settings",
      group: "ตั้งค่า",
    } satisfies AdminRouteMeta,
  },
  // ── Phase-4 routes (04-02 freeze). Stub views today; Wave-2 slices replace the
  // SFC only. RBAC: OWNER_ADMIN nav-gate here is cosmetic — the server requireRole
  // is the authority (T-04-04). ──────────────────────────────────────────────────
  {
    path: "/coupons",
    name: "coupons",
    component: () => import("./views/CouponComposer.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "คูปอง",
      icon: "Ticket",
      group: "การตลาด",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/loyalty",
    name: "loyalty",
    component: () => import("./views/LoyaltySettings.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "สะสมแต้ม",
      icon: "Gift",
      group: "การตลาด",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/broadcasts",
    name: "broadcasts",
    component: () => import("./views/BroadcastComposer.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "บรอดแคสต์",
      icon: "Megaphone",
      group: "การตลาด",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/tracking",
    name: "tracking",
    component: () => import("./views/CarrierTrackingForm.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "ติดตามพัสดุ",
      icon: "Truck",
      group: "จัดส่ง",
    } satisfies AdminRouteMeta,
  },
  {
    path: "/product-images",
    name: "product-images",
    component: () => import("./views/ProductImages.vue"),
    meta: {
      roles: OWNER_ADMIN,
      title: "รูปสินค้า",
      icon: "Image",
      group: "สินค้า",
    } satisfies AdminRouteMeta,
  },
  // Unknown paths fall back to the dashboard (the guard re-routes by role/session).
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** The first route (in registration order) the given role is allowed to see. */
export function firstRouteForRole(role: StaffRole): string {
  const hit = routes.find((r) => {
    const meta = r.meta as AdminRouteMeta | undefined;
    return meta?.roles?.includes(role);
  });
  return (hit?.path as string | undefined) ?? "/login";
}

// nav-hide guard (D-19). Cosmetic only — the server is the access authority.
router.beforeEach((to) => {
  const meta = to.meta as AdminRouteMeta;
  const { state } = useSession();

  if (meta.public) {
    // Already signed in? Skip the login screen straight to a role-appropriate home.
    if (to.name === "login" && state.token && state.role) {
      return firstRouteForRole(state.role);
    }
    return true;
  }

  // Protected route: require a staff session.
  if (!state.token || !state.role) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  // In-role? allow. Out-of-role → send to the first screen this role can reach.
  if (meta.roles && !meta.roles.includes(state.role)) {
    return firstRouteForRole(state.role);
  }
  return true;
});
