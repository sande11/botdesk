import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { ErrorBox } from '@/components/ui/display.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { useKnowledgeBases } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'

/** Turns an unanswered question into a Q&A source, so the bot can answer it next time. */
export function QuickAnswerDialog({ question, open, onOpenChange }: { question: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace, legal } = useWorkspace()
  const kbs = useKnowledgeBases()
  const qc = useQueryClient()
  const [q, setQ] = useState(question)
  const [answer, setAnswer] = useState('')
  const [kb, setKb] = useState('')
  const [jurisdiction, setJurisdiction] = useState(workspace.settings.default_jurisdiction ?? '')
  // Each time the dialog opens, start from the question it was opened for.
  const [shownFor, setShownFor] = useState<string | null>(open ? question : null)
  if (open && shownFor !== question) {
    setShownFor(question)
    setQ(question)
    setAnswer('')
  } else if (!open && shownFor !== null) {
    setShownFor(null)
  }
  const kbId = kb || kbs.data?.[0]?.id || ''

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from('sources').insert({
          workspace_id: workspace.id,
          knowledge_base_id: kbId,
          kind: 'qa',
          title: q.slice(0, 200),
          question: q,
          content: answer,
          source_type: 'faq',
          jurisdiction: legal && jurisdiction ? jurisdiction : null,
        }),
      ),
    onSuccess: () => {
      toast.success('Answer added. The bot will use it once it is indexed (a few seconds).')
      qc.invalidateQueries({ queryKey: ['sources'] })
      onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add an answer"
      description="Saved as a Q&A source in a knowledge base. Every bot using that knowledge base can then answer it."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!q.trim() || !answer.trim() || !kbId} loading={save.isPending} onClick={() => save.mutate()}>
            Save answer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Question" htmlFor="qa-q">
          <Input id="qa-q" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Answer" htmlFor="qa-a" hint="Write it the way you'd want the bot to say it.">
          <Textarea id="qa-a" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Knowledge base" htmlFor="qa-kb">
            <Select id="qa-kb" value={kbId} onChange={(e) => setKb(e.target.value)}>
              {(kbs.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          </Field>
          {legal && (
            <Field label="Jurisdiction" htmlFor="qa-j" optional>
              <Input id="qa-j" value={jurisdiction} maxLength={12} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} placeholder="MW" />
            </Field>
          )}
        </div>
        <ErrorBox error={save.error} />
      </div>
    </Dialog>
  )
}
