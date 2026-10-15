import type { Metadata } from "next";
import Link from "next/link";
import { AdminBar } from "../../../src/admin/admin-bar.tsx";
import { AdminProductList } from "../../../src/admin/admin-product-list.tsx";
import { requireAdminPage } from "../../../src/admin/page-guard.ts";
import { ADMIN_NEW_PRODUCT_PATH } from "../../../src/admin/paths.ts";
import { readMenu } from "../../../src/db/menu.ts";

export const metadata: Metadata = {
  title: "Ürünler | Yönetim | Coffy Shop",
  robots: { index: false, follow: false },
};

// The session and the products are read on every request, so a reload
// after a logout elsewhere goes back to the login page.
export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  await requireAdminPage();
  const menu = readMenu();
  return (
    <>
      <AdminBar />
      <main>
        <h1>Ürünler</h1>
        <Link href={ADMIN_NEW_PRODUCT_PATH} className="button">
          Yeni ürün ekle
        </Link>
        <AdminProductList menu={menu} />
      </main>
    </>
  );
}
