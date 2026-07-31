import { defineCollection, z } from "astro:content";

const pages = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    draft: z.boolean().optional().default(false),
  }),
});

const products = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    accent: z.string().default("#4ba9fb"),
    status: z.enum(["live", "coming-soon"]).default("coming-soon"),
    url: z.string().optional(),
    appKey: z.string().optional(),
    order: z.number().default(99),
  }),
});

const pricing = defineCollection({
  type: "content",
  schema: z.object({
    name: z.string(),
    price: z.string(),
    period: z.string().default("/month"),
    description: z.string(),
    featured: z.boolean().default(false),
    features: z.array(z.string()),
    cta: z.string().default("Get started"),
    ctaHref: z.string().default("/contact"),
    order: z.number().default(99),
  }),
});

export const collections = { pages, products, pricing };
