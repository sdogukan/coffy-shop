import { readMenu } from "../src/db/menu.ts";
import { MenuView } from "../src/menu/menu-view.tsx";

// The menu is read from the database on every request; prerendering it at
// build time would need a database the build does not have.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const menu = readMenu();
  return (
    <main>
      <h1>Menü</h1>
      <MenuView menu={menu} />
    </main>
  );
}
