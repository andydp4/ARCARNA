import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  Lock,
  Minus,
  PackageCheck,
  Plus,
  ShoppingBasket,
  Store,
} from "lucide-react";
import { resolveAppPath } from "@/lib/appPaths";
import {
  blockCssVars,
  calculateCartTotal,
  fallbackSiteConfig,
  formatWebsiteMoney,
  getRenderableBlocks,
  normalizeCartLines,
  publicWebsiteApiUrl,
  resolveWebsiteHref,
  themeCssVars,
  type PublicSiteConfig,
  type PublicWebsiteBlock,
  type PublicWebsiteProduct,
  type PublicWebsiteTheme,
  type WebsiteCartLine,
} from "./publicWebsite";
import "./publicWebsite.css";

async function getPublicJson<T>(path: string): Promise<T> {
  const res = await fetch(publicWebsiteApiUrl(path), { credentials: "include" });
  if (!res.ok) {
    throw new Error((await res.text()) || res.statusText);
  }
  return (await res.json()) as T;
}

async function postPublicJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(publicWebsiteApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || res.statusText);
  }
  return (await res.json()) as T;
}

function usePublicSiteConfig() {
  return useQuery({
    queryKey: ["wm-supplies", "site-config"],
    queryFn: () => getPublicJson<PublicSiteConfig>("/api/public/wm-supplies/site-config"),
    retry: false,
  });
}

function usePublicProducts() {
  return useQuery({
    queryKey: ["wm-supplies", "products"],
    queryFn: () => getPublicJson<PublicWebsiteProduct[]>("/api/public/wm-supplies/products"),
    retry: false,
  });
}

function siteDataFromQuery(data: PublicSiteConfig | undefined): PublicSiteConfig {
  if (!data) return fallbackSiteConfig;
  return {
    theme: { ...fallbackSiteConfig.theme, ...data.theme },
    orderSettings: { ...fallbackSiteConfig.orderSettings, ...data.orderSettings },
    blocks: data.blocks ?? [],
  };
}

function WmHeader({ theme }: { theme: PublicWebsiteTheme }) {
  return (
    <header className="wm-header">
      <a className="wm-brand" href={resolveAppPath("/")} aria-label={`${theme.siteName} home`}>
        {theme.logoUrl ? (
          <img src={theme.logoUrl} alt="" className="wm-brand-logo" />
        ) : (
          <span className="wm-brand-mark">WM</span>
        )}
        <span>{theme.siteName}</span>
      </a>
      <nav className="wm-nav" aria-label="WM Supplies">
        <a href={resolveAppPath("/")}>Home</a>
        <a href={resolveAppPath("/order")}>Order</a>
        <a href={resolveAppPath("/sign-in")}>Staff sign-in</a>
      </nav>
    </header>
  );
}

function WmFooter({ theme }: { theme: PublicWebsiteTheme }) {
  return (
    <footer className="wm-footer">
      <strong>{theme.siteName}</strong>
      <span>Website orders land in Arcana for the team to process.</span>
    </footer>
  );
}

function WmPublicLayout({
  config,
  children,
}: {
  config: PublicSiteConfig;
  children: ReactNode;
}) {
  const headingFont = config.theme.headingFont || undefined;
  const bodyFont = config.theme.bodyFont || undefined;

  return (
    <div
      className="wm-site"
      style={{
        ...themeCssVars(config.theme),
        fontFamily: bodyFont,
      }}
    >
      <WmHeader theme={config.theme} />
      <main>{children}</main>
      <WmFooter theme={config.theme} />
      {config.theme.customCss ? <style>{config.theme.customCss}</style> : null}
      <style>{headingFont ? `.wm-site h1,.wm-site h2,.wm-brand{font-family:${headingFont};}` : ""}</style>
    </div>
  );
}

