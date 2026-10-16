import { useNavigate, useParams } from 'react-router'
import { Page } from '@/components/layout/AppShell.tsx'
import { PageHeader, Tabs } from '@/components/ui/display.tsx'
import { useWorkspace } from '@/lib/session.tsx'
import { DatasetsTab } from './DatasetsTab.tsx'
import { EvalsTab } from './EvalsTab.tsx'
import { FinetuneTab } from './FinetuneTab.tsx'

export default function TrainingPage() {
  const { tab = 'evals' } = useParams()
  const { base } = useWorkspace()
  const navigate = useNavigate()
  return (
    <Page>
      <PageHeader
        title="Quality & training"
        description="Measure answers with test sets, turn reviewed answers into training data, and fine-tune a model when retrieval and instructions are not enough."
      />
      <Tabs
        value={tab}
        onChange={(t) => navigate(`${base}/training/${t}`)}
        className="mb-6"
        tabs={[
          { value: 'evals', label: 'Evals' },
          { value: 'datasets', label: 'Datasets' },
          { value: 'finetune', label: 'Fine-tuning' },
        ]}
      />
      {tab === 'datasets' ? <DatasetsTab /> : tab === 'finetune' ? <FinetuneTab /> : <EvalsTab />}
    </Page>
  )
}
