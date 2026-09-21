import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Subtitle Studio",
  description: "Translate your video into English subtitles, review every line and download your subtitled video.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
