import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import AuthGate from './components/AuthGate'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={
          <AuthGate>
            <AnalyticsDashboard />
          </AuthGate>
        } />
      </Routes>
    </BrowserRouter>
  )
}