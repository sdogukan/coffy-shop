import type { Metadata } from "next";
import { AdminBar } from "../../../../src/admin/admin-bar.tsx";
import { requireAdminPage } from "../../../../src/admin/page-guard.ts";
import { ProductForm } from "../../../../src/admin/product-form.tsx";
import { readMenu } from "../../../../src/db/menu.ts";

export const metadata: Metadata = {
  title: "Yeni ürün | Yönetim | Coffy Shop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminNewProductPage() {
  await requireAdminPage();
  const categories = readMenu().map(({ id, name }) => ({ id, name }));
  return (
    <>
      <AdminBar />
      <main>
        <h1>Yeni ürün</h1>
        <ProductForm categories={categories} />
      </main>
    </>
  );
}
