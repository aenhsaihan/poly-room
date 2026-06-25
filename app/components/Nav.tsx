'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from './UserProvider';

export default function Nav() {
  const { username, balance, setUsername } = useUser();
  const path = usePathname();

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href);

  const topLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm font-medium transition ${isActive(href) ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
    >
      {label}
    </Link>
  );

  const tabs = [
    { href: '/',            icon: '📈', label: 'Markets' },
    { href: '/leaderboard', icon: '🏆', label: 'Leaders' },
    { href: '/agents',      icon: '🤖', label: 'Agents' },
    { href: '/copy',        icon: '⧉',  label: 'Copy' },
    { href: '/tickets',     icon: '🎫', label: 'Tickets' },
    ...(username ? [{ href: `/portfolio/${username}`, icon: '👤', label: 'Portfolio' }] : []),
  ];

  return (
    <>
      {/* Top bar */}
      <nav className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-white font-bold text-lg tracking-tight flex-shrink-0">
            📈 Poly Trader
          </Link>
          <div className="hidden sm:flex items-center gap-5">
            {topLink('/', 'Markets')}
            {topLink('/leaderboard', 'Leaderboard')}
            {topLink('/agents', 'Agents')}
            {topLink('/copy', 'Copy')}
            {topLink('/tickets', 'Tickets')}
            {username && topLink(`/portfolio/${username}`, 'My Portfolio')}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {username ? (
            <>
              <span className="text-green-400 font-mono text-sm font-semibold">${balance.toFixed(2)}</span>
              <button
                onClick={() => {
                  localStorage.removeItem('poly_username');
                  setUsername('');
                  window.location.reload();
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                {username} ×
              </button>
            </>
          ) : (
            <span className="text-zinc-500 text-sm">Not logged in</span>
          )}
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 flex">
        {tabs.map(t => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition ${
                active ? 'text-white' : 'text-zinc-500'
              }`}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              <span className={`text-[10px] font-medium ${active ? 'text-white' : 'text-zinc-500'}`}>
                {t.label}
              </span>
              {active && <span className="absolute bottom-0 w-8 h-0.5 bg-blue-500 rounded-full" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
