import Link from "next/link";
import { LogoutButton } from "./logout-button.tsx";
import { ADMIN_MILK_OPTIONS_PATH, ADMIN_ORDERS_PATH, ADMIN_PRODUCTS_PATH } from "./paths.ts";

// Shown on the protected admin pages only, never on the login page.
export function AdminBar() {
  return (
    <div className="admin-bar">
      <nav className="admin-bar-nav" aria-label="Yönetim menüsü">
        <div className="admin-bar-links">
          <Link href={ADMIN_PRODUCTS_PATH} className="admin-bar-title">
            Yönetim · Ürünler
          </Link>
          <Link href={ADMIN_ORDERS_PATH} className="admin-bar-title">
            Siparişler
          </Link>
          <Link href={ADMIN_MILK_OPTIONS_PATH} className="admin-bar-title">
            Süt seçenekleri
          </Link>
        </div>
        <LogoutButton />
      </nav>
    </div>
  );
}
