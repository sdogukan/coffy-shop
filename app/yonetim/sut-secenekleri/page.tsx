import type { Metadata } from "next";
import { AdminBar } from "../../../src/admin/admin-bar.tsx";
import { MilkOptionCreateForm, MilkOptionList } from "../../../src/admin/milk-option-list.tsx";
import { requireAdminPage } from "../../../src/admin/page-guard.ts";
import { readMilkOptions } from "../../../src/db/milk-options.ts";

export const metadata: Metadata = {
  title: "Süt seçenekleri | Yönetim | Coffy Shop",
  robots: { index: false, follow: false },
};

// The session and the options are read on every request, so a new option
// shows up on the reload that follows its creation.
export const dynamic = "force-dynamic";

export default async function AdminMilkOptionsPage() {
  await requireAdminPage();
  const options = readMilkOptions();
  return (
    <>
      <AdminBar />
      <main>
        <h1>Süt seçenekleri</h1>
        <MilkOptionList options={options} />
        <MilkOptionCreateForm />
      </main>
    </>
  );
}
