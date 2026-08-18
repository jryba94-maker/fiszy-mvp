import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fiszy — aukcje z malejącą ceną",
    short_name: "Fiszy",
    description: "Obserwuj spadającą cenę i wybierz swój moment zakupu.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ec",
    theme_color: "#10120f",
    lang: "pl",
    categories: ["shopping", "lifestyle"],
  };
}
