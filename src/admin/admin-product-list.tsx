import Link from "next/link";
import type { MenuCategory } from "../db/menu.ts";
import { formatPriceKurus } from "../menu/format-price.ts";
import { AvailabilityToggle } from "./availability-toggle.tsx";
import { adminProductPath } from "./paths.ts";

// Every category with every product, closed ones included, each with its
// availability toggle and an edit link. A milk drink is marked "Sütlü".
export function AdminProductList({ menu }: { menu: readonly MenuCategory[] }) {
  if (menu.length === 0) {
    return <p>Henüz kategori yok.</p>;
  }
  return (
    <>
      {menu.map((category) => (
        <section key={category.id} className="admin-category" aria-labelledby={`yonetim-kategori-${category.id}`}>
          <h2 id={`yonetim-kategori-${category.id}`}>{category.name}</h2>
          {category.products.length === 0 ? (
            <p>Bu kategoride henüz ürün yok.</p>
          ) : (
            <ul className="admin-product-list">
              {category.products.map((product) => (
                <li key={product.id} className="admin-product">
                  <div className="admin-product-info">
                    <h3>{product.name}</h3>
                    <p className="product-price">{formatPriceKurus(product.priceKurus)}</p>
                    {product.containsMilk && <p className="admin-status">Sütlü</p>}
                  </div>
                  <AvailabilityToggle
                    productId={product.id}
                    productName={product.name}
                    initialAvailable={product.isAvailable}
                  />
                  <Link href={adminProductPath(product.id)} className="admin-edit-link">
                    Düzenle
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
