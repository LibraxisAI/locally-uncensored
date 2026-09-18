import { useState } from 'react'
import { Folder, Shield, X } from 'lucide-react'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { AgentWorkspaceDialog } from './AgentWorkspaceDialog'
import type { AgentWorkspace } from '../../types/agent-workspace'

/**
 * Tiny pill next to the agent toggle that shows where the active chat
 * operates: "Sandbox" or the basename of the picked folder. Click to
 * change — re-opens AgentWorkspaceDialog so the user can swap mid-chat.
 *
 * Renders nothing unless agent mode is enabled for the active chat AND
 * a workspace has been chosen. The initial-choice flow is owned by
 * AgentModeToggle.
 */
export function AgentWorkspaceBadge() {
  const [dialogOpen, setDialogOpen] = useState(false)
  // Gesetzt, nachdem das x den Eintrag je Chat geloescht hat und ein
  // Vorgabeordner nachruecken wuerde. Eigener Zustand, weil die Pille in
  // diesem Moment schon verschwunden ist und der Dialog trotzdem stehen
  // bleiben muss.
  const [leftInto, setLeftInto] = useState<AgentWorkspace | null>(null)
  const activeId = useChatStore((s) => s.activeConversationId)
  const isActive = useAgentModeStore((s) =>
    activeId ? s.agentModeActive[activeId] ?? false : false,
  )
  const workspace = useAgentModeStore((s) =>
    activeId ? s.workspaces[activeId] : undefined,
  )
  const defaultWorkspace = useSettingsStore((s) => s.settings.defaultWorkspace)

  if (!activeId) return null

  const handleChoose = (next: AgentWorkspace) => {
    useAgentModeStore.getState().setWorkspace(activeId, next)
    setDialogOpen(false)
    setLeftInto(null)
  }

  // helpslowlydying, 01.09.2026: der Agent stand in einem riesigen Baum, in dem
  // er nichts zu suchen hatte, und es gab KEINEN Weg hinaus. Die Plakette
  // konnte den Ordner wechseln, nicht ihn verlassen; clearWorkspace gab es im
  // Speicher, nur hat es niemand aufgerufen. Jetzt liegt es hier, direkt an der
  // Stelle, an der der Nutzer den Ordner sieht.
  //
  // R2-1: der Eintrag je Chat war nur die obere Haelfte. `resolveWorkspace`
  // faellt danach auf `settings.defaultWorkspace` zurueck, und der Umschalter
  // ueberspringt bei gesetztem Vorgabeordner den Dialog. Der Agent behielt also
  // Schreib- und Shellzugriff auf genau den Baum, den der Nutzer eben verlassen
  // hat. Steht ein Vorgabeordner, geht deshalb der Dialog auf: er ist die
  // einzige Stelle mit "Forget it". Ohne Vorgabeordner bleibt es beim
  // bisherigen Verhalten, die Pille geht weg und der Agent fragt neu.
  const handleLeave = () => {
    useAgentModeStore.getState().clearWorkspace(activeId)
    setDialogOpen(false)
    if (defaultWorkspace) setLeftInto(defaultWorkspace)
  }

  if (leftInto) {
    return (
      <AgentWorkspaceDialog
        open={true}
        conversationId={activeId}
        initialWorkspace={leftInto}
        onChoose={handleChoose}
        onClose={() => setLeftInto(null)}
      />
    )
  }

  if (!isActive || !workspace) return null

  const extras = workspace.kind === 'folder' ? workspace.extraPaths ?? [] : []
  const label =
    workspace.kind === 'folder'
      ? extras.length > 0
        ? `${basename(workspace.path)} +${extras.length}`
        : basename(workspace.path)
      : 'Sandbox'
  const Icon = workspace.kind === 'folder' ? Folder : Shield
  const tone =
    workspace.kind === 'folder'
      // Picked folder = neutral / no colour (David 2026-06-06). The amber read
      // as an alert. Text + Folder icon inherit this gray. Sandbox stays green.
      ? 'text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/10'
      : 'text-emerald-500 border-emerald-500/30'

  return (
    <>
      <span className={`flex items-center rounded border transition-colors text-[0.55rem] ${tone}`}>
      <button
        onClick={() => setDialogOpen(true)}
        title={
          workspace.kind === 'folder'
            ? `Agent working in ${workspace.path}. Click to change.`
            : 'Agent working in a separate folder with a file tool path jail, not a container. Click to change.'
        }
        className="flex items-center gap-1 px-1.5 py-0.5 bg-transparent hover:bg-white/5"
      >
        <Icon size={10} />
        <span className="font-mono max-w-[120px] truncate">{label}</span>
      </button>
      <button
        onClick={handleLeave}
        title="Leave this workspace. The agent asks again before it works anywhere."
        aria-label="Leave this workspace"
        data-testid="agent-workspace-leave"
        className="px-1 py-0.5 bg-transparent hover:bg-white/5"
      >
        <X size={9} />
      </button>
      </span>

      {dialogOpen && (
        <AgentWorkspaceDialog
          open={true}
          conversationId={activeId}
          // Re-opening a folder chat from the badge jumps straight to the
          // multi-repo extras manager (add repos / remember-as-default).
          initialWorkspace={workspace}
          onChoose={handleChoose}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}

function basename(p?: string): string {
  if (!p) return 'folder'
  const cleaned = p.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || cleaned
}
