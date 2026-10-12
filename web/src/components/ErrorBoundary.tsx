// Límite de errores: si una vista falla, el resto de la aplicación sigue disponible y el fallo se explica.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './ui'

interface Props {
  children: ReactNode
  /** Al cambiar (por ejemplo, la ruta) se reintenta el contenido. */
  resetKey?: string
}
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error en la interfaz:', error, info.componentStack)
    if (import.meta.env.DEV) document.body.dataset.lastError = `${error.stack ?? error.message}\n${info.componentStack ?? ''}`.slice(0, 1800)
  }
  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <ErrorState error={{ message: `Esta vista encontró un error inesperado (${this.state.error.message}).`, kind: 'formato' }} retry={() => this.setState({ error: null })} />
      </div>
    )
  }
}
