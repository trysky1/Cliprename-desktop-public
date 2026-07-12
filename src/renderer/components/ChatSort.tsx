import React, { useMemo, useState } from 'react'
import { MediaItem, SortOption, SortPlan } from '../../shared/types'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  plan?: SortPlan
}

interface Props {
  items: MediaItem[]
  live: boolean
  applying: boolean
  onPlan: (instruction: string) => Promise<SortPlan>
  onApplyOption: (option: SortOption) => Promise<boolean>
  // 'move' relocates originals; 'copy' leaves them in place — shown on each option.
  applyMode: 'copy' | 'move'
  onOpenSupport: () => void
}

// Friendly prompt for each detected theme/category.
const CATEGORY_SUGGESTIONS: Record<string, string> = {
  aerial: 'Put all the aerial & drone shots in an "aerial" folder',
  interview: 'Group the interview clips into an "interviews" folder',
  people: 'Put the clips with people into a "people" folder',
  nature: 'Gather the nature shots into a "nature" folder',
  outdoors: 'Collect the outdoor footage into an "outdoors" folder',
  urban: 'Put the city / urban shots into an "urban" folder',
  interior: 'Group the indoor shots into an "interior" folder',
  product: 'Put the product shots into a "product" folder',
  broll: 'Separate the b-roll into its own folder',
  music: 'Put the music tracks into a "music" folder',
  voice: 'Group the voiceover clips into a "voice" folder',
  sfx: 'Collect the sound effects into an "sfx" folder',
  screen: 'Put screen recordings & screenshots into a "screens" folder'
}

// Generic, anyone-can-ask suggestions shown before the clips are analyzed.
const GENERIC_SUGGESTIONS = [
  'Sort everything into folders by type',
  'Group the files by the month they were made',
  'Put the videos and photos into separate folders'
]

function buildSuggestions(items: MediaItem[]): { themed: boolean; list: string[] } {
  const analyzed = items.some((i) => i.status === 'done' && !!i.category)
  if (!analyzed) return { themed: false, list: GENERIC_SUGGESTIONS }

  const counts = new Map<string, number>()
  for (const i of items) if (i.category) counts.set(i.category, (counts.get(i.category) || 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)

  const list: string[] = []
  for (const c of top) {
    const phrase = CATEGORY_SUGGESTIONS[c]
    if (phrase && !list.includes(phrase)) list.push(phrase)
    if (list.length >= 3) break
  }
  list.push('Sort everything by theme into tidy folders')
  return { themed: true, list: list.slice(0, 4) }
}

export default function ChatSort({
  items,
  live,
  applying,
  onPlan,
  onApplyOption,
  applyMode,
  onOpenSupport
}: Props): React.ReactElement {
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  // Once a layout is applied the files have moved — every other plan in the
  // chat is stale, so all apply buttons lock to prevent double-applies.
  const [appliedOnce, setAppliedOnce] = useState(false)
  const [busy, setBusy] = useState(false)
  const { themed, list: suggestions } = useMemo(() => buildSuggestions(items), [items])

  async function send(text: string): Promise<void> {
    const instruction = text.trim()
    if (!instruction || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: instruction }])
    setBusy(true)
    try {
      const plan = await onPlan(instruction)
      setMsgs((m) => [...m, { role: 'assistant', text: plan.message, plan }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: e instanceof Error ? e.message : String(e) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex-1 space-y-3 overflow-auto p-1 text-sm">
        {msgs.length === 0 && (
          <div className="text-[13px] text-muted">
            <p className="mb-3 leading-relaxed">
              Tell me how you’d like things sorted, in your own words. I’ll suggest a folder layout you
              can apply with one click — and I’ll say so if something isn’t possible.
            </p>
            {!live && (
              <p className="mb-3 rounded-xl border border-peach/30 bg-peach/5 p-3 text-peach">
                Sign in to your ClipRename account (Settings) to use chat sorting.
              </p>
            )}
            <div className="space-y-2">
              <div className="text-xs text-faint">
                {themed
                  ? 'Based on what’s in your clips, try:'
                  : 'Try one of these (clean up names first for smarter ideas):'}
              </div>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={!live || items.length === 0}
                  className="block w-full rounded-xl border border-borderSoft bg-surface px-3 py-2.5 text-left text-muted transition-colors hover:border-faint hover:text-text disabled:opacity-40"
                >
                  “{s}”
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] ${
                m.role === 'user'
                  ? 'bg-mint text-mint-ink'
                  : 'border border-borderSoft bg-surface text-muted'
              }`}
            >
              <div className="whitespace-pre-wrap">{m.text}</div>

              {m.plan && !m.plan.possible && (
                <div className="mt-2 rounded-xl border border-peach/30 bg-peach/5 p-2.5 text-peach">
                  <div className="font-medium">I can’t do that with these files.</div>
                  {m.plan.reason && <div className="mt-1 text-peach/90">{m.plan.reason}</div>}
                  <button
                    onClick={onOpenSupport}
                    className="mt-2 rounded-lg border border-peach/40 px-3 py-1.5 text-xs text-peach transition-colors hover:bg-peach/10"
                  >
                    Get help on cliprename.com →
                  </button>
                </div>
              )}

              {m.plan?.options?.map((opt, oi) => (
                <div key={oi} className="mt-2 rounded-xl border border-borderSoft bg-surface2 p-3">
                  <div className="font-medium text-text">{opt.label}</div>
                  <div className="text-muted">{opt.description}</div>
                  <div className="mt-1.5 text-xs text-faint">{summarize(opt)}</div>
                  <button
                    onClick={() => {
                      void onApplyOption(opt).then((ok) => ok && setAppliedOnce(true))
                    }}
                    disabled={applying || appliedOnce}
                    className="btn-primary mt-2.5 !py-1.5 !px-3 text-xs"
                  >
                    {applying ? 'Working…' : appliedOnce ? 'Applied' : 'Apply this layout'}
                  </button>
                  <div className="mt-1.5 text-[11px] text-faint">
                    Files will be {applyMode === 'move' ? 'moved' : 'copied'} — you can undo right after.
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-mint">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-mint/30 border-t-mint" />
            Thinking about the best layout…
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          disabled={!live}
          placeholder={live ? 'e.g. put all drone shots in an aerial folder' : 'Sign in to start sorting'}
          className="field"
        />
        <button onClick={() => send(input)} disabled={busy || !live} className="btn-primary">
          Send
        </button>
      </div>
    </div>
  )
}

function summarize(opt: SortOption): string {
  const counts = new Map<string, number>()
  for (const a of opt.assignments) {
    const f = a.targetFolder || '(stays in place)'
    counts.set(f, (counts.get(f) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([f, n]) => `${f}: ${n}`)
    .join('   ·   ')
}
