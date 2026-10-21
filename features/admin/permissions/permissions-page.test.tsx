import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionInfo, PermissionKey, RoleMatrix, RoleName, UserPermissions, UserView } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, PERMISSIONS } from "@/shared/permissions";
import { resetAdminTestState } from "../shared/test-utils";
import { PermissionsPage } from "./permissions-page";

const CATALOG: PermissionInfo[] = PERMISSION_KEYS.map((key) => ({ key, ...PERMISSIONS[key] }));
const MATRIX: RoleMatrix = { roles: { SUPER_ADMIN: [...PERMISSION_KEYS], ...DEFAULT_ROLE_PERMISSIONS }, locked: ["SUPER_ADMIN"] };

const FINANCE_USER: UserView = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "finance",
  displayName: "Finance Team",
  email: null,
  role: "FINANCE",
  branch: null,
  isActive: true,
  twoFactorEnabled: false,
  hasShowroomPassword: false,
  locked: false,
  lastLoginAt: null,
  createdAt: "2026-09-01T08:00:00.000Z",
};

const admin = makeUser({ role: "SUPER_ADMIN", branch: null, permissions: ["permission.manage", "user.manage"] });

/** Catalog + a role matrix that PUTs update (like the API). */
function mockCatalog() {
  const matrix: RoleMatrix = structuredClone(MATRIX);
  let put: { role: string; body: { permissions: PermissionKey[] } } | null = null;
  server.use(
    http.get("/api/permissions", () => HttpResponse.json(CATALOG)),
    http.get("/api/roles/permissions", () => HttpResponse.json(matrix)),
    http.put("/api/roles/:role/permissions", async ({ params, request }) => {
      const body = (await request.json()) as { permissions: PermissionKey[] };
      put = { role: String(params.role), body };
      matrix.roles[params.role as RoleName] = body.permissions;
      return HttpResponse.json({ role: params.role, permissions: body.permissions });
    }),
  );
  return { lastPut: () => put };
}

describe("Permissions — by role", () => {
  beforeEach(() => resetAdminTestState("/en/dashboard/permissions"));

  it("needs permission.manage", () => {
    renderWithApp(<PermissionsPage />, { user: makeUser({ permissions: ["user.manage"] }) });
    expect(screen.getByRole("alert")).toHaveTextContent("Manage permissions");
  });

  it("locks the Super Admin column", async () => {
    mockCatalog();
    renderWithApp(<PermissionsPage />, { user: admin });
    const box = await screen.findByRole("checkbox", { name: "Create products — Super Admin" });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    const column = screen.getAllByRole("checkbox", { name: /— Super Admin$/ });
    expect(column).toHaveLength(PERMISSION_KEYS.length);
    expect(column.every((c) => c.hasAttribute("disabled") && c.getAttribute("aria-checked") === "true")).toBe(true);
    // each permission shows its key as secondary text
    for (const key of PERMISSION_KEYS) expect(screen.getByText(key)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Always has every permission" })).toBeInTheDocument();
  });

  it("saves a changed role and can discard edits", async () => {
    const { lastPut } = mockCatalog();
    const { user } = renderWithApp(<PermissionsPage />, { user: admin });
    const activity = await screen.findByRole("checkbox", { name: "View the activity log — Finance" });
    expect(activity).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();

    // toggle and discard
    await user.click(activity);
    expect(activity).toBeChecked();
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    await user.click(within(bar).getByRole("button", { name: "Discard" }));
    expect(activity).not.toBeChecked();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument());

    // toggling back and forth is not a change
    await user.click(activity);
    await user.click(activity);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument());

    // toggle and save
    await user.click(activity);
    await user.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(lastPut()).not.toBeNull());
    expect(lastPut()?.role).toBe("FINANCE");
    expect(lastPut()?.body).toEqual({ permissions: ["product.update.price", "product.read", "order.read.all", "order.odoo.retry", "activity.read"] });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "View the activity log — Finance" })).toBeChecked();
  });
});

describe("Permissions — by user", () => {
  const perms: UserPermissions = {
    userId: FINANCE_USER.id,
    role: "FINANCE",
    locked: false,
    rolePermissions: DEFAULT_ROLE_PERMISSIONS.FINANCE,
    overrides: [{ permission: "product.update.price", effect: "REVOKE" }],
    effective: ["product.read", "order.read.all"],
  };

  beforeEach(() => {
    resetAdminTestState(`/en/dashboard/permissions?tab=users&user=${FINANCE_USER.id}`);
    server.use(
      http.get("/api/permissions", () => HttpResponse.json(CATALOG)),
      http.get("/api/users", () => HttpResponse.json({ items: [FINANCE_USER], page: 1, pageSize: 10, total: 1 })),
      http.get(`/api/users/${FINANCE_USER.id}`, () => HttpResponse.json(FINANCE_USER)),
      http.get(`/api/users/${FINANCE_USER.id}/permissions`, () => HttpResponse.json(perms)),
    );
  });

  it("shows the role default and the effective state", async () => {
    renderWithApp(<PermissionsPage />, { user: admin });
    const price = await screen.findByRole("radiogroup", { name: "Set prices" });
    expect(within(price).getByRole("radio", { name: "Revoke" })).toBeChecked();
    const row = price.closest("li") as HTMLElement;
    expect(row).toHaveTextContent("From role: on");
    expect(row).toHaveTextContent("Effective:off");
    expect(screen.getByText("1 exception")).toBeInTheDocument();
  });

  it("grants a permission and saves the overrides", async () => {
    let body: unknown;
    server.use(
      http.put(`/api/users/${FINANCE_USER.id}/permissions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...perms, overrides: (body as UserPermissions).overrides });
      }),
    );
    const { user } = renderWithApp(<PermissionsPage />, { user: admin });
    const activity = await screen.findByRole("radiogroup", { name: "View the activity log" });
    expect(within(activity).getByRole("radio", { name: "Role default" })).toBeChecked();
    await user.click(within(activity).getByRole("radio", { name: "Grant" }));
    expect(activity.closest("li")).toHaveTextContent("Effective:on");

    await user.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(body).toEqual({
        overrides: [
          { permission: "product.update.price", effect: "REVOKE" },
          { permission: "activity.read", effect: "GRANT" },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(screen.getByText("2 exceptions")).toBeInTheDocument();
  });

  it("explains that Super Admin accounts are locked", async () => {
    const adminUser = { ...FINANCE_USER, role: "SUPER_ADMIN" as const, displayName: "Boss" };
    server.use(
      http.get(`/api/users/${FINANCE_USER.id}`, () => HttpResponse.json(adminUser)),
      http.get(`/api/users/${FINANCE_USER.id}/permissions`, () =>
        HttpResponse.json({ ...perms, role: "SUPER_ADMIN", locked: true, overrides: [], rolePermissions: PERMISSION_KEYS, effective: PERMISSION_KEYS }),
      ),
    );
    renderWithApp(<PermissionsPage />, { user: admin });
    expect(await screen.findByRole("note")).toHaveTextContent("Super Admin accounts always have every permission");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
