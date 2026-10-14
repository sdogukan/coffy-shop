import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "../../app/layout.tsx";
import HomePage from "../../app/page.tsx";

describe("landing page", () => {
  it("renders the Coffy Shop heading with Turkish copy", () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("<h1>Coffy Shop</h1>");
    expect(html).toContain("Uygulama iskeleti çalışıyor.");
  });

  it("declares Turkish as the document language", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <HomePage />
      </RootLayout>,
    );
    expect(html).toContain('<html lang="tr">');
  });
});
