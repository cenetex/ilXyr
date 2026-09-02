import type { Metadata } from "next";
import "./globals.css";

const title = "ilXyr — Evidence before execution";
const description =
  "Explore ilXyr's public research protocol, evidence ledger, experiment records, and read-only API.";

export const metadata: Metadata = {
  metadataBase: new URL("https://ilxyr.cenetex.com"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "ilXyr" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
