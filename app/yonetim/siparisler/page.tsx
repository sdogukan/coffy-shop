import type { Metadata } from "next";
import { AdminBar } from "../../../src/admin/admin-bar.tsx";
import { AdminOrderList } from "../../../src/admin/admin-order-list.tsx";
import { requireAdminPage } from "../../../src/admin/page-guard.ts";
import { readOrders } from "../../../src/db/admin-orders.ts";

export const metadata: Metadata = {
  title: "Siparişler | Yönetim | Coffy Shop",
  robots: { index: false, follow: false },
};

// The session and the orders are read on every request, so a reload shows
// the current statuses and goes to the login page after a logout elsewhere.
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  await requireAdminPage();
  const orders = readOrders();
  return (
    <>
      <AdminBar />
      <main>
        <h1>Siparişler</h1>
        <AdminOrderList orders={orders} />
      </main>
    </>
  );
}
