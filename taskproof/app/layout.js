import "./globals.css";

export const metadata = {
  title: "TaskProof — Hire on proof, not paper",
  description: "Evaluate candidates through realistic workplace simulations.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-bg text-ink min-h-screen">{children}</body>
    </html>
  );
}
