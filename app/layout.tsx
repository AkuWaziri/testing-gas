import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "TestingGas — Tempo contract test app", description: "Standalone TestingGas contract and claim UI on Tempo mainnet." };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