function WmVisualPanel({ label }: { label: string }) {
  return (
    <div className="wm-visual" aria-label={label} role="img">
      <div className="wm-visual-shelf wm-visual-shelf-one" />
      <div className="wm-visual-shelf wm-visual-shelf-two" />
      <div className="wm-visual-box wm-visual-box-one" />
      <div className="wm-visual-box wm-visual-box-two" />
      <div className="wm-visual-bottle wm-visual-bottle-one" />
      <div className="wm-visual-bottle wm-visual-bottle-two" />
      <div className="wm-visual-roll wm-visual-roll-one" />
      <div className="wm-visual-roll wm-visual-roll-two" />
      <ImageIcon className="wm-visual-icon" aria-hidden="true" />
    </div>
  );
}

function BlockImage({ block }: { block: PublicWebsiteBlock }) {
  if (!block.image?.url) {
    return <WmVisualPanel label={block.image?.altText ?? block.title ?? "Supplies display"} />;
  }

  return (
    <div className="wm-image-frame">
      <img
        src={block.image.url}
        alt={block.image.altText ?? block.title ?? ""}
        style={{ objectFit: block.imageFit }}
        loading={block.type === "hero" ? "eager" : "lazy"}
      />
      <span className="wm-image-overlay" />
    </div>
  );
}

function BlockButton({ block }: { block: PublicWebsiteBlock }) {
  if (!block.ctaLabel || !block.ctaLink) return null;
  return (
    <a className="wm-block-button" href={resolveWebsiteHref(block.ctaLink)}>
      <span>{block.ctaLabel}</span>
      <ArrowRight size={18} aria-hidden="true" />
    </a>
  );
}

function BlockCopy({ block }: { block: PublicWebsiteBlock }) {
  return (
    <div className="wm-block-copy">
      {block.subtitle ? <p className="wm-block-subtitle">{block.subtitle}</p> : null}
      {block.title ? <h2>{block.title}</h2> : null}
      {block.body ? <p className="wm-block-body">{block.body}</p> : null}
      <BlockButton block={block} />
    </div>
  );
}

function GalleryBlock({ block, theme }: { block: PublicWebsiteBlock; theme: PublicWebsiteTheme }) {
  return (
    <section className="wm-block wm-gallery-block" style={blockCssVars(block, theme)}>
      <BlockCopy block={block} />
      <div className="wm-gallery-grid">
        <BlockImage block={block} />
        <WmVisualPanel label="Supplies promo tile" />
        <WmVisualPanel label="Delivery supplies tile" />
      </div>
    </section>
  );
}

function WebsiteBlock({ block, theme }: { block: PublicWebsiteBlock; theme: PublicWebsiteTheme }) {
  const style = blockCssVars(block, theme);
  if (block.type === "spacer") {
    return <div className="wm-spacer" aria-hidden="true" />;
  }
  if (block.type === "gallery") {
    return <GalleryBlock block={block} theme={theme} />;
  }

  const className = `wm-block wm-block-${block.type}`;
  return (
    <section className={className} style={style}>
      {block.type === "hero" ? (
        <>
          <div className="wm-hero-copy">
            {block.title ? <h1>{block.title}</h1> : null}
            {block.subtitle ? <p className="wm-hero-subtitle">{block.subtitle}</p> : null}
            {block.body ? <p className="wm-block-body">{block.body}</p> : null}
            <BlockButton block={block} />
          </div>
          <BlockImage block={block} />
        </>
      ) : block.type === "split" ? (
        <>
          <BlockImage block={block} />
          <BlockCopy block={block} />
        </>
      ) : block.type === "image" || block.type === "wide" ? (
        <>
          <BlockImage block={block} />
          <BlockCopy block={block} />
        </>
      ) : (
        <BlockCopy block={block} />
      )}
    </section>
  );
}

