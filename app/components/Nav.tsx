'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useUser } from './UserProvider';
import type { TradingMode } from './UserProvider';

const MORE_ITEMS = [
  { href: '/tickets',    icon: '🎫', label: 'Tickets' },
  { href: '/strategies', icon: '⚙️', label: 'Strategies' },
];

export default function Nav() {
  const { username, balance, setUsername, tradingMode, setTradingMode } = useUser();
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href);

  const moreActive = MORE_ITEMS.some(m => isActive(m.href));

  const topLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm font-medium transition ${isActive(href) ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
    >
      {label}
    </Link>
  );

  const primaryTabs = [
    { href: '/',            icon: '📈', label: 'Markets' },
    { href: '/leaderboard', icon: '🏆', label: 'Leaders' },
    { href: '/agents',      icon: '🤖', label: 'Agents' },
    { href: '/copy',        icon: '⧉',  label: 'Copy' },
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
            {topLink('/strategies', 'Strategies')}
            {username && topLink(`/portfolio/${username}`, 'My Portfolio')}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Paper / Live toggle */}
          <div className="flex items-center bg-zinc-800 rounded-full p-0.5 border border-zinc-700">
            {(['paper', 'live'] as TradingMode[]).map(m => (
              <button
                key={m}
                onClick={() => setTradingMode(m)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-full transition ${
                  tradingMode === m
                    ? m === 'live'
                      ? 'bg-green-600 text-white'
                      : 'bg-zinc-600 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {m === 'paper' ? 'Paper' : '● Live'}
              </button>
            ))}
          </div>

          {username ? (
            <>
              {tradingMode === 'paper' && (
                <span className="text-green-400 font-mono text-sm font-semibold">${balance.toFixed(2)}</span>
              )}
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
        {primaryTabs.map(t => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={() => setMoreOpen(false)}
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

        {/* More button */}
        <button
          onClick={() => setMoreOpen(o => !o)}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition ${
            moreOpen || moreActive ? 'text-white' : 'text-zinc-500'
          }`}
        >
          <span className="text-lg leading-none">⋯</span>
          <span className={`text-[10px] font-medium ${moreOpen || moreActive ? 'text-white' : 'text-zinc-500'}`}>
            More
          </span>
          {moreActive && !moreOpen && <span className="absolute bottom-0 w-8 h-0.5 bg-blue-500 rounded-full" />}
        </button>
      </nav>

      {/* More overlay */}
      {moreOpen && (
        <>
          <div
            className="sm:hidden fixed inset-0 z-30"
            onClick={() => setMoreOpen(false)}
          />
          <div className="sm:hidden fixed bottom-14 right-0 left-0 z-40 bg-zinc-900 border-t border-zinc-700 shadow-xl">
            {MORE_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={`flex items-center gap-4 px-6 py-4 border-b border-zinc-800 transition ${
                  isActive(item.href) ? 'text-white bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
                {isActive(item.href) && <span className="ml-auto w-2 h-2 rounded-full bg-blue-500" />}
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
