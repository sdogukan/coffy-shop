import { AddToCartButton } from "../cart/add-to-cart-button.tsx";
import type { MenuCategory } from "../db/menu.ts";
import { formatPriceKurus } from "./format-price.ts";

export function MenuView({ menu }: { menu: readonly MenuCategory[] }) {
  if (menu.length === 0) {
    return <p>Menü şu anda boş.</p>;
  }
  return (
    <>
      {menu.map((category) => (
        <section key={category.id} className="menu-category" aria-labelledby={`kategori-${category.id}`}>
          <h2 id={`kategori-${category.id}`}>{category.name}</h2>
          {category.products.length === 0 ? (
            <p>Bu kategoride henüz ürün yok.</p>
          ) : (
            <ul className="product-list">
              {category.products.map((product) => (
                <li key={product.id} className={product.isAvailable ? "product" : "product product-unavailable"}>
                  <h3>{product.name}</h3>
                  <p className="product-description">{product.description}</p>
                  <p className="product-price">{formatPriceKurus(product.priceKurus)}</p>
                  <p className="product-availability">{product.isAvailable ? "Satışta" : "Satışta değil"}</p>
                  <AddToCartButton productId={product.id} isAvailable={product.isAvailable} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
