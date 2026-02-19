import { useHazards } from '../../hooks/useHazards'

const HAZARD_ICONS: Record<string, string> = {
  heatwave: 'H',
  flood: 'F',
  drought: 'D',
}

interface StepSelectHazardProps {
  hazards: string[]
  onSelect: (hazard: string) => void
}

export default function StepSelectHazard({ hazards, onSelect }: StepSelectHazardProps) {
  const { hazards: hazardConfigs, loading } = useHazards()

  if (loading) {
    return <div className="wizard-loading">Loading hazards...</div>
  }

  return (
    <div className="wizard-step">
      <h3>Select Hazard Type</h3>
      <div className="hazard-grid">
        {hazards.map((h) => {
          const config = hazardConfigs[h]
          return (
            <button key={h} className="hazard-card" onClick={() => onSelect(h)}>
              <div className="hazard-icon">{HAZARD_ICONS[h] ?? '?'}</div>
              <div className="hazard-name">{h.charAt(0).toUpperCase() + h.slice(1)}</div>
              {config && (
                <div className="hazard-desc">
                  {config.description} ({config.unit})
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
