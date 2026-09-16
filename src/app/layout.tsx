import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vault Console',
  description:
    'Read-only console over an ERC-4626 vault: what the chain says now, what the index says happened, and which of the two each figure came from.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-slate-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
