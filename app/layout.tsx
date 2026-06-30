import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI検索対策 投資判断シミュレーター",
  description: "月額費用を回収するために、問い合わせ・受注・粗利がどれだけ必要かを可視化します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
