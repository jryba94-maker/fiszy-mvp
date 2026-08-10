import type { Metadata } from "next";
import { DeviceProfile } from "./DeviceProfile";

export const metadata: Metadata = {
  title: "Moje Fiszy",
  description: "Historia aukcji zapisana w tej przeglądarce.",
};

export default function MyFiszyPage() {
  return <DeviceProfile />;
}
