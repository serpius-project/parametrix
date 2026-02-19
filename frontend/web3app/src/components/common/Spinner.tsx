export default function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="spinner"
      style={{
        width: size,
        height: size,
        border: `2px solid rgba(255,255,255,0.3)`,
        borderTop: `2px solid #fff`,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  )
}
