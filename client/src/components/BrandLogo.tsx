import { cn } from "@/lib/utils";
import { resolveAppPath } from "@/lib/appPaths";

type BrandLogoVariant = "white-on-navy" | "navy-on-white" | "legacy";
type BrandLogoSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<BrandLogoSize, string> = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
};

const VARIANT_PATH: Record<BrandLogoVariant, string> = {
  "white-on-navy": "/brand/midnight-logo-white-on-navy.png",
  "navy-on-white": "/brand/midnight-logo-navy-on-white.png",
  legacy: "/logo.png",
};

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  alt?: string;
  className?: string;
};

/** Official Midnight EPOS mark — paths respect VITE_BASE_PATH (e.g. /midnight). */
export function BrandLogo({
  variant = "white-on-navy",
  size = "md",
  alt = "Midnight EPOS",
  className,
}: BrandLogoProps) {
  return (
    <img
      src={resolveAppPath(VARIANT_PATH[variant])}
      alt={alt}
      width={96}
      height={96}
      className={cn("shrink-0 object-contain", SIZE_CLASS[size], className)}
    />
  );
}
