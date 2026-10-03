import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Agent AI",
  description: "Assistant de voyage multimodal porte-à-porte.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
