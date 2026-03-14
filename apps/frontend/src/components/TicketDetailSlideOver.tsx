import { useEffect, useRef, useState } from 'react'
import { generalTicketsApi } from '@/api/tickets'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import { useWebSocket } from '@/context/WebSocketContext'
import TicketStatusBadge from '@/components/TicketStatusBadge'
import TicketPriorityBadge from '@/components/TicketPriorityBadge'
import type { OrgMember, Ticket, TicketTask, TicketTaskCreatePayload, TicketTaskUpdatePayload } from '@/types/ticket'

// Status transitions available per role
const NEXT_STATUSES: Record<string, string[]> = {
  open: ['assigned', 'in_progress', 'cancelled'],
  assigned: ['in_progress', 'open', 'cancelled'],
  in_progress: ['pending_review', 'resolved', 'cancelled'],
  pending_review: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  cancelled: [],
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress',
  pending_review: 'Pending Review', resolved: 'Resolved',
  closed: 'Closed', cancelled: 'Cancelled',
}

const CONDITION_LABELS: Record<string, string> = {
  good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', skipped: 'Skipped',
}

type Tab = 'details' | 'tasks' | 'comments' | 'activity'

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  ticketId: string
  onClose: () => void
  onUpdated?: (ticket: Ticket) => void
}

