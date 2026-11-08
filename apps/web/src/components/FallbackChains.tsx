import { useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { TASK_TYPES, TASK_TYPE_LABEL } from '@/lib/domain';
import { Card, NativeSelect } from './ui/primitives';
import { ProviderStatus } from './shared';
import type { Provider } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

function Row({ id, provider, index, onRemove, canRemove }: { id: string; provider: Provider; index: number; onRemove: () => void; canRemove: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-2',
        isDragging && 'z-10 border-navy-300 shadow-lg',
        provider.status === 'stopped' && 'opacity-70'
      )}
    >
      <button className="cursor-grab touch-none rounded p-0.5 text-navy-300 hover:text-navy-600 active:cursor-grabbing" aria-label={`Drag ${provider.name}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
          index === 0 ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-600'
        )}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{provider.name}</div>
        <div className="truncate text-xs text-muted">{provider.model}</div>
      </div>
      <ProviderStatus provider={provider} />
      {canRemove && (
        <button onClick={onRemove} className="rounded p-1 text-muted hover:bg-navy-50 hover:text-ink" aria-label={`Remove ${provider.name}`}>
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

function Chain({ taskType }: { taskType: string }) {
  const db = useDb();
  const call = useCall();
  const chain = db.chains.find(c => c.taskType === taskType);
  const serverIds = (chain?.providerIds ?? []).map(String);
  const [ids, setIds] = useState<string[]>(serverIds);
  const key = serverIds.join(',');
  useEffect(() => setIds(serverIds), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const save = async (next: string[]) => {
    setIds(next);
    const ok = await call(r => r.setFallbackChain({ taskType, providerIds: next.map(s => BigInt(s)) }), `${TASK_TYPE_LABEL[taskType] ?? taskType} chain saved`);
    if (!ok) setIds(serverIds);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    void save(arrayMove(ids, from, to));
  };

  const missing = db.providers.filter(p => !ids.includes(p.id.toString()));

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">{TASK_TYPE_LABEL[taskType] ?? taskType}</div>
        <div className="text-xs text-muted">First choice on top</div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {ids.map((id, i) => {
              const p = db.providers.find(x => x.id.toString() === id);
              if (!p) return null;
              return <Row key={id} id={id} provider={p} index={i} canRemove={ids.length > 1} onRemove={() => void save(ids.filter(x => x !== id))} />;
            })}
          </ol>
        </SortableContext>
      </DndContext>
      {missing.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <Plus className="size-4 shrink-0 text-muted" />
          <NativeSelect
            className="h-8 flex-1 text-[13px]"
            value=""
            aria-label={`Add a provider to ${taskType}`}
            onChange={e => e.target.value && void save([...ids, e.target.value])}
          >
            <option value="">Add a fallback</option>
            {missing.map(p => (
              <option key={p.id.toString()} value={p.id.toString()}>
                {p.name} ({p.model})
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </Card>
  );
}

export function FallbackChains() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {TASK_TYPES.map(t => (
        <Chain key={t} taskType={t} />
      ))}
    </div>
  );
}
