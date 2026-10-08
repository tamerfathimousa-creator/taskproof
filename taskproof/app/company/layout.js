import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/actions/auth";

export default async function CompanyLayout({ children }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "COMPANY") redirect("/login");

  const navItem = "px-3 py-2 rounded-lg text-sm font-medium text-muted hover:bg-surface2 hover:text-ink";

  return (
    <div className="min-h-screen grid md:grid-cols-[220px_1fr]">
      <aside className="border-b md:border-b-0 md:border-r border-line bg-surface2 px-4 py-5 flex md:flex-col gap-1 md:gap-1">
        <div className="px-2 pb-4 hidden md:block">
          <Logo />
        </div>
        <nav className="flex md:flex-col gap-1 flex-1 overflow-x-auto">
          <Link href="/company/dashboard" className={navItem}>
            Dashboard
          </Link>
          <Link href="/company/jobs" className={navItem}>
            Jobs
          </Link>
          <Link href="/company/simulations" className={navItem}>
            Simulations
          </Link>
          <Link href="/company/profile" className={navItem}>
            Company profile
          </Link>
        </nav>
        <form action={logout} className="hidden md:block mt-auto pt-4 border-t border-line">
          <div className="px-2 pb-2 text-xs text-muted truncate">{user.email}</div>
          <button className="w-full text-left px-2 py-2 rounded-lg text-sm text-muted hover:bg-surface hover:text-ink">
            Log out
          </button>
        </form>
      </aside>
      <main className="px-5 md:px-10 py-8 max-w-5xl w-full">{children}</main>
    </div>
  );
}
