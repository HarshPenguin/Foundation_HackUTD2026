import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(20,33,58,0.04)]', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-semibold text-ink', className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5 pt-4', className)} {...props} />;
}

export const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100',
      navy: 'bg-navy-800 text-white',
      ok: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
      warn: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
      stop: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
      outline: 'bg-white text-muted ring-1 ring-inset ring-line',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-9 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-navy-300 focus:outline-none focus:ring-2 focus:ring-navy-100 disabled:opacity-60',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 rounded-lg border border-line bg-white pl-3 pr-8 text-sm text-ink focus:border-navy-300 focus:outline-none focus:ring-2 focus:ring-navy-100 disabled:opacity-60',
      className
    )}
    {...props}
  />
));
NativeSelect.displayName = 'NativeSelect';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-[13px] font-medium text-ink', className)} {...props} />;
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent bg-navy-200 transition-colors data-[state=checked]:bg-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-300 disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn('relative flex h-5 w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-navy-100">
        <SliderPrimitive.Range className="absolute h-full bg-navy-700" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-navy-800 bg-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-300" />
    </SliderPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex w-full gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 [scrollbar-width:none]', className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:bg-navy-800 data-[state=active]:text-white [&_svg]:size-4',
        className
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-5 focus-visible:outline-none', className)} {...props} />;
}

/** A horizontal meter. Segments are stacked left to right. */
export function Meter({
  segments,
  max,
  className,
  marker,
}: {
  segments: { value: number; className: string; label?: string }[];
  max: number;
  className?: string;
  marker?: number;
}) {
  const safeMax = max > 0 ? max : 1;
  return (
    <div className={cn('relative h-3 w-full overflow-hidden rounded-full bg-navy-50 ring-1 ring-inset ring-navy-100', className)}>
      <div className="flex h-full w-full">
        {segments.map((s, i) => (
          <div
            key={i}
            title={s.label}
            className={cn('h-full transition-[width] duration-700 ease-out', s.className)}
            style={{ width: `${Math.max(0, Math.min(100, (s.value / safeMax) * 100))}%` }}
          />
        ))}
      </div>
      {marker != null && (
        <div className="absolute inset-y-0 w-0.5 bg-navy-900/70" style={{ left: `${Math.min(100, (marker / safeMax) * 100)}%` }} />
      )}
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function MockTag({ children = 'Demo' }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-navy-200 px-1.5 py-0.5 text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, body }: { icon?: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
      {icon && <div className="text-navy-300 [&_svg]:size-7">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {body && <div className="max-w-sm text-sm text-muted">{body}</div>}
    </div>
  );
}
