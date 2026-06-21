'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from './UserProvider';

export default function Nav() {
  const { username, balance, setUsername } = useUser();
  const path = usePathname();

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm font-medium transition ${path === href ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-4 h-14 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-white font-bold text-lg tracking-tight">
          📈 Poly Trader
        </Link>
        <div className="hidden sm:flex items-center gap-5">
          {link('/', 'Markets')}
          {link('/leaderboard', 'Leaderboard')}
          {link('/agents', 'Agents')}
          {link('/copy', 'Copy')}
          {username && link(`/portfolio/${username}`, 'My Portfolio')}
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
  );
}
