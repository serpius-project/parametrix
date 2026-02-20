import { useHazards } from '../../hooks/useHazards'
import { formatUnit, formatDescription } from '../../utils/format'

const HAZARD_ICONS: Record<string, string> = {
  heatwave: 'fa-solid fa-temperature-high',
  flood: 'fa-solid fa-water',
  drought: 'fa-solid fa-sun-plant-wilt',
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
              <div className="hazard-icon"><i className={HAZARD_ICONS[h] ?? 'fa-solid fa-question'} /></div>
              <div className="hazard-name">{h.charAt(0).toUpperCase() + h.slice(1)}</div>
              {config && (
                <div className="hazard-desc">
                  {(() => {
                    const cleaned = formatDescription(config.description)
                    const parenIdx = cleaned.indexOf('(')
                    const main = parenIdx >= 0 ? cleaned.slice(0, parenIdx).trim() : cleaned
                    const detail = parenIdx >= 0 ? cleaned.slice(parenIdx) : ''
                    return (
                      <>
                        <span><strong>Description:</strong> {main}</span>
                        {detail && <span><strong>Measure:</strong> {detail}</span>}
                        <span><strong>Units:</strong> {formatUnit(config.unit)}</span>
                      </>
                    )
                  })()}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
