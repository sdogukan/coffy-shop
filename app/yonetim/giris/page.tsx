import type { Metadata } from "next";
import { LoginForm } from "../../../src/admin/login-form.tsx";

export const metadata: Metadata = {
  title: "Yönetici girişi | Coffy Shop",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main>
      <h1>Yönetici girişi</h1>
      <LoginForm />
    </main>
  );
}
