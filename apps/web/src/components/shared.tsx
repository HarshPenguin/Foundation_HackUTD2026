import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  Briefcase,
  ClipboardCheck,
  Code,
  FlaskConical,
  Mail,
  Megaphone,
  MessageSquare,
  RefreshCw,
  ScanSearch,
  Wallet,
  User,
} from 'lucide-react';
import type { Employee, Provider } from '@/module_bindings/types';
import { Badge } from './ui/primitives';
import { cn } from '@/lib/utils';
import { sentence } from '@/lib/format';

const ROLE_ICON: Record<string, typeof User> = {
  translator: MessageSquare,
  manager: Briefcase,
  auditor: ScanSearch,
  researcher: BookOpen,
  updater: RefreshCw,
  developer: Code,
  tester: FlaskConical,
  purser: Wallet,
  reviewer: ClipboardCheck,
  marketer: Megaphone,
  communicator: Mail,
};

export function RoleAvatar({ role, size = 'md', className }: { role: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = ROLE_ICON[role] ?? User;
  const dims = size === 'sm' ? 'size-6 [&_svg]:size-3.5 rounded-md' : size === 'lg' ? 'size-11 [&_svg]:size-5 rounded-xl' : 'size-9 [&_svg]:size-4 rounded-lg';
  const tone =
    role === 'translator' || role === 'manager'
      ? 'bg-navy-800 text-amber-300'
      : role === 'purser'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100';
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', dims, tone, className)}>
      <Icon />
    </span>
  );
}

export function EmployeeChip({ employee, className }: { employee?: Employee; className?: string }) {
  if (!employee) return <Badge tone="outline">Unknown employee</Badge>;
  return (
    <Link
      to={`/developers?employee=${employee.id}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-ink transition-colors hover:border-navy-200 hover:bg-navy-50',
        className
      )}
      title={`Open ${employee.displayName} on My Developers`}
    >
      <RoleAvatar role={employee.role} size="sm" className="rounded-full" />
      {employee.displayName}
      {employee.status === 'fired' && <span className="text-muted">(former)</span>}
    </Link>
  );
}

export function EmployeeStatus({ status }: { status: string }) {
  if (status === 'active') return <Badge tone="ok">Active</Badge>;
  if (status === 'on_review') return <Badge tone="warn">On review</Badge>;
  if (status === 'fired') return <Badge tone="outline">Let go</Badge>;
  return <Badge>{sentence(status)}</Badge>;
}

export function ProviderStatus({ provider }: { provider: Provider }) {
  if (provider.status === 'stopped') return <Badge tone="stop">Stopped</Badge>;
  if (provider.status === 'low') return <Badge tone="warn">Low</Badge>;
  return <Badge tone="ok">Healthy</Badge>;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-report', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-line bg-white font-mono text-[12.5px] leading-5">
      {lines.map((l, i) => {
        const add = l.startsWith('+') && !l.startsWith('+++');
        const del = l.startsWith('-') && !l.startsWith('---');
        const hunk = l.startsWith('@@');
        const meta = l.startsWith('diff ') || l.startsWith('+++') || l.startsWith('---') || l.startsWith('index ');
        return (
          <div
            key={i}
            className={cn(
              'flex whitespace-pre px-3',
              add && 'bg-emerald-50 text-emerald-800',
              del && 'bg-red-50 text-red-800',
              hunk && 'bg-navy-50 text-navy-500',
              meta && 'font-semibold text-navy-700'
            )}
          >
            <span className="mr-3 w-8 shrink-0 select-none text-right text-navy-300">{i + 1}</span>
            <span>{l || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
