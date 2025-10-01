import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import AnalyticsDashboard from '../src/pages/AnalyticsDashboard'

describe('Analytics Dashboard', () => {
  test('renders dashboard headings', () => {
    render(<AnalyticsDashboard />)
    expect(screen.getByText(/Top Customers/)).toBeInTheDocument()
    expect(screen.getByText(/Daily Revenue/)).toBeInTheDocument()
    expect(screen.getByText(/Monthly Orders/)).toBeInTheDocument()
  })
})