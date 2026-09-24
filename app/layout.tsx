import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Hiwell · Partner Studio',
  description: 'Instagram partner keşfi ve yerel kampanya çalışma alanı.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
