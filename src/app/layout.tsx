import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Race demo with Jev",
  description:
    "Local demo of a 10-minute simulated race with explainable Jev decisions. Fictional data; no diagnosis or medical advice.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
