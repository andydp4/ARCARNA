/**
 * The link from elsewhere (Suppliers' price check) to one product's card on
 * the Products page. Both ends live here so they cannot drift: the Products
 * page reads the id back with `productIdFromSearch` and opens that product.
 */
export const PRODUCT_LINK_PARAM = "product";

export function productHref(productId: string): string {
  return `/products?${PRODUCT_LINK_PARAM}=${encodeURIComponent(productId)}`;
}

/** The product a `/products?product=<id>` link asks to open, if any. */
export function productIdFromSearch(search: string): string | undefined {
  const id = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(PRODUCT_LINK_PARAM);
  return id ? id : undefined;
}
