// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { db, bucket, toastMock } = vi.hoisted(() => {
  const bucket = {
    createSignedUrls: vi.fn(async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://files/${path}` })), error: null })),
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => ({ error: null })),
  }
  const db = {
    projects: [] as unknown[],
    photos: [] as unknown[],
    projectsError: null as null | { code?: string; message: string },
    inserted: [] as unknown[],
  }
  return { db, bucket, toastMock: { error: vi.fn(), success: vi.fn() } }
})

function table(name: string) {
  const rows = () => (name === 'marketing_projects' ? db.projects : name === 'marketing_project_photos' ? db.photos : [{ id: 'c1', code: 'SRG', name: 'Shanks Realty Group', color: '#123456', position: 0, is_archived: false }])
  const result = () => ({ data: rows(), error: name === 'marketing_projects' ? db.projectsError : null })
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    insert: (row: Record<string, unknown>) => {
      db.inserted.push(row)
      const made = { id: 'new-id', created_at: '2026-11-24T10:00:00+00:00', updated_at: '2026-11-24T10:00:00+00:00', company_id: null, area: null, completed_on: null, description: '', ...row }
      return { select: () => ({ single: async () => ({ data: made, error: null }) }) }
    },
    then: (resolve: (v: unknown) => void) => resolve(result()),
  }
  return chain
}

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: table, storage: { from: () => bucket } }) }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/lib/image-compress', () => ({
  compressPhoto: vi.fn(async (file: File) => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 1800, height: 1200, originalBytes: file.size })),
}))

import MarketingProjects from './marketing-projects'

const project = {
  id: 'p1',
  name: 'Kitchen remodel',
  company_id: 'c1',
  area: 'Kirkwood',
  completed_on: '2026-10-05',
  description: 'Cedar shelves and a new island.',
  created_at: '2026-10-06T10:00:00+00:00',
  updated_at: '2026-10-06T10:00:00+00:00',
}
const photo = (id: string, position: number) => ({ id, project_id: 'p1', path: `p1/${id}.jpg`, caption: '', position, width: 1800, height: 1200, bytes: 250_000, created_at: '2026-11-25T21:42:00+00:00', created_by: 'u2' })

beforeEach(() => {
  db.projects = []
  db.photos = []
  db.projectsError = null
  db.inserted = []
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('MarketingProjects', () => {
  it('invites the first project when there are none', async () => {
    render(<MarketingProjects userId="u1" />)
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  })

  it('says so when the tables are not there yet', async () => {
    db.projectsError = { code: 'PGRST205', message: "Could not find the table 'public.marketing_projects'" }
    render(<MarketingProjects userId="u1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up')
  })

  it('lists projects with the cover photo and photo count', async () => {
    db.projects = [project]
    db.photos = [photo('b', 2), photo('a', 1)]
    render(<MarketingProjects userId="u1" />)
    expect(await screen.findByText('Kitchen remodel')).toBeInTheDocument()
    expect(screen.getByText('SRG')).toBeInTheDocument()
    expect(screen.getByText('2 photos')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('img')).toHaveAttribute('src', 'https://files/p1/a.jpg'))
  })

  it('shows when and by whom a photo was uploaded, and filters by date', async () => {
    db.projects = [project, { ...project, id: 'p2', name: 'Deck rebuild', created_at: '2026-09-01T10:00:00+00:00' }]
    db.photos = [photo('a', 1), { ...photo('z', 1), id: 'z', project_id: 'p2', path: 'p2/z.jpg', created_at: '2026-09-02T18:00:00+00:00' }]
    render(<MarketingProjects userId="u1" />)
    expect(await screen.findByText('Deck rebuild')).toBeInTheDocument()
    expect(screen.getByText('Last upload Nov 25, 2026, 3:42 PM CST')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Added between: from'), { target: { value: '2026-11-01' } })
    expect(screen.queryByText('Deck rebuild')).not.toBeInTheDocument()
    expect(screen.getByText('Kitchen remodel')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 projects')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Kitchen remodel'))
    expect(await screen.findByText('Uploaded Nov 25, 2026, 3:42 PM CST')).toBeInTheDocument()
  })

  it('uploads photos picked from the list to the project chosen', async () => {
    db.projects = [project, { ...project, id: 'p2', name: 'Deck rebuild', completed_on: '2026-09-01' }]
    render(<MarketingProjects userId="u1" />)
    await screen.findByText('Deck rebuild')
    const input = screen.getByLabelText('Choose photos to upload') as HTMLInputElement
    expect(input.accept).toBe('image/*')
    // An iPhone can hand over a HEIC with no type at all.
    const heic = new File(['a'], 'IMG_0042.HEIC', { type: '' })
    fireEvent.change(input, { target: { files: [heic] } })
    expect(await screen.findByText('Add 1 photo to a project')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(bucket.upload).toHaveBeenCalledTimes(1))
    expect((bucket.upload.mock.calls[0] as unknown as string[])[0]).toMatch(/^p2\//)
    expect(db.inserted[0]).toMatchObject({ project_id: 'p2', created_by: 'u1' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Deck rebuild' })).toBeInTheDocument())
  })

  it('creates a project and opens it for photos', async () => {
    render(<MarketingProjects userId="u1" />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    const create = screen.getByRole('button', { name: /create project/i })
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Deck rebuild ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Cedar.' } })
    fireEvent.click(create)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Deck rebuild' })).toBeInTheDocument())
    expect(db.inserted[0]).toMatchObject({ name: 'Deck rebuild', description: 'Cedar.', company_id: null, created_by: 'u1' })
    expect(screen.getByText('Add the best photos of this project')).toBeInTheDocument()
  })
})
