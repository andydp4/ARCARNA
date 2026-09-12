import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        metal: {
          graphite: "var(--lm-graphite)",
          gunmetal: "var(--lm-gunmetal)",
          charcoal: "var(--lm-charcoal)",
          "smoke-chrome": "var(--lm-smoke-chrome)",
          brushed: "var(--lm-brushed)",
          "brushed-highlight": "var(--lm-brushed-highlight)",
          titanium: "var(--lm-titanium)",
          stainless: "var(--lm-stainless)",
          "warm-white": "var(--lm-warm-white)",
          muted: "var(--lm-muted)",
          amber: "var(--lm-amber)",
          emerald: "var(--lm-emerald)",
          crimson: "var(--lm-crimson)",
          "electric-blue": "var(--lm-electric-blue)",
          edge: "var(--lm-edge-highlight)",
        },
        // Truth Blue — semantic accent: insight, action, selection, understanding
        truth: {
          DEFAULT: "var(--truth-blue)",
          bright: "var(--truth-blue-bright)",
          strong: "var(--truth-blue-strong)",
          subtle: "var(--truth-blue-subtle)",
          foreground: "var(--truth-blue-foreground)",
        },
        // Semantic state — meaning only
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        // Operations Centre card-state tokens — see arcarna.css and
        // docs/briefs/PHASE_N_OPERATIONS_CENTRE.md "Colour resolution".
        // Every fill/text pair is contrast-checked in shared/ui/contrast.spec.ts.
        ops: {
          ontime: "var(--ops-ontime)",
          ready: {
            DEFAULT: "var(--ops-ready)",
            foreground: "var(--ops-ready-text)",
          },
          held: {
            DEFAULT: "var(--ops-held)",
            foreground: "var(--ops-held-text)",
          },
          delayed: {
            DEFAULT: "var(--ops-delayed)",
            foreground: "var(--ops-delayed-text)",
          },
          late: {
            DEFAULT: "var(--ops-late)",
            foreground: "var(--ops-late-text)",
          },
          completed: {
            DEFAULT: "var(--ops-completed)",
            foreground: "var(--ops-completed-text)",
          },
          alert: "var(--ops-alert)",
        },
      },
      boxShadow: {
        "metal-inner": "var(--lm-inner-shadow)",
        "metal-panel": "var(--lm-panel-shadow)",
      },
      backgroundImage: {
        "metal-surface": "var(--lm-surface-gradient)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // Operations Centre: "an alert addressed to you is open on this
        // card" (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md "Alerts &
        // notifications"). Never applied for "on time" alone — see
        // usePrefersReducedMotion for the static equivalent this yields to.
        "ops-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 var(--truth-blue-subtle)" },
          "50%": { boxShadow: "0 0 0 6px var(--truth-blue-bright)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "ops-pulse": "ops-pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/container-queries"),
  ],
} satisfies Config;
