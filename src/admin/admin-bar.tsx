import Link from "next/link";
import { LogoutButton } from "./logout-button.tsx";
import { ADMIN_PRODUCTS_PATH } from "./paths.ts";

// Shown on the protected admin pages only, never on the login page.
export function AdminBar() {
  return (
    <div className="admin-bar">
      <nav className="admin-bar-nav" aria-label="Yönetim menüsü">
        <Link href={ADMIN_PRODUCTS_PATH} className="admin-bar-title">
          Yönetim · Ürünler
        </Link>
        <LogoutButton />
      </nav>
    </div>
  );
}
