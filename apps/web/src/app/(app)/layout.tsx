import { AppShell } from "../_components/AppShell";

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
