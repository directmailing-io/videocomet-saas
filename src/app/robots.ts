import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/v/",
          "/lp-block/",
          "/share/",
          "/dashboard",
          "/kampagnen",
          "/einstellungen",
          "/passwort-zuruecksetzen",
        ],
      },
    ],
    sitemap: "https://videocomet.de/sitemap.xml",
  };
}
