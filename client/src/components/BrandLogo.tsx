import { cn } from "@/lib/utils";
import { resolveAppPath } from "@/lib/appPaths";
import { BRAND_MARK, BRAND_NAME, BRAND_PRODUCT_NAME, BRAND_WORDMARK } from "@shared/brand";

export type BrandLogoVariant = "mark" | "wordmark";
export type BrandLogoSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<BrandLogoSize, string> = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
};

const WORDMARK_SIZE_CLASS: Record<BrandLogoSize, string> = {
  sm: "h-8 max-w-[120px]",
  md: "h-12 max-w-[180px]",
  lg: "h-16 max-w-[240px]",
  xl: "h-24 max-w-[320px]",
};

const VARIANT_PATH: Record<BrandLogoVariant, string> = {
  mark: BRAND_MARK,
  wordmark: BRAND_WORDMARK,
};

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  alt?: string;
  className?: string;
};

/** Official ARCARNA mark — paths respect VITE_BASE_PATH (e.g. /arcarna). */
export function BrandLogo({
  variant = "mark",
  size = "md",
  alt,
  className,
}: BrandLogoProps) {
  const defaultAlt = variant === "wordmark" ? BRAND_PRODUCT_NAME : BRAND_NAME;
  const sizeClass = variant === "wordmark" ? WORDMARK_SIZE_CLASS[size] : SIZE_CLASS[size];

  return (
    <img
      src={resolveAppPath(VARIANT_PATH[variant])}
      alt={alt ?? defaultAlt}
      width={variant === "wordmark" ? 240 : 96}
      height={variant === "wordmark" ? 96 : 96}
      className={cn("shrink-0 object-contain", sizeClass, className)}
    />
  );
}
