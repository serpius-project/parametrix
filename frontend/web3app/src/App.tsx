import { Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import BuyPage from './pages/BuyPage'
import DashboardPage from './pages/DashboardPage'
import VaultsPage from './pages/VaultsPage'
import ProtocolHealthPage from './pages/ProtocolHealthPage'

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<BuyPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/vaults" element={<VaultsPage />} />
          <Route path="/health" element={<ProtocolHealthPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
