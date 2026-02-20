import { NavLink } from 'react-router-dom'
import { DynamicWidget } from '@dynamic-labs/sdk-react-core'

export default function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <NavLink to="/" className="header-logo">
          Parametrix
        </NavLink>
        <nav className="header-nav">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} end>
            Buy Policy
          </NavLink>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/health"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            Protocol Health
          </NavLink>
        </nav>
      </div>
      <DynamicWidget />
    </header>
  )
}
