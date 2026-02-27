import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { DynamicWidget } from '@dynamic-labs/sdk-react-core'

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="header">
      <div className="header-left">
        <button
          type="button"
          className="header-menu-btn"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Toggle navigation"
        >
          <i className={`fa-solid ${menuOpen ? 'fa-xmark' : 'fa-bars'}`} />
        </button>
        <NavLink to="/" className="header-logo">
          <img src="/logo.png" alt="prmtrix" className="header-logo-img" />
          prm&middot;trix
        </NavLink>
        <nav className={`header-nav${menuOpen ? ' open' : ''}`}>
          <NavLink
            to="/"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            end
            onClick={() => setMenuOpen(false)}
          >
            Buy Policy
          </NavLink>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            onClick={() => setMenuOpen(false)}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/vaults"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            onClick={() => setMenuOpen(false)}
          >
            Vaults
          </NavLink>
          <NavLink
            to="/health"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            onClick={() => setMenuOpen(false)}
          >
            Protocol Health
          </NavLink>
        </nav>
      </div>
      <DynamicWidget />
    </header>
  )
}