export function WmSuppliesHomePage() {
  const siteQuery = usePublicSiteConfig();
  const config = siteDataFromQuery(siteQuery.data);
  const blocks = getRenderableBlocks(config);

  return (
    <WmPublicLayout config={config}>
      <div className="wm-block-stack">
        {blocks.map((block) => (
          <WebsiteBlock key={block.id} block={block} theme={config.theme} />
        ))}
      </div>
    </WmPublicLayout>
  );
}

function ProductTile({
  product,
  quantity,
  onChange,
}: {
  product: PublicWebsiteProduct;
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <article className="wm-product">
      <div className="wm-product-media">
        {product.image?.url ? (
          <img src={product.image.url} alt={product.image.altText ?? product.name} loading="lazy" />
        ) : (
          <PackageCheck aria-hidden="true" />
        )}
      </div>
      <div className="wm-product-copy">
        <div>
          {product.category ? <p className="wm-product-category">{product.category}</p> : null}
          <h3>{product.name}</h3>
          {product.description ? <p>{product.description}</p> : null}
        </div>
        <div className="wm-product-action">
          <strong>
            {formatWebsiteMoney(product.price)}
            {product.unitLabel ? <span> / {product.unitLabel}</span> : null}
          </strong>
          <div className="wm-stepper" aria-label={`Quantity for ${product.name}`}>
            <button type="button" onClick={() => onChange(quantity - 1)} aria-label="Decrease quantity">
              <Minus size={16} aria-hidden="true" />
            </button>
            <span>{quantity}</span>
            <button type="button" onClick={() => onChange(quantity + 1)} aria-label="Increase quantity">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function productsByCategory(products: PublicWebsiteProduct[]) {
  return products.reduce<Record<string, PublicWebsiteProduct[]>>((groups, product) => {
    const key = product.category || "Supplies";
    groups[key] = [...(groups[key] ?? []), product];
    return groups;
  }, {});
}

export function WmSuppliesOrderPage() {
  const [, setLocation] = useLocation();
  const siteQuery = usePublicSiteConfig();
  const productsQuery = usePublicProducts();
  const config = siteDataFromQuery(siteQuery.data);
  const products = productsQuery.data ?? [];
  const groupedProducts = useMemo(() => productsByCategory(products), [products]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cartLines = normalizeCartLines(
    Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity })),
  );
  const total = calculateCartTotal(products, cartLines);
  const minOrderValue = config.orderSettings.minOrderValue ?? 0;
  const needsPassword = config.orderSettings.orderAccessMode === "password";
  const requiresClerk = config.orderSettings.orderAccessMode === "clerk";
  const canSubmit =
    !requiresClerk &&
    cartLines.length > 0 &&
    customerName.trim().length > 0 &&
    (method === "pickup" || address.trim().length > 0) &&
    (!needsPassword || accessPassword.trim().length > 0) &&
    total >= minOrderValue &&
    !isSubmitting;

  const updateQuantity = (productId: string, quantity: number) => {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) {
        delete next[productId];
      } else {
        next[productId] = Math.min(999, Math.trunc(quantity));
      }
      return next;
    });
  };

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const payload = {
        customer: {
          name: customerName.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
        },
        fulfilment: {
          method,
          address: method === "delivery" ? address.trim() : undefined,
          notes: notes.trim() || undefined,
        },
        items: cartLines,
        accessPassword: needsPassword ? accessPassword : undefined,
      };
      const result = await postPublicJson<{ orderId: string }>("/api/public/wm-supplies/orders", payload);
      setLocation(`/order/success?orderId=${encodeURIComponent(result.orderId)}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send order");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <WmPublicLayout config={config}>
      <form className="wm-order-shell" onSubmit={submitOrder}>
        <section className="wm-order-intro">
          <div>
            <p className="wm-block-subtitle">Order request</p>
            <h1>Build your WM Supplies order</h1>
            <p>
              {config.orderSettings.orderIntroText ||
                "Choose products, add your details, and send the request straight into Arcana."}
            </p>
          </div>
          <div className="wm-order-total" aria-live="polite">
            <ShoppingBasket aria-hidden="true" />
            <span>Total</span>
            <strong>{formatWebsiteMoney(total)}</strong>
          </div>
        </section>

        {requiresClerk ? (
          <section className="wm-order-gate">
            <Lock aria-hidden="true" />
            <h2>Sign in to order</h2>
            <p>This order page is currently limited to signed-in customers.</p>
            <a className="wm-block-button" href={resolveAppPath("/sign-in")}>
              <span>Sign in</span>
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </section>
        ) : (
          <>
            {needsPassword ? (
              <section className="wm-order-panel">
                <label>
                  Order password
                  <input
                    type="password"
                    value={accessPassword}
                    onChange={(event) => setAccessPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </label>
              </section>
            ) : null}

            <section className="wm-product-groups" aria-label="Products">
              {products.length === 0 ? (
                <div className="wm-empty-products">
                  <Store aria-hidden="true" />
                  <h2>Products are waiting to be published</h2>
                  <p>Once staff mark Arcana products as available for the website, they will appear here.</p>
                </div>
              ) : (
                Object.entries(groupedProducts).map(([category, items]) => (
                  <div className="wm-product-group" key={category}>
                    <h2>{category}</h2>
                    <div className="wm-product-grid">
                      {items.map((product) => (
                        <ProductTile
                          key={product.id}
                          product={product}
                          quantity={cart[product.id] ?? 0}
                          onChange={(quantity) => updateQuantity(product.id, quantity)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="wm-order-form-grid">
              <div className="wm-order-panel">
                <h2>Your details</h2>
                <label>
                  Name
                  <input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    autoComplete="tel"
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </label>
              </div>

              <div className="wm-order-panel">
                <h2>Fulfilment</h2>
                <div className="wm-choice-row" role="radiogroup" aria-label="Fulfilment method">
                  <button
                    type="button"
                    className={method === "pickup" ? "is-selected" : ""}
                    onClick={() => setMethod("pickup")}
                  >
                    Pickup
                  </button>
                  <button
                    type="button"
                    className={method === "delivery" ? "is-selected" : ""}
                    onClick={() => setMethod("delivery")}
                  >
                    Delivery
                  </button>
                </div>
                {method === "delivery" ? (
                  <label>
                    Delivery address
                    <textarea value={address} onChange={(event) => setAddress(event.target.value)} />
                  </label>
                ) : null}
                <label>
                  Notes
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
              </div>
            </section>

            <section className="wm-order-submit">
              <div>
                <strong>{formatWebsiteMoney(total)}</strong>
                {minOrderValue > 0 ? <span>Minimum order {formatWebsiteMoney(minOrderValue)}</span> : null}
                {error ? <p className="wm-order-error">{error}</p> : null}
              </div>
              <button className="wm-submit-button" type="submit" disabled={!canSubmit}>
                <ShoppingBasket size={18} aria-hidden="true" />
                {isSubmitting ? "Sending..." : "Send order request"}
              </button>
            </section>
          </>
        )}
      </form>
    </WmPublicLayout>
  );
}

export function WmSuppliesOrderSuccessPage() {
  const siteQuery = usePublicSiteConfig();
  const config = siteDataFromQuery(siteQuery.data);
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("orderId");

  return (
    <WmPublicLayout config={config}>
      <section className="wm-success">
        <CheckCircle2 aria-hidden="true" />
        <h1>Order request sent</h1>
        <p>
          {config.orderSettings.successMessage ||
            "Thanks. The WM Supplies team can now pick this up inside Arcana."}
        </p>
        {orderId ? <span>Reference {orderId.slice(0, 8)}</span> : null}
        <a className="wm-block-button" href={resolveAppPath("/")}>
          <span>Back to shop window</span>
          <ArrowRight size={18} aria-hidden="true" />
        </a>
      </section>
    </WmPublicLayout>
  );
}
