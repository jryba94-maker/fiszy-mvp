import type { Metadata } from "next";
import { DeviceProfile } from "./DeviceProfile";

export const metadata: Metadata = {
  title: "Moje Fiszy",
  description: "Konto, historia aukcji, zamówienia, obserwowane i pomoc Fiszy.",
};

export default function MyFiszyPage() {
  return <DeviceProfile />;
}
