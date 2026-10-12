import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { SyncStatusBar } from '@/components/SyncStatusBar';

const NAV_ITEMS = [
  { to: '/', label: '打卡', end: true },
  { to: '/timeline', label: '记录', end: false },
  { to: '/settings', label: '设置', end: false },
];

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__top">
          <h1 className="app-title">打卡</h1>
          <SyncStatusBar />
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `app-nav__link${isActive ? ' app-nav__link--active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="app-main">{children}</main>

      <footer className="app-footer">数据仅存本机 · 无账号 · 无上传</footer>
    </div>
  );
}
