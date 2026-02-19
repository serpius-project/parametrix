import { Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import BuyPage from './pages/BuyPage'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<BuyPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