export default function TicketDetailSlideOver({ ticketId, onClose, onUpdated }: Props) {
  const { user } = useAuth()
  const { subscribe } = useWebSocket()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('details')
  const [saving, setSaving] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentFile, setCommentFile] = useState<File | null>(null)
  const [submittingComment, setSubmittingComment] = useState(false)

  // Task modal state
  const [taskModal, setTaskModal] = useState<{ mode: 'add' } | { mode: 'edit'; task: TicketTask } | null>(null)

  // Track loading state in a ref so the WS handler doesn't capture stale closure
  const loadingRef = useRef(false)

  const canChangeStatus = user?.role !== 'tenant'
  const canAssign = user?.role && ['owner', 'agent', 'superadmin'].includes(user.role)
  const canManageTasks = user?.role && ['owner', 'agent', 'superadmin'].includes(user.role)

  async function load() {
    loadingRef.current = true
    setLoading(true)
    try {
      const [t, m] = await Promise.all([
        generalTicketsApi.get(ticketId),
        canAssign ? generalTicketsApi.listMembers() : Promise.resolve([]),
      ])
      setTicket(t)
      setMembers(m)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }

  useEffect(() => { load() }, [ticketId])

  // Auto-refresh when a ticket_updated WS event arrives for this ticket
  useEffect(() => {
    return subscribe((notification) => {
      if (notification.type === 'ticket_updated') {
        const data = notification.data as { ticket_id?: string } | undefined
        if (data?.ticket_id === ticketId && !loadingRef.current) {
          generalTicketsApi.get(ticketId).then((updated) => {
            setTicket(updated)
            onUpdated?.(updated)
          }).catch(() => {})
        }
      }
    })
  }, [ticketId, subscribe])

  function refresh(updated: Ticket) {
    setTicket(updated)
    onUpdated?.(updated)
  }

  async function changeStatus(newStatus: string) {
    if (!ticket) return
    setSaving(true)
    try {
      refresh(await generalTicketsApi.update(ticket.id, { status: newStatus }))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function assignTo(userId: string) {
    if (!ticket) return
    setSaving(true)
    try {
      refresh(await generalTicketsApi.update(ticket.id, { assigned_to: userId || undefined }))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function submitComment() {
    if (!ticket || !commentBody.trim()) return
    setSubmittingComment(true)
    try {
      let updated = await generalTicketsApi.addComment(ticket.id, commentBody.trim())
      if (commentFile) {
        await generalTicketsApi.addAttachment(ticket.id, commentFile)
        updated = await generalTicketsApi.get(ticket.id)
      }
      refresh(updated)
      setCommentBody('')
      setCommentFile(null)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmittingComment(false)
    }
  }

  async function handleAddTask(data: TicketTaskCreatePayload) {
    if (!ticket) return
    try {
      refresh(await generalTicketsApi.addTask(ticket.id, data))
      setTaskModal(null)
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  async function handleUpdateTask(taskId: string, data: TicketTaskUpdatePayload) {
    if (!ticket) return
    try {
      refresh(await generalTicketsApi.updateTask(ticket.id, taskId, data))
      setTaskModal(null)
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (!ticket || !confirm('Delete this task?')) return
    try {
      refresh(await generalTicketsApi.deleteTask(ticket.id, taskId))
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  async function handleQuickTaskStatus(taskId: string, status: string) {
    if (!ticket) return
    try {
      refresh(await generalTicketsApi.updateTask(ticket.id, taskId, { status }))
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  const nextStatuses = ticket ? NEXT_STATUSES[ticket.status] ?? [] : []

  const tabs: Tab[] = ['details', 'tasks', 'comments', 'activity']

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4 shrink-0">
          <div className="flex-1 min-w-0">
            {ticket ? (
              <>
                <p className="text-xs text-gray-400 mb-0.5 uppercase tracking-wide font-medium">
                  {ticket.category.replace(/_/g, ' ')}
                </p>
                <h2 className="text-lg font-semibold text-gray-900 truncate">{ticket.title}</h2>
                <div className="flex items-center gap-2 mt-1.5">
                  <TicketStatusBadge status={ticket.status} />
                  <TicketPriorityBadge priority={ticket.priority} />
                  {ticket.property_name && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      {ticket.property_name}
                      {ticket.unit_label && ` · ${ticket.unit_label}`}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="h-6 w-48 bg-gray-100 rounded animate-pulse" />
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 shrink-0">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'py-2.5 px-1 mr-6 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t === 'activity' ? 'Activity' : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'comments' && ticket ? ` (${ticket.comments.length})` : ''}
              {t === 'tasks' && ticket ? ` (${ticket.tasks?.length ?? 0})` : ''}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
          )}
          {ticket && !loading && (
            <>
              {tab === 'details' && (
                <DetailsTab
                  ticket={ticket}
                  members={members}
                  canChangeStatus={canChangeStatus}
                  canAssign={!!canAssign}
                  nextStatuses={nextStatuses}
                  saving={saving}
                  onChangeStatus={changeStatus}
                  onAssign={assignTo}
                />
              )}
              {tab === 'tasks' && (
                <TasksTab
                  ticket={ticket}
                  canManage={!!canManageTasks}
                  members={members}
                  onAdd={() => setTaskModal({ mode: 'add' })}
                  onEdit={(task) => setTaskModal({ mode: 'edit', task })}
                  onDelete={handleDeleteTask}
                  onQuickStatus={handleQuickTaskStatus}
                />
              )}
              {tab === 'comments' && (
                <CommentsTab
                  ticket={ticket}
                  commentBody={commentBody}
                  onCommentChange={setCommentBody}
                  commentFile={commentFile}
                  onFileChange={setCommentFile}
                  submitting={submittingComment}
                  onSubmit={submitComment}
                />
              )}
              {tab === 'activity' && <ActivityTab ticket={ticket} />}
            </>
          )}
        </div>
      </div>

      {/* Task modal */}
      {taskModal && ticket && (
        <TaskModal
          mode={taskModal.mode}
          task={taskModal.mode === 'edit' ? taskModal.task : undefined}
          category={ticket.category}
          members={members}
          onSave={(data) =>
            taskModal.mode === 'add'
              ? handleAddTask(data as TicketTaskCreatePayload)
              : handleUpdateTask((taskModal as { mode: 'edit'; task: TicketTask }).task.id, data)
          }
          onClose={() => setTaskModal(null)}
        />
      )}
    </div>
  )
}

// ── Details Tab ───────────────────────────────────────────────────────────────

function DetailsTab({
  ticket,
  members,
  canChangeStatus,
  canAssign,
  nextStatuses,
  saving,
  onChangeStatus,
  onAssign,
}: {
  ticket: Ticket
  members: OrgMember[]
  canChangeStatus: boolean
  canAssign: boolean
  nextStatuses: string[]
  saving: boolean
  onChangeStatus: (s: string) => void
  onAssign: (userId: string) => void
}) {
  const [assigneeId, setAssigneeId] = useState(ticket.assigned_to ?? '')

  // Keep local state in sync when ticket is refreshed
  useEffect(() => {
    setAssigneeId(ticket.assigned_to ?? '')
  }, [ticket.assigned_to])

  return (
    <div className="space-y-6">
      {/* Status transitions */}
      {canChangeStatus && nextStatuses.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Change Status</p>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <button
                key={s}
                disabled={saving}
                onClick={() => onChangeStatus(s)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                → {STATUS_LABELS[s] ?? s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Assignment dropdown */}
      {canAssign && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Assigned To</p>
          <div className="flex gap-2">
            <select
              className="input flex-1"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">— Unassigned —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({m.role.replace('_', ' ')})
                </option>
              ))}
            </select>
            <button
              disabled={saving || assigneeId === (ticket.assigned_to ?? '')}
              onClick={() => onAssign(assigneeId)}
              className="px-3 py-2 text-xs font-semibold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {ticket.assigned_to_name && (
            <p className="text-xs text-gray-400 mt-1">Currently: {ticket.assigned_to_name}</p>
          )}
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Property</p>
          <p className="font-medium text-gray-700">{ticket.property_name ?? ticket.property_id}</p>
        </div>
        {(ticket.unit_id || ticket.unit_label) && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Unit</p>
            <p className="font-medium text-gray-700">{ticket.unit_label ?? ticket.unit_id}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Created By</p>
          <p className="font-medium text-gray-700">
            {ticket.creator_name ?? ticket.creator_id}
            {ticket.creator_role && (
              <span className="ml-1 text-xs text-gray-400 capitalize">
                ({ticket.creator_role.replace('_', ' ')})
              </span>
            )}
          </p>
        </div>
        {ticket.tenant_name && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Tenant</p>
            <p className="font-medium text-gray-700">{ticket.tenant_name}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Created</p>
          <p className="font-medium text-gray-700">{fmtDate(ticket.created_at)}</p>
        </div>
        {ticket.resolved_at && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Resolved</p>
            <p className="font-medium text-gray-700">{fmtDate(ticket.resolved_at)}</p>
          </div>
        )}
      </div>

      {/* Description */}
      {ticket.description && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Description</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-4">
            {ticket.description}
          </p>
        </div>
      )}

      {/* Resolution Notes */}
      {ticket.resolution_notes && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Resolution Notes</p>
          <p className="text-sm text-gray-700 bg-green-50 rounded-lg p-4">{ticket.resolution_notes}</p>
        </div>
      )}

      {/* Attachments */}
      {ticket.attachment_urls.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {ticket.attachment_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
              >
                <img src={url} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tasks Tab ──────────────────────────────────────────────────────────────────

function TasksTab({
  ticket,
  canManage,
  members,
  onAdd,
  onEdit,
  onDelete,
  onQuickStatus,
}: {
  ticket: Ticket
  canManage: boolean
  members: OrgMember[]
  onAdd: () => void
  onEdit: (task: TicketTask) => void
  onDelete: (taskId: string) => void
  onQuickStatus: (taskId: string, status: string) => void
}) {
  const tasks = ticket.tasks ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <button
            onClick={onAdd}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            + Add Task
          </button>
        )}
      </div>

      {tasks.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No tasks yet. {canManage && 'Add one above.'}</p>
      )}

      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          members={members}
          canManage={canManage}
          onEdit={() => onEdit(task)}
          onDelete={() => onDelete(task.id)}
          onQuickStatus={(s) => onQuickStatus(task.id, s)}
        />
      ))}
    </div>
  )
}

function TaskCard({
  task,
  members,
  canManage,
  onEdit,
  onDelete,
  onQuickStatus,
}: {
  task: TicketTask
  members: OrgMember[]
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
  onQuickStatus: (status: string) => void
}) {
  const statusColor: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    skipped: 'bg-slate-100 text-slate-500',
  }

  const assignee = members.find((m) => m.id === task.assigned_to)

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColor[task.status] ?? 'bg-gray-100 text-gray-600'}`}
            >
              {TASK_STATUS_LABELS[task.status] ?? task.status}
            </span>
            <span className="text-[11px] text-gray-400 capitalize">
              {task.task_type.replace('_', ' ')}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-gray-800">{task.title}</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
            >
              Del
            </button>
          </div>
        )}
      </div>

      {/* Type-specific details */}
      {task.task_type === 'meter_reading' && (
        <div className="grid grid-cols-3 gap-3 text-xs bg-blue-50 rounded-lg p-3">
          {task.meter_number && (
            <div>
              <p className="text-gray-400">Meter #</p>
              <p className="font-mono font-medium text-gray-700">{task.meter_number}</p>
            </div>
          )}
          {task.previous_reading !== undefined && task.previous_reading !== null && (
            <div>
              <p className="text-gray-400">Previous</p>
              <p className="font-medium text-gray-700">{task.previous_reading} {task.unit_of_measure}</p>
            </div>
          )}
          {task.current_reading !== undefined && task.current_reading !== null ? (
            <div>
              <p className="text-gray-400">Current</p>
              <p className="font-medium text-green-700">{task.current_reading} {task.unit_of_measure}</p>
            </div>
          ) : (
            <div>
              <p className="text-gray-400">Current</p>
              <p className="text-gray-300 italic">Not recorded</p>
            </div>
          )}
        </div>
      )}

      {task.task_type === 'inspection_item' && (
        <div className="flex gap-4 text-xs bg-purple-50 rounded-lg p-3">
          {task.room && (
            <div>
              <p className="text-gray-400">Room</p>
              <p className="font-medium text-gray-700">{task.room}</p>
            </div>
          )}
          {task.condition && (
            <div>
              <p className="text-gray-400">Condition</p>
              <p className={`font-medium ${task.condition === 'good' ? 'text-green-600' : task.condition === 'damaged' ? 'text-red-600' : 'text-yellow-600'}`}>
                {CONDITION_LABELS[task.condition] ?? task.condition}
              </p>
            </div>
          )}
        </div>
      )}

      {task.notes && (
        <p className="text-xs text-gray-500 italic">{task.notes}</p>
      )}

      {assignee && (
        <p className="text-xs text-gray-400">
          Assigned: {assignee.first_name} {assignee.last_name}
        </p>
      )}

      {/* Quick status change */}
      {canManage && task.status !== 'completed' && task.status !== 'skipped' && (
        <div className="flex gap-2 pt-1 border-t border-gray-100">
          {task.status === 'pending' && (
            <button
              onClick={() => onQuickStatus('in_progress')}
              className="text-xs text-yellow-600 hover:text-yellow-700 font-medium"
            >
              → In Progress
            </button>
          )}
          <button
            onClick={() => onQuickStatus('completed')}
            className="text-xs text-green-600 hover:text-green-700 font-medium"
          >
            ✓ Complete
          </button>
          <button
            onClick={() => onQuickStatus('skipped')}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  )
}

// ── Task Modal ─────────────────────────────────────────────────────────────────

function TaskModal({
  mode,
  task,
  category,
  members,
  onSave,
  onClose,
}: {
  mode: 'add' | 'edit'
  task?: TicketTask
  category: string
  members: OrgMember[]
  onSave: (data: TicketTaskCreatePayload | TicketTaskUpdatePayload) => void
  onClose: () => void
}) {
  // Infer default task_type from ticket category
  const defaultType =
    category === 'utility_reading' ? 'meter_reading' :
    category === 'move_in_inspection' || category === 'move_out_inspection' ? 'inspection_item' :
    'custom'

  const [taskType, setTaskType] = useState<string>(task?.task_type ?? defaultType)
  const [title, setTitle] = useState(task?.title ?? '')
  const [meterNumber, setMeterNumber] = useState(task?.meter_number ?? '')
  const [prevReading, setPrevReading] = useState<string>(task?.previous_reading?.toString() ?? '')
  const [curReading, setCurReading] = useState<string>(task?.current_reading?.toString() ?? '')
  const [uom, setUom] = useState(task?.unit_of_measure ?? 'units')
  const [room, setRoom] = useState(task?.room ?? '')
  const [condition, setCondition] = useState(task?.condition ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to ?? '')
  const [status, setStatus] = useState<string>(task?.status ?? 'pending')

  function handleSave() {
    if (!title.trim()) return
    const base = {
      title: title.trim(),
      notes: notes || undefined,
      assigned_to: assignedTo || undefined,
    }
    if (mode === 'add') {
      const payload: TicketTaskCreatePayload = {
        ...base,
        task_type: taskType,
        ...(taskType === 'meter_reading' && {
          meter_number: meterNumber || undefined,
          previous_reading: prevReading ? parseFloat(prevReading) : undefined,
          unit_of_measure: uom,
        }),
        ...(taskType === 'inspection_item' && {
          room: room || undefined,
        }),
      }
      onSave(payload)
    } else {
      const payload: TicketTaskUpdatePayload = {
        ...base,
        status,
        ...(taskType === 'meter_reading' && {
          meter_number: meterNumber || undefined,
          previous_reading: prevReading ? parseFloat(prevReading) : undefined,
          current_reading: curReading ? parseFloat(curReading) : undefined,
          unit_of_measure: uom,
        }),
        ...(taskType === 'inspection_item' && {
          room: room || undefined,
          condition: condition || undefined,
        }),
      }
      onSave(payload)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">
          {mode === 'add' ? 'Add Task' : 'Edit Task'}
        </h3>

        {/* Task type (only on add) */}
        {mode === 'add' && (
          <div>
            <label className="text-xs font-medium text-gray-500">Task Type</label>
            <select
              className="input w-full mt-1"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
            >
              <option value="custom">Custom</option>
              <option value="meter_reading">Meter Reading</option>
              <option value="inspection_item">Inspection Item</option>
              <option value="checklist_item">Checklist Item</option>
            </select>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="text-xs font-medium text-gray-500">Title *</label>
          <input
            className="input w-full mt-1"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Status (only on edit) */}
        {mode === 'edit' && (
          <div>
            <label className="text-xs font-medium text-gray-500">Status</label>
            <select
              className="input w-full mt-1"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        )}

        {/* Meter reading fields */}
        {taskType === 'meter_reading' && (
          <div className="space-y-3 p-3 bg-blue-50 rounded-xl">
            <p className="text-xs font-medium text-blue-700">Meter Reading Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Meter Number</label>
                <input
                  className="input w-full mt-1"
                  placeholder="e.g. MTR-001"
                  value={meterNumber}
                  onChange={(e) => setMeterNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Unit of Measure</label>
                <input
                  className="input w-full mt-1"
                  placeholder="units / kWh / m³"
                  value={uom}
                  onChange={(e) => setUom(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Previous Reading</label>
                <input
                  type="number"
                  className="input w-full mt-1"
                  placeholder="0"
                  value={prevReading}
                  onChange={(e) => setPrevReading(e.target.value)}
                />
              </div>
              {mode === 'edit' && (
                <div>
                  <label className="text-xs text-gray-500">Current Reading</label>
                  <input
                    type="number"
                    className="input w-full mt-1"
                    placeholder="0"
                    value={curReading}
                    onChange={(e) => setCurReading(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Inspection item fields */}
        {taskType === 'inspection_item' && (
          <div className="space-y-3 p-3 bg-purple-50 rounded-xl">
            <p className="text-xs font-medium text-purple-700">Inspection Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Room / Area</label>
                <input
                  className="input w-full mt-1"
                  placeholder="e.g. Kitchen"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                />
              </div>
              {mode === 'edit' && (
                <div>
                  <label className="text-xs text-gray-500">Condition</label>
                  <select
                    className="input w-full mt-1"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assign to */}
        {members.length > 0 && (
          <div>
            <label className="text-xs font-medium text-gray-500">Assign To</label>
            <select
              className="input w-full mt-1"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">— Unassigned —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({m.role.replace('_', ' ')})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-gray-500">Notes</label>
          <textarea
            className="input w-full mt-1 resize-none"
            rows={2}
            placeholder="Optional notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
          >
            {mode === 'add' ? 'Add Task' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Comments Tab ──────────────────────────────────────────────────────────────

function CommentsTab({
  ticket,
  commentBody,
  onCommentChange,
  commentFile,
  onFileChange,
  submitting,
  onSubmit,
}: {
  ticket: Ticket
  commentBody: string
  onCommentChange: (v: string) => void
  commentFile: File | null
  onFileChange: (f: File | null) => void
  submitting: boolean
  onSubmit: () => void
}) {
  return (
    <div className="space-y-4">
      {ticket.comments.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">No comments yet.</p>
      )}
      {ticket.comments.map((c) => (
        <div key={c.id} className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-700">
              {c.author_name ?? c.author_role.replace('_', ' ')}
            </span>
            {c.author_name && (
              <span className="text-[11px] text-gray-400 capitalize">
                ({c.author_role.replace('_', ' ')})
              </span>
            )}
            <span className="text-xs text-gray-400">{fmtDate(c.created_at)}</span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body}</p>
          {c.attachment_urls.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {c.attachment_urls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    alt={`Attachment ${i + 1}`}
                    className="w-12 h-12 object-cover rounded border border-gray-200"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* New comment */}
      <div className="border-t border-gray-100 pt-4">
        <textarea
          className="input w-full resize-none"
          rows={3}
          placeholder="Add a comment…"
          value={commentBody}
          onChange={(e) => onCommentChange(e.target.value)}
        />
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer hover:text-gray-700">
            <input
              type="file"
              className="hidden"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
            📎 {commentFile ? commentFile.name : 'Attach file'}
          </label>
          <button
            onClick={onSubmit}
            disabled={submitting || !commentBody.trim()}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
          >
            {submitting ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Activity Tab ──────────────────────────────────────────────────────────────

function ActivityTab({ ticket }: { ticket: Ticket }) {
  const sorted = [...ticket.activity].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  const typeIcon: Record<string, string> = {
    status_change: '🔄',
    assignment: '👤',
    comment: '💬',
    attachment: '📎',
    task: '☑️',
    system: '⚙️',
  }

  return (
    <div className="space-y-3">
      {sorted.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">No activity yet.</p>
      )}
      {sorted.map((a) => (
        <div key={a.id} className="flex gap-3 items-start">
          <span className="mt-0.5 text-base shrink-0">{typeIcon[a.type] ?? '•'}</span>
          <div>
            <p className="text-sm text-gray-700">{a.description}</p>
            {a.actor_name && (
              <p className="text-xs text-gray-400 mt-0.5">
                By {a.actor_name}
                {a.actor_role && ` (${a.actor_role.replace('_', ' ')})`}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
