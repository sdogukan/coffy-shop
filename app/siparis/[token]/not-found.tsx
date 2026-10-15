import Link from "next/link";

// Rendered with status 404 for a malformed or unknown tracking token. The two
// cases look the same, so a token cannot be probed for existence.
export default function OrderNotFound() {
  return (
    <main>
      <h1>Sipariş bulunamadı veya bağlantı geçersiz</h1>
      <p>Bağlantıyı sipariş onayında gösterildiği gibi açtığınızdan emin olun.</p>
      <Link href="/">Menüye dön</Link>
    </main>
  );
}
