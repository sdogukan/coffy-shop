// Admin page and endpoint paths, shared by the proxy, the server pages and
// the client components. Every endpoint is same-origin and relative.

export const ADMIN_LOGIN_PATH = "/yonetim/giris";
export const ADMIN_PRODUCTS_PATH = "/yonetim/urunler";
export const ADMIN_NEW_PRODUCT_PATH = "/yonetim/urunler/yeni";

export const ADMIN_LOGIN_ENDPOINT = "/api/admin/login";
export const ADMIN_LOGOUT_ENDPOINT = "/api/admin/logout";
export const ADMIN_PRODUCTS_ENDPOINT = "/api/admin/products";

export function adminProductPath(id: string): string {
  return `${ADMIN_PRODUCTS_PATH}/${encodeURIComponent(id)}`;
}

export function adminProductEndpoint(id: string): string {
  return `${ADMIN_PRODUCTS_ENDPOINT}/${encodeURIComponent(id)}`;
}
