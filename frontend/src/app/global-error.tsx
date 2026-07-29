'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f5f5f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ maxWidth: 380, width: '100%', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 16, padding: 24, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          <div style={{ fontSize: 40 }} aria-hidden>🛠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '12px 0 8px', color: '#171717' }}>Estamos en mantenimiento</h1>
          <p style={{ fontSize: 14, color: '#525252', margin: 0 }}>En unas horas el sistema va a estar disponible. Probá de nuevo en un rato.</p>
          <button
            onClick={() => reset()}
            style={{ marginTop: 20, width: '100%', height: 44, borderRadius: 10, border: 'none', background: '#171717', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
