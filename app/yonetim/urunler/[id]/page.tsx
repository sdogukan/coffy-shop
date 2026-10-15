import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBar } from "../../../../src/admin/admin-bar.tsx";
import { requireAdminPage } from "../../../../src/admin/page-guard.ts";
import { ProductForm } from "../../../../src/admin/product-form.tsx";
import { readProductById } from "../../../../src/db/admin-products.ts";
import { readMenu } from "../../../../src/db/menu.ts";

export const metadata: Metadata = {
  title: "Ürünü düzenle | Yönetim | Coffy Shop",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminEditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  // An id outside the column's bounds returns null without a query.
  const product = readProductById(id);
  if (product === null) {
    notFound();
  }
  const categories = readMenu().map(({ id: categoryId, name }) => ({ id: categoryId, name }));
  return (
    <>
      <AdminBar />
      <main>
        <h1>Ürünü düzenle</h1>
        <ProductForm categories={categories} product={product} />
      </main>
    </>
  );
}
