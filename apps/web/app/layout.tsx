import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';

import '@workspace/ui/globals.css';
import { Providers } from '@/app/providers';

const fallbackFontVariables = {
  '--font-sans':
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as CSSProperties;

export const metadata: Metadata = {
  title: 'Numeron',
  description: 'Catch, train, and battle with blockchain monsters!',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased" style={fallbackFontVariables} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
