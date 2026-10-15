import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CartBadge } from "../src/cart/cart-badge.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coffy Shop",
  description: "Coffy Shop kahve siparişi uygulaması",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <header className="top-bar">
          <nav className="top-bar-nav" aria-label="Ana menü">
            <Link href="/" className="top-bar-brand">
              Coffy Shop
            </Link>
            <Link href="/sepet" className="top-bar-cart">
              Sepet <CartBadge />
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
