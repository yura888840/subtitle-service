import { SiteLayout } from "@/components/site-layout";
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SiteLayout lang="de">{children}</SiteLayout>;
}
