import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-300 focus-visible:ring-offset-1 disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-navy-800 text-white shadow-sm hover:bg-navy-700',
        accent: 'bg-amber-400 text-navy-950 shadow-sm hover:bg-amber-300',
        outline: 'border border-line bg-white text-ink hover:bg-navy-50',
        ghost: 'text-ink hover:bg-navy-50',
        soft: 'bg-navy-50 text-navy-800 hover:bg-navy-100',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        link: 'text-navy-600 underline-offset-4 hover:underline px-0',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-[13px]',
        xs: 'h-7 px-2.5 text-xs',
        lg: 'h-11 px-6 text-[15px]',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
