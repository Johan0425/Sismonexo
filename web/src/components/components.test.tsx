import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ChartFrame, DataTable } from '@/charts/Chart'
import { DISCLAIMER } from '@/lib/export'
import { useApp } from '@/lib/store'
import { Disclaimer } from './Shell'
import { Button, EmptyState, ErrorState, Field, Modal, ProbabilityScale, ProbabilityValue, Segmented, Slider, Tabs, Tooltip } from './ui'

describe('probabilidad', () => {
  it('comunica el valor con porcentaje, etiqueta e intervalo de incertidumbre', () => {
    render(<ProbabilityValue p={0.22} lo={0.14} hi={0.31} />)
    expect(screen.getByText(/22\s?%/)).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Intervalo de incertidumbre del 90 %: de 14\s?% a 31\s?%/ })).toBeInTheDocument()
  })
  it('la escala describe sus clases para lectores de pantalla', () => {
    render(<ProbabilityScale value={0.7} />)
    expect(screen.getByRole('img', { name: /seis clases.*Valor actual: 70\s?%, clase Muy alta/ })).toBeInTheDocument()
    expect(screen.getByText('Muy baja')).toBeInTheDocument()
  })
})

describe('controles', () => {
  it('el control segmentado funciona con las flechas del teclado', async () => {
    const user = userEvent.setup()
    function T() {
      const [v, setV] = useState(30)
      return <Segmented label="Horizonte" value={v} onChange={setV} options={[{ value: 7, label: '7 días' }, { value: 30, label: '30 días' }, { value: 90, label: '90 días' }]} />
    }
    render(<T />)
    const group = screen.getByRole('radiogroup', { name: 'Horizonte' })
    expect(within(group).getByRole('radio', { name: '30 días' })).toBeChecked()
    within(group).getByRole('radio', { name: '30 días' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(within(group).getByRole('radio', { name: '90 días' })).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(within(group).getByRole('radio', { name: '7 días' })).toBeChecked()
  })
  it('las pestañas exponen el estado seleccionado', async () => {
    const user = userEvent.setup()
    const on = vi.fn()
    render(<Tabs label="Secciones" value="a" onChange={on} tabs={[{ value: 'a', label: 'Uno' }, { value: 'b', label: 'Dos' }]} />)
    expect(screen.getByRole('tab', { name: 'Uno' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Dos' }))
    expect(on).toHaveBeenCalledWith('b')
  })
  it('los campos enlazan etiqueta, ayuda y error', () => {
    render(<Field label="Magnitud mínima" error="Use un valor entre 2,5 y 9.">{(p) => <input {...p} />}</Field>)
    const input = screen.getByLabelText('Magnitud mínima')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Use un valor entre 2,5 y 9.')
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })
  it('el deslizador anuncia advertencias de rango', () => {
    render(<Slider label="Frecuencia reciente" value={50} min={0} max={60} step={1} onChange={() => undefined} format={(v) => `${v} eventos`} warn="Fuera del rango histórico habitual." />)
    expect(screen.getByRole('slider', { name: 'Frecuencia reciente' })).toHaveAttribute('aria-valuetext', '50 eventos')
    expect(screen.getByText('Fuera del rango histórico habitual.')).toHaveAttribute('role', 'status')
  })
  it('el tooltip aparece al enfocar y se cierra con Escape', async () => {
    const user = userEvent.setup()
    render(<Tooltip text="Volver a la extensión nacional"><button type="button">Inicio</button></Tooltip>)
    await user.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Volver a la extensión nacional')
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('ventana modal', () => {
  it('atrapa el foco, se cierra con Escape y devuelve el foco', async () => {
    const user = userEvent.setup()
    function T() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Abrir</Button>
          <Modal open={open} onClose={() => setOpen(false)} title="Explicación" footer={<Button>Entendido</Button>}>
            <p>Contenido</p>
          </Modal>
        </>
      )
    }
    render(<T />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Explicación' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await user.tab()
    await user.tab()
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus()
  })
})

describe('estados y advertencias', () => {
  it('la advertencia permanente contiene el texto exigido', () => {
    render(<Disclaimer />)
    expect(screen.getByRole('note', { name: 'Advertencia de uso académico' })).toHaveTextContent(DISCLAIMER)
    expect(DISCLAIMER).toBe('Esta plataforma presenta estimaciones académicas basadas en patrones históricos. No constituye una alerta oficial, no predice terremotos individuales y no reemplaza la información del Servicio Geológico Colombiano ni de las autoridades de gestión del riesgo.')
  })
  it('el estado de error distingue la conexión interrumpida y permite reintentar', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    render(<ErrorState error={{ message: 'No hay conexión con el servidor de datos.', kind: 'red' }} retry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Conexión interrumpida')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(retry).toHaveBeenCalledOnce()
  })
  it('el estado vacío orienta sobre qué hacer', () => {
    render(<EmptyState title="Ningún evento cumple los filtros">Amplíe el rango de fechas.</EmptyState>)
    expect(screen.getByRole('status')).toHaveTextContent('Amplíe el rango de fechas.')
  })
})

describe('gráficos', () => {
  const table = { columns: ['Año', 'Eventos'], rows: [[2023, 1200], [2024, 1350]] }
  it('cada gráfico tiene resumen textual y alternativa tabular', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ChartFrame title="Eventos por año" summary="Dos años de datos; el máximo fue 1.350." table={table}>
          {() => <svg data-testid="svg" />}
        </ChartFrame>
      </MemoryRouter>,
    )
    const fig = screen.getByRole('figure', { name: 'Eventos por año' })
    expect(within(fig).getByText('Dos años de datos; el máximo fue 1.350.')).toBeInTheDocument()
    expect(within(fig).getByRole('img', { name: 'Eventos por año' })).toHaveAccessibleDescription('Dos años de datos; el máximo fue 1.350.')
    await user.click(within(fig).getByRole('button', { name: 'Ver datos en tabla' }))
    const t = within(fig).getByRole('table')
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Año', 'Eventos'])
    expect(within(t).getByRole('rowheader', { name: '2023' })).toBeInTheDocument()
    expect(within(fig).getByRole('button', { name: 'Ver gráfico' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('las tablas tienen leyenda y encabezados de fila y columna', () => {
    render(<DataTable table={table} caption="Datos de prueba" />)
    expect(screen.getByRole('region', { name: 'Datos de prueba' })).toHaveAttribute('tabindex', '0')
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
  })
})

describe('anuncios para lectores de pantalla', () => {
  it('los cambios de filtros se anuncian en la región viva', () => {
    useApp.getState().setFilters({ magMin: 5 }, 'Magnitud ≥ 5,0')
    expect(useApp.getState().live).toBe('Filtro aplicado: Magnitud ≥ 5,0.')
    useApp.getState().resetFilters()
  })
})
