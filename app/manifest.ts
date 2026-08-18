import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Fiszy — aukcje z malejącą ceną",
    short_name: "Fiszy",
    description: "Obserwuj spadającą cenę i wybierz swój moment zakupu.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f4ec",
    theme_color: "#10120f",
    lang: "pl",
    categories: ["shopping", "lifestyle"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Aktualne aukcje",
        short_name: "Aukcje",
        description: "Otwórz katalog aktualnych aukcji Fiszy.",
        url: "/#aukcje",
      },
      {
        name: "Moje Fiszy",
        short_name: "Moje Fiszy",
        description: "Otwórz historię, zamówienia i obserwowane aukcje.",
        url: "/moje-fiszy",
      },
    ],
  };
}
